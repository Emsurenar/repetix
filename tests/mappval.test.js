import { describe, expect, it } from 'vitest';

import { hittaMapp } from '../src/domain/mappval.js';

const sektioner = [
  { id: 's1', title: 'Grunder' },
  { id: 's2', title: 'Envariabelanalys' },
];

/* Modellen svarar med ett mappNAMN, inte ett id — den känner inga id:n. Namnet
 * måste därför paras ihop med en befintlig mapp, annars får varje förslag en
 * ny mapp med nästan samma namn som en som redan finns.
 */
describe('hittaMapp', () => {
  it('hittar mappen på namnet', () => {
    expect(hittaMapp(sektioner, 'Grunder')?.id).toBe('s1');
  });

  /* Modellen skriver som den vill; versalerna är inte ett annat svar. */
  it('bryr sig inte om versaler eller blanksteg', () => {
    expect(hittaMapp(sektioner, '  grunder ')?.id).toBe('s1');
    expect(hittaMapp(sektioner, 'ENVARIABELANALYS')?.id).toBe('s2');
  });

  it('ger null när namnet inte finns', () => {
    expect(hittaMapp(sektioner, 'Flervariabelanalys')).toBeNull();
  });

  it('ger null på tomt eller ogiltigt namn', () => {
    for (const namn of ['', '   ', null, undefined, 42]) {
      expect(hittaMapp(sektioner, namn), String(namn)).toBeNull();
    }
  });

  it('tål en lek utan mappar', () => {
    expect(hittaMapp([], 'Grunder')).toBeNull();
    expect(hittaMapp(null, 'Grunder')).toBeNull();
  });

  /* En mapp utan titel ska inte matcha ett tomt svar och råka bli vald. */
  it('matchar inte en titellös mapp', () => {
    expect(hittaMapp([{ id: 'x' }], '')).toBeNull();
  });
});
