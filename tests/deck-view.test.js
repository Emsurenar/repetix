import { describe, expect, it } from 'vitest';

import { kortIVyn, sektionerIVyn } from '../src/domain/deck-view.js';

const deck = {
  id: 'd1',
  sections: [
    { id: 's1', title: 'Envariabelanalys' },
    { id: 's2', title: 'Tom mapp' },
  ],
  cards: [
    { id: 'k1', sectionId: null },
    { id: 'k2', sectionId: 's1' },
    { id: 'k3', sectionId: 's1' },
  ],
};

/* Kortleksvyn har två lägen och de skilde sig bara i rubriken.
 *
 * Öppnade man EN mapp filtrerades titeln och talen till mappen, medan listan
 * ritades ur deck.cards rakt av — alltså hela leken, med lösa kort och andra
 * mappar. Rubriken sa "2 kort" och listan visade tre.
 */
describe('kortIVyn', () => {
  it('ger hela leken när ingen mapp är öppen', () => {
    expect(kortIVyn(deck, null).map((c) => c.id)).toEqual(['k1', 'k2', 'k3']);
  });

  it('ger bara mappens kort när en mapp är öppen', () => {
    expect(kortIVyn(deck, 's1').map((c) => c.id)).toEqual(['k2', 'k3']);
  });

  /* Föräldralösa sectionId hanteras INTE här, med flit. De nollställs redan
   * två gånger om: deleteSection flyttar ut korten när en mapp raderas, och
   * fromRows nollar referenser till mjukraderade mappar vid molnläsning. En
   * tredje reparation här hade dolt om någon av de två slutade fungera. */
  it('lämnar leken orörd när ingen mapp är öppen', () => {
    const egen = { ...deck, cards: [{ id: 'x', sectionId: 'borta' }] };
    expect(kortIVyn(egen, null).map((c) => c.id)).toEqual(['x']);
  });

  it('tål en lek utan kort', () => {
    expect(kortIVyn({ sections: [], cards: [] }, null)).toEqual([]);
  });
});

describe('sektionerIVyn', () => {
  /* Tomma mappar måste synas i leksvyn: de är släppytor, och en mapp man inte
   * ser går inte att lägga något i. */
  it('ger alla mappar i leksvyn, även de tomma', () => {
    expect(sektionerIVyn(deck, null).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('ger bara den öppnade mappen i mappvyn', () => {
    expect(sektionerIVyn(deck, 's1').map((s) => s.id)).toEqual(['s1']);
  });

  it('ger ingen mapp alls när den öppnade inte finns kvar', () => {
    expect(sektionerIVyn(deck, 'borta')).toEqual([]);
  });

  it('tål en lek utan mappar', () => {
    expect(sektionerIVyn({ cards: [] }, null)).toEqual([]);
  });
});
