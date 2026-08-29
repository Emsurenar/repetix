// Gemensam form för begäran och svar i serverfunktionerna.
//
// Handlerna skrivs i Nodes (req, res)-form eftersom både Vercel och
// Vite-middlewaren förstår den. Priset är att body inte är färdigläst överallt:
// Vercel tolkar JSON åt oss, Vite gör det inte. Läsningen ligger därför här i
// stället för att upprepas — och gissas olika — i varje handler.

/**
 * Fel som är avsett för användaren. Bär kontraktets felkod, så att klienten
 * kan skilja "lägg in en nyckel" från "försök igen om en stund" utan att läsa
 * meddelandetexten.
 */
export class ApiError extends Error {
  constructor(status, code, message, extra = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Databasfelet får bära sin kod med sig tillbaka till användaren.
 *
 * Koden kastades tidigare bort på varje ställe där en fråga mot Supabase kunde
 * misslyckas, och kvar blev en mening som beskriver alla orsaker lika illa:
 * "Kunde inte spara nyckeln. Försök igen." En policy som saknas (42501), en
 * migration som aldrig kördes (42703, PGRST204) och en databas som ligger nere
 * ser då exakt likadana ut — och rådet att försöka igen gäller bara det sista.
 * Serverfunktionerna loggar med flit ingenting, eftersom en logg är det
 * enklaste sättet att av misstag skriva ut en användares nyckel. Utan koden i
 * meddelandet finns felet alltså inte bevarat någonstans alls.
 *
 * Enbart koden följer med. Fälten details och hint återger raden som inte gick
 * igenom — "Failing row contains (...)" — och den raden bär chiffertexten för
 * användarens nyckel. Formkravet finns för att koden kommer utifrån och landar
 * i en text som visas för användaren.
 */
export function dbError(error, text) {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  if (!/^[A-Za-z0-9_]{1,20}$/.test(code)) return new ApiError(500, 'server_error', text);
  return new ApiError(500, 'server_error', `${text} (databasfel ${code})`);
}

/**
 * Största begäran vi läser. En prompt med kortlekskontext landar på tiotals
 * kilobyte; allt bortom en megabyte är antingen en bugg i klienten eller ett
 * försök att fylla funktionens minne.
 */
const MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(res, status, payload, headers = null) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // Svaren är personliga och innehåller AI-text som kostat pengar att ta fram.
  // Ingen mellanliggande cache ska kunna spara eller återanvända dem.
  res.setHeader('cache-control', 'no-store');
  if (headers) for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

/**
 * Översätter ett fel till kontraktets { error, code }.
 *
 * Fel som inte är ApiError får aldrig visa sitt meddelande utåt. Ett oväntat
 * undantag kan bära med sig delar av begäran, och begäran innehåller i värsta
 * fall användarens API-nyckel i klartext. Koden server_error står inte i
 * kontraktets tabell, och det är avsikten: den betyder just att inget av
 * kontraktets fall inträffade, och klienten har inget annat att göra än att
 * visa meddelandet.
 */
export function sendError(res, err) {
  if (err instanceof ApiError) {
    const headers = err.extra?.retryAfter ? { 'retry-after': String(err.extra.retryAfter) } : null;
    sendJson(res, err.status, { error: err.message, code: err.code, ...err.extra }, headers);
    return;
  }
  sendJson(res, 500, { error: 'Något gick fel på servern. Försök igen.', code: 'server_error' });
}

/**
 * Tolkar begärans body som JSON. Tom body ger ett tomt objekt.
 *
 * Vercel har redan läst strömmen när handlern körs och lämnar antingen ett
 * färdigtolkat objekt, en sträng eller en buffert. Vite lämnar strömmen orörd.
 * Alla fyra fallen måste därför fungera, annars kör samma fil olika lokalt och
 * i produktion — vilket är precis det (req, res)-formen ska undvika.
 */
export async function readJsonBody(req) {
  assertDeclaredSize(req);

  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;

  const raw = Buffer.isBuffer(body)
    ? body.toString('utf8')
    : typeof body === 'string'
      ? body
      : await readStream(req);
  if (!raw.trim()) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'bad_request', 'Begäran är inte giltig JSON.');
  }

  // `null`, `5` och `"text"` är giltig JSON men inga kroppar. Handlarna läser
  // fält ur det som kommer tillbaka, och utan den här raden blir `curl -d null`
  // ett TypeError och därmed 500 — ett serverfel för något som är avsändarens.
  if (!parsed || typeof parsed !== 'object') {
    throw new ApiError(400, 'bad_request', 'Begäran måste vara ett JSON-objekt.');
  }
  return parsed;
}

/**
 * Avvisar en för stor begäran på det uppgivna content-length.
 *
 * Måste ske före allt annat i läsningen. Räkningen i readStream nås aldrig i
 * produktion — Vercel har redan tolkat kroppen när handlern körs, så funktionen
 * returnerar på första raden och gränsen gällde i praktiken bara lokalt. Ett
 * fält på flera megabyte gick alltså rakt igenom och vidare till leverantören.
 *
 * Huvudet kan saknas eller ljuga, och därför är det bara första linjen:
 * fältgränserna i api/ai.js gäller oavsett hur kroppen kom in.
 */
function assertDeclaredSize(req) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(400, 'bad_request', 'Begäran är för stor.');
  }
}

async function readStream(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(400, 'bad_request', 'Begäran är för stor.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Läser ett textfält ur en begäran och håller det inom sin gräns.
 *
 * Gränsen är inte en formsak: fälten skickas vidare till leverantören, så ett
 * obegränsat fält gör serverfunktionen till en förstärkare av någon annans
 * utgående bandbredd. Längden mäts i tecken och inte i byte, eftersom det är
 * tecken användaren skriver och tecken leverantören räknar.
 *
 * @param {unknown} value fältets värde ur den tolkade kroppen
 * @param {{ name: string, max: number, required?: boolean }} options
 * @returns {string} värdet, trimmat. Saknas det och är valfritt: tom sträng.
 */
export function readTextField(value, { name, max, required = false }) {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, 'bad_request', `Begäran saknar fältet ${name}.`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new ApiError(400, 'bad_request', `Fältet ${name} måste vara text.`);
  }
  if (value.length > max) {
    throw new ApiError(
      400,
      'bad_request',
      `Fältet ${name} är för långt: ${value.length} tecken, gränsen är ${max}.`
    );
  }

  const text = value.trim();
  if (required && !text) throw new ApiError(400, 'bad_request', `Begäran saknar fältet ${name}.`);
  return text;
}

/**
 * Avgör om ett fetch-fel beror på att tiden gick ut.
 *
 * Node kastar olika saker beroende på var i anropet avbrottet sker: ibland
 * signalens egen TimeoutError, ibland ett TypeError med den som `cause`.
 * Skillnaden spelar roll, eftersom timeout och nätverksfel är olika koder i
 * kontraktet.
 */
export function isTimeoutError(err) {
  return (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    err?.cause?.name === 'TimeoutError'
  );
}
