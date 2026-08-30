import { describe, expect, it } from 'vitest';

import { dbError } from '../api/_lib/http.js';

/* Ett fel mot databasen var tidigare omöjligt att skilja från nästa.
 *
 * "Kunde inte spara nyckeln. Försök igen." visades likadant vare sig en
 * radnivåpolicy saknades, en migration aldrig hade körts eller databasen låg
 * nere — och bara i det sista fallet var rådet att försöka igen sant.
 * Supabase-felet fanns i handen men destrukturerades bort, och eftersom
 * serverfunktionerna med flit inte loggar något fanns orsaken sedan ingenstans.
 */
describe('dbError', () => {
  it('behåller databasens kod i meddelandet', () => {
    const fel = dbError({ code: '42501' }, 'Kunde inte spara nyckeln. Försök igen.');
    expect(fel.message).toContain('42501');
    expect(fel.status).toBe(500);
    expect(fel.code).toBe('server_error');
  });

  it('tar även PostgREST-koder, som inte är SQLSTATE', () => {
    expect(dbError({ code: 'PGRST204' }, 'Kunde inte spara nyckeln.').message).toContain('PGRST204');
  });

  /* Ett fel utan kod ska inte lämna en tom parentes efter sig. */
  it('lämnar texten orörd när koden saknas', () => {
    const text = 'Kunde inte spara nyckeln. Försök igen.';
    expect(dbError({ message: 'nätet dog' }, text).message).toBe(text);
    expect(dbError(null, text).message).toBe(text);
    expect(dbError({ code: '  ' }, text).message).toBe(text);
  });

  /* Koden kommer utifrån och hamnar i en text som visas för användaren.
   *
   * Fälten details och hint återger dessutom raden som inte gick igenom, och
   * den raden bär chiffertexten för nyckeln — därför följer bara code med, och
   * bara när den har formen av en kod. */
  it('släpper inte igenom något annat än en kod', () => {
    const text = 'Kunde inte spara nyckeln.';
    expect(dbError({ code: 'new row violates policy for "user_ai_keys"' }, text).message).toBe(text);
    expect(dbError({ code: 'x'.repeat(21) }, text).message).toBe(text);
    expect(dbError({ code: '42501' }, text).message).toBe(`${text} (databasfel 42501)`);
  });

  it('tar inte med details, som kan innehålla den krypterade nyckeln', () => {
    const fel = dbError(
      { code: '23514', details: 'Failing row contains (uuid, anthropic, iv:tag:chiffer, ...).' },
      'Kunde inte spara nyckeln.'
    );
    expect(fel.message).not.toContain('chiffer');
    expect(fel.message).not.toContain('Failing row');
  });
});
