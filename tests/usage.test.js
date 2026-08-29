import { describe, expect, it } from 'vitest';
import { recordUsage } from '../api/_lib/usage.js';

const falskDb = (utfall) => ({
  from(tabell) {
    this.tabell = tabell;
    return {
      insert: async (rad) => {
        this.rad = rad;
        return utfall;
      },
    };
  },
});

describe('recordUsage', () => {
  it('skriver en rad med tokentalen', async () => {
    const db = falskDb({ error: null });
    await recordUsage(db, {
      userId: 'u1',
      provider: 'anthropic',
      model: 'claude-opus-5',
      feature: 'tutor',
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 1 },
    });
    expect(db.tabell).toBe('ai_usage');
    expect(db.rad).toMatchObject({
      user_id: 'u1',
      provider: 'anthropic',
      model: 'claude-opus-5',
      feature: 'tutor',
      input_tokens: 10,
      output_tokens: 2,
      cache_read_tokens: 5,
      cache_write_tokens: 1,
    });
  });

  /* En bokföringsrad får aldrig sänka det användaren faktiskt bad om: svaret
   * från leverantören är redan betalt och ska levereras även om vi inte lyckas
   * anteckna det. */
  it('kastar inte när databasen svarar med fel', async () => {
    const db = falskDb({ error: { message: 'nekad' } });
    await expect(
      recordUsage(db, {
        userId: 'u1',
        provider: 'anthropic',
        model: 'm',
        feature: 'tutor',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })
    ).resolves.toBeUndefined();
  });

  it('kastar inte när klienten själv exploderar', async () => {
    const trasigDb = {
      from() {
        throw new Error('ingen uppkoppling');
      },
    };
    await expect(
      recordUsage(trasigDb, {
        userId: 'u1',
        provider: 'anthropic',
        model: 'm',
        feature: 'tutor',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })
    ).resolves.toBeUndefined();
  });
});
