-- Repetix — kontoradering och ägarskap på främmande nycklar
--
-- Kör i Supabase SQL Editor EFTER 0004. Idempotent: går att köra om.
--
-- Två saker:
--   1. En användare kan radera sitt konto själv. Utan detta finns ingen väg ut
--      ur en publik app med öppen registrering, vilket både är ett
--      dataskyddsproblem och en kostnad som bara växer.
--   2. Främmande nycklar tvingas dela ägare med sin förälder.
--
-- Ingen service role-nyckel behövs för något av det. Funktionen nedan är
-- security definer och härleder alltid användaren ur auth.uid() — den kan
-- alltså bara radera anroparen själv, aldrig någon annan.

-- ---------------------------------------------------------------------------
-- 1. Radera mitt konto
-- ---------------------------------------------------------------------------
-- Allt i public kaskaderar från auth.users, så en enda delete tar hela
-- biblioteket. Lagringsraderna städas också, som skydd för det fall klienten
-- inte hann ta filerna via lagrings-API:et först — men klienten SKA göra det,
-- eftersom en rad borttagen härifrån inte alltid tar själva filen med sig.
--
-- Ingen bekräftelseparameter: det som skyddar mot en olyckshändelse är
-- gränssnittet, inte databasen, och en magisk sträng i ett API-anrop hade bara
-- gett en falsk känsla av spärr.

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

  -- Bilder som ligger kvar i hinken. Klienten har normalt redan tagit dem.
  delete from storage.objects
  where bucket_id = 'card-images'
    and (storage.foldername(name))[1] = v_user::text;

  -- Kaskaden tar profiles, bookshelves, decks, sections, cards, card_images,
  -- notebooks, notes, reviews, user_ai_keys, user_settings och api_usage.
  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ägarskap på främmande nycklar
-- ---------------------------------------------------------------------------
-- Radnivåsäkerheten kontrollerar att raden bär rätt user_id, men inte att dess
-- FÖRÄLDER gör det. Ett kort kunde alltså peka på någon annans kortlek. Offret
-- ser aldrig raden — RLS filtrerar på user_id — men två saker följer ändå: en
-- radering av den egna kortleken tar tyst med sig främlingens rader via
-- kaskaden, och kontrollen av främmande nyckel blir ett orakel som avslöjar om
-- ett godtyckligt kortleks-id finns någonstans i systemet.
--
-- Primärnyckeln rörs inte — alla främmande nycklar hänger i den. I stället
-- läggs en unik nyckel på (user_id, id) som de pekas om till, vilket tvingar
-- barn och förälder att dela ägare.
--
-- KÖR FÖRST och kontrollera att resultatet är tomt. Finns rader måste de städas
-- innan villkoren går att lägga på:
--
--   select 'cards' as tabell, c.id from public.cards c
--     join public.decks d on d.id = c.deck_id where d.user_id <> c.user_id
--   union all
--   select 'sections', s.id from public.sections s
--     join public.decks d on d.id = s.deck_id where d.user_id <> s.user_id
--   union all
--   select 'notes', n.id from public.notes n
--     join public.notebooks nb on nb.id = n.notebook_id where nb.user_id <> n.user_id;

do $$
begin
  -- Unika nycklar. IF NOT EXISTS finns inte för constraints, därav vaktposten.
  if not exists (select 1 from pg_constraint where conname = 'decks_owner_id_key') then
    alter table public.decks add constraint decks_owner_id_key unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookshelves_owner_id_key') then
    alter table public.bookshelves add constraint bookshelves_owner_id_key unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sections_owner_id_key') then
    alter table public.sections add constraint sections_owner_id_key unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notebooks_owner_id_key') then
    alter table public.notebooks add constraint notebooks_owner_id_key unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_owner_id_key') then
    alter table public.cards add constraint cards_owner_id_key unique (user_id, id);
  end if;
end $$;

-- Peka om de främmande nycklarna till (user_id, id). Namnen nedan är
-- PostgreSQL:s automatiska; har schemat rörts för hand, kontrollera med
--   select conname, conrelid::regclass from pg_constraint where contype = 'f';

alter table public.decks drop constraint if exists decks_bookshelf_id_fkey;
alter table public.decks drop constraint if exists decks_bookshelf_fk;
alter table public.decks add constraint decks_bookshelf_fk
  foreign key (user_id, bookshelf_id) references public.bookshelves (user_id, id)
  on delete set null;

alter table public.sections drop constraint if exists sections_deck_id_fkey;
alter table public.sections drop constraint if exists sections_deck_fk;
alter table public.sections add constraint sections_deck_fk
  foreign key (user_id, deck_id) references public.decks (user_id, id)
  on delete cascade;

alter table public.cards drop constraint if exists cards_deck_id_fkey;
alter table public.cards drop constraint if exists cards_deck_fk;
alter table public.cards add constraint cards_deck_fk
  foreign key (user_id, deck_id) references public.decks (user_id, id)
  on delete cascade;

alter table public.cards drop constraint if exists cards_section_id_fkey;
alter table public.cards drop constraint if exists cards_section_fk;
alter table public.cards add constraint cards_section_fk
  foreign key (user_id, section_id) references public.sections (user_id, id)
  on delete set null;

alter table public.notebooks drop constraint if exists notebooks_bookshelf_id_fkey;
alter table public.notebooks drop constraint if exists notebooks_bookshelf_fk;
alter table public.notebooks add constraint notebooks_bookshelf_fk
  foreign key (user_id, bookshelf_id) references public.bookshelves (user_id, id)
  on delete set null;

alter table public.notes drop constraint if exists notes_notebook_id_fkey;
alter table public.notes drop constraint if exists notes_notebook_fk;
alter table public.notes add constraint notes_notebook_fk
  foreign key (user_id, notebook_id) references public.notebooks (user_id, id)
  on delete cascade;

alter table public.card_images drop constraint if exists card_images_card_id_fkey;
alter table public.card_images drop constraint if exists card_images_card_fk;
alter table public.card_images add constraint card_images_card_fk
  foreign key (user_id, card_id) references public.cards (user_id, id)
  on delete cascade;

-- PostgREST måste läsa om schemat för att se den nya funktionen.
notify pgrst, 'reload schema';
