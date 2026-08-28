// POST /api/ai — utför ett AI-anrop med den inloggade användarens egen nyckel.
//
// Nyckeln hämtas krypterad, dekrypteras i minnet, används för ett enda anrop
// och lämnar aldrig funktionen. Den loggas inte, returneras inte och ingår inte
// i något felmeddelande.

import { requireUser, serviceClient } from './_lib/auth.js';
import { decrypt } from './_lib/crypto.js';
import { ApiError, isTimeoutError, readJsonBody, sendError, sendJson } from './_lib/http.js';
import { extractProviderMessage, getProvider, isAuthFailure } from './_lib/providers.js';

/** Kontraktets gräns. Speglas av maxDuration i vercel.json. */
const TIMEOUT_MS = 60_000;

const DEFAULT_MAX_TOKENS = 1024;

/**
 * Tak för maxTokens. Fakturan är användarens egen, så taket finns inte för att
 * spara pengar åt oss utan för att en bugg i klienten inte ska kunna beställa
 * ett svar som varken ryms i timeouten eller i användarens plånbok.
 */
const MAX_TOKENS_CEILING = 16_384;

export default async function handler(req, res) {
  try {
    // Inloggningen kontrolleras före allt annat, i båda slutpunkterna. En
    // anropare som inte är känd ska inte kunna få veta något om slutpunkten
    // alls, inte ens vilka metoder den tar emot.
    const userId = await requireUser(req);

    if (req.method !== 'POST') {
      throw new ApiError(405, 'bad_request', 'Slutpunkten tar bara emot POST.');
    }

    const body = await readJsonBody(req);

    const user = typeof body.user === 'string' ? body.user.trim() : '';
    if (!user) throw new ApiError(400, 'bad_request', 'Begäran saknar fältet user.');

    const { providerName, provider, model } = await resolveTarget(body, userId);
    const apiKey = await loadApiKey(userId, providerName, provider.label);

    const request = provider.buildRequest({
      system: typeof body.system === 'string' ? body.system : '',
      user,
      maxTokens: resolveMaxTokens(body.maxTokens),
      model,
      json: body.json === true,
      key: apiKey,
    });

    const text = await callProvider(provider, request);
    sendJson(res, 200, { text, provider: providerName, model });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Vilken leverantör och modell gäller för det här anropet?
 *
 * Begäran får styra, annars användarens sparade inställning, annars
 * leverantörens standard. Ett undantag: byter begäran leverantör utan att ange
 * modell ignoreras den sparade modellen, eftersom ett sparat id hör hemma i en
 * annan katalog och bara hade gett ett obegripligt fel från leverantören.
 */
async function resolveTarget(body, userId) {
  const settings = await readSettings(userId);
  const savedProvider = settings.ai_provider || 'anthropic';

  const requested = typeof body.provider === 'string' ? body.provider.trim() : '';
  const providerName = requested || savedProvider;
  const provider = getProvider(providerName);

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const savedModel = providerName === savedProvider ? settings.ai_model : null;
  const model = requestedModel || savedModel || provider.defaultModel;

  if (!model) {
    throw new ApiError(
      400,
      'bad_request',
      `Ingen modell är vald för ${provider.label}. Ange ett modell-id i inställningarna.`
    );
  }
  return { providerName, provider, model };
}

async function readSettings(userId) {
  const { data, error } = await serviceClient
    .from('user_settings')
    .select('ai_provider, ai_model')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'server_error', 'Kunde inte läsa dina AI-inställningar.');
  return data ?? {};
}

/**
 * Hämtar och dekrypterar användarens nyckel.
 *
 * Att dekrypteringen misslyckas betyder i praktiken att AI_KEY_SECRET har
 * roterats: den gamla chiffertexten går då inte att läsa, och det är avsikten.
 * För användaren är läget identiskt med att ingen nyckel finns, alltså samma
 * kod — det enda som hjälper är att lägga in nyckeln på nytt.
 */
async function loadApiKey(userId, providerName, label) {
  const { data, error } = await serviceClient
    .from('user_ai_keys')
    .select('encrypted_key')
    .eq('user_id', userId)
    .eq('provider', providerName)
    .maybeSingle();
  if (error) throw new ApiError(500, 'server_error', 'Kunde inte hämta din sparade API-nyckel.');

  if (!data?.encrypted_key) {
    throw new ApiError(
      428,
      'no_key',
      `Du har ingen API-nyckel för ${label}. Lägg in den under Inställningar.`
    );
  }

  try {
    return decrypt(data.encrypted_key);
  } catch {
    throw new ApiError(
      428,
      'no_key',
      'Din sparade API-nyckel går inte att läsa längre. Lägg in den på nytt under Inställningar.'
    );
  }
}

function resolveMaxTokens(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_TOKENS;
  const tal = Number(value);
  if (!Number.isFinite(tal) || tal < 1) {
    throw new ApiError(400, 'bad_request', 'maxTokens måste vara ett positivt heltal.');
  }
  return Math.min(Math.floor(tal), MAX_TOKENS_CEILING);
}

/**
 * Gör anropet och översätter leverantörens svar till kontraktets felkoder.
 *
 * Timeouten sitter på signalen och inte på funktionen: ett anrop som hänger
 * ska ge ett svar användaren förstår, i stället för att plattformen klipper
 * förbindelsen och klienten ser ett nätverksfel.
 */
async function callProvider(provider, request) {
  let res;
  try {
    res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new ApiError(504, 'timeout', 'Leverantören svarade inte inom 60 sekunder.');
    }
    throw new ApiError(502, 'provider_error', 'Ingen kontakt med leverantören.');
  }

  if (!res.ok) throw translateFailure(res, await res.text().catch(() => ''));

  const data = await res.json().catch(() => null);
  const text = provider.extractText(data);
  if (!text) {
    throw new ApiError(502, 'provider_error', 'Leverantören svarade utan någon text.');
  }
  return text;
}

function translateFailure(res, bodyText) {
  const detail = extractProviderMessage(bodyText);

  if (isAuthFailure(res.status, detail)) {
    return new ApiError(
      401,
      'invalid_key',
      'Leverantören avvisade din API-nyckel. Lägg in den på nytt under Inställningar.'
    );
  }

  if (res.status === 429) {
    const retryAfter = retryAfterSeconds(res);
    return new ApiError(
      429,
      'rate_limited',
      retryAfter
        ? `Leverantören har tillfälligt stoppat fler anrop. Försök igen om ${retryAfter} sekunder.`
        : 'Leverantören har tillfälligt stoppat fler anrop. Försök igen om en stund.',
      retryAfter ? { retryAfter } : null
    );
  }

  return new ApiError(
    502,
    'provider_error',
    detail
      ? `Leverantören svarade med fel (${res.status}): ${detail}`
      : `Leverantören svarade med fel (${res.status}).`
  );
}

/**
 * Retry-After anges antingen i sekunder eller som en tidpunkt. Båda formerna
 * är tillåtna i HTTP och leverantörerna använder olika, så båda tolkas.
 */
function retryAfterSeconds(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1, Math.round(seconds));

  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return Math.max(1, Math.round((time - Date.now()) / 1000));
}
