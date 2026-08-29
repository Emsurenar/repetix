import { describe, expect, it } from 'vitest';
import { summera } from '../src/domain/usage.js';

const rad = (over) => ({
  model: 'claude-opus-5',
  feature: 'tutor',
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  created_at: '2026-08-15T10:00:00.000Z',
  ...over,
});

describe('summera', () => {
  it('summerar kostnad och tokental', () => {
    const r = summera([
      rad({ input_tokens: 1_000_000 }),
      rad({ output_tokens: 100_000 }),
    ]);
    expect(r.total).toBeCloseTo(7.5, 6);
    expect(r.tokens).toEqual({ in: 1_000_000, ut: 100_000 });
  });

  it('grupperar per funktion, dyrast först', () => {
    const r = summera([
      rad({ feature: 'tutor', input_tokens: 100_000 }),
      rad({ feature: 'topic', input_tokens: 1_000_000 }),
    ]);
    expect(r.perFunktion.map((p) => p.feature)).toEqual(['topic', 'tutor']);
    expect(r.perFunktion[0].kostnad).toBeCloseTo(5, 6);
  });

  /* En modell utan pris får inte tyst räknas som noll — då hade summan sett
   * komplett ut medan den saknade poster. Flaggan låter panelen säga det. */
  it('flaggar när någon rad saknar pris', () => {
    const r = summera([rad({ model: 'okänd-modell', input_tokens: 1000 })]);
    expect(r.okändaModeller).toBe(true);
    expect(r.total).toBe(0);
  });

  it('filtrerar på datumintervall i lokal tid', () => {
    // Klockslag mitt på dagen, inte vid midnatt: en tidszon på upp till ±14h
    // ska inte kunna knuffa datumet över till föregående eller nästa dygn och
    // få testet att falla på maskiner utanför UTC.
    const rader = [
      rad({ created_at: '2026-08-01T12:00:00.000Z', input_tokens: 1_000_000 }),
      rad({ created_at: '2026-07-31T12:00:00.000Z', input_tokens: 1_000_000 }),
    ];
    const r = summera(rader, { fran: '2026-08-01', till: '2026-08-31' });
    expect(r.total).toBeCloseTo(5, 6);
  });
});
