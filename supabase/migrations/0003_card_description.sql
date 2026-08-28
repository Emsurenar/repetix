-- Repetix — beskrivningsfält på kort
--
-- Kör i Supabase SQL Editor efter 0002. Idempotent.
--
-- Ett kort har haft två sidor: fråga och svar. Svaret ska vara det man ska
-- kunna återkalla, och blir sämre av att svälla — ett långt svar går inte att
-- pröva sig själv på. Beskrivningen är därför ett tredje, separat fält: plats
-- att gå på djupet utan att göra det som ska memoreras längre.
--
-- Fältet visas efter att svaret avslöjats och ingår aldrig i bedömningen.

alter table public.cards
  add column if not exists description text;

comment on column public.cards.description is
  'Fördjupning som visas efter svaret. Ingår inte i det som ska memoreras.';
