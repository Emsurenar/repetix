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
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;

  const raw = Buffer.isBuffer(body)
    ? body.toString('utf8')
    : typeof body === 'string'
      ? body
      : await readStream(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'bad_request', 'Begäran är inte giltig JSON.');
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
