import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/_lib/http.js';
import {
  extractProviderMessage,
  getProvider,
  isAuthFailure,
  providerIds,
  providers,
} from '../api/_lib/providers.js';

const NYCKEL = 'test-nyckel-123';

const anrop = (extra = {}) => ({
  system: 'Du ar en hjalpsam larare.',
  user: 'Forklara fotosyntes.',
  maxTokens: 500,
  model: 'test-modell',
  json: false,
  key: NYCKEL,
  ...extra,
});

describe('katalogen', () => {
  it('har de fyra leverantorerna ur kontraktet', () => {
    expect(providerIds).toEqual(['anthropic', 'openai', 'google', 'openrouter']);
  });

  it('har claude-opus-5 som standard hos anthropic', () => {
    expect(providers.anthropic.defaultModel).toBe('claude-opus-5');
    expect(providers.anthropic.models).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-fable-5',
    ]);
  });

  it('foljer kontraktets modelllistor for openai och google', () => {
    expect(providers.openai.models).toEqual(['gpt-5.1', 'gpt-5.1-mini', 'gpt-5']);
    expect(providers.google.models).toEqual(['gemini-3-pro', 'gemini-3-flash']);
  });

  it('lamnar openrouter utan katalog och utan standardmodell', () => {
    expect(providers.openrouter.models).toEqual([]);
    expect(providers.openrouter.defaultModel).toBeNull();
  });

  it('kastar vid okand leverantor', () => {
    expect(() => getProvider('mistral')).toThrow(ApiError);
    expect(() => getProvider('mistral')).toThrow(/mistral/);
    expect(() => getProvider('')).toThrow(ApiError);
    expect(() => getProvider(undefined)).toThrow(ApiError);
  });

  it('har buildRequest, extractText, verifyKey och en modellista hos varje adapter', () => {
    for (const id of providerIds) {
      const adapter = providers[id];
      expect(typeof adapter.buildRequest).toBe('function');
      expect(typeof adapter.extractText).toBe('function');
      expect(typeof adapter.verifyKey).toBe('function');
      expect(Array.isArray(adapter.models)).toBe(true);
    }
  });
});

describe('buildRequest: autentisering', () => {
  it('skickar nyckeln i x-api-key hos anthropic, aldrig som bearer', () => {
    const { headers } = providers.anthropic.buildRequest(anrop());
    expect(headers['x-api-key']).toBe(NYCKEL);
    expect(headers.authorization).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('skickar nyckeln som bearer hos openai', () => {
    const { headers } = providers.openai.buildRequest(anrop());
    expect(headers.authorization).toBe(`Bearer ${NYCKEL}`);
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('skickar nyckeln i x-goog-api-key hos google', () => {
    const { headers, url } = providers.google.buildRequest(anrop());
    expect(headers['x-goog-api-key']).toBe(NYCKEL);
    expect(headers.authorization).toBeUndefined();
    // Modellen ligger i sokvagen hos google, inte i kroppen.
    expect(url).toContain('/models/test-modell:generateContent');
  });

  it('skickar nyckeln som bearer hos openrouter', () => {
    const { headers } = providers.openrouter.buildRequest(anrop());
    expect(headers.authorization).toBe(`Bearer ${NYCKEL}`);
  });
});

describe('buildRequest: systemprompten', () => {
  it('lagger den som egen parameter hos anthropic', () => {
    const { body } = providers.anthropic.buildRequest(anrop());
    expect(body.system).toBe('Du ar en hjalpsam larare.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Forklara fotosyntes.' }]);
  });

  it('lagger den som forsta meddelande hos openai och openrouter', () => {
    for (const id of ['openai', 'openrouter']) {
      const { body } = providers[id].buildRequest(anrop());
      expect(body.messages[0]).toEqual({ role: 'system', content: 'Du ar en hjalpsam larare.' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Forklara fotosyntes.' });
      expect(body.system).toBeUndefined();
    }
  });

  it('lagger den i systemInstruction hos google', () => {
    const { body } = providers.google.buildRequest(anrop());
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Du ar en hjalpsam larare.' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Forklara fotosyntes.' }] }]);
  });

  it('utelamnar systemprompten helt nar den saknas', () => {
    expect(providers.anthropic.buildRequest(anrop({ system: '' })).body.system).toBeUndefined();
    expect(providers.openai.buildRequest(anrop({ system: '' })).body.messages).toHaveLength(1);
    expect(
      providers.google.buildRequest(anrop({ system: '' })).body.systemInstruction
    ).toBeUndefined();
    expect(providers.openrouter.buildRequest(anrop({ system: '' })).body.messages).toHaveLength(1);
  });
});

describe('buildRequest: tokengransen', () => {
  it('heter max_tokens hos anthropic', () => {
    const { body } = providers.anthropic.buildRequest(anrop());
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.maxOutputTokens).toBeUndefined();
  });

  it('heter max_completion_tokens hos openai', () => {
    const { body } = providers.openai.buildRequest(anrop());
    expect(body.max_completion_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
  });

  it('heter maxOutputTokens och ligger i generationConfig hos google', () => {
    const { body } = providers.google.buildRequest(anrop());
    expect(body.generationConfig.maxOutputTokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
  });

  it('heter max_tokens hos openrouter', () => {
    const { body } = providers.openrouter.buildRequest(anrop());
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
  });
});

describe('buildRequest: json-laget', () => {
  it('anvander leverantorens eget lage dar det finns', () => {
    expect(providers.openai.buildRequest(anrop({ json: true })).body.response_format).toEqual({
      type: 'json_object',
    });
    expect(providers.openrouter.buildRequest(anrop({ json: true })).body.response_format).toEqual({
      type: 'json_object',
    });
    expect(
      providers.google.buildRequest(anrop({ json: true })).body.generationConfig.responseMimeType
    ).toBe('application/json');
  });

  it('lamnar flaggan borta nar json inte begarts', () => {
    expect(providers.openai.buildRequest(anrop()).body.response_format).toBeUndefined();
    expect(
      providers.google.buildRequest(anrop()).body.generationConfig.responseMimeType
    ).toBeUndefined();
  });

  it('skriver in instruktionen i systemprompten hos alla fyra', () => {
    // Anthropic har inget eget json-lage, och openai kraver att ordet JSON
    // forekommer i prompten for att alls godta sitt.
    expect(providers.anthropic.buildRequest(anrop({ json: true })).body.system).toMatch(/JSON/);
    expect(providers.openai.buildRequest(anrop({ json: true })).body.messages[0].content).toMatch(
      /JSON/
    );
    expect(
      providers.google.buildRequest(anrop({ json: true })).body.systemInstruction.parts[0].text
    ).toMatch(/JSON/);
    expect(
      providers.openrouter.buildRequest(anrop({ json: true })).body.messages[0].content
    ).toMatch(/JSON/);
  });

  it('lagger till instruktionen aven utan systemprompt', () => {
    const { body } = providers.anthropic.buildRequest(anrop({ system: '', json: true }));
    expect(body.system).toMatch(/JSON/);
  });
});

describe('extractText', () => {
  it('plockar content[0].text hos anthropic', () => {
    const svar = { content: [{ type: 'text', text: 'Fotosyntes ar ...' }] };
    expect(providers.anthropic.extractText(svar)).toBe('Fotosyntes ar ...');
  });

  it('fogar ihop flera textblock hos anthropic och hoppar over ovriga', () => {
    const svar = {
      content: [
        { type: 'thinking', thinking: 'ska inte med' },
        { type: 'text', text: 'del ett ' },
        { type: 'text', text: 'del tva' },
      ],
    };
    expect(providers.anthropic.extractText(svar)).toBe('del ett del tva');
  });

  it('plockar choices[0].message.content hos openai och openrouter', () => {
    const svar = { choices: [{ message: { role: 'assistant', content: 'Svaret' } }] };
    expect(providers.openai.extractText(svar)).toBe('Svaret');
    expect(providers.openrouter.extractText(svar)).toBe('Svaret');
  });

  it('plockar candidates[0].content.parts[0].text hos google', () => {
    const svar = { candidates: [{ content: { parts: [{ text: 'Svaret' }] } }] };
    expect(providers.google.extractText(svar)).toBe('Svaret');
  });

  it('ger tom strang i stallet for att kasta pa ett oformat svar', () => {
    for (const id of providerIds) {
      expect(providers[id].extractText(null)).toBe('');
      expect(providers[id].extractText({})).toBe('');
    }
  });
});

describe('felttolkning', () => {
  it('raknar 401 och 403 som fel nyckel', () => {
    expect(isAuthFailure(401)).toBe(true);
    expect(isAuthFailure(403)).toBe(true);
    expect(isAuthFailure(500)).toBe(false);
  });

  it('raknar googles 400 med API_KEY_INVALID som fel nyckel', () => {
    expect(
      isAuthFailure(400, '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid"}}')
    ).toBe(true);
    expect(isAuthFailure(400, 'reason: API_KEY_INVALID')).toBe(true);
    expect(isAuthFailure(400, 'max_tokens is too large')).toBe(false);
  });

  it('plockar leverantorens meddelande ur felsvaret', () => {
    expect(extractProviderMessage('{"error":{"message":"overloaded"}}')).toBe('overloaded');
    expect(extractProviderMessage('rena texten')).toBe('rena texten');
    expect(extractProviderMessage('')).toBe('');
  });
});

/* Nyckelkontrollen är den enda platsen där ett fel från leverantören inte kan
 * felsökas i efterhand: serverfunktionerna loggar med flit ingenting, så det
 * som inte följer med i meddelandet är borta. Statuskoden ensam räcker inte —
 * ett 400 säger att begäran var fel men inte vad i den. */
describe('verifyKey: vad som når användaren', () => {
  const medSvar = async (svar, fn) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => svar;
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  };

  const svar = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });

  it('avvisad nyckel ger false, inte ett kastat fel', async () => {
    const r = await medSvar(svar(401, '{"error":{"message":"invalid x-api-key"}}'), () =>
      providers.anthropic.verifyKey(NYCKEL)
    );
    expect(r).toBe(false);
  });

  it('tar med leverantorens egen beskrivning vid 400', async () => {
    const fel = await medSvar(
      svar(400, '{"error":{"type":"invalid_request_error","message":"limit: unrecognized"}}'),
      () => providers.anthropic.verifyKey(NYCKEL).then(() => null).catch((e) => e)
    );
    expect(fel).toBeInstanceOf(ApiError);
    expect(fel.code).toBe('provider_error');
    expect(fel.message).toContain('400');
    expect(fel.message).toContain('limit: unrecognized');
  });

  it('klarar ett felsvar utan beskrivning', async () => {
    const fel = await medSvar(svar(503, ''), () =>
      providers.anthropic.verifyKey(NYCKEL).then(() => null).catch((e) => e)
    );
    expect(fel.message).toContain('503');
    expect(fel.message).not.toContain('undefined');
  });
});

/* Tokentalen heter olika hos varje leverantör, och ett fält som saknas ska bli
 * noll och aldrig undefined: summeringen i panelen adderar dem rakt av, och en
 * enda undefined hade gjort hela månadssumman till NaN.
 *
 * Formen för de tre icke-Anthropic-leverantörerna är antagen och inte
 * verifierad mot ett riktigt svar. Därför är noll det säkra utfallet: gissar vi
 * fel fält får vi nollor, inte påhittade tal. */
describe('extractUsage', () => {
  it('läser Anthropics fält, cache inräknad', () => {
    expect(
      providers.anthropic.extractUsage({
        usage: {
          input_tokens: 1200,
          output_tokens: 340,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 8000,
        },
      })
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheWriteTokens: 900,
      cacheReadTokens: 8000,
    });
  });

  it('läser OpenAI:s fält', () => {
    expect(
      providers.openai.extractUsage({
        usage: { prompt_tokens: 500, completion_tokens: 120 },
      })
    ).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('läser OpenAI:s cachade tokens ur det nästlade fältet', () => {
    expect(
      providers.openai.extractUsage({
        usage: {
          prompt_tokens: 500,
          completion_tokens: 120,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      })
    ).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      cacheWriteTokens: 0,
      cacheReadTokens: 400,
    });
  });

  it('läser Googles fält', () => {
    expect(
      providers.google.extractUsage({
        usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 90 },
      })
    ).toEqual({
      inputTokens: 700,
      outputTokens: 90,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('läser Googles cachade tokens', () => {
    expect(
      providers.google.extractUsage({
        usageMetadata: {
          promptTokenCount: 700,
          candidatesTokenCount: 90,
          cachedContentTokenCount: 500,
        },
      })
    ).toEqual({
      inputTokens: 700,
      outputTokens: 90,
      cacheWriteTokens: 0,
      cacheReadTokens: 500,
    });
  });

  it('läser OpenRouters fält', () => {
    expect(
      providers.openrouter.extractUsage({
        usage: { prompt_tokens: 60, completion_tokens: 10 },
      })
    ).toEqual({
      inputTokens: 60,
      outputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('ger nollor när svaret saknar usage helt', () => {
    for (const id of providerIds) {
      expect(providers[id].extractUsage({})).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
      expect(providers[id].extractUsage(null)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
    }
  });
});

/* Ett avhugget svar såg likadant ut som ett helt.
 *
 * Ingen adapter läste stop_reason eller finish_reason, så texten kom tillbaka
 * som om den vore färdig. Sammanfattningen slutade mitt i en mening och ett
 * svar som skulle vara JSON gick inte att tolka — utan att något pekade på
 * tokentaket, som var det som faktiskt tagit slut.
 */
describe('extractTruncated', () => {
  const avhugget = {
    anthropic: { stop_reason: 'max_tokens' },
    openai: { choices: [{ finish_reason: 'length' }] },
    google: { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    openrouter: { choices: [{ finish_reason: 'length' }] },
  };

  const helt = {
    anthropic: { stop_reason: 'end_turn' },
    openai: { choices: [{ finish_reason: 'stop' }] },
    google: { candidates: [{ finishReason: 'STOP' }] },
    openrouter: { choices: [{ finish_reason: 'stop' }] },
  };

  it('kanner igen taket hos alla fyra', () => {
    for (const id of providerIds) {
      expect(providers[id].extractTruncated(avhugget[id]), id).toBe(true);
    }
  });

  it('sager nej nar svaret ar helt', () => {
    for (const id of providerIds) {
      expect(providers[id].extractTruncated(helt[id]), id).toBe(false);
    }
  });

  /* Ett svar utan falten alls far aldrig rapporteras som avhugget: da hade
   * varje sammanfattning fatt en varning om att den inte var fardig. */
  it('sager nej pa tomt eller okant svar', () => {
    for (const id of providerIds) {
      expect(providers[id].extractTruncated({}), id).toBe(false);
      expect(providers[id].extractTruncated(null), id).toBe(false);
      expect(providers[id].extractTruncated(undefined), id).toBe(false);
    }
  });

  /* Andra stoppskal ar inte avhuggna: ett verktygsstopp eller ett
   * innehallsfilter ar nagot annat an att pappret tog slut. */
  it('skiljer taket fran andra stoppskal', () => {
    expect(providers.anthropic.extractTruncated({ stop_reason: 'stop_sequence' })).toBe(false);
    expect(providers.openai.extractTruncated({ choices: [{ finish_reason: 'content_filter' }] })).toBe(false);
    expect(providers.google.extractTruncated({ candidates: [{ finishReason: 'SAFETY' }] })).toBe(false);
  });
});
