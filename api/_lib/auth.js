// Autentisering för serverfunktionerna.
//
// user_id härleds alltid ur Supabase-token och aldrig ur begärans innehåll.
// Fick klienten skicka med ett eget id vore varje användares krypterade nyckel
// bara en id-gissning bort, och all radnivåsäkerhet i databasen meningslös
// eftersom funktionerna ändå går förbi den.

import { createClient } from '@supabase/supabase-js';
import { ApiError } from './http.js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Kontrolleras vid modulinläsning av samma skäl som huvudnyckeln i crypto.js:
// en deploy utan konfiguration ska säga ifrån direkt, inte fungera tills någon
// försöker använda AI-funktionerna.
if (!url || !serviceRoleKey) {
  throw new Error(
    'SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta för serverfunktionerna i api/. Ingen av dem får ha VITE_-prefix.'
  );
}

/**
 * Klient med service role-nyckeln. Går förbi radnivåsäkerheten, vilket krävs
 * för att över huvud taget kunna läsa user_ai_keys — tabellen saknar medvetet
 * select-policy, så inte ens en klient med giltig token kommer åt
 * chiffertexten.
 *
 * Priset är att spärren flyttar in i den här koden: varje fråga härifrån måste
 * själv filtrera på det user_id som requireUser härlett.
 *
 * Sessionshanteringen stängs av. En serverfunktion delas av alla användare och
 * får aldrig råka bära med sig en session mellan två anrop.
 */
export const serviceClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/**
 * Verifierar Authorization-huvudet och returnerar användarens id.
 * Kastar ApiError med koden `unauthorized` när token saknas eller inte gäller.
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

  const { data, error } = await serviceClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new ApiError(401, 'unauthorized', 'Din session gäller inte längre. Logga in igen.');
  }
  return data.user.id;
}
