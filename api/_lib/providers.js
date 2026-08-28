// Adaptrar för de fyra AI-leverantörerna.
//
// Alla anrop i appen är single-turn utan verktyg och utan strömning. Det som
// skiljer leverantörerna åt kokar därför ner till fyra saker: hur nyckeln
// skickas, var systemprompten hör hemma, vad tokengränsen heter och var texten
// ligger i svaret. Adaptrarna är byggda för att vara symmetriska — samma fyra
// medlemmar var, ingen leverantör med ett eget undantag i anropskoden.
//
// Rå fetch, ingen SDK. Fyra SDK:er hade dragit in fyra beroenden med fyra egna
// felformer och fyra uppdateringstakter, alltså precis den asymmetri som det
// här lagret finns till för att ta bort.

import { ApiError, isTimeoutError } from './http.js';

/** Anthropic versionerar sitt API i en header i stället för i sökvägen. */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * En nyckelkontroll ska svara snabbt eller inte alls — användaren står och
 * väntar i inställningsvyn, till skillnad från vid ett riktigt AI-anrop.
 */
const VERIFY_TIMEOUT_MS = 15_000;

/**
 * Instruktionen som styr JSON-läget.
 *
 * Anthropic har inget eget JSON-läge, så för dem är den här meningen hela
 * mekanismen. Hos OpenAI räcker den inte, men den behövs ändå: deras JSON-läge
 * avvisar begäran om ordet JSON inte förekommer i prompten. Samma text till
 * alla fyra ger dessutom samma svarsstil oavsett vem användaren valt.
 */
const JSON_INSTRUCTION =
  'Svara enbart med giltig JSON, utan förklarande text före eller efter och utan kodstaket.';

function withJsonInstruction(system, json) {
  const base = typeof system === 'string' ? system.trim() : '';
  if (!json) return base;
  return base ? `${base}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
}

/**
 * Betyder svaret att nyckeln är fel, snarare än att leverantören krånglar?
 *
 * Google avvisar en felaktig nyckel med 400 och API_KEY_INVALID i stället för
 * 401. Utan det undantaget hade en felskriven Google-nyckel rapporterats som
 * ett leverantörsfel, och användaren aldrig fått veta att det var nyckeln som
 * var problemet.
 */
export function isAuthFailure(status, detail = '') {
  if (status === 401 || status === 403) return true;
  return status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid/i.test(detail);
}

/**
 * Plockar ut leverantörens egen felbeskrivning.
 *
 * Alla fyra lägger den under `error.message`, men resten av svaret kan vara
 * långt och innehålla ekon av begäran. Vi tar bara meddelandet, och kortar det
 * — det ska hjälpa användaren att förstå, inte återge hela kroppen.
 */
export function extractProviderMessage(bodyText) {
  if (!bodyText) return '';
  let message = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    message = parsed?.error?.message ?? parsed?.message ?? bodyText;
  } catch {
    // Inte JSON. Då är råtexten det bästa vi har.
  }
  return String(message).slice(0, 200).trim();
}

/**
 * Gemensam nyckelkontroll: ett läsande anrop som kostar noll tokens.
 *
 * Returnerar false bara när leverantören uttryckligen avvisar nyckeln. Ett
 * avbrott eller ett 500 hos leverantören kastas i stället, eftersom det vore
 * fel att be användaren skriva om en nyckel som mycket väl kan vara korrekt.
 */
async function probeKey(url, headers) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new ApiError(504, 'timeout', 'Leverantören svarade inte i tid. Försök igen.');
    }
    throw new ApiError(502, 'provider_error', 'Ingen kontakt med leverantören.');
  }

  if (res.ok) return true;
  const detail = await res.text().catch(() => '');
  if (isAuthFailure(res.status, detail)) return false;
  throw new ApiError(
    502,
    'provider_error',
    `Leverantören svarade med fel (${res.status}) när nyckeln skulle kontrolleras.`
  );
}

/**
 * Adaptrarna. Varje leverantör har:
 *
 * - `models` och `defaultModel` — katalogen från kontraktet. Den är en
 *   bekvämlighet i inställningarna, inte en begränsning: användaren kan skriva
 *   in vilket modell-id som helst, eftersom leverantörerna släpper nya modeller
 *   oftare än den här appen uppdateras.
 * - `buildRequest({ system, user, maxTokens, model, json, key })` som ger
 *   `{ url, headers, body }`. Kroppen är ett objekt; anroparen serialiserar.
 * - `extractText(responseJson)` som ger svarets text.
 * - `verifyKey(key)` som ger true eller false.
 */
export const providers = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-fable-5',
    ],
    defaultModel: 'claude-opus-5',

    buildRequest({ system, user, maxTokens, model, json, key }) {
      const prompt = withJsonInstruction(system, json);
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: {
          model,
          max_tokens: maxTokens,
          // Systemprompten är en egen parameter här, inte ett meddelande.
          ...(prompt ? { system: prompt } : {}),
          messages: [{ role: 'user', content: user }],
        },
      };
    },

    // Svaret är en lista av block. Med enbart text finns ett block, men vi
    // fogar ihop alla texter i stället för att ta det första: en modell som
    // delar upp sitt svar ska inte tappa halva meningen.
    extractText(data) {
      return (data?.content ?? [])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
    },

    // Modellistan kräver samma nyckel som meddelanden men kostar ingenting.
    // Ett riktigt meddelande hade debiterat användaren för att upptäcka en
    // felskrivning.
    verifyKey(key) {
      return probeKey('https://api.anthropic.com/v1/models?limit=1', {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      });
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5'],
    defaultModel: 'gpt-5.1',

    buildRequest({ system, user, maxTokens, model, json, key }) {
      const prompt = withJsonInstruction(system, json);
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: {
          model,
          // De nyare modellerna avvisar max_tokens och kräver det här namnet.
          max_completion_tokens: maxTokens,
          // Systemprompten är ett meddelande i listan, inte en egen parameter.
          messages: [
            ...(prompt ? [{ role: 'system', content: prompt }] : []),
            { role: 'user', content: user },
          ],
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
      };
    },

    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },

    verifyKey(key) {
      return probeKey('https://api.openai.com/v1/models', { authorization: `Bearer ${key}` });
    },
  },

  google: {
    id: 'google',
    label: 'Google',
    models: ['gemini-3-pro', 'gemini-3-flash'],
    defaultModel: 'gemini-3-pro',

    buildRequest({ system, user, maxTokens, model, json, key }) {
      const prompt = withJsonInstruction(system, json);
      return {
        // Modellen ligger i sökvägen här, inte i kroppen. Den kommer från
        // användaren och kodas därför, annars kan ett snedstreck i ett
        // hemsnickrat id peka anropet någon annanstans.
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: {
          ...(prompt ? { systemInstruction: { parts: [{ text: prompt }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        },
      };
    },

    extractText(data) {
      return (data?.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text ?? '').join('');
    },

    verifyKey(key) {
      return probeKey('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        'x-goog-api-key': key,
      });
    },
  },

  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    // Katalogen är avsiktligt tom: OpenRouter förmedlar hundratals modeller
    // från andra leverantörer, så en lista här hade varit inaktuell redan när
    // den skrevs. Användaren anger id:t på formen leverantör/modell.
    models: [],
    defaultModel: null,

    buildRequest({ system, user, maxTokens, model, json, key }) {
      const prompt = withJsonInstruction(system, json);
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          // Namnger appen i användarens egen OpenRouter-logg, så att
          // förbrukningen går att härleda till Repetix.
          'x-title': 'Repetix',
        },
        body: {
          model,
          max_tokens: maxTokens,
          messages: [
            ...(prompt ? [{ role: 'system', content: prompt }] : []),
            { role: 'user', content: user },
          ],
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
      };
    },

    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },

    verifyKey(key) {
      return probeKey('https://openrouter.ai/api/v1/auth/key', {
        authorization: `Bearer ${key}`,
      });
    },
  },
};

/** Leverantörernas id, i den ordning de visas i inställningarna. */
export const providerIds = Object.keys(providers);

/** Slår upp en adapter. Kastar ApiError vid okänd leverantör. */
export function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    throw new ApiError(
      400,
      'bad_request',
      // Namnet kommer från klienten och kortas innan det ekas tillbaka.
      `Okänd leverantör: ${String(name).slice(0, 40)}. Välj en av ${providerIds.join(', ')}.`
    );
  }
  return provider;
}
