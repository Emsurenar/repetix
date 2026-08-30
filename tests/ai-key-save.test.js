import { beforeEach, describe, expect, it, vi } from 'vitest';

const attrapp = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({
    userId: '11111111-1111-1111-1111-111111111111',
    token: 'token',
    db: { rpc: attrapp.rpc, from: attrapp.from },
  }),
}));
vi.mock('../api/_lib/crypto.js', () => ({ encrypt: (klartext) => `krypterad(${klartext})` }));
vi.mock('../api/_lib/limit.js', () => ({ enforceRateLimit: async () => {} }));
vi.mock('../api/_lib/providers.js', () => ({
  getProvider: (id) => ({ id, label: 'Leverantören', verifyKey: async () => true }),
}));

const { default: handler } = await import('../api/ai-key.js');

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(namn, värde) {
      this.headers[namn] = värde;
    },
    end(text) {
      this.body = text;
    },
  };
}

async function spara(key = 'sk-test-abcdefghijklmnop') {
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: {}, body: { provider: 'anthropic', key } },
    res
  );
  return { res, svar: JSON.parse(res.body) };
}

/* Att spara en nyckel misslyckades alltid, med 42501, och tabellen var tom.
 *
 * Servern gjorde en upsert rakt mot user_ai_keys. `insert ... on conflict do
 * update` kräver att raden får läsas under radnivåsäkerheten, och Postgres
 * avgör det utifrån satsens form — inte utifrån om någon krock inträffar.
 * Tabellen saknar select-policy med flit, så satsen kunde aldrig gå igenom,
 * inte ens mot tom tabell. Provat i Postgres: ren insert med samma policyer
 * går igenom, samma insert med on conflict ger 42501 även utan befintlig rad.
 */
describe('POST /api/ai-key', () => {
  beforeEach(() => {
    attrapp.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    attrapp.from.mockReset();
  });

  it('skriver genom save_my_ai_key och aldrig rakt mot tabellen', async () => {
    const { res, svar } = await spara();

    expect(attrapp.from).not.toHaveBeenCalled();
    expect(attrapp.rpc).toHaveBeenCalledTimes(1);
    expect(attrapp.rpc.mock.calls[0][0]).toBe('save_my_ai_key');
    expect(res.statusCode).toBe(200);
    expect(svar).toMatchObject({ ok: true, verified: true });
  });

  it('skickar chiffertexten, aldrig nyckeln själv', async () => {
    await spara('sk-test-hemligheten');

    const args = attrapp.rpc.mock.calls[0][1];
    expect(args.p_encrypted_key).toBe('krypterad(sk-test-hemligheten)');
    expect(JSON.stringify(args)).not.toContain('sk-test-hemligheten"');
    expect(args.p_provider).toBe('anthropic');
  });

  /* Funktionen härleder ägaren ur auth.uid(). Skickade servern med ett eget
   * user_id vore det ett sämre svar på vem raden tillhör än det databasen
   * redan vet, och ett fält till som kunde peka fel. */
  it('skickar inget user_id — databasen vet vem som ringer', async () => {
    await spara();

    expect(Object.keys(attrapp.rpc.mock.calls[0][1]).sort()).toEqual([
      'p_encrypted_key',
      'p_key_hint',
      'p_provider',
    ]);
  });

  it('låter databasfelets kod nå användaren', async () => {
    attrapp.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });

    const { res, svar } = await spara();

    expect(res.statusCode).toBe(500);
    expect(svar.error).toContain('42501');
  });
});
