import { describe, expect, it } from 'vitest';

import { fordelaMappar, hittaMapp } from '../src/domain/mappval.js';

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

/* Genereringen låter modellen föreslå en mapp PER kort, så en omgång kan peka
 * på både befintliga och nya mappar på en gång. Fördelningen är egen och ren
 * av samma skäl som hittaMapp: den ska gå att pröva utan webbläsare, och det
 * som lätt går fel — att fem kort med samma nya mappnamn ger fem mappar — syns
 * inte av att läsa anropsstället.
 */
describe('fordelaMappar', () => {
  it('pekar ut den befintliga mappen när namnet finns', () => {
    const { tilldelning, nya } = fordelaMappar(sektioner, ['Grunder']);
    expect(tilldelning).toEqual([{ sektionId: 's1', nyttNamn: null }]);
    expect(nya).toEqual([]);
  });

  it('markerar ett okänt namn som en ny mapp', () => {
    const { tilldelning, nya } = fordelaMappar(sektioner, ['Serier']);
    expect(tilldelning).toEqual([{ sektionId: null, nyttNamn: 'Serier' }]);
    expect(nya).toEqual(['Serier']);
  });

  /* Kärnan i funktionen. Utan den skulle varje kort skapa sin egen mapp och en
   * omgång om tjugo kort ge tjugo mappar med samma namn. */
  it('ger flera kort med samma nya namn EN mapp', () => {
    const { tilldelning, nya } = fordelaMappar(sektioner, ['Serier', 'serier', ' SERIER ']);
    expect(nya).toEqual(['Serier']);
    expect(tilldelning.map((t) => t.nyttNamn)).toEqual(['Serier', 'Serier', 'Serier']);
  });

  it('lämnar kortet osorterat när mappen saknas', () => {
    const { tilldelning, nya } = fordelaMappar(sektioner, ['', '   ', null, undefined, 42]);
    expect(tilldelning).toEqual(Array(5).fill({ sektionId: null, nyttNamn: null }));
    expect(nya).toEqual([]);
  });

  it('ger en post per kort, i ordning', () => {
    const { tilldelning } = fordelaMappar(sektioner, ['Serier', 'Grunder', null]);
    expect(tilldelning).toEqual([
      { sektionId: null, nyttNamn: 'Serier' },
      { sektionId: 's1', nyttNamn: null },
      { sektionId: null, nyttNamn: null },
    ]);
  });

  it('tål en lek utan mappar', () => {
    const { tilldelning, nya } = fordelaMappar(null, ['Serier']);
    expect(tilldelning).toEqual([{ sektionId: null, nyttNamn: 'Serier' }]);
    expect(nya).toEqual(['Serier']);
  });
});
