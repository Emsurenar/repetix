import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/_lib/http.js';
import { LIMITS, describeWait, enforceRateLimit } from '../api/_lib/limit.js';

/**
 * En db-attrapp. Svaren ges i tur och ordning, ett per fonster, och varje
 * anrop sparas sa att argumenten gar att provas.
 */
function fakeDb(svar) {
  const anrop = [];
  const kvar = [...svar];
  return {
    anrop,
    async rpc(fn, args) {
      anrop.push({ fn, args });
      const nasta = kvar.shift();
      if (!nasta) throw new Error('attrappen fick fler anrop an den hade svar');
      return nasta;
    },
  };
}

const slapper = (retryAfter = 42) => ({ data: { allowed: true, retryAfter }, error: null });
const stoppar = (retryAfter) => ({ data: { allowed: false, retryAfter }, error: null });

describe('taken', () => {
  it('tacker de tre slutpunkter serverfunktionerna anropar', () => {
    expect(Object.keys(LIMITS).sort()).toEqual(['ai', 'ai-key', 'ai-key:verify']);
  });

  it('ger ai bade ett burst-tak per minut och ett kostnadstak per timme', () => {
    expect(LIMITS.ai).toEqual([
      { limit: 20, windowSeconds: 60 },
      { limit: 120, windowSeconds: 3600 },
    ]);
  });

  it('haller nyckelkontrollen pa tio i timmen', () => {
    expect(LIMITS['ai-key:verify']).toEqual([{ limit: 10, windowSeconds: 3600 }]);
  });

  it('listar fonstren fran kortast till langst, sa att kort sparr ger kort vantan', () => {
    for (const buckets of Object.values(LIMITS)) {
      const fonster = buckets.map((b) => b.windowSeconds);
      expect(fonster).toEqual([...fonster].sort((a, b) => a - b));
    }
  });
});

describe('enforceRateLimit', () => {
  it('slapper igenom och stegar varje fonster', async () => {
    const db = fakeDb([slapper(), slapper()]);
    await expect(enforceRateLimit(db, 'ai')).resolves.toBeUndefined();

    expect(db.anrop).toHaveLength(2);
    expect(db.anrop[0]).toEqual({
      fn: 'bump_rate_limit',
      args: { p_endpoint: 'ai', p_limit: 20, p_window_seconds: 60 },
    });
    expect(db.anrop[1].args).toEqual({
      p_endpoint: 'ai',
      p_limit: 120,
      p_window_seconds: 3600,
    });
  });

  it('kastar rate_limited med retryAfter nar taket ar natt', async () => {
    const db = fakeDb([stoppar(37)]);
    const err = await enforceRateLimit(db, 'ai').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.extra).toEqual({ retryAfter: 37 });
    expect(err.message).toMatch(/37 sekunder/);
  });

  it('stannar vid forsta stoppet, sa att det korta fonstret ger den korta vantan', async () => {
    const db = fakeDb([stoppar(12)]);
    await expect(enforceRateLimit(db, 'ai')).rejects.toThrow(ApiError);
    // Timfonstret ska varken raknas eller fragas nar minutfonstret redan sagt nej.
    expect(db.anrop).toHaveLength(1);
  });

  it('klammer retryAfter till fonstrets langd', async () => {
    const db = fakeDb([stoppar(999_999)]);
    const err = await enforceRateLimit(db, 'ai').catch((e) => e);
    expect(err.extra.retryAfter).toBe(60);
  });

  it('ger minst en sekund aven nar databasen sager noll', async () => {
    const db = fakeDb([stoppar(0)]);
    const err = await enforceRateLimit(db, 'ai').catch((e) => e);
    expect(err.extra.retryAfter).toBe(1);
  });

  it('avrundar uppat, sa att klienten aldrig forsoker igen for tidigt', async () => {
    const db = fakeDb([stoppar(4.2)]);
    const err = await enforceRateLimit(db, 'ai').catch((e) => e);
    expect(err.extra.retryAfter).toBe(5);
  });

  // Fail closed: en sparr som oppnar sig nar databasen krankar ar verkningslos
  // just nar den behovs som mest.
  it('stanger slutpunkten nar databasen svarar med fel', async () => {
    const db = fakeDb([{ data: null, error: { message: 'function does not exist' } }]);
    const err = await enforceRateLimit(db, 'ai').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('server_error');
  });

  it('stanger slutpunkten aven nar svaret har fel form', async () => {
    for (const data of [null, {}, { allowed: 'ja' }, 'nej']) {
      const err = await enforceRateLimit(fakeDb([{ data, error: null }]), 'ai').catch((e) => e);
      expect(err.status).toBe(503);
    }
  });

  it('slar aldrig upp taken genom prototypkedjan', async () => {
    for (const namn of ['__proto__', 'constructor', 'toString']) {
      const err = await enforceRateLimit(fakeDb([]), namn).catch((e) => e);
      expect(err).not.toBeInstanceOf(ApiError);
      expect(err.message).toMatch(/Okänd slutpunkt/);
    }
  });
});

describe('describeWait', () => {
  it('raknar i sekunder under en och en halv minut', () => {
    expect(describeWait(1)).toBe('en sekund');
    expect(describeWait(30)).toBe('30 sekunder');
    expect(describeWait(89)).toBe('89 sekunder');
  });

  it('gar over till minuter darefter', () => {
    expect(describeWait(90)).toBe('2 minuter');
    expect(describeWait(600)).toBe('10 minuter');
  });

  it('gar over till timmar vid en och en halv timme', () => {
    expect(describeWait(5400)).toBe('2 timmar');
    expect(describeWait(3480)).toBe('58 minuter');
  });

  it('sager aldrig noll eller negativt', () => {
    expect(describeWait(0)).toBe('en sekund');
    expect(describeWait(-5)).toBe('en sekund');
    expect(describeWait(undefined)).toBe('en sekund');
  });
});
