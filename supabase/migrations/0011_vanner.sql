-- Repetix — vänner, profiler och delning med vänner
--
-- Kör detta i Supabase SQL Editor efter 0010. Idempotent.
--
-- Tre saker på en gång, eftersom de hänger ihop:
--
--   1. PROFILER blir synliga. Tabellen profiles fanns sedan 0001 men släppte
--      bara igenom den egna raden. Den får ett handtag (@namn), en profilbild
--      och en statistikbild, och en profil MED handtag går att läsa för alla
--      inloggade. Utan handtag är den lika osynlig som förut: att bli hittad
--      är något man väljer genom att ta ett namn, inte något som händer en.
--      Profilen bär aldrig e-postadressen.
--
--   2. VÄNSKAPER. En rad per par, i ett av två lägen: pending (förfrågan)
--      eller accepted. Skrivningarna går genom funktioner som slår upp
--      handtaget, hindrar dubbletter och tak, och låter en förfrågan i
--      motsatt riktning bli en accept i stället för en andra förfrågan.
--
--   3. DELNING MED VÄNNER. deck_shares adresseras hittills till en
--      e-postadress som aldrig slås upp (se 0010). En vän har ett id, och en
--      delning till ett id kräver att paret är vänner — annars vore varje
--      profil en adress vem som helst kan skicka till. Delningen får också
--      en sort: hel kortlek, en mapp, eller ett enda kort. Innehållet är
--      samma ögonblicksbild som förut; sorten styr bara vad mottagaren
--      erbjuds att göra med den.
--
-- STATISTIKEN skrivs av ägarens egen klient, inte av databasen. Korten,
-- kortlekarna och repetitionsloggen ligger bakom radnivåsäkerhet som bara
-- släpper in ägaren, och det ska den fortsätta göra. Klienten räknar samma
-- tal som Spelhallen visar och lägger dem i profiles.stats — en bild som kan
-- vara några minuter gammal, men aldrig kräver att någon annan får läsa
-- ägarens rader. Talen går att förfalska av den som redigerar sin egen rad;
-- det är samma sak som att ljuga om sin streak för en kompis, och det finns
-- ingen tävling att vinna.

-- ---------------------------------------------------------------------------
-- 1. Profilen
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists handle            text,
  add column if not exists avatar_path       text,
  add column if not exists stats             jsonb,
  add column if not exists stats_updated_at  timestamptz;

-- Handtaget: små bokstäver, siffror och understreck, 3–20 tecken. Gemener
-- av samma skäl som e-postadresser normaliseras — @Anna och @anna ska inte
-- kunna vara två personer.
alter table public.profiles drop constraint if exists profiles_handle_form;
alter table public.profiles add constraint profiles_handle_form
  check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or length(display_name) between 1 and 40);

-- Bilden ligger i hinken avatars under den egna mappen. Villkoret binder
-- sökvägen till raden: ingen kan peka sin profil på någon annans bild.
alter table public.profiles drop constraint if exists profiles_avatar_form;
alter table public.profiles add constraint profiles_avatar_form
  check (
    avatar_path is null
    or avatar_path ~ ('^' || id::text || '/avatar\.(webp|jpg|png)$')
  );

-- Statistikbilden är liten: några tal, en lista med prestationer och ett
-- halvår av dagsräkningar. 64 kB är tio gånger det.
alter table public.profiles drop constraint if exists profiles_stats_size;
alter table public.profiles add constraint profiles_stats_size
  check (stats is null or pg_column_size(stats) <= 65536);

create unique index if not exists profiles_handle_unique on public.profiles (handle);

-- Läsa andras profiler: bara de som tagit ett handtag. Policyn läggs BREDVID
-- own_rows från 0001, som fortsätter ge ägaren allt på sin egen rad.
drop policy if exists profiles_public_select on public.profiles;
create policy profiles_public_select on public.profiles
  for select to authenticated
  using (handle is not null);

-- ---------------------------------------------------------------------------
-- 2. Vänskaper
-- ---------------------------------------------------------------------------

create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  -- Nycklarna pekar på profiles och inte auth.users, så att klienten kan
  -- hämta namn och bild i samma fråga. Profilen kaskaderar från kontot.
  requester_id  uuid not null references public.profiles(id) on delete cascade,
  addressee_id  uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- Ett par är ett par oavsett vem som frågade först.
create unique index if not exists friendships_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists idx_friendships_addressee on public.friendships (addressee_id, status);
create index if not exists idx_friendships_requester on public.friendships (requester_id, status);

alter table public.friendships enable row level security;
revoke all on table public.friendships from public, anon;
grant select, delete on table public.friendships to authenticated;

-- Båda parter ser raden. Båda får ta bort den: att ta bort en vän, neka en
-- förfrågan och dra tillbaka en förfrågan är samma sak för databasen.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

-- Ingen insert- eller update-policy: skrivningarna går genom funktionerna.

-- Skickar en förfrågan till ett handtag. Finns det redan en förfrågan från
-- den andra blir det här ett svar på den — två som vill samma sak ska inte
-- behöva vänta på varandra. Returnerar radens id.
create or replace function public.send_friend_request(p_handle text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := (select auth.uid());
  v_till    uuid;
  v_rad     public.friendships%rowtype;
  v_vantar  integer;
begin
  if v_user is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;

  select id into v_till from public.profiles
   where handle = lower(btrim(coalesce(p_handle, '')));
  if v_till is null then
    raise exception 'Det finns ingen med det namnet.' using errcode = 'P0002';
  end if;
  if v_till = v_user then
    raise exception 'Du kan inte bli vän med dig själv.' using errcode = '22023';
  end if;

  select * into v_rad from public.friendships
   where least(requester_id, addressee_id) = least(v_user, v_till)
     and greatest(requester_id, addressee_id) = greatest(v_user, v_till);

  if found then
    if v_rad.status = 'accepted' then
      raise exception 'Ni är redan vänner.' using errcode = '23505';
    end if;
    if v_rad.requester_id = v_user then
      raise exception 'Förfrågan är redan skickad.' using errcode = '23505';
    end if;
    -- Den andra har redan frågat: det här är ett ja.
    update public.friendships
       set status = 'accepted', responded_at = now()
     where id = v_rad.id;
    return v_rad.id;
  end if;

  -- Taket är ett skräpskydd: femtio obesvarade förfrågningar från ett konto
  -- är inte något en människa gör.
  select count(*) into v_vantar from public.friendships
   where requester_id = v_user and status = 'pending';
  if v_vantar >= 50 then
    raise exception 'Du har redan femtio obesvarade förfrågningar.' using errcode = '53400';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (v_user, v_till)
  returning id into v_rad.id;
  return v_rad.id;
end;
$$;

revoke all on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- Tackar ja. Bara den tillfrågade, bara en väntande förfrågan.
create or replace function public.accept_friend_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friendships
     set status = 'accepted', responded_at = now()
   where id = p_id
     and addressee_id = (select auth.uid())
     and status = 'pending';
  if not found then
    raise exception 'Förfrågan finns inte längre.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- Är två konton vänner? Används av delningen nedan och av lagringspolicyn.
create or replace function public.ar_vanner(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and least(requester_id, addressee_id) = least(p_a, p_b)
       and greatest(requester_id, addressee_id) = greatest(p_a, p_b)
  )
$$;

revoke all on function public.ar_vanner(uuid, uuid) from public, anon;
grant execute on function public.ar_vanner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profilbilden
-- ---------------------------------------------------------------------------

-- En publik hink: bilden visas på profiler som alla inloggade får se, och en
-- signerad länk per bild hade kostat ett anrop per rad i vänlistan. Publik
-- betyder att den som har länken ser bilden — samma sak som på varje annan
-- sida med profilbilder. Små filer, tre bildtyper, aldrig SVG (se 0004).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Var och en skriver i sin egen mapp, precis som i card-images.
drop policy if exists avatars_own on storage.objects;
create policy avatars_own on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 4. Delning med vänner, och delning av mappar och kort
-- ---------------------------------------------------------------------------

alter table public.deck_shares
  add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
  add column if not exists kind         text not null default 'deck';

alter table public.deck_shares drop constraint if exists deck_shares_kind;
alter table public.deck_shares add constraint deck_shares_kind
  check (kind in ('deck', 'section', 'card'));

-- Adressen blir valfri: antingen en adress eller ett id, aldrig båda.
alter table public.deck_shares alter column recipient_email drop not null;
alter table public.deck_shares drop constraint if exists deck_shares_recipient_form;
alter table public.deck_shares add constraint deck_shares_recipient_form check (
  (
    recipient_id is null
    and recipient_email is not null
    and recipient_email = lower(btrim(recipient_email))
    and length(recipient_email) between 3 and 320
    and position('@' in recipient_email) > 1
  )
  or (recipient_id is not null and recipient_email is null)
);

-- Avsändarens profil, så att inkorgen kan visa ett namn i stället för en
-- adress. En andra främmande nyckel på samma kolumn: den mot auth.users
-- från 0010 står kvar.
alter table public.deck_shares drop constraint if exists deck_shares_sender_profile_fkey;
alter table public.deck_shares add constraint deck_shares_sender_profile_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;

create index if not exists idx_deck_shares_recipient_id
  on public.deck_shares (recipient_id, status, expires_at);

-- Läsa: avsändaren ser sina egna; den adresserade ser dem som väntar; en
-- vän ser också det hen redan svarat på, så att "delat mellan er" på
-- profilen kan visa historiken från båda håll. Nyttolasten nollas vid svar,
-- så en besvarad rad bär ändå inget innehåll.
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
    or (
      recipient_id = (select auth.uid())
      and status <> 'preparing'
    )
  );

-- share_deck får en ny signatur. Den gamla tas bort: två funktioner med
-- samma namn hade gjort anropet tvetydigt för PostgREST.
drop function if exists public.share_deck(text, text, integer, integer, integer, jsonb);

create or replace function public.share_deck(
  p_recipient_email text,
  p_recipient_id    uuid,
  p_kind            text,
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
  v_till     text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
  v_kind     text := coalesce(nullif(p_kind, ''), 'deck');
  v_vantande integer;
  v_id       uuid;
begin
  if v_user is null or v_epost is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;
  if v_kind not in ('deck', 'section', 'card') then
    raise exception 'Okänd sorts delning.' using errcode = '22023';
  end if;

  if p_recipient_id is not null then
    -- Till ett id: bara till en vän. Annars vore varje profil en adress vem
    -- som helst kan fylla med kortlekar.
    if p_recipient_id = v_user then
      raise exception 'Du kan inte dela med dig själv.' using errcode = '22023';
    end if;
    if not public.ar_vanner(v_user, p_recipient_id) then
      raise exception 'Ni är inte vänner.' using errcode = '42501';
    end if;
    v_till := null;
  else
    if v_till is null then
      raise exception 'Ingen mottagare angiven.' using errcode = '22023';
    end if;
    if v_till = v_epost then
      raise exception 'Du kan inte dela med dig själv.' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_vantande
    from public.deck_shares
   where sender_id = v_user and status in ('preparing', 'pending');
  if v_vantande >= 50 then
    raise exception 'Du har redan femtio obesvarade delningar.' using errcode = '53400';
  end if;

  insert into public.deck_shares
    (sender_id, sender_email, recipient_email, recipient_id, kind, title,
     card_count, image_count, source_count, payload)
  values
    (v_user, v_epost, v_till, p_recipient_id, v_kind, left(coalesce(p_title, ''), 200),
     coalesce(p_card_count, 0), coalesce(p_image_count, 0), coalesce(p_source_count, 0), p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.share_deck(text, uuid, text, text, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.share_deck(text, uuid, text, text, integer, integer, integer, jsonb) to authenticated;

-- Svaret matchar nu både adress och id.
create or replace function public.respond_to_share(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := (select auth.uid());
  v_epost text := public.min_epost();
begin
  if v_user is null then
    raise exception 'Ingen inloggad användare.' using errcode = '28000';
  end if;

  update public.deck_shares
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(),
         payload = null
   where id = p_id
     and status = 'pending'
     and expires_at > now()
     and (
       (recipient_email is not null and recipient_email = v_epost)
       or recipient_id = v_user
     );
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

-- Väntområdet: mottagaren med id får läsa det som väntar på hen, som den
-- med adress får sedan 0010.
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
             and (
               (s.recipient_email is not null and s.recipient_email = public.min_epost())
               or s.recipient_id = (select auth.uid())
             )
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

-- ---------------------------------------------------------------------------
-- 5. Kontoraderingen tar profilbilden med sig
-- ---------------------------------------------------------------------------

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

  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = v_user::text;

  delete from auth.users where id = v_user;
end;
$$;

-- PostgREST måste läsa om schemat för att se de nya kolumnerna och
-- funktionerna.
notify pgrst, 'reload schema';
