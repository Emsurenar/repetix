// Takt-spärr per användare.
//
// Spärren bor i databasen, inte i funktionens minne. Vercels funktioner är
// statslösa och startas i flera instanser samtidigt — en räknare i en modulnivå
// hade nollställts vid varje kallstart och räknat separat i varje instans,
// alltså precis inte räknat alls. Postgres är det enda delade tillstånd appen
// redan har, och en rad per användare och fönster kostar mindre än en ny tjänst
// att drifta.
//
// Räkningen sker i `bump_rate_limit` (migration 0004), som kör med ägarens
// rättigheter men härleder användaren ur auth.uid(). Anroparen kan därför inte
// räkna åt någon annan, och inte heller nolla sin egen räknare: funktionen
// stegar bara uppåt, och tabellen är stängd för direkt åtkomst.

import { ApiError } from './http.js';

/**
 * Taken, per slutpunkt.
 *
 * Två fönster på `ai` av två olika skäl. Timfönstret är kostnadstaket: 120
 * anrop är långt bortom vad ett riktigt pass gör av med, och den som passerar
 * det håller inte på att repetera. Minutfönstret är parallellitetstaket, och
 * det är det som faktiskt skyddar plånboken — ett timtak hindrar inte att alla
 * 120 anropen görs i samma sekund, och varje anrop håller en serverfunktion
 * uppbunden i upp till 45 sekunder.
 *
 * `ai-key:verify` är strängast av alla, trots att den varken kostar tokens
 * eller tid. Slutpunkten skickar den inkomna strängen till leverantören som
 * autentiseringshuvud och skiljer sedan exakt på giltig och ogiltig nyckel —
 * utan tak är den ett orakel som triagerar skrapade nycklar från våra IP-nummer.
 * Att lägga in en nyckel är en handling man gör med handen, någon enstaka gång
 * per leverantör. Tio i timmen räcker för felskrivningar och för fyra
 * leverantörer i följd.
 */
export const LIMITS = {
  ai: [
    { limit: 20, windowSeconds: 60 },
    { limit: 120, windowSeconds: 3600 },
  ],
  // Läsning och radering av nycklar rör aldrig nätet utanför Supabase, men
  // kostar en invokation var. Taket är därför löst — det ska stoppa en slinga,
  // inte en användare som öppnar inställningarna några gånger.
  'ai-key': [{ limit: 60, windowSeconds: 3600 }],
  'ai-key:verify': [{ limit: 10, windowSeconds: 3600 }],
};

/**
 * Stegar räknaren och kastar `rate_limited` när taket är passerat.
 *
 * Fönstren prövas från kortast till längst, så att den som bara skjutit en
 * skur får veta att det räcker med en minut i stället för en timme.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db klient som agerar som användaren
 * @param {keyof LIMITS} endpoint nyckel i LIMITS
 * @throws {ApiError} 429 `rate_limited`, eller 503 `server_error` om spärren inte går att nå
 */
export async function enforceRateLimit(db, endpoint) {
  // Uppslag med Object.hasOwn: '__proto__' och 'toString' finns på varje objekt
  // och hade annars sett ut som slutpunkter med tomma taklistor.
  if (!Object.hasOwn(LIMITS, endpoint)) {
    throw new Error(`Okänd slutpunkt i takt-spärren: ${endpoint}`);
  }

  for (const bucket of LIMITS[endpoint]) {
    const decision = await bumpBucket(db, endpoint, bucket);
    if (!decision.allowed) {
      throw new ApiError(
        429,
        'rate_limited',
        `Du har gjort för många anrop på kort tid. Försök igen om ${describeWait(decision.retryAfter)}.`,
        { retryAfter: decision.retryAfter }
      );
    }
  }
}

/**
 * Ett fönster, ett databasanrop.
 *
 * Går anropet inte igenom stängs slutpunkten. En spärr som öppnar sig när
 * databasen krånglar är verkningslös just när den behövs som mest — och samma
 * databas läses ändå två rader längre ner för att hämta nyckeln, så
 * tillgängligheten offras inte på något som annars hade fungerat.
 */
async function bumpBucket(db, endpoint, { limit, windowSeconds }) {
  const { data, error } = await db.rpc('bump_rate_limit', {
    p_endpoint: endpoint,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error || !data || typeof data.allowed !== 'boolean') {
    throw new ApiError(
      503,
      'server_error',
      'Kunde inte kontrollera din anropskvot just nu. Försök igen om en stund.'
    );
  }

  return { allowed: data.allowed, retryAfter: clampRetryAfter(data.retryAfter, windowSeconds) };
}

/**
 * Sekunderna som går tillbaka till klienten. Databasen räknar redan ut dem,
 * men värdet hamnar i ett svarshuvud och i klientens backoff, så det kläms in
 * i sitt rimliga intervall här i stället för att lita på anropets andra sida.
 */
function clampRetryAfter(value, windowSeconds) {
  const seconds = Math.ceil(Number(value));
  if (!Number.isFinite(seconds)) return windowSeconds;
  return Math.min(Math.max(seconds, 1), windowSeconds);
}

/**
 * Väntetiden i ord. Ett tal i sekunder är exakt och obegripligt: "försök igen
 * om 3 480 sekunder" säger inte att man är avstängd i nästan en timme.
 */
export function describeWait(seconds) {
  const total = Math.max(1, Math.ceil(Number(seconds) || 1));
  if (total === 1) return 'en sekund';
  if (total < 90) return `${total} sekunder`;

  const minutes = Math.ceil(total / 60);
  if (minutes === 1) return 'en minut';
  if (minutes < 90) return `${minutes} minuter`;

  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'en timme' : `${hours} timmar`;
}
