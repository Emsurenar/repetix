// Autentisering för serverfunktionerna.
//
// user_id härleds alltid ur Supabase-token och aldrig ur begärans innehåll.
// Fick klienten skicka med ett eget id vore varje användares krypterade nyckel
// bara en id-gissning bort.
//
// Funktionerna använder medvetet INTE Supabases service role-nyckel. Den
// kringgår all radnivåsäkerhet, så läcker den ligger varje användares hela
// bibliotek öppet — ett dåligt pris för ett skydd som ändå inte är det
// verkliga försvaret här: chiffertexten är oanvändbar utan huvudnyckeln, som
// aldrig finns i databasen. I stället arbetar varje anrop med användarens egen
// token, och migration 0002 ser till att en användare bara når sitt eget.

import { createClient } from '@supabase/supabase-js';
import { ApiError } from './http.js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

// Kontrolleras vid modulinläsning av samma skäl som huvudnyckeln i crypto.js:
// en deploy utan konfiguration ska säga ifrån direkt, inte fungera tills någon
// försöker använda AI-funktionerna.
if (!url || !anonKey) {
  throw new Error(
    'SUPABASE_URL och SUPABASE_ANON_KEY måste vara satta för serverfunktionerna i api/. Ingen av dem får ha VITE_-prefix.'
  );
}

// Sessionshanteringen stängs av på varje klient här. En serverfunktion delas av
// alla användare och får aldrig råka bära med sig en session mellan två anrop.
const utanSession = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/** Klient utan användare. Räcker för att verifiera en token. */
const anonClient = createClient(url, anonKey, utanSession);

/**
 * Klient som agerar SOM den inloggade användaren.
 *
 * Databasen ser alltså anropet precis som om det kom från webbläsaren, och
 * radnivåsäkerheten gäller fullt ut. Det är skillnaden mot service role: en
 * bugg här kan i värsta fall läcka användarens egna data till användaren
 * själv, inte allas data till vem som helst.
 */
export function userClient(token) {
  return createClient(url, anonKey, {
    ...utanSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Verifierar Authorization-huvudet.
 * Returnerar både användarens id och en klient som agerar som hen.
 *
 * @returns {Promise<{ userId: string, token: string, db: import('@supabase/supabase-js').SupabaseClient }>}
 * @throws {ApiError} med koden `unauthorized`
 */
export async function requireUser(req) {
  const header = String(req.headers?.authorization ?? '').trim();
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token) {
    throw new ApiError(
      401,
      'unauthorized',
      'Du måste vara inloggad för att använda AI-funktionerna.'
    );
  }

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new ApiError(401, 'unauthorized', 'Din session gäller inte längre. Logga in igen.');
  }

  return { userId: data.user.id, token, db: userClient(token) };
}
