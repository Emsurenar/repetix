-- Repetix — användningslogg för AI-anrop
--
-- Kör detta i Supabase SQL Editor efter 0005. Idempotent.
--
-- Tabellen är append-only, byggd som reviews: select och insert, aldrig update
-- eller delete. En bokföringsrad ändras inte och raderas inte, och därför finns
-- varken updated_at-trigger eller deleted_at här.
--
-- Endast tokental lagras, aldrig kostnad. Priser ändras; tokental är fakta.
-- Kostnaden räknas fram vid visning, precis som streak härleds ur reviews i
-- stället för att lagras.

create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null,
  model              text not null,
  -- Vilken funktion i appen som gjorde anropet. Avsiktligt utan check: ett nytt
  -- AI-läge ska inte kräva en migration, och ett okänt värde visas som sitt eget
  -- namn i panelen.
  feature            text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  created_at         timestamptz not null default now()
);

-- Driver panelens enda fråga: den här användarens rader för innevarande månad.
create index if not exists idx_ai_usage_user_time
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select on public.ai_usage;
drop policy if exists ai_usage_insert on public.ai_usage;

create policy ai_usage_select on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- with check hindrar en klient från att skriva någon annans user_id.
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Månadstaket är en preferens och hör hemma bland de andra. null = inget tak.
alter table public.user_settings
  add column if not exists ai_monthly_budget numeric;
