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

  it('har samma fyra medlemmar hos varje adapter', () => {
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
