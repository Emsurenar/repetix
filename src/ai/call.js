// Ett enda gränssnitt mot AI, oavsett leverantör.
//
// Tidigare fanns elva kopior av samma anrop utspridda i koden, var och en med
// hårdkodad URL, modellsträng, felhantering och svarsparsning. Modellen stod
// på elva ställen och svarsformen `content[0].text` på lika många — att byta
// leverantör hade krävt elva likadana ändringar, och att glömma en hade gett
// ett fel som bara syns i just det flödet.
//
// Hela ytan täcks av en funktion eftersom varje anrop i appen är single-turn
// utan tools och utan streaming.

import { supabase } from '../core/supabase.js';

/** Fel från AI-lagret. `code` följer docs/api-contract.md. */
export class AiError extends Error {
  constructor(message, code = 'provider_error', retryAfter = null) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Serverns timeout är 45 s, strikt under Vercels maxDuration så att den hinner
 *  skriva sitt svar. Klienten ger den marginal att göra det färdigt. */
const CLIENT_TIMEOUT_MS = 55_000;

/** Koder det är meningsfullt att försöka igen på. Övriga är permanenta. */
const RETRYABLE = new Set(['rate_limited', 'provider_error', 'timeout']);

const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function accessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Utför ett AI-anrop.
 *
 * @param {object} options
 * @param {string} [options.system] systemprompt
 * @param {string} options.user meddelandet
 * @param {number} [options.maxTokens]
 * @param {boolean} [options.json] be leverantören svara med ren JSON
 * @param {string} [options.provider] annars användarens inställning
 * @param {string} [options.model] annars användarens inställning
 * @param {string} options.feature vilken funktion som frågar, för användningsmätaren
 * @param {string} [options.effort] lägre ansträngning där leverantören stödjer det
 * @param {AbortSignal} [options.signal] för att kunna avbryta
 * @returns {Promise<string>} svarstexten
 * @throws {AiError}
 */
export async function callAI(options) {
  return (await callAIDetailed(options)).text;
}

/**
 * Samma anrop, men med svarets omständigheter kvar.
 *
 * De elva anropsställena vill ha en sträng och ska fortsätta få det — därför
 * är callAI kvar som den är. Två av dem behöver dessutom veta OM texten är
 * hel: sammanfattningen, som annars visar en halv mening som om den vore
 * hela, och kortförslaget, vars JSON inte går att tolka när den huggits av.
 * Att byta returtyp på alla elva för de tvås skull hade varit ett sämre pris.
 *
 * @param {Parameters<typeof callAI>[0]} options
 * @returns {Promise<{text: string, truncated: boolean}>}
 * @throws {AiError}
 */
export async function callAIDetailed({
  system,
  user,
  maxTokens,
  json,
  provider,
  model,
  feature,
  effort,
  signal,
} = {}) {
  if (!user?.trim()) throw new AiError('Tomt meddelande skickades till AI.', 'bad_request');

  const token = await accessToken();
  if (!token) {
    throw new AiError('Logga in för att använda AI-funktionerna.', 'unauthorized');
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Egen timeout per försök, sammanslagen med anroparens signal så att ett
    // avbrutet flöde slutar vänta direkt i stället för att hänga i en minut.
    const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ system, user, maxTokens, json, provider, model, feature, effort }),
        signal: combined,
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        if (typeof data.text !== 'string') {
          throw new AiError('AI-tjänsten svarade i ett oväntat format.', 'provider_error');
        }
        return { text: data.text, truncated: data.truncated === true };
      }

      lastError = new AiError(
        data.error ?? `AI-tjänsten svarade med fel ${res.status}.`,
        data.code ?? 'provider_error',
        data.retryAfter ?? null
      );
    } catch (err) {
      if (signal?.aborted) throw new AiError('Avbrutet.', 'aborted');
      if (err instanceof AiError) throw err;
      lastError =
        err?.name === 'TimeoutError'
          ? new AiError('AI-tjänsten svarade inte i tid.', 'timeout')
          : new AiError('Ingen kontakt med servern. Kontrollera din uppkoppling.', 'network');
    }

    const sista = attempt === MAX_ATTEMPTS;
    if (sista || !RETRYABLE.has(lastError.code)) break;

    // Leverantörens egen Retry-After går före vår backoff — den vet bättre än
    // vi när det är lönt att försöka igen.
    const backoff = lastError.retryAfter ? lastError.retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
    await sleep(Math.min(backoff, 15_000));
  }

  throw lastError;
}

/**
 * Hämtar användarens sparade nycklar, utan chiffertexten.
 * Används för att avgöra om AI-funktionerna ska erbjudas alls.
 */
export async function getKeyStatus() {
  const token = await accessToken();
  if (!token) return { providers: [] };
  try {
    const res = await fetch('/api/ai-key', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { providers: [] };
    return await res.json();
  } catch {
    return { providers: [] };
  }
}

/** Finns en nyckel att anropa med? */
export async function hasAiKey() {
  const { providers } = await getKeyStatus();
  return providers.length > 0;
}

/**
 * Gemensam felvisning. Tidigare hanterades AI-fel på tre olika sätt i koden —
 * blockerande `alert`, toast, och inline-text i DOM:en — vilket gjorde att
 * samma fel såg olika ut beroende på var det uppstod.
 */
export function aiErrorMessage(err) {
  if (!(err instanceof AiError)) return 'Något gick fel med AI-anropet.';
  const texter = {
    unauthorized: 'Logga in för att använda AI-funktionerna.',
    no_key: 'Lägg in din API-nyckel under Inställningar för att använda AI.',
    invalid_key: 'API-nyckeln avvisades. Kontrollera den under Inställningar.',
    rate_limited: 'För många anrop just nu. Vänta en stund och försök igen.',
    timeout: 'AI-tjänsten svarade inte i tid. Försök igen.',
    network: 'Ingen kontakt med servern. Kontrollera din uppkoppling.',
    aborted: 'Avbrutet.',
  };
  return texter[err.code] ?? err.message;
}
