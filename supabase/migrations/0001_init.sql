-- Repetix — grundschema
--
-- Kör detta i Supabase SQL Editor. Skriptet är idempotent och går att köra om.
--
-- Två principer styr schemat:
--
-- 1. Radnivåsäkerhet på varje tabell. Varje rad bär user_id och varje policy
--    kräver user_id = auth.uid(). Det betyder att en bugg i klientkoden aldrig
--    kan lämna ut en användares kort till en annan — spärren sitter i
--    databasen, inte i applikationen.
--
-- 2. Mjuk radering och updated_at överallt. Synken löser konflikter med
--    senaste ändring vinner per rad, och en hård radering på en enhet skulle
--    annars återuppstå från en annan enhet som inte sett raderingen.

-- ---------------------------------------------------------------------------
-- Hjälpfunktioner
-- ---------------------------------------------------------------------------

-- gen_random_uuid() används av reviews och är inbyggd sedan PostgreSQL 13.
-- Ingen extension behöver installeras.

-- Sätter updated_at vid varje uppdatering. Klienten får inte styra fältet
-- själv, eftersom en felställd klocka på en enhet annars skulle kunna låsa
-- ute alla framtida ändringar från andra enheter.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Konton
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Skapar en profilrad automatiskt när ett konto registreras.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Innehåll
-- ---------------------------------------------------------------------------

create table if not exists public.bookshelves (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  color       text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.decks (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  bookshelf_id  text references public.bookshelves(id) on delete set null,
  title         text not null,
  color         text,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.sections (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  deck_id     text not null references public.decks(id) on delete cascade,
  title       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.cards (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  deck_id       text not null references public.decks(id) on delete cascade,
  section_id    text references public.sections(id) on delete set null,
  type          text not null default 'card' check (type in ('card', 'note')),
  front         text,
  back          text,
  content       text,
  is_long_form  boolean not null default false,
  position      integer not null default 0,

  -- SM-2. Defaults speglar domain/srs.js: ett nytt kort är förfallet direkt.
  repetition       integer not null default 0,
  interval_days    double precision not null default 0,
  ease_factor      double precision not null default 2.5 check (ease_factor >= 1.3),
  next_review_date timestamptz not null default now(),
  lapses           integer not null default 0,
  last_reviewed    timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.card_images (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  card_id       text not null references public.cards(id) on delete cascade,
  storage_path  text not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.notebooks (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  bookshelf_id  text references public.bookshelves(id) on delete set null,
  title         text not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.notes (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  notebook_id  text not null references public.notebooks(id) on delete cascade,
  content      text,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Repetitionslogg
-- ---------------------------------------------------------------------------

-- Append-only. Raderna ändras aldrig, bara läggs till.
--
-- Detta ersätter den gamla statistiken, som härleddes ur card.lastReviewed —
-- ett fält som skrivs över vid varje ny repetition, så att historiken raderade
-- sig själv bakåt i tiden. Med en logg blir streak, heatmap och rekord
-- korrekta för all framtid. Loggen kan heller aldrig konflikta vid synk,
-- eftersom rader bara tillkommer.
create table if not exists public.reviews (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  card_id         text not null,
  deck_id         text,
  rating          smallint not null check (rating between 1 and 4),
  reviewed_at     timestamptz not null default now(),
  interval_before double precision,
  interval_after  double precision,
  ease_after      double precision,
  mode            text not null default 'study',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inställningar och AI-nycklar
-- ---------------------------------------------------------------------------

create table if not exists public.user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  ai_provider text not null default 'anthropic',
  ai_model    text,
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Användarens egen API-nyckel, krypterad. Kolumnen innehåller chiffertext som
-- bara serverfunktionen kan dekryptera; klienten läser aldrig ut den.
--
-- Därför saknar tabellen medvetet en select-policy: klienten får skriva och
-- radera sin nyckel, och läsa metadata via vyn nedan, men aldrig hämta
-- chiffertexten. Det gör att en XSS-bugg i klienten inte kan exfiltrera
-- nyckeln.
create table if not exists public.user_ai_keys (
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,
  encrypted_key text not null,
  key_hint      text,
  last_verified timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

create or replace view public.user_ai_key_status
with (security_invoker = true) as
  select user_id, provider, key_hint, last_verified, updated_at
  from public.user_ai_keys;

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

create index if not exists idx_bookshelves_user   on public.bookshelves (user_id, updated_at);
create index if not exists idx_decks_user         on public.decks (user_id, updated_at);
create index if not exists idx_decks_shelf        on public.decks (bookshelf_id);
create index if not exists idx_sections_user      on public.sections (user_id, updated_at);
create index if not exists idx_sections_deck      on public.sections (deck_id);
create index if not exists idx_cards_user         on public.cards (user_id, updated_at);
create index if not exists idx_cards_deck         on public.cards (deck_id);
create index if not exists idx_cards_section      on public.cards (section_id);
-- Driver "vad ska repeteras nu": den vanligaste frågan i hela appen.
create index if not exists idx_cards_due          on public.cards (user_id, next_review_date)
  where deleted_at is null and type = 'card';
create index if not exists idx_card_images_card   on public.card_images (card_id);
create index if not exists idx_notebooks_user     on public.notebooks (user_id, updated_at);
create index if not exists idx_notes_notebook     on public.notes (notebook_id);
create index if not exists idx_notes_user         on public.notes (user_id, updated_at);
-- Driver streak, heatmap och rekord.
create index if not exists idx_reviews_user_time  on public.reviews (user_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- updated_at-triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'bookshelves', 'decks', 'sections', 'cards', 'card_images',
    'notebooks', 'notes', 'user_settings', 'user_ai_keys'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Radnivåsäkerhet
-- ---------------------------------------------------------------------------

-- Tabeller där användaren äger sina rader helt: läsa, skapa, ändra, radera.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'bookshelves', 'decks', 'sections', 'cards', 'card_images',
    'notebooks', 'notes', 'user_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
  end loop;
end;
$$;

-- profiles har id som ägarkolumn, övriga har user_id.
create policy own_rows on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'bookshelves', 'decks', 'sections', 'cards', 'card_images',
    'notebooks', 'notes', 'user_settings'
  ]
  loop
    execute format(
      'create policy own_rows on public.%I
         for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- reviews: append-only. Ingen update- eller delete-policy finns, vilket gör
-- loggen oföränderlig även för dess egen ägare.
alter table public.reviews enable row level security;
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated using (user_id = (select auth.uid()));
create policy reviews_insert on public.reviews
  for insert to authenticated with check (user_id = (select auth.uid()));

-- user_ai_keys: skriv och radera, men aldrig select. Klienten kan alltså
-- spara och byta nyckel utan att någonsin kunna läsa tillbaka den.
alter table public.user_ai_keys enable row level security;
drop policy if exists ai_keys_insert on public.user_ai_keys;
drop policy if exists ai_keys_update on public.user_ai_keys;
drop policy if exists ai_keys_delete on public.user_ai_keys;
create policy ai_keys_insert on public.user_ai_keys
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy ai_keys_update on public.user_ai_keys
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy ai_keys_delete on public.user_ai_keys
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Lagring för kortbilder
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

-- Varje användare får en egen mapp döpt efter sitt user-id. Policyn jämför
-- första mappnivån i sökvägen mot auth.uid().
drop policy if exists card_images_own on storage.objects;
create policy card_images_own on storage.objects
  for all to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
