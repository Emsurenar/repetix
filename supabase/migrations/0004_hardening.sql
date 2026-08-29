-- Repetix — härdning inför publicering
--
-- Kör detta i Supabase SQL Editor efter 0003. Idempotent och går att köra om.
--
-- Registreringen är öppen, alltså är "en inloggad användare" inte längre samma
-- sak som "ägaren". Migrationen ger databasen tre saker den saknade:
--
--   1. En takt-spärr som serverfunktionerna kan räkna i. Utan den kan ett
--      nyregistrerat konto binda hundratals serverfunktioner samtidigt, och
--      använda nyckelkontrollen som ett orakel för skrapade API-nycklar.
--   2. Riktiga gränser på bildhinken. Utan dem är den gratis filhotell för vem
--      som helst med ett konto.
--   3. security_barrier på vyn över nyckelstatus.

-- ---------------------------------------------------------------------------
-- Takt-spärr
-- ---------------------------------------------------------------------------

-- En rad per användare, slutpunkt och tidsfönster. Fast fönster och inte
-- glidande: ett glidande fönster kräver en rad per anrop och en städning som
-- hinner med, medan det här kräver en enda rad som stegas uppåt.
create table if not exists public.api_usage (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  endpoint     text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (user_id, endpoint, window_start)
);

-- Ingen kommer åt tabellen direkt. Radnivåsäkerhet utan en enda policy betyder
-- noll rader för alla utom tabellens ägare — och ägaren är funktionen nedan.
-- Skulle någon kunna skriva i tabellen själv vore spärren en formsak: man
-- nollställde sin egen räknare och fortsatte.
alter table public.api_usage enable row level security;
revoke all on table public.api_usage from public, anon, authenticated;

comment on table public.api_usage is
  'Räknare för takt-spärren i api/_lib/limit.js. Skrivs enbart av bump_rate_limit().';

-- Stegar räknaren för ett fönster och svarar om anropet får gå igenom.
--
-- security definer av samma skäl som get_my_ai_key: funktionen måste förbi
-- radnivåsäkerheten, men härleder användaren ur auth.uid() och kan därför bara
-- någonsin räkna på anroparens egna rader. Att den är anropbar direkt från
-- klienten är ofarligt — den enda effekten är att räknaren stegas uppåt, vilket
-- bara drabbar den som anropar.
create or replace function public.bump_rate_limit(
  p_endpoint       text,
  p_limit          integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid    := auth.uid();
  -- Argumenten kommer från serverfunktionen, men slutpunkten är anropbar direkt
  -- och får därför inte kunna skapa en rad med hundra års fönster.
  v_window integer := least(greatest(coalesce(p_window_seconds, 60), 1), 86400);
  v_limit  integer := least(greatest(coalesce(p_limit, 1), 1), 100000);
  v_key    text;
  v_start  timestamptz;
  v_hits   integer;
begin
  if v_user is null then
    raise exception 'bump_rate_limit kräver en inloggad användare';
  end if;

  -- Fönsterlängden ingår i nyckeln. Utan den delar minut- och timfönstret rad
  -- varje gång de råkar börja i samma sekund, och den korta spärren äter den
  -- långas kvot.
  v_key := left(coalesce(p_endpoint, ''), 48) || ':' || v_window;

  -- Fönstrets start avrundas nedåt till en hel fönsterlängd, så att alla anrop
  -- inom samma fönster hittar samma rad utan att behöva komma överens om något.
  v_start := to_timestamp(
    (floor(extract(epoch from now()) / v_window) * v_window)::double precision
  );

  -- Städar användarens egna utgångna räknare i samma anrop. Tabellen stannar
  -- därmed på en rad per användare och spärr, utan att något schemalagt jobb
  -- behöver finnas och hållas vid liv.
  delete from public.api_usage
   where user_id = v_user
     and endpoint = v_key
     and window_start < v_start;

  -- Ett enda uttryck, alltså atomärt: två samtidiga anrop kan inte läsa samma
  -- värde och båda tro att de var under taket.
  insert into public.api_usage as u (user_id, endpoint, window_start, hits)
  values (v_user, v_key, v_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set hits = u.hits + 1
  returning u.hits into v_hits;

  -- Även avvisade anrop räknas. Den som fortsätter hamra sig mot en stängd dörr
  -- ska inte kunna hålla räknaren precis under taket genom att sluta räknas.
  return jsonb_build_object(
    'allowed',    v_hits <= v_limit,
    'remaining',  greatest(v_limit - v_hits, 0),
    'limit',      v_limit,
    'retryAfter', greatest(
      ceil(extract(epoch from (v_start + make_interval(secs => v_window)) - now()))::integer,
      1
    )
  );
end;
$$;

revoke all on function public.bump_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.bump_rate_limit(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Bildhinken
-- ---------------------------------------------------------------------------

-- 0001 skapade hinken med `on conflict do nothing`, vilket inte rör en hink som
-- redan finns. En hink som en gång blivit publik förblev alltså publik, och
-- varken storlek eller filtyp har någonsin varit begränsad. Här sätts alla tre
-- varje gång skriptet körs.
--
-- 5 MB: klienten komprimerar bilder före uppladdning och landar långt under
-- det. Taket finns för det som inte går genom komprimeringen.
--
-- image/svg+xml är medvetet utelämnad. En SVG är ett skriptbärande dokument,
-- inte en bild, och en signerad länk till den kör alltså kod på lagringens
-- domän. Vill man ändå tillåta den: lägg till den i listan nedan och kör om.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Vyn över nyckelstatus
-- ---------------------------------------------------------------------------

-- Vyn kör med ägarens rättigheter och filtrerar själv på auth.uid().
-- security_barrier hindrar planeraren från att köra anroparens egna villkor
-- före det filtret — annars kan ett läckande uttryck i en where-sats få se rader
-- som filtret skulle ha tagit bort.
--
-- Villkoret gör att skriptet går att köra även om 0002 inte körts, i stället
-- för att avbryta mitt i.
do $$
begin
  if to_regclass('public.user_ai_key_status') is not null then
    alter view public.user_ai_key_status set (security_barrier = true);
  end if;
end
$$;
