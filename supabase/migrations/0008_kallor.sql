-- Repetix — källdokument per kortlek
--
-- Kör detta i Supabase SQL Editor efter 0007. Idempotent.
--
-- Två tabeller, inte en. Texten är hundra kilobyte per föreläsning och behövs
-- bara när AI:n faktiskt ska läsa den; metadatan behövs varje gång kortleken
-- öppnas. Delade de rad hade varje listning dragit med hela texten.
--
-- INGEN av dem går genom synken. Synken är en diff mot S.appData, inte en
-- tabellista: att ta in källor där hade krävt ändringar i appdatan, i
-- flatten(), i diffen och i utkorgen — för en funktion som ändå inte fungerar
-- utan nät, eftersom både generering och frågor går till AI:n. user_settings
-- och ai_usage nås redan på samma sätt, med direkta anrop.

create table if not exists public.sources (
  -- text, inte uuid, och utan default: källan skapas i webbläsaren när texten
  -- utvunnits, precis som en kortlek eller ett kort, och id:t kommer därför ur
  -- nyttId() i klienten. ai_usage kunde ha uuid med default eftersom SERVERN
  -- skapar de raderna.
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Främmande nyckel: se alter-satserna nedan för ägarskapsvillkoren.
  deck_id    text not null,
  title      text not null,
  pages      integer not null default 0,
  chars      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mjuk radering, som allt annat användaren äger.
  deleted_at timestamptz
);

create table if not exists public.source_texts (
  source_id text primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  text      text not null
);

-- Driver den enda frågan: den här kortlekens källor, nyast först.
create index if not exists idx_sources_deck on public.sources (user_id, deck_id, created_at desc);

alter table public.sources enable row level security;
alter table public.source_texts enable row level security;

drop policy if exists own_rows on public.sources;
drop policy if exists own_rows on public.source_texts;

-- Samma form som cards: användaren äger sina rader helt.
create policy own_rows on public.sources
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy own_rows on public.source_texts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- updated_at-triggern som resten av tabellerna har.
drop trigger if exists set_updated_at on public.sources;
create trigger set_updated_at before update on public.sources
  for each row execute function public.set_updated_at();

-- Ägarskap på de främmande nycklarna, enligt konventionen i 0005: en unik
-- nyckel på (user_id, id) som barnen pekas om till, så att barn och förälder
-- tvingas dela ägare. En vanlig FK hindrar inte att en rad med MITT user_id
-- pekar på DIN kortlek — radnivåsäkerheten kontrollerar radens eget user_id,
-- inte förälderns — och då tar en radering av din kortlek tyst med sig mina
-- rader via kaskaden.
--
-- Satserna står separat från create table eftersom tabellerna kan finnas
-- redan: create table if not exists ändrar inte en befintlig tabell.
do $$
begin
  -- Unika nycklar. IF NOT EXISTS finns inte för constraints, därav vaktposten.
  if not exists (select 1 from pg_constraint where conname = 'sources_owner_id_key') then
    alter table public.sources add constraint sources_owner_id_key unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'source_texts_owner_id_key') then
    alter table public.source_texts add constraint source_texts_owner_id_key unique (user_id, id);
  end if;
end $$;

-- De främmande nycklarna pekas om till (user_id, id).
alter table public.sources drop constraint if exists sources_deck_id_fkey;
alter table public.sources drop constraint if exists sources_deck_fk;
alter table public.sources add constraint sources_deck_fk
  foreign key (user_id, deck_id) references public.decks (user_id, id)
  on delete cascade;

alter table public.source_texts drop constraint if exists source_texts_source_id_fkey;
alter table public.source_texts drop constraint if exists source_texts_source_fk;
alter table public.source_texts add constraint source_texts_source_fk
  foreign key (user_id, source_id) references public.sources (user_id, id)
  on delete cascade;
