import { describe, expect, it } from 'vitest';

import {
  aktivitetskartaHtml,
  heatNiva,
  manadsrad,
  veckokolumner,
  veckorSomFarPlats,
} from '../src/ui/aktivitetskarta.js';

// 5 september 2026 är en lördag.
const idag = new Date(2026, 8, 5, 12);

describe('veckokolumner', () => {
  it('börjar varje kolumn på en måndag och slutar i veckan idag ligger i', () => {
    const kolumner = veckokolumner(new Map(), 4, idag);
    expect(kolumner).toHaveLength(4);
    for (const v of kolumner) {
      expect(v).toHaveLength(7);
      expect(v[0].date.getDay()).toBe(1);
    }
    const sista = kolumner[3];
    expect(sista[5].date.getDate()).toBe(5);
    expect(sista[5].kommande).toBe(false);
    expect(sista[6].kommande).toBe(true);
  });

  it('läser räkningar ur både Map och objekt, och nollar kommande dagar', () => {
    const m = veckokolumner(new Map([['2026-09-05', 3]]), 1, idag);
    const o = veckokolumner({ '2026-09-05': 3, '2026-09-06': 99 }, 1, idag);
    expect(m[0][5].count).toBe(3);
    expect(o[0][5].count).toBe(3);
    expect(o[0][6].count).toBe(0);
  });
});

describe('månadsraden', () => {
  it('sätter namnet på kolumnen som innehåller den 1:a, så att innevarande månad syns', () => {
    const kolumner = veckokolumner({}, 24, idag);
    const rad = manadsrad(kolumner);
    expect(rad.filter(Boolean)).toEqual(['mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep']);
    expect(rad[rad.length - 1]).toBe('sep');
  });

  it('en månad som börjar på en måndag får sin egen kolumn', () => {
    // 1 juni 2026 är en måndag.
    const rad = manadsrad(veckokolumner({}, 8, new Date(2026, 5, 10, 12)));
    expect(rad).toContain('jun');
  });
});

describe('nivåer och markup', () => {
  it('fyra steg relativt maximum', () => {
    expect(heatNiva(0, 10)).toBe('');
    expect(heatNiva(1, 10)).toBe(' is-1');
    expect(heatNiva(4, 10)).toBe(' is-2');
    expect(heatNiva(6, 10)).toBe(' is-3');
    expect(heatNiva(10, 10)).toBe(' is-4');
    expect(heatNiva(3, 0)).toBe(' is-4');
  });

  it('ritar idag som sista synliga ruta och månaden ovanför', () => {
    const html = aktivitetskartaHtml({ dagsrakningar: { '2026-09-05': 2 }, veckor: 2, idag });
    expect(html).toContain('--veckor:2');
    expect(html).toContain('<span>sep</span>');
    expect(html).toContain('title="5/9: 2 repetitioner"');
    expect(html).toContain('heat-cell is-kommande');
    expect(html).not.toContain('6/9');
    expect(html).not.toContain('is-entering');
    expect(aktivitetskartaHtml({ dagsrakningar: {}, veckor: 1, idag, tona: true })).toContain('is-entering');
  });

  it('räknar veckorna ur bredden med golv och tak', () => {
    expect(veckorSomFarPlats(0)).toBe(12);
    expect(veckorSomFarPlats(26 + 24 * 30)).toBe(30);
    expect(veckorSomFarPlats(5000)).toBe(53);
  });
});
