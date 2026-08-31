import { describe, expect, it } from 'vitest';
import { medTankeutrymme } from '../src/ai/tak.js';

/* Regeln finns för att ett tak satt efter textens längd inte räcker till
 * texten: modellen tänker ur samma budget och klipps mitt i meningen. Testet
 * håller därför fast vid att taket alltid är STÖRRE än den beställda texten,
 * inte vid ett visst tal — utrymmet får justeras, men aldrig bort. */
describe('medTankeutrymme', () => {
  it('ger mer än den beställda texten', () => {
    for (const textTokens of [300, 400, 700, 1500, 4000]) {
      expect(medTankeutrymme(textTokens)).toBeGreaterThan(textTokens);
    }
  });

  it('lägger på lika mycket oavsett hur lång texten är', () => {
    // Tänkandet styrs av frågans svårighet, inte av hur långt svaret ska bli.
    // Ett påslag i procent hade gett minst utrymme åt de kortaste svaren —
    // och det var just de som kapades.
    expect(medTankeutrymme(1500) - medTankeutrymme(300)).toBe(1200);
  });

  it('håller sig under serverns tak på 16 384 för appens största anrop', () => {
    expect(medTankeutrymme(4000)).toBeLessThan(16_384);
  });
});
