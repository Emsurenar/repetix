import { describe, expect, it } from 'vitest';
import { harPris, kostnad } from '../src/domain/pricing.js';

describe('kostnad', () => {
  it('räknar input och output per miljon tokens', () => {
    // Opus 5: $5 in, $25 ut per Mtok.
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(5, 6);
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 100_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(2.5, 6);
  });

  /* Cachad läsning är en tiondel av input och cachad skrivning en och en
   * kvarts. Det är hela poängen med att grunda en PDF i kontexten, så det ska
   * synas som en egen post och inte döljas i input. */
  it('prissätter cachad läsning och skrivning ur input', () => {
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(0.5, 6);
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
      })
    ).toBeCloseTo(6.25, 6);
  });

  /* Användaren kan skriva in vilket modell-id som helst, och leverantörerna
   * släpper nya modeller oftare än appen uppdateras. En gissad prislapp vore
   * sämre än en ärlig lucka: null betyder "vet inte", inte "gratis". */
  it('ger null för en modell utan pris', () => {
    expect(
      kostnad({
        model: 'gpt-något-nytt',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeNull();
    expect(harPris('gpt-något-nytt')).toBe(false);
    expect(harPris('claude-opus-5')).toBe(true);
  });

  it('kan alla modeller appen listar för Anthropic', () => {
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-fable-5']) {
      expect(harPris(m)).toBe(true);
    }
  });
});
