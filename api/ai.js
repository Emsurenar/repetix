// POST /api/ai — utför ett AI-anrop med den inloggade användarens egen nyckel.
//
// Nyckeln hämtas krypterad, dekrypteras i minnet, används för ett enda anrop
// och lämnar aldrig funktionen. Den loggas inte, returneras inte och ingår inte
// i något felmeddelande.

import { requireUser } from './_lib/auth.js';
import { decrypt } from './_lib/crypto.js';
import {
  ApiError,
  dbError,
  isTimeoutError,
  readJsonBody,
  readTextField,
  sendError,
  sendJson,
} from './_lib/http.js';
import { enforceRateLimit } from './_lib/limit.js';
import { extractProviderMessage, getProvider, isAuthFailure } from './_lib/providers.js';
import { arLattKandidat, valjMal } from './_lib/routing.js';
import { recordUsage } from './_lib/usage.js';

/**
 * Kontraktets gräns, och den måste ligga under maxDuration i vercel.json.
 *
 * Var den lika med maxDuration kunde svaret aldrig levereras: när signalen löste
 * ut hade funktionen noll tid kvar att skriva något, och klienten fick
 * plattformens HTML-504 i stället för kontraktets JSON. Koden `timeout` gick
 * alltså inte att få. Marginalen på 15 sekunder räcker för att skriva ett svar
 * på några hundra byte med bred marginal.
 */
const TIMEOUT_MS = 45_000;

const DEFAULT_MAX_TOKENS = 1024;

/**
 * Fältgränser.
 *
 * Fälten går vidare till leverantören, så ett obegränsat fält gör slutpunkten
 * till en förstärkare av vår egen utgående bandbredd. Taken ligger långt över
 * verklig användning: 200 000 tecken är ungefär tio gånger den största prompten
 * appen bygger, en hel kortlek inräknad.
 *
 * Modell-id:t har ett eget, mycket lägre tak eftersom det interpoleras in i
 * Googles URL.
 */
const MAX_USER_CHARS = 200_000;
const MAX_SYSTEM_CHARS = 200_000;
const MAX_MODEL_CHARS = 128;
const MAX_PROVIDER_CHARS = 40;

/* Funktionens namn är vårt eget och kort. Taket finns av samma skäl som de
 * andra: ett obegränsat fält gör slutpunkten till en väg att skriva godtycklig
 * mängd data till databasen. */
const MAX_FEATURE_CHARS = 40;

/* Enda tillåtna värdet. En öppen sträng hade skickat vidare vad som helst till
 * leverantören, och ett felstavat värde ger ett fel användaren inte kan tolka. */
const TILLATEN_EFFORT = new Set(['low']);

/**
 * Tecken som får förekomma i ett modell-id. Snedstrecket behövs av OpenRouter
 * (`leverantör/modell`), kolon och at-tecken av leverantörer som versionerar i
 * namnet. Allt annat — blanksteg, procenttecken, kontrolltecken — hör inte
 * hemma i ett modellnamn och ska inte ta sig in i en URL eller en JSON-kropp.
 */
const MODEL_PATTERN = /^[A-Za-z0-9._:@/-]+$/;

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
    const { userId, db } = await requireUser(req);

    if (req.method !== 'POST') {
      throw new ApiError(405, 'bad_request', 'Slutpunkten tar bara emot POST.');
    }

    // Kvoten dras före allt arbete. Ett anrop som ändå ska avvisas ska inte
    // hinna kosta två databasläsningar och en uppkoppling mot leverantören.
    await enforceRateLimit(db, 'ai');

    const body = await readJsonBody(req);

    const user = readTextField(body.user, { name: 'user', max: MAX_USER_CHARS, required: true });
    const system = readTextField(body.system, { name: 'system', max: MAX_SYSTEM_CHARS });
    const feature = readTextField(body.feature, {
      name: 'feature',
      max: MAX_FEATURE_CHARS,
      required: true,
    });
    const effort = TILLATEN_EFFORT.has(body.effort) ? body.effort : undefined;
    const cache = body.cache === true;

    const { providerName, provider, model } = await resolveTarget(body, db, userId, feature);
    const apiKey = await loadApiKey(db, providerName, provider.label);

    const request = provider.buildRequest({
      system,
      user,
      maxTokens: resolveMaxTokens(body.maxTokens),
      model,
      json: body.json === true,
      key: apiKey,
      effort,
      cache,
    });

    const { text, usage, truncated } = await callProvider(provider, request);

    // Efter att svaret säkrats, före att det skickas. Skrivningen kan inte
    // kasta, så ordningen kostar ingenting.
    await recordUsage(db, { userId, provider: providerName, model, feature, usage });

    sendJson(res, 200, { text, truncated, provider: providerName, model, usage });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Vilken leverantör och modell gäller för det här anropet?
 *
 * Ordningen mellan källorna ligger i valjMal, som är ren och provad. Här blir
 * bara två saker kvar: att hämta det den behöver veta, och att fylla i
 * leverantörens standard när ingen modell pekats ut.
 */
async function resolveTarget(body, db, userId, feature) {
  const settings = await readSettings(db, userId);

  const begardProvider = readTextField(body.provider, {
    name: 'provider',
    max: MAX_PROVIDER_CHARS,
  });
  const begardModell = readTextField(body.model, { name: 'model', max: MAX_MODEL_CHARS });
  const lattFriPa = settings.ai_light_free === true;

  // Nyckelläget kostar en fråga, så den ställs bara när svaret kan ändra något
  // — alltså för de två lätta funktionerna hos den som slagit på brytaren. Att
  // i stället låta nyckeln falla ut ur den här funktionen hade sparat frågan,
  // men blandat ihop att välja mål med att hämta hemligheter.
  const kandidat = arLattKandidat({ feature, begardProvider, begardModell, lattFriPa });
  const harGoogleNyckel = kandidat ? await harNyckel(db, 'google') : false;

  const val = valjMal({
    feature,
    begardProvider,
    begardModell,
    sparadProvider: settings.ai_provider,
    sparadModell: settings.ai_model,
    lattFriPa,
    harGoogleNyckel,
  });

  const providerName = val.provider;
  const provider = getProvider(providerName);
  const model = val.model || provider.defaultModel;

  if (!model) {
    throw new ApiError(
      400,
      'bad_request',
      `Ingen modell är vald för ${provider.label}. Ange ett modell-id i inställningarna.`
    );
  }
  assertModel(model);
  return { providerName, provider, model };
}

/**
 * Kontrollen sitter på den framräknade modellen, inte på fältet i begäran.
 *
 * Ett modell-id kan komma tre vägar, och två av dem är användarens: fältet i
 * begäran och det sparade värdet i user_settings, som klienten skriver själv.
 * Bara den tredje — leverantörens standard — är vår egen. En kontroll på fältet
 * hade alltså lämnat den sparade vägen öppen.
 */
function assertModel(model) {
  if (typeof model !== 'string' || model.length > MAX_MODEL_CHARS) {
    throw new ApiError(
      400,
      'bad_request',
      `Modell-id:t är för långt. Gränsen är ${MAX_MODEL_CHARS} tecken.`
    );
  }
  if (!MODEL_PATTERN.test(model)) {
    throw new ApiError(
      400,
      'bad_request',
      'Modell-id:t innehåller tecken som inte hör hemma i ett modellnamn.'
    );
  }
}

async function readSettings(db, userId) {
  const { data, error } = await db
    .from('user_settings')
    .select('ai_provider, ai_model, ai_light_free')
    .eq('user_id', userId)
    .maybeSingle();
  if (!error) return data ?? {};

  /* PostgREST avvisar HELA frågan (42703, okänd kolumn) om ai_light_free inte
   * finns än — migration 0009 kan vara okörd. Utan reträtten slutar varje
   * AI-anrop fungera vid en distribution där koden hinner före migrationen,
   * inte bara den nya routningen. Brytaren kan bara inte läsas förrän kolumnen
   * finns, och att den då är av är rätt svar. */
  const gammal = await db
    .from('user_settings')
    .select('ai_provider, ai_model')
    .eq('user_id', userId)
    .maybeSingle();
  if (gammal.error) throw dbError(gammal.error, 'Kunde inte läsa dina AI-inställningar.');
  return gammal.data ?? {};
}

/**
 * Finns en nyckel för leverantören?
 *
 * Samma databasfunktion som loadApiKey använder, men bara närvaron intresserar
 * — chiffertexten dekrypteras aldrig här och lämnar inte anropet.
 */
async function harNyckel(db, providerName) {
  const { data, error } = await db.rpc('get_my_ai_key', { p_provider: providerName });
  if (error) throw dbError(error, 'Kunde inte hämta din sparade API-nyckel.');
  return Boolean(data);
}

/**
 * Hämtar och dekrypterar användarens nyckel.
 *
 * Att dekrypteringen misslyckas betyder i praktiken att AI_KEY_SECRET har
 * roterats: den gamla chiffertexten går då inte att läsa, och det är avsikten.
 * För användaren är läget identiskt med att ingen nyckel finns, alltså samma
 * kod — det enda som hjälper är att lägga in nyckeln på nytt.
 */
async function loadApiKey(db, providerName, label) {
  // Databasfunktionen kör med sin ägares rättigheter men filtrerar själv på
  // auth.uid(), så den kan bara någonsin returnera anroparens egen rad. Det är
  // det som gör att appen inte behöver någon service role-nyckel.
  const { data, error } = await db.rpc('get_my_ai_key', { p_provider: providerName });
  if (error) throw dbError(error, 'Kunde inte hämta din sparade API-nyckel.');

  if (!data) {
    throw new ApiError(
      428,
      'no_key',
      `Du har ingen API-nyckel för ${label}. Lägg in den under Inställningar.`
    );
  }

  try {
    return decrypt(data);
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
      throw new ApiError(
        504,
        'timeout',
        `Leverantören svarade inte inom ${Math.round(TIMEOUT_MS / 1000)} sekunder.`
      );
    }
    throw new ApiError(502, 'provider_error', 'Ingen kontakt med leverantören.');
  }

  if (!res.ok) throw translateFailure(res, await res.text().catch(() => ''));

  const data = await res.json().catch(() => null);
  const text = provider.extractText(data);
  if (!text) {
    throw new ApiError(502, 'provider_error', 'Leverantören svarade utan någon text.');
  }
  return {
    text,
    /* Slog modellen i taket är texten halv, och utan det här fältet finns
     * ingenting som säger det. Sammanfattningen slutar mitt i en mening, och
     * ett svar som skulle vara JSON går inte att tolka — båda ser ut som
     * appens fel i stället för som ett tak som är för lågt. */
    truncated: provider.extractTruncated(data) === true,
    usage: provider.extractUsage(data),
  };
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
