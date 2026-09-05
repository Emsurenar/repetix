import { describe, expect, it } from 'vitest';

import {
  MINSTA_ANTAL_KORT,
  bedom,
  enMening,
  gallra,
  kanSammanfattas,
  signatur,
  underlagText,
} from '../src/domain/sammanfattning.js';

const kort = (front, back, extra = {}) => ({ id: `k-${front}`, front, back, ...extra });

const lek = (over = {}) => ({
  id: 'd1',
  title: 'Analys',
  sections: [{ id: 's1', title: 'Gränsvärden' }],
  cards: [kort('a', '1'), kort('b', '2'), kort('c', '3')],
  ...over,
});

describe('signatur', () => {
  it('är densamma för samma innehåll', () => {
    expect(signatur(lek())).toBe(signatur(lek()));
  });

  it('ändras när ett kort ändras, läggs till eller tas bort', () => {
    const bas = signatur(lek());
    expect(signatur(lek({ cards: [kort('a', '1'), kort('b', '2'), kort('c', 'ändrad')] }))).not.toBe(bas);
    expect(signatur(lek({ cards: [...lek().cards, kort('d', '4')] }))).not.toBe(bas);
    expect(signatur(lek({ cards: lek().cards.slice(1) }))).not.toBe(bas);
  });

  it('ändras när titeln eller en mapp byter namn', () => {
    const bas = signatur(lek());
    expect(signatur(lek({ title: 'Algebra' }))).not.toBe(bas);
    expect(signatur(lek({ sections: [{ id: 's1', title: 'Derivator' }] }))).not.toBe(bas);
  });

  /* En repetition skriver om intervall och nästa datum på kortet. Räknades
   * de in hade varje pass kostat ett nytt anrop utan att meningen fått något
   * nytt att säga. */
  it('bryr sig inte om repetitionsläget', () => {
    const repeterad = lek({
      cards: lek().cards.map((c) => ({ ...c, interval: 21, nextReviewDate: 1, lastReviewed: 2 })),
    });
    expect(signatur(repeterad)).toBe(signatur(lek()));
  });

  it('skiljer på var gränsen mellan fram- och baksida går', () => {
    const ena = lek({ cards: [kort('ab', 'c'), kort('x', 'y'), kort('z', 'w')] });
    const andra = lek({ cards: [kort('a', 'bc'), kort('x', 'y'), kort('z', 'w')] });
    expect(signatur(ena)).not.toBe(signatur(andra));
  });

  it('räknar inte anteckningar som kort', () => {
    const medAnteckning = lek({ cards: [...lek().cards, kort('n', '', { type: 'note' })] });
    expect(signatur(medAnteckning)).toBe(signatur(lek()));
  });
});

describe('kanSammanfattas', () => {
  it(`kräver minst ${MINSTA_ANTAL_KORT} kort`, () => {
    expect(kanSammanfattas(lek({ cards: lek().cards.slice(0, MINSTA_ANTAL_KORT - 1) }))).toBe(false);
    expect(kanSammanfattas(lek())).toBe(true);
  });

  it('tål en lek utan kort alls', () => {
    expect(kanSammanfattas({ id: 'd' })).toBe(false);
    expect(kanSammanfattas(null)).toBe(false);
  });
});

describe('bedom', () => {
  it('visar den lagrade meningen och ber inte om en ny när signaturen stämmer', () => {
    const lagrad = { sign: signatur(lek()), text: 'Gränsvärden i en variabel.' };
    expect(bedom(lagrad, lek())).toEqual({ text: 'Gränsvärden i en variabel.', aktuell: true, behovs: false });
  });

  /* Den gamla meningen står kvar medan den nya skrivs. Raden ska inte blinka
   * bort för att man lade till ett kort. */
  it('visar den gamla meningen men ber om en ny när leken ändrats', () => {
    const lagrad = { sign: 'gammal', text: 'Gränsvärden i en variabel.' };
    expect(bedom(lagrad, lek())).toEqual({ text: 'Gränsvärden i en variabel.', aktuell: false, behovs: true });
  });

  it('ber om en ny när ingen finns', () => {
    expect(bedom(undefined, lek())).toEqual({ text: '', aktuell: false, behovs: true });
    expect(bedom({ sign: signatur(lek()), text: '   ' }, lek())).toEqual({ text: '', aktuell: false, behovs: true });
  });

  it('ber aldrig om en mening för en lek som är för liten', () => {
    const liten = lek({ cards: [kort('a', '1')] });
    expect(bedom({ sign: signatur(liten), text: 'Något.' }, liten)).toEqual({ text: '', aktuell: false, behovs: false });
  });
});

describe('gallra', () => {
  it('tar bort poster för lekar som inte finns', () => {
    const lagrade = { d1: { sign: 'x', text: 'a' }, borta: { sign: 'y', text: 'b' } };
    expect(gallra(lagrade, [{ id: 'd1' }])).toEqual({ d1: { sign: 'x', text: 'a' } });
  });

  it('tål tomt och trasigt', () => {
    expect(gallra(undefined, [])).toEqual({});
    expect(gallra({ d1: 1 }, undefined)).toEqual({});
  });
});

describe('underlagText', () => {
  it('bär titel, mappar, antal och korten', () => {
    const text = underlagText(lek());
    expect(text).toContain('Titel: Analys');
    expect(text).toContain('Mappar: Gränsvärden');
    expect(text).toContain('Antal kort: 3');
    expect(text).toContain('F: a | S: 1');
    expect(text).toContain('F: c | S: 3');
  });

  it('utelämnar mappraden när det inte finns mappar', () => {
    expect(underlagText(lek({ sections: [] }))).not.toContain('Mappar');
  });

  /* Ett urval spritt över hela leken, inte de första åttio: en lek fylls i
   * den ordning ämnet lästes, och början är bara första kapitlet. */
  it('tar ett jämnt urval ur en stor lek', () => {
    const stor = lek({ cards: Array.from({ length: 400 }, (_, i) => kort(`f${i}`, `s${i}`)) });
    const text = underlagText(stor);
    const rader = text.split('\n').filter((r) => r.startsWith('F: '));
    expect(rader.length).toBeLessThanOrEqual(80);
    expect(text).toContain('Antal kort: 400 (urval av 80)');
    expect(text).toContain('F: f0 |');
    expect(text).toContain('F: f395 |');
  });

  it('klipper långa sidor', () => {
    const lang = lek({ cards: [kort('a', 'x'.repeat(1000)), kort('b', '2'), kort('c', '3')] });
    const rad = underlagText(lang).split('\n').find((r) => r.startsWith('F: a'));
    expect(rad.length).toBeLessThan(200);
    expect(rad.endsWith('…')).toBe(true);
  });
});

describe('enMening', () => {
  it('lämnar en ren mening orörd', () => {
    expect(enMening('Gränsvärden, derivator och integraler i en variabel.')).toBe(
      'Gränsvärden, derivator och integraler i en variabel.'
    );
  });

  it('tar bort etikett, markdown och citattecken runt om', () => {
    expect(enMening('**Sammanfattning:** "Gränsvärden i en variabel."')).toBe('Gränsvärden i en variabel.');
    expect(enMening('“Derivator.”\n')).toBe('Derivator.');
  });

  it('gör radbrytningar till en rad', () => {
    expect(enMening('Första\ndelen  och\tandra.')).toBe('Första delen och andra.');
  });

  it('tål tomt', () => {
    expect(enMening(undefined)).toBe('');
    expect(enMening('  ')).toBe('');
  });
});
