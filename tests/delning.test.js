import { describe, expect, it } from 'vitest';
import {
  TAK,
  bildandelse,
  byggNyttolast,
  packaUpp,
  sammanfatta,
  stagingVag,
  validera,
} from '../src/domain/delning.js';

const deck = {
  id: 'd-avsandare',
  title: '  Termodynamik ',
  bookshelfId: 'h1',
  sections: [{ id: 's1', title: 'Grunder' }],
  cards: [
    {
      id: 'k1',
      front: 'Vad är entropi?',
      back: 'Ett mått på oordning',
      description: 'Fördjupning',
      isLongForm: false,
      sectionId: 's1',
      backImages: ['u1/k1/a.webp', 'data:image/png;base64,AAAA'],
      repetition: 4,
      interval: 40,
      easeFactor: 2.8,
      nextReviewDate: 1,
    },
    { id: 'k2', type: 'note', content: 'En anteckning', sectionId: 'raderad-mapp' },
  ],
};

describe('byggNyttolast', () => {
  it('bär text och mappar men inga id:n på kort och inget repetitionsläge', () => {
    const { ok, nyttolast } = byggNyttolast(deck);
    expect(ok).toBe(true);
    expect(nyttolast.title).toBe('Termodynamik');
    expect(nyttolast.sections).toEqual([{ id: 's1', title: 'Grunder' }]);
    const [kort] = nyttolast.cards;
    expect(kort).not.toHaveProperty('id');
    expect(kort).not.toHaveProperty('repetition');
    expect(kort).not.toHaveProperty('interval');
    expect(kort.description).toBe('Fördjupning');
  });

  /* Sökvägen säger vem avsändaren är och går ändå inte att läsa för
   * mottagaren. Nyttolasten bär bara filnamnet i väntområdet. */
  it('byter bildernas sökvägar mot filnamn i väntområdet', () => {
    const { nyttolast, bilder } = byggNyttolast(deck);
    expect(nyttolast.cards[0].images).toEqual(['0.webp', '1.png']);
    expect(bilder).toEqual([
      { fran: 'u1/k1/a.webp', filnamn: '0.webp' },
      { fran: 'data:image/png;base64,AAAA', filnamn: '1.png' },
    ]);
    expect(JSON.stringify(nyttolast)).not.toContain('u1/k1');
  });

  it('släpper en mapp-pekare som inte finns i leken', () => {
    const { nyttolast } = byggNyttolast(deck);
    expect(nyttolast.cards[1].sectionId).toBeNull();
  });

  it('stoppar en lek över taket', () => {
    const stor = { title: 'x', sections: [], cards: Array.from({ length: TAK.kort + 1 }, () => ({ front: 'f', back: 'b' })) };
    expect(byggNyttolast(stor).ok).toBe(false);
  });

  it('tar med källorna, kapade vid taket', () => {
    const { nyttolast } = byggNyttolast(deck, { kallor: [{ title: 'F1', pages: 3, text: 'abc' }] });
    expect(nyttolast.sources).toEqual([{ title: 'F1', pages: 3, chars: 3, text: 'abc' }]);
  });
});

describe('bildandelse', () => {
  it('läser ändelsen ur en sökväg och typen ur en data-URL', () => {
    expect(bildandelse('u/k/a.webp')).toBe('webp');
    expect(bildandelse('data:image/jpeg;base64,AAA')).toBe('jpg');
  });

  /* En SVG är ett dokument som kan bära skript. Hinken tar inte emot den,
   * och en delning ska inte kunna smuggla in en. */
  it('avvisar typer hinken inte tar emot', () => {
    expect(bildandelse('u/k/a.svg')).toBeNull();
    expect(bildandelse('data:image/svg+xml;base64,AAA')).toBeNull();
    expect(bildandelse('u/k/utan-andelse')).toBeNull();
  });
});

describe('validera', () => {
  const giltig = () => byggNyttolast(deck, { kallor: [{ title: 'F1', pages: 1, text: 'text' }] }).nyttolast;

  it('släpper igenom det byggNyttolast producerar', () => {
    const svar = validera(giltig());
    expect(svar.ok).toBe(true);
    expect(svar.varde.cards).toHaveLength(2);
    expect(svar.varde.sources[0].chars).toBe(4);
  });

  it('avvisar fel version och tomt innehåll', () => {
    expect(validera(null).ok).toBe(false);
    expect(validera({ ...giltig(), version: 2 }).ok).toBe(false);
    expect(validera({ ...giltig(), title: '' }).ok).toBe(false);
  });

  /* Nyttolasten skrevs av någon annans webbläsare. Ett filnamn med en
   * sökväg i hade läst en fil utanför delningens eget väntområde. */
  it('avvisar bildnamn som inte är ett löpnummer och en ändelse', () => {
    const n = giltig();
    n.cards[0].images = ['../../annan-anvandare/hemlig.webp'];
    expect(validera(n).ok).toBe(false);
    n.cards[0].images = ['0.svg'];
    expect(validera(n).ok).toBe(false);
  });

  it('avvisar ett kort som pekar på en mapp som inte finns', () => {
    const n = giltig();
    n.cards[0].sectionId = 'finns-inte';
    expect(validera(n).ok).toBe(false);
  });

  it('avvisar okända korttyper och för många kort', () => {
    const n = giltig();
    n.cards[0].type = 'skript';
    expect(validera(n).ok).toBe(false);
    const m = giltig();
    m.cards = Array.from({ length: TAK.kort + 1 }, () => ({ type: 'card', front: 'f', back: 'b' }));
    expect(validera(m).ok).toBe(false);
  });

  /* Allt som inte hör till formatet faller bort: ett id på ett kort, ett
   * påhittat fält, en funktion. */
  it('kastar bort fält utanför formatet', () => {
    const n = giltig();
    n.cards[0].id = 'kapa-mottagarens-rad';
    n.cards[0].__proto__polluter = 1;
    n.extra = 'x';
    const { varde } = validera(n);
    expect(varde.cards[0]).not.toHaveProperty('id');
    expect(varde).not.toHaveProperty('extra');
    expect(Object.keys(varde.cards[0]).sort()).toEqual(
      ['back', 'description', 'front', 'images', 'isLongForm', 'sectionId', 'type'].sort()
    );
  });

  it('kapar text vid taket i stället för att avvisa', () => {
    const n = giltig();
    n.cards[0].front = 'x'.repeat(TAK.text + 10);
    const { ok, varde } = validera(n);
    expect(ok).toBe(true);
    expect(varde.cards[0].front).toHaveLength(TAK.text);
  });
});

describe('packaUpp', () => {
  const verktyg = () => {
    let n = 0;
    return { nyttId: () => `ny-${++n}`, kortId: () => `kort-${++n}`, nu: 1234 };
  };

  it('ger allt färska id:n och nollställer repetitionsläget', () => {
    const { varde } = validera(byggNyttolast(deck).nyttolast);
    const { deck: kopia, bilder } = packaUpp(varde, verktyg());
    expect(kopia.id).toMatch(/^ny-/);
    expect(kopia.bookshelfId).toBeNull();
    expect(kopia.sections[0].id).not.toBe('s1');
    const [kort, anteckning] = kopia.cards;
    expect(kort.id).toMatch(/^kort-/);
    expect(kort.sectionId).toBe(kopia.sections[0].id);
    expect(kort.repetition).toBe(0);
    expect(kort.interval).toBe(0);
    expect(kort.easeFactor).toBe(2.5);
    expect(kort.nextReviewDate).toBe(1234);
    expect(kort.backImages).toEqual([]);
    expect(anteckning.type).toBe('note');
    expect(bilder).toEqual([
      { kortId: kort.id, filnamn: '0.webp' },
      { kortId: kort.id, filnamn: '1.png' },
    ]);
  });
});

describe('sammanfatta och stagingVag', () => {
  it('räknar det inkorgen visar', () => {
    const { nyttolast } = byggNyttolast(deck, { kallor: [{ title: 'F', text: 't' }] });
    expect(sammanfatta(nyttolast)).toEqual({ kort: 1, anteckningar: 1, mappar: 1, bilder: 2, kallor: 1 });
  });

  it('lägger filen under delningens eget id', () => {
    expect(stagingVag('abc', '0.webp')).toBe('delningar/abc/0.webp');
  });
});
