import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// supabase-modulen hämtar sin konfiguration ur import.meta.env och skapar en
// riktig klient. Här ersätts den helt: testerna gäller anropslagrets logik,
// inte Supabase.
const session = { access_token: 'test-token' };
vi.mock('../src/core/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: session.value } }) },
  },
}));

const { AiError, aiErrorMessage, callAI, getKeyStatus, hasAiKey } = await import(
  '../src/ai/call.js'
);

/** Bygger ett fetch-svar. */
const svar = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  session.value = { access_token: 'test-token' };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Kör ett löfte till slut trots att timers är fejkade. */
async function utan_vantan(promise) {
  const resultat = promise.then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e })
  );
  await vi.runAllTimersAsync();
  return resultat;
}

describe('callAI', () => {
  it('returnerar texten vid lyckat anrop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => svar(200, { text: 'Stockholm', provider: 'anthropic' }))
    );
    const r = await utan_vantan(callAI({ user: 'Huvudstad?' }));
    expect(r.ok).toBe(true);
    expect(r.v).toBe('Stockholm');
  });

  it('skickar med Supabase-token i Authorization', async () => {
    const f = vi.fn(async () => svar(200, { text: 'ok' }));
    vi.stubGlobal('fetch', f);
    await utan_vantan(callAI({ user: 'hej' }));
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('skickar system, maxTokens och json vidare oforandrat', async () => {
    const f = vi.fn(async () => svar(200, { text: 'ok' }));
    vi.stubGlobal('fetch', f);
    await utan_vantan(callAI({ system: 'S', user: 'U', maxTokens: 42, json: true }));
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ system: 'S', user: 'U', maxTokens: 42, json: true });
  });

  it('skickar med feature i kroppen', async () => {
    const skickat = [];
    globalThis.fetch = async (url, init) => {
      skickat.push(JSON.parse(init.body));
      return svar(200, { text: 'ett svar' });
    };

    await callAI({ user: 'hej', feature: 'tutor' });

    expect(skickat).toHaveLength(1);
    expect(skickat[0].feature).toBe('tutor');
  });

  it('kraver inloggning', async () => {
    session.value = null;
    vi.stubGlobal('fetch', vi.fn());
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.ok).toBe(false);
    expect(r.e.code).toBe('unauthorized');
  });

  it('avvisar tomt meddelande utan att rora natet', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await utan_vantan(callAI({ user: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.e.code).toBe('bad_request');
    expect(f).not.toHaveBeenCalled();
  });

  it('forsoker igen vid rate_limited och lyckas till slut', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(svar(429, { error: 'For manga anrop', code: 'rate_limited' }))
      .mockResolvedValueOnce(svar(200, { text: 'till slut' }));
    vi.stubGlobal('fetch', f);
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.ok).toBe(true);
    expect(r.v).toBe('till slut');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('forsoker INTE igen vid permanenta fel', async () => {
    // En saknad eller avvisad nyckel blir inte battre av att fragas om igen.
    for (const kod of ['no_key', 'invalid_key', 'unauthorized', 'bad_request']) {
      const f = vi.fn(async () => svar(400, { error: 'fel', code: kod }));
      vi.stubGlobal('fetch', f);
      const r = await utan_vantan(callAI({ user: 'hej' }));
      expect(r.ok, kod).toBe(false);
      expect(r.e.code, kod).toBe(kod);
      expect(f, kod).toHaveBeenCalledTimes(1);
    }
  });

  it('ger upp efter tre forsok', async () => {
    const f = vi.fn(async () => svar(502, { error: 'trasigt', code: 'provider_error' }));
    vi.stubGlobal('fetch', f);
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('behaller leverantorens felmeddelande', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => svar(428, { error: 'Ingen nyckel sparad.', code: 'no_key' }))
    );
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.e.message).toBe('Ingen nyckel sparad.');
  });

  it('behandlar natverksfel som fel, inte som tomt svar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.ok).toBe(false);
    expect(r.e.code).toBe('network');
  });

  it('avvisar ett svar som saknar text', async () => {
    // Ett 200-svar utan text-falt betyder att nagot ar fel pa serversidan.
    // Att returnera undefined hade gett ett obegripligt fel langre fram.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => svar(200, { provider: 'anthropic' }))
    );
    const r = await utan_vantan(callAI({ user: 'hej' }));
    expect(r.ok).toBe(false);
    expect(r.e.code).toBe('provider_error');
  });
});

describe('getKeyStatus och hasAiKey', () => {
  it('returnerar tom lista utan inloggning, utan att rora natet', async () => {
    session.value = null;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(getKeyStatus()).resolves.toEqual({ providers: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it('hasAiKey ar sant nar en nyckel finns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => svar(200, { providers: [{ provider: 'anthropic', hint: 'sk-a...9f2c' }] }))
    );
    await expect(hasAiKey()).resolves.toBe(true);
  });

  it('hasAiKey ar falskt vid serverfel i stallet for att kasta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => svar(500, {}))
    );
    await expect(hasAiKey()).resolves.toBe(false);
  });
});

describe('aiErrorMessage', () => {
  it('ger ett handlingsbart meddelande for saknad nyckel', () => {
    const text = aiErrorMessage(new AiError('rått fel', 'no_key'));
    expect(text).toContain('Inställningar');
  });

  it('faller tillbaka pa felets eget meddelande for okand kod', () => {
    expect(aiErrorMessage(new AiError('nagot ovantat', 'nonsens'))).toBe('nagot ovantat');
  });

  it('klarar ett fel som inte ar ett AiError', () => {
    expect(aiErrorMessage(new Error('vanligt fel'))).toMatch(/AI-anropet/);
  });
});
