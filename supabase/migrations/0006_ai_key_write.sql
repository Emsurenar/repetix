-- Repetix — skrivvägen för AI-nycklar
--
-- Kör i Supabase SQL Editor EFTER 0005. Idempotent: går att köra om.
--
-- Bakgrund: att spara en nyckel misslyckades alltid, med 42501. Servern gjorde
-- en upsert direkt mot tabellen, alltså `insert ... on conflict do update`, och
-- den satsen kräver att raden får LÄSAS under radnivåsäkerheten. Postgres
-- avgör det utifrån satsens form och inte utifrån om någon krock inträffar —
-- tabellen var tom, och det spelade ingen roll. user_ai_keys saknar
-- select-policy med flit, så kravet kunde aldrig uppfyllas.
--
-- Att lägga till en select-policy vore fel väg ut. Den saknas för att klienten
-- aldrig ska kunna läsa tillbaka chiffertexten, och det skyddet är värt mer än
-- bekvämligheten i att skriva rakt mot tabellen. Skrivningen går därför samma
-- väg som läsningen redan gör, genom en funktion med ägarens rättigheter.

-- security definer av samma skäl som get_my_ai_key: funktionen måste förbi
-- radnivåsäkerheten, men härleder användaren ur auth.uid() och kan därför bara
-- någonsin skriva anroparens egen rad. Att den är anropbar direkt från
-- klienten ger ingenting: den skriver bara det anroparen redan äger, och
-- läser aldrig tillbaka något.
create or replace function public.save_my_ai_key(
  p_provider      text,
  p_encrypted_key text,
  p_key_hint      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'save_my_ai_key kräver en inloggad användare';
  end if;

  -- Kontrollerna finns för att funktionen är anropbar direkt och inte bara via
  -- serverfunktionen. En tom leverantör hade gett en rad ingen kan nå, och en
  -- tom chiffertext hade sett ut som en sparad nyckel ända tills någon
  -- försökte använda den.
  if coalesce(btrim(p_provider), '') = '' then
    raise exception 'save_my_ai_key kräver en leverantör';
  end if;
  if coalesce(p_encrypted_key, '') = '' then
    raise exception 'save_my_ai_key kräver en krypterad nyckel';
  end if;

  -- last_verified sätts här och tas inte emot som argument. Raden skrivs bara
  -- när leverantören just har godkänt nyckeln, alltså är tidpunkten alltid nu,
  -- och databasens klocka är den enda alla rader kan jämföras mot.
  insert into public.user_ai_keys (user_id, provider, encrypted_key, key_hint, last_verified)
  values (v_user, btrim(p_provider), p_encrypted_key, p_key_hint, now())
  on conflict (user_id, provider) do update
    set encrypted_key = excluded.encrypted_key,
        key_hint      = excluded.key_hint,
        last_verified = excluded.last_verified;
end;
$$;

revoke all on function public.save_my_ai_key(text, text, text) from public, anon;
grant execute on function public.save_my_ai_key(text, text, text) to authenticated;

-- PostgREST cachar schemat och hittar annars inte funktionen förrän den startas om.
notify pgrst, 'reload schema';
