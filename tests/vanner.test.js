import { describe, expect, it } from 'vitest';

import {
  AKTIVITETSDAGAR,
  avatarSokvag,
  byggProfilstatistik,
  dagnyckel,
  delningsSort,
  denAndra,
  initialer,
  normaliseraHandle,
  profilRekord,
  provaHandle,
  provaProfilstatistik,
  provaVisningsnamn,
  sokmonster,
  vanskapsLage,
} from '../src/domain/vanner.js';

describe('handtag', () => {
  it('normaliserar: utan @, gemener, utan blanksteg', () => {
    expect(normaliseraHandle('  @Anna_S ')).toBe('anna_s');
    expect(normaliseraHandle(undefined)).toBe('');
  });

  it('godkänner formen från migration 0011', () => {
    expect(provaHandle('anna_s')).toEqual({ ok: true, varde: 'anna_s' });
    expect(provaHandle('@ANNA')).toEqual({ ok: true, varde: 'anna' });
    expect(provaHandle('ab').ok).toBe(false);
    expect(provaHandle('a'.repeat(21)).ok).toBe(false);
    expect(provaHandle('anna s').ok).toBe(false);
    expect(provaHandle('åsa').ok).toBe(false);
    expect(provaHandle('').ok).toBe(false);
  });

  it('visningsnamnet trimmas och kapas', () => {
    expect(provaVisningsnamn('  Anna   Svensson ')).toEqual({ ok: true, varde: 'Anna Svensson' });
    expect(provaVisningsnamn('   ').ok).toBe(false);
    expect(provaVisningsnamn('x'.repeat(41)).ok).toBe(false);
  });

  /* Ett understreck i ett handtag är ett tecken, inte LIKE:s "vilket tecken
   * som helst". Utan escapen hade "an_" matchat "ann". */
  it('sökmönstret är ett prefix med jokertecknen oskadliggjorda', () => {
    expect(sokmonster('An')).toBe('an%');
    expect(sokmonster('an_s')).toBe('an\\_s%');
    expect(sokmonster('100%')).toBe('100\\%%');
    expect(sokmonster('  ')).toBe('');
  });
});

describe('vänskapsläge', () => {
  const rader = [
    { id: 'f1', requester_id: 'a', addressee_id: 'b', status: 'accepted' },
    { id: 'f2', requester_id: 'a', addressee_id: 'c', status: 'pending' },
    { id: 'f3', requester_id: 'd', addressee_id: 'a', status: 'pending' },
  ];

  it('ser paret oavsett riktning', () => {
    expect(vanskapsLage(rader, 'a', 'b').lage).toBe('vanner');
    expect(vanskapsLage(rader, 'b', 'a').lage).toBe('vanner');
  });

  it('skiljer på skickad och mottagen förfrågan', () => {
    expect(vanskapsLage(rader, 'a', 'c')).toEqual({ lage: 'skickad', rad: rader[1] });
    expect(vanskapsLage(rader, 'a', 'd')).toEqual({ lage: 'mottagen', rad: rader[2] });
    expect(vanskapsLage(rader, 'a', 'x')).toEqual({ lage: 'ingen', rad: null });
    expect(vanskapsLage(undefined, 'a', 'b').lage).toBe('ingen');
  });

  it('pekar ut den andra i raden', () => {
    const rad = { requester_id: 'a', addressee_id: 'b', requester: { handle: 'a' }, addressee: { handle: 'b' } };
    expect(denAndra(rad, 'a')).toEqual({ handle: 'b' });
    expect(denAndra(rad, 'b')).toEqual({ handle: 'a' });
  });
});

describe('profilstatistik', () => {
  const idag = new Date(2026, 8, 5, 12);
  const decks = [
    {
      id: 'd1',
      cards: [
        { id: 'k1', interval: 30 },
        { id: 'k2', interval: 3 },
        { id: 'n1', type: 'note' },
      ],
    },
    { id: 'd2', cards: [{ id: 'k3', interval: 21 }] },
  ];
  const dagsrakningar = new Map([
    ['2026-09-05', 12],
    ['2026-09-04', 8],
    ['2025-01-01', 40],
  ]);

  it('räknar kort, lekar och bemästrade utan anteckningar', () => {
    const s = byggProfilstatistik({ decks, dagsrakningar, streak: 2, idag });
    expect(s.cards).toBe(3);
    expect(s.decks).toBe(2);
    expect(s.mastered).toBe(2);
    expect(s.longestInterval).toBe(30);
  });

  it('summerar hela loggen men bär bara ett halvår av dagar', () => {
    const s = byggProfilstatistik({ decks, dagsrakningar, streak: 2, idag });
    expect(s.reviews).toBe(60);
    expect(s.activeDays).toBe(3);
    expect(s.activity).toEqual({ '2026-09-05': 12, '2026-09-04': 8 });
    expect(Object.keys(s.activity).every((d) => d >= dagnyckel(new Date(2026, 8, 5 - AKTIVITETSDAGAR)))).toBe(true);
  });

  it('tar det största av rekordstreak, längsta streak och nuvarande', () => {
    expect(byggProfilstatistik({ decks, dagsrakningar, streak: 2, longestStreak: 5, records: { bestStreak: 9 }, idag }).longestStreak).toBe(9);
    expect(byggProfilstatistik({ decks, dagsrakningar, streak: 11, longestStreak: 5, idag }).longestStreak).toBe(11);
  });

  it('kapar prestationerna och tål tomt', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ title: `P${i}`, desc: 'd' }));
    expect(byggProfilstatistik({ decks: [], dagsrakningar: {}, streak: 0, prestationer: many, idag }).achievements).toHaveLength(50);
    const tom = byggProfilstatistik({ decks: undefined, dagsrakningar: undefined, streak: 0, idag });
    expect(tom.cards).toBe(0);
    expect(tom.activity).toEqual({});
  });
});

describe('prövning av en mottagen statistikbild', () => {
  it('släpper igenom tal och kapar skräp', () => {
    const s = provaProfilstatistik({
      cards: '12',
      decks: -3,
      mastered: 1e12,
      streak: 4,
      achievements: [{ title: 'Första steget', desc: 'x' }, { nope: 1 }, { title: '' }],
      activity: { '2026-09-05': 3, 'inte-ett-datum': 5, '2026-09-04': 0 },
      extra: 'ignoreras',
    });
    expect(s.cards).toBe(12);
    expect(s.decks).toBe(0);
    expect(s.mastered).toBe(10_000_000);
    expect(s.achievements).toEqual([{ title: 'Första steget', desc: 'x' }]);
    expect(s.activity).toEqual({ '2026-09-05': 3 });
    expect(s.extra).toBeUndefined();
  });

  it('ger null för det som inte är en bild', () => {
    expect(provaProfilstatistik(null)).toBeNull();
    expect(provaProfilstatistik('x')).toBeNull();
    expect(provaProfilstatistik([1])).toBeNull();
  });

  it('rekorden följer Spelhallens urval', () => {
    const s = provaProfilstatistik({ bestDay: 40, longestStreak: 7, longestInterval: 3, reviews: 90, activeDays: 9 });
    expect(profilRekord(s)).toEqual([
      { n: 40, l: 'kort på en dag' },
      { n: 7, l: 'dagars längsta streak' },
      { n: 10, l: 'snitt per aktiv dag' },
      { n: 90, l: 'repetitioner totalt' },
    ]);
    expect(profilRekord(null)).toEqual([]);
  });
});

describe('småsaker', () => {
  it('delningens sort i löpande text', () => {
    expect(delningsSort('section')).toBe('mapp');
    expect(delningsSort('card')).toBe('kort');
    expect(delningsSort('deck')).toBe('kortlek');
    expect(delningsSort(undefined)).toBe('kortlek');
  });

  it('bildens sökväg är kontots mapp', () => {
    expect(avatarSokvag('u1', 'webp')).toBe('u1/avatar.webp');
  });

  it('initialer ur namnet, annars handtaget', () => {
    expect(initialer({ display_name: 'Anna Svensson' })).toBe('AS');
    expect(initialer({ display_name: 'Anna' })).toBe('AN');
    expect(initialer({ handle: 'kalle' })).toBe('KA');
    expect(initialer({})).toBe('');
  });
});
