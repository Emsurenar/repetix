-- Repetix — delade kortlekar
--
-- Kör detta i Supabase SQL Editor efter 0009. Idempotent.
--
-- En användare delar en kortlek med en e-postadress. Mottagaren ser den i sin
-- inkorg i appen nästa gång hen öppnar den, och får en EGEN KOPIA vid accept:
-- kortleken lever därefter sitt eget liv hos båda. Ingen levande delning —
-- den hade krävt att radnivåsäkerheten släppte in läsare på främmande rader,
-- och regeln "user_id = auth.uid()" är projektets bärande antagande.
--
-- Delningen är en ÖGONBLICKSBILD. Nyttolasten — namn, mappar, kort, källtexter
-- — skrivs ned i delningsraden när avsändaren delar. Bilderna kopieras av
-- avsändarens webbläsare till ett väntområde i hinken, delningar/<id>/…, som
-- avsändaren får skriva till och mottagaren får läsa ur. Vid accept läser
-- mottagarens webbläsare nyttolasten, kopierar bilderna till sin egen mapp
-- och skriver in allt under sitt eget user_id — genom den vanliga synken.
-- Varje steg görs av en klient som redan har rätten. Ingen service
-- role-nyckel, inga undantag i innehållstabellernas policyer.
--
-- Adressering utan uppslagning. Det går inte att fråga "finns den här
-- adressen?" — profiles saknar e-post och släpper bara igenom den egna raden,
-- och det är med flit: en sådan fråga är ett enumereringsorakel. Inbjudan
-- skrivs mot ADRESSEN, och läses av den vars token bär den. Adressen i token
-- är den Supabase verifierat vid registreringen; därför är e-postbekräftelse
-- ett krav i lanseringschecklistan — utan den kan vem som helst registrera
-- någon annans adress och läsa hens inkorg.

-- ---------------------------------------------------------------------------
-- Adressen ur token
-- ---------------------------------------------------------------------------

-- Normaliserad likadant som vid insättningen: gemener, utan omgivande
-- blanksteg. Null när token saknar adress, och null matchar aldrig något.
create or replace function public.min_epost()
returns text
language sql
stable
as $$
  select lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
$$;

revoke all on function public.min_epost() from public, anon;
grant execute on function public.min_epost() to authenticated;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.deck_shares (
  id              uuid primary key default gen_random_uuid(),
  sender_id       uuid not null references auth.users(id) on delete cascade,
  -- Sätts av share_deck ur token, aldrig av klienten: mottagaren ska kunna
  -- lita på vem delningen kommer ifrån.
  sender_email    text not null,
  recipient_email text not null,
  title           text not null,
  card_count      integer not null default 0,
  image_count     integer not null default 0,
  source_count    integer not null default 0,
  -- Ögonblicksbilden. Nollas när delningen besvarats: den har då gjort sitt,
  -- och en accepterad kortlek ska inte ligga kvar i dubbel upplaga.
  payload         jsonb,
  -- preparing: raden finns men bilderna är ännu på väg till väntområdet.
  -- Mottagaren ser den först som pending, så att en accept aldrig hittar ett
  -- halvfyllt väntområde.
  status          text not null default 'preparing'
                  check (status in ('preparing', 'pending', 'accepted', 'declined')),
  created_at      timestamptz not null default now(),
  -- Obesvarad delning går ut. Nyttolasten kostar plats, och en inbjudan från
  -- i våras är ingen inbjudan längre.
  expires_at      timestamptz not null default now() + interval '30 days',
  responded_at    timestamptz,

  -- Åtta megabyte. Källtexterna är det som väger: en föreläsning är hundra
  -- kilobyte, och taket i klienten släpper igenom femtio källor.
  constraint deck_shares_payload_size
    check (payload is null or pg_column_size(payload) <= 8388608),
  constraint deck_shares_recipient_form check (
    recipient_email = lower(btrim(recipient_email))
    and length(recipient_email) between 3 and 320
    and position('@' in recipient_email) > 1
  ),
  constraint deck_shares_title_len check (length(title) between 1 and 200),
  constraint deck_shares_counts check (
    card_count between 0 and 5000
    and image_count between 0 and 500
    and source_count between 0 and 50
  )
);

-- Inkorgen: mottagarens väntande, och avsändarens egna.
create index if not exists idx_deck_shares_recipient
  on public.deck_shares (recipient_email, status, expires_at);
create index if not exists idx_deck_shares_sender
  on public.deck_shares (sender_id, created_at desc);

alter table public.deck_shares enable row level security;
revoke all on table public.deck_shares from public, anon;
grant select, delete on table public.deck_shares to authenticated;

-- Läsa: avsändaren ser sina egna, mottagaren ser dem som väntar på hen.
-- Mottagaren ser aldrig en delning som förbereds, gått ut eller besvarats.
drop policy if exists deck_shares_select on public.deck_shares;
create policy deck_shares_select on public.deck_shares
  for select to authenticated
  using (
    sender_id = (select auth.uid())
    or (
      status = 'pending'
      and expires_at > now()
      and recipient_email = public.min_epost()
    )
  );

-- Radera: bara avsändaren. Det är återkallelsen, och städningen av det som
-- gått ut eller besvarats.
drop policy if exists deck_shares_delete on public.deck_shares;
create policy deck_shares_delete on public.deck_shares
  for delete to authenticated
  using (sender_id = (select auth.uid()));

-- Ingen insert- eller update-policy. Skrivningarna går genom funktionerna
-- nedan, som sätter avsändaren ur token och håller taken — en klient som
-- kunde skriva raden själv hade kunnat sätta vilken avsändare som helst.

-- ---------------------------------------------------------------------------
-- Dela
-- ---------------------------------------------------------------------------

-- Skapar delningen i läget preparing och returnerar dess id, som klienten
-- behöver för väntområdets sökväg. Först när bilderna ligger där anropas
-- publish_share.
create or replace function public.share_deck(
  p_recipient_email text,
  p_title           text,
  p_card_count      integer,
  p_image_count     integer,
  p_source_count    integer,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := (select auth.uid());
  v_epost    text := public.min_epost();
  v_till     text := lower(btrim(coalesce(p_recipient_email, '')));
  v_vantande integer;
  v_id       uuid;
begin
  if v_user is null or v_epost is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;
  if v_till = v_epost then
    raise exception 'Du kan inte dela med dig själv.' using errcode = '22023';
  end if;

  -- Taket är ett skräpskydd, inte en kvot: femtio obesvarade delningar från
  -- ett konto är inte något en människa gör.
  select count(*) into v_vantande
    from public.deck_shares
   where sender_id = v_user and status in ('preparing', 'pending');
  if v_vantande >= 50 then
    raise exception 'Du har redan femtio obesvarade delningar.' using errcode = '53400';
  end if;

  insert into public.deck_shares
    (sender_id, sender_email, recipient_email, title, card_count, image_count, source_count, payload)
  values
    (v_user, v_epost, v_till, left(coalesce(p_title, ''), 200),
     coalesce(p_card_count, 0), coalesce(p_image_count, 0), coalesce(p_source_count, 0), p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.share_deck(text, text, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.share_deck(text, text, integer, integer, integer, jsonb) to authenticated;

-- Väntområdet är fyllt: nu får mottagaren se delningen.
create or replace function public.publish_share(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deck_shares
     set status = 'pending'
   where id = p_id
     and sender_id = (select auth.uid())
     and status = 'preparing';
  if not found then
    raise exception 'Delningen finns inte.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.publish_share(uuid) from public, anon;
grant execute on function public.publish_share(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Svara
-- ---------------------------------------------------------------------------

-- Acceptera eller neka. Bara mottagaren, bara en väntande delning, bara en
-- gång: nyttolasten nollas, så en andra accept har inget att kopiera.
--
-- Väntområdets rader i storage.objects tas bort här som skyddsnät. Klienten
-- SKA ta filerna via lagrings-API:et före anropet — en rad som tas bort med
-- SQL tar inte alltid själva filen med sig — men hann den inte ska det inte
-- lämna kvar rader som pekar på filer mottagaren inte längre får läsa.
create or replace function public.respond_to_share(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_epost text := public.min_epost();
begin
  if v_epost is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;

  update public.deck_shares
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(),
         payload = null
   where id = p_id
     and status = 'pending'
     and expires_at > now()
     and recipient_email = v_epost;
  if not found then
    raise exception 'Delningen finns inte längre.' using errcode = 'P0002';
  end if;

  delete from storage.objects
   where bucket_id = 'card-images'
     and name like 'delningar/' || p_id::text || '/%';
end;
$$;

revoke all on function public.respond_to_share(uuid, boolean) from public, anon;
grant execute on function public.respond_to_share(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Väntområdet i hinken
-- ---------------------------------------------------------------------------

-- Sökvägen är delningar/<delnings-id>/<fil>. Avsändaren når sin delnings
-- mapp så länge delningen finns; mottagaren så länge den väntar på hen.
-- Policyn läggs BREDVID card_images_own från 0001, som fortsätter kräva att
-- första mappnivån är det egna user-id:t för allt annat i hinken.
--
-- Kopiering i lagrings-API:et kräver läsrätt på källan och skrivrätt på
-- målet. Avsändaren läser sin egen mapp (0001) och skriver i väntområdet
-- (här); mottagaren läser väntområdet (här) och skriver i sin egen mapp
-- (0001). Ingen av dem når den andres mapp.
drop policy if exists card_images_share_staging on storage.objects;
create policy card_images_share_staging on storage.objects
  for all to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = 'delningar'
    and exists (
      select 1 from public.deck_shares s
       where s.id::text = (storage.foldername(name))[2]
         and (
           s.sender_id = (select auth.uid())
           or (
             s.status = 'pending'
             and s.expires_at > now()
             and s.recipient_email = public.min_epost()
           )
         )
    )
  )
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = 'delningar'
    and exists (
      select 1 from public.deck_shares s
       where s.id::text = (storage.foldername(name))[2]
         and s.sender_id = (select auth.uid())
    )
  );

-- Kontoraderingen i 0005 tar användarens egen mapp. Delningar som väntar
-- kaskaderar bort med raden i deck_shares, men filerna i väntområdet gör det
-- inte av sig själva: de tas här, så att en raderad avsändare inte lämnar
-- sina bilder kvar under ett id ingen längre äger.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;

  delete from storage.objects
  where bucket_id = 'card-images'
    and (storage.foldername(name))[1] = v_user::text;

  delete from storage.objects
  where bucket_id = 'card-images'
    and (storage.foldername(name))[1] = 'delningar'
    and (storage.foldername(name))[2] in (
      select id::text from public.deck_shares where sender_id = v_user
    );

  delete from auth.users where id = v_user;
end;
$$;

-- PostgREST måste läsa om schemat för att se de nya funktionerna.
notify pgrst, 'reload schema';
