-- Repetix — åtkomst till AI-nycklar utan service role
--
-- Kör detta i Supabase SQL Editor efter 0001. Idempotent.
--
-- Bakgrund: serverfunktionerna behövde tidigare Supabases service role-nyckel
-- för att läsa tillbaka en användares krypterade API-nyckel, eftersom
-- user_ai_keys medvetet saknar select-policy. Den nyckeln kringgår ALL
-- radnivåsäkerhet — läcker den ligger varje användares hela bibliotek öppet.
-- Att kräva den av alla som självhostar appen är en dålig affär för ett skydd
-- som ändå inte är det verkliga försvaret: chiffertexten är oanvändbar utan
-- huvudnyckeln AI_KEY_SECRET, som aldrig finns i databasen.
--
-- Efter den här migrationen behöver appen ingen service role-nyckel alls.
-- Serverfunktionerna arbetar med användarens egen token, och de två
-- konstruktionerna nedan ser till att en användare bara når sitt eget.

-- ---------------------------------------------------------------------------
-- Läsa ut den egna krypterade nyckeln
-- ---------------------------------------------------------------------------

-- security definer gör att funktionen kör med sin ägares rättigheter och
-- därmed förbi radnivåsäkerheten. Spärren ligger i stället i where-satsen:
-- auth.uid() kommer från den anropandes token och går inte att förfalska, så
-- funktionen kan bara någonsin returnera anroparens egen rad.
create or replace function public.get_my_ai_key(p_provider text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select encrypted_key
  from public.user_ai_keys
  where user_id = (select auth.uid())
    and provider = p_provider
$$;

-- Ingen ska kunna anropa den anonymt.
revoke all on function public.get_my_ai_key(text) from public, anon;
grant execute on function public.get_my_ai_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Läsa metadata om sparade nycklar
-- ---------------------------------------------------------------------------

-- Vyn definierades i 0001 med security_invoker = true, vilket innebär att den
-- lyder anroparens radnivåsäkerhet. Eftersom tabellen saknar select-policy gav
-- den därför alltid noll rader när den frågades med en användartoken — den
-- fungerade bara för service role.
--
-- Nu kör den i stället med ägarens rättigheter och filtrerar själv på
-- auth.uid(). Kolumnen encrypted_key ingår inte, så vyn kan inte ens av
-- misstag lämna ut chiffertexten.
drop view if exists public.user_ai_key_status;

create view public.user_ai_key_status
with (security_invoker = false) as
  select user_id, provider, key_hint, last_verified, updated_at
  from public.user_ai_keys
  where user_id = (select auth.uid());

revoke all on public.user_ai_key_status from public, anon;
grant select on public.user_ai_key_status to authenticated;
