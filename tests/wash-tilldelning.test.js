import { describe, expect, it } from 'vitest';

import { tilldelaBilder } from '../src/domain/wash-tilldelning.js';

const ANTAL = 30;
const nycklar = (n, prefix = 'd') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/* Bilden räknades ur nyckeln ensam, och en ren funktion av ett id kan inte
 * veta vad de andra fick. Med trettio bilder och åtta kortlekar är chansen
 * för minst en krock ungefär 65 % — två paneler bredvid varandra med samma
 * bakgrund, vilket är precis vad bakgrunden finns till för att undvika.
 */
describe('tilldelaBilder', () => {
  it('ger alla olika bild så länge de får plats', () => {
    for (const n of [2, 5, 12, 29, 30]) {
      const ut = tilldelaBilder(nycklar(n), ANTAL);
      expect(ut.size, `${n} nycklar`).toBe(n);
      expect(new Set(ut.values()).size, `${n} nycklar`).toBe(n);
    }
  });

  it('håller sig inom bilderna som finns', () => {
    for (const nummer of tilldelaBilder(nycklar(30), ANTAL).values()) {
      expect(nummer).toBeGreaterThanOrEqual(1);
      expect(nummer).toBeLessThanOrEqual(ANTAL);
    }
  });

  /* Samma mängd ska alltid ge samma tilldelning. Bakgrunden är en identitet;
   * en bild som byts mellan två besök är brus. */
  it('ger samma svar varje gång', () => {
    const a = tilldelaBilder(nycklar(10), ANTAL);
    const b = tilldelaBilder(nycklar(10), ANTAL);
    expect([...a]).toEqual([...b]);
  });

  /* Det är därför sonderingen går framåt genom listan i ordning: en ny lek
   * läggs sist och tar en ledig plats, utan att rubba någon befintlig. */
  it('rubbar ingen befintlig när en nyckel läggs till sist', () => {
    const fore = tilldelaBilder(nycklar(6), ANTAL);
    const efter = tilldelaBilder([...nycklar(6), 'ny'], ANTAL);
    for (const [nyckel, nummer] of fore) {
      expect(efter.get(nyckel), nyckel).toBe(nummer);
    }
    expect(efter.get('ny')).toBeDefined();
  });

  /* Fler nycklar än bilder går inte att lösa. Då ska var och en ändå få en
   * bild — den den helst ville ha — i stället för att någon blir utan. */
  it('ger alla en bild även när de är fler än bilderna', () => {
    const ut = tilldelaBilder(nycklar(45), ANTAL);
    expect(ut.size).toBe(45);
    for (const nummer of ut.values()) {
      expect(nummer).toBeGreaterThanOrEqual(1);
      expect(nummer).toBeLessThanOrEqual(ANTAL);
    }
  });

  it('tål dubbletter i listan', () => {
    const ut = tilldelaBilder(['a', 'b', 'a'], ANTAL);
    expect(ut.size).toBe(2);
    expect(ut.get('a')).not.toBe(ut.get('b'));
  });

  it('tål en tom lista och skräp i den', () => {
    expect(tilldelaBilder([], ANTAL).size).toBe(0);
    expect(tilldelaBilder(null, ANTAL).size).toBe(0);
    const ut = tilldelaBilder(['a', null, '', undefined, 'b'], ANTAL);
    expect([...ut.keys()]).toEqual(['a', 'b']);
  });

  /* Olika mängder ska inte ge systematiskt samma bild åt den första — då
   * hade sonderingen bara flyttat problemet. */
  it('sprider ut sig i stället för att börja om på ett', () => {
    const forsta = ['x', 'y', 'z'].map((p) => tilldelaBilder(nycklar(3, p), ANTAL).get(`${p}0`));
    expect(new Set(forsta).size).toBeGreaterThan(1);
  });
});
