import { describe, expect, it } from 'vitest';
import { TECKENTAK, overTaket, sammanfogaSidor } from '../src/domain/kalltext.js';

describe('sammanfogaSidor', () => {
  it('fogar ihop sidor med blankrad emellan', () => {
    expect(sammanfogaSidor(['sida ett', 'sida två'])).toBe('sida ett\n\nsida två');
  });

  /* pdf.js ger ofta rader med efterhängande blanksteg och tomma sidor för
   * omslag och avdelare. En tom sida ska inte bli en blankrad till. */
  it('hoppar över tomma sidor och trimmar', () => {
    expect(sammanfogaSidor(['  ett  ', '   ', '', 'två'])).toBe('ett\n\ntvå');
  });

  it('ger tom sträng när ingenting gick att utvinna', () => {
    expect(sammanfogaSidor([])).toBe('');
    expect(sammanfogaSidor(['', '   '])).toBe('');
  });
});

describe('overTaket', () => {
  /* Taket finns för att en hel kursbok annars spränger både kontexten och
   * plånboken. Gränsen prövas exakt, inte ungefär: ett tak som råkar vara ett
   * tecken fel är ett tak ingen kan resonera om. */
  it('är falskt precis på gränsen och sant ett tecken över', () => {
    expect(overTaket('x'.repeat(TECKENTAK))).toBe(false);
    expect(overTaket('x'.repeat(TECKENTAK + 1))).toBe(true);
  });

  it('klarar tom text', () => {
    expect(overTaket('')).toBe(false);
  });
});
