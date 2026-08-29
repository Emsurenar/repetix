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

  if (!looksLikeAccessToken(token)) {
    throw new ApiError(401, 'unauthorized', 'Din session gäller inte längre. Logga in igen.');
  }

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new ApiError(401, 'unauthorized', 'Din session gäller inte längre. Logga in igen.');
  }

  return { userId: data.user.id, token, db: userClient(token) };
}

/**
 * Ser strängen över huvud taget ut som en Supabase-token?
 *
 * DET HÄR ÄR INTE AUTENTISERING. Signaturen kontrolleras inte, och ingenting i
 * nyttolasten litas på — user_id hämtas fortfarande ur svaret från Supabase,
 * som är det enda som kan avgöra om token är äkta.
 *
 * Kontrollen finns bara för att ett skräpvärde ska kosta oss ingenting. Utan
 * den blir `Authorization: Bearer x` i en slinga en gratis förstärkare: varje
 * begäran betalar en serverfunktion och en förfrågan mot Supabases
 * auth-tjänst, utan att avsändaren behöver ett konto. Med den avvisas allt som
 * inte ens har formen av en token innan något nät rörs.
 */
function looksLikeAccessToken(token) {
  // En token på flera kilobyte är inte vår: den ska inte kopieras vidare i ett
  // huvud bara för att få veta att den är ogiltig.
  if (token.length < 60 || token.length > 8192) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  if (!parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;

  const payload = decodeSegment(parts[1]);
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) return false;

  // Utgången token avvisas här. Det är ingen genväg förbi verifieringen —
  // Supabase hade avvisat den ändå — utan ett nätanrop mindre. Marginalen
  // finns för att vår klocka kan gå före utfärdarens.
  if (typeof payload.exp !== 'number') return false;
  return payload.exp * 1000 > Date.now() - 60_000;
}

function decodeSegment(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
