import { describe, expect, it } from 'vitest';
import {
  TABLES,
  build,
  cardToRow,
  createCard,
  createNoteCard,
  flatten,
  reviewRow,
  rowToCard,
} from '../src/domain/model.js';

const ANVANDARE = '00000000-0000-4000-8000-000000000001';

// Kolumnerna per tabell enligt supabase/migrations/0001_init.sql. Raderna som
// klienten bygger far aldrig innehalla nagot som inte star har: Supabase
// avvisar hela batchen vid en okand kolumn, och da fastnar utkorgen.
const KOLUMNER = {
  bookshelves: ['id', 'user_id', 'title', 'color', 'position'],
  decks: ['id', 'user_id', 'bookshelf_id', 'title', 'color', 'position'],
  sections: ['id', 'user_id', 'deck_id', 'title', 'position'],
  cards: [
    'id',
    'user_id',
    'deck_id',
    'section_id',
    'type',
    'front',
    'back',
    'content',
    'is_long_form',
    'description',
    'position',
    'repetition',
    'interval_days',
    'ease_factor',
    'next_review_date',
    'lapses',
    'last_reviewed',
  ],
  notebooks: ['id', 'user_id', 'bookshelf_id', 'title', 'position'],
  notes: ['id', 'user_id', 'notebook_id', 'content', 'position', 'created_at'],
};

// Kolumner med not null i schemat. Saknas nagon av dem i raden gar insert fel.
const OBLIGATORISKA = {
  bookshelves: ['id', 'user_id', 'title', 'position'],
  decks: ['id', 'user_id', 'title', 'position'],
  sections: ['id', 'user_id', 'deck_id', 'title', 'position'],
  cards: [
    'id',
    'user_id',
    'deck_id',
    'type',
    'is_long_form',
    'position',
    'repetition',
    'interval_days',
    'ease_factor',
    'next_review_date',
    'lapses',
  ],
  notebooks: ['id', 'user_id', 'title', 'position'],
  notes: ['id', 'user_id', 'notebook_id', 'position'],
};

// Ett exakt millisekundvarde med siffror kvar langst ner, sa att en rundtur
// via ISO-strang inte kan se korrekt ut bara for att vardet var jamnt.
const FORFALLER = 1_735_689_612_345;
const REPETERAD = 1_733_000_000_678;

const vanligtKort = (over = {}) => ({
  id: 'k1',
  front: 'Vad ar derivatan av x^2?',
  back: '2x',
  isLongForm: false,
  backImages: [],
  sectionId: 's1',
  repetition: 4,
  interval: 12.5,
  easeFactor: 2.35,
  nextReviewDate: FORFALLER,
  lapses: 2,
  lastReviewed: REPETERAD,
  ...over,
});

/** Ett realistiskt bibliotek: flera bokhyllor, kortlekar, mappar och block. */
const bibliotek = () => ({
  bookshelves: [
    { id: 'h1', title: 'Matematik', color: '#ff0000' },
    { id: 'h2', title: 'Sprak' },
  ],
  decks: [
    {
      id: 'd1',
      title: 'Analys',
      color: '#123456',
      bookshelfId: 'h1',
      sections: [
        { id: 's1', title: 'Derivator' },
        { id: 's2', title: 'Integraler' },
      ],
      cards: [
        vanligtKort(),
        vanligtKort({ id: 'k2', front: 'Integralen av 1/x?', back: 'ln|x|', sectionId: 's2' }),
        { id: 'k3', type: 'note', content: 'Kom ihag kedjeregeln', sectionId: 's2' },
      ],
    },
    {
      id: 'd2',
      title: 'Linjar algebra',
      color: '#654321',
      bookshelfId: 'h1',
      sections: [],
      cards: [vanligtKort({ id: 'k4', sectionId: null })],
    },
    {
      id: 'd3',
      title: 'Glosor',
      color: '#abcdef',
      bookshelfId: null,
      sections: [{ id: 's3', title: 'Verb' }],
      cards: [],
    },
  ],
  notebooks: [
    {
      id: 'b1',
      title: 'Forelasningar',
      bookshelfId: 'h1',
      notes: [
        { id: 'a1', content: 'Forsta anteckningen', createdAt: 1_700_000_000_000 },
        { id: 'a2', content: 'Andra anteckningen', createdAt: 1_700_000_500_000 },
      ],
    },
    { id: 'b2', title: 'Ideer', bookshelfId: null, notes: [] },
  ],
});

describe('flatten', () => {
  it('ger ratt antal rader per tabell for ett realistiskt bibliotek', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    expect(rader.bookshelves).toHaveLength(2);
    expect(rader.decks).toHaveLength(3);
    expect(rader.sections).toHaveLength(3);
    expect(rader.cards).toHaveLength(4);
    expect(rader.notebooks).toHaveLength(2);
    expect(rader.notes).toHaveLength(2);
  });

  it('ger en tabell per namn i TABLES och inga fler', () => {
    expect(Object.keys(flatten(bibliotek(), ANVANDARE)).sort()).toEqual([...TABLES].sort());
  });

  it('anvander bara kolumner som finns i databasschemat', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    for (const tabell of TABLES) {
      for (const rad of rader[tabell]) {
        expect(Object.keys(rad).sort()).toEqual([...KOLUMNER[tabell]].sort());
      }
    }
  });

  it('fyller i alla kolumner som databasen kraver not null', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    for (const tabell of TABLES) {
      for (const rad of rader[tabell]) {
        for (const kolumn of OBLIGATORISKA[tabell]) {
          expect(rad[kolumn], `${tabell}.${kolumn}`).not.toBeNull();
          expect(rad[kolumn], `${tabell}.${kolumn}`).not.toBeUndefined();
        }
      }
    }
  });

  it('satter user_id pa varje rad i varje tabell', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    for (const tabell of TABLES) {
      expect(rader[tabell].every((r) => r.user_id === ANVANDARE)).toBe(true);
    }
  });

  it('speglar arrayordningen i position', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    expect(rader.bookshelves.map((r) => [r.id, r.position])).toEqual([
      ['h1', 0],
      ['h2', 1],
    ]);
    expect(rader.decks.map((r) => [r.id, r.position])).toEqual([
      ['d1', 0],
      ['d2', 1],
      ['d3', 2],
    ]);
    expect(rader.notes.map((r) => [r.id, r.position])).toEqual([
      ['a1', 0],
      ['a2', 1],
    ]);
  });

  it('raknar position fran noll inom varje kortlek, inte over hela biblioteket', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    const iKortlek = (id) => rader.cards.filter((r) => r.deck_id === id).map((r) => r.position);
    expect(iKortlek('d1')).toEqual([0, 1, 2]);
    expect(iKortlek('d2')).toEqual([0]);
    expect(rader.sections.filter((r) => r.deck_id === 'd3').map((r) => r.position)).toEqual([0]);
  });

  it('kopplar mappar och kort till ratt kortlek', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    expect(rader.sections.map((r) => r.deck_id)).toEqual(['d1', 'd1', 'd3']);
    expect(rader.cards.map((r) => r.deck_id)).toEqual(['d1', 'd1', 'd1', 'd2']);
    expect(rader.notes.every((r) => r.notebook_id === 'b1')).toBe(true);
  });

  it('klarar appData helt utan bokhyllor', () => {
    const utan = bibliotek();
    delete utan.bookshelves;
    const rader = flatten(utan, ANVANDARE);
    expect(rader.bookshelves).toEqual([]);
    expect(rader.decks).toHaveLength(3);
  });

  it('klarar en kortlek utan mappar och utan kort', () => {
    const data = { decks: [{ id: 'd9', title: 'Tom' }] };
    const rader = flatten(data, ANVANDARE);
    expect(rader.sections).toEqual([]);
    expect(rader.cards).toEqual([]);
    expect(rader.decks[0]).toMatchObject({ id: 'd9', title: 'Tom', bookshelf_id: null });
  });

  it('ger tomma tabeller for ett tomt appData', () => {
    const rader = flatten({}, ANVANDARE);
    for (const tabell of TABLES) expect(rader[tabell]).toEqual([]);
  });

  it('ger tom titel i stallet for null nar titeln saknas, eftersom title ar not null', () => {
    const rader = flatten({ bookshelves: [{ id: 'h9' }], decks: [{ id: 'd9' }] }, ANVANDARE);
    expect(rader.bookshelves[0].title).toBe('');
    expect(rader.decks[0].title).toBe('');
  });
});

describe('cardToRow', () => {
  it('tar inte med transienta skrapfalt fran spellagena', () => {
    // Spellagena kopierar kort med extrafalt (playground.js), och de kopiorna
    // har historiskt lackt in i sparad data. De far aldrig na databasen.
    const smutsigt = vanligtKort({
      _jeopardy: true,
      originalDeckId: 'nagon-annan-kortlek',
      _sectionTitle: 'Derivator',
    });
    const rad = cardToRow(smutsigt, 'd1', ANVANDARE, 0);
    expect(rad).not.toHaveProperty('_jeopardy');
    expect(rad).not.toHaveProperty('originalDeckId');
    expect(rad).not.toHaveProperty('_sectionTitle');
    expect(rad.deck_id).toBe('d1');
  });

  it('slapper igenom inga okanda falt alls', () => {
    const rad = cardToRow(vanligtKort({ nagotHeltNytt: 1, __proto__falt: 2 }), 'd1', ANVANDARE);
    expect(Object.keys(rad).sort()).toEqual([...KOLUMNER.cards].sort());
  });

  it('tar inte med bilder i kortraden', () => {
    const medBild = vanligtKort({ backImages: ['data:image/png;base64,AAAA'] });
    const rad = cardToRow(medBild, 'd1', ANVANDARE);
    expect(rad).not.toHaveProperty('backImages');
    expect(JSON.stringify(rad)).not.toContain('base64');
  });

  it('later aldrig ease_factor understiga databasens golv 1,3', () => {
    // cards har check (ease_factor >= 1.3). En rad under golvet avvisas.
    expect(cardToRow(vanligtKort({ easeFactor: 0.9 }), 'd1', ANVANDARE).ease_factor).toBe(1.3);
    expect(cardToRow(vanligtKort({ easeFactor: -5 }), 'd1', ANVANDARE).ease_factor).toBe(1.3);
    expect(cardToRow(vanligtKort({ easeFactor: 1.3 }), 'd1', ANVANDARE).ease_factor).toBe(1.3);
  });

  it('ger ease_factor 2,5 nar faltet saknas helt', () => {
    const utan = vanligtKort();
    delete utan.easeFactor;
    expect(cardToRow(utan, 'd1', ANVANDARE).ease_factor).toBe(2.5);
    expect(cardToRow({ id: 'k9' }, 'd1', ANVANDARE).ease_factor).toBe(2.5);
  });

  it('ger nolldefaults for ovriga SM-2-falt nar de saknas', () => {
    const rad = cardToRow({ id: 'k9' }, 'd1', ANVANDARE);
    expect(rad.repetition).toBe(0);
    expect(rad.interval_days).toBe(0);
    expect(rad.lapses).toBe(0);
    expect(rad.next_review_date).toBe(new Date(0).toISOString());
    expect(rad.last_reviewed).toBeNull();
  });

  it('skriver nextReviewDate som ISO-strang', () => {
    const rad = cardToRow(vanligtKort(), 'd1', ANVANDARE);
    expect(rad.next_review_date).toBe(new Date(FORFALLER).toISOString());
    expect(rad.last_reviewed).toBe(new Date(REPETERAD).toISOString());
  });

  it('markerar bara notiskort som typ note', () => {
    expect(cardToRow({ id: 'k9', type: 'note' }, 'd1', ANVANDARE).type).toBe('note');
    expect(cardToRow({ id: 'k9' }, 'd1', ANVANDARE).type).toBe('card');
    // type har check (type in ('card','note')): en okand typ far inte slinka ut.
    expect(cardToRow({ id: 'k9', type: 'jeopardy' }, 'd1', ANVANDARE).type).toBe('card');
  });

  it('behaller notiskortets innehall', () => {
    const rad = cardToRow({ id: 'k9', type: 'note', content: 'Text' }, 'd1', ANVANDARE, 3);
    expect(rad.content).toBe('Text');
    expect(rad.position).toBe(3);
  });

  it('later aldrig NaN passera till ease_factor', () => {
    // Math.max(1.3, NaN) ar NaN, och ?? fangar bara null och undefined. En
    // NaN-rad serialiseras till null av JSON och avvisas av bade not null och
    // check (ease_factor >= 1.3). Da kastar pushOutbox, mutationen ligger kvar
    // i utkorgen och gors om vid varje synk — kon fastnar for alltid.
    const rad = cardToRow(vanligtKort({ easeFactor: NaN }), 'd1', ANVANDARE);
    expect(rad.ease_factor).toBe(2.5);
    expect(JSON.parse(JSON.stringify(rad)).ease_factor).toBe(2.5);
  });

  it('later aldrig NaN passera till interval_days eller repetition', () => {
    const rad = cardToRow(vanligtKort({ interval: NaN, repetition: NaN }), 'd1', ANVANDARE);
    expect(rad.interval_days).toBe(0);
    expect(rad.repetition).toBe(0);
  });

  it('later aldrig Infinity passera heller', () => {
    const rad = cardToRow(vanligtKort({ interval: Infinity, lapses: -Infinity }), 'd1', ANVANDARE);
    expect(Number.isFinite(rad.interval_days)).toBe(true);
    expect(Number.isFinite(rad.lapses)).toBe(true);
  });
});

describe('rowToCard', () => {
  it('ger ett notiskort utan SM-2-falt', () => {
    const kort = rowToCard({ id: 'k3', type: 'note', content: 'Text', section_id: 's2' });
    expect(kort).toEqual({ id: 'k3', sectionId: 's2', type: 'note', content: 'Text' });
    for (const falt of ['repetition', 'interval', 'easeFactor', 'nextReviewDate', 'lapses']) {
      expect(kort).not.toHaveProperty(falt);
    }
  });

  it('satter inte lastReviewed nar kortet aldrig repeterats', () => {
    const kort = rowToCard({ id: 'k9', type: 'card', last_reviewed: null });
    expect(kort).not.toHaveProperty('lastReviewed');
  });

  it('ger alltid en tom bildlista, eftersom bilder hanteras separat', () => {
    expect(rowToCard({ id: 'k9', type: 'card' }).backImages).toEqual([]);
  });
});

describe('rundturen flatten -> build', () => {
  const rundtur = (data) => build(flatten(data, ANVANDARE));

  it('bevarar titlar och antal', () => {
    const efter = rundtur(bibliotek());
    expect(efter.bookshelves.map((h) => h.title)).toEqual(['Matematik', 'Sprak']);
    expect(efter.decks.map((d) => d.title)).toEqual(['Analys', 'Linjar algebra', 'Glosor']);
    expect(efter.notebooks.map((b) => b.title)).toEqual(['Forelasningar', 'Ideer']);
    expect(efter.decks[0].sections.map((s) => s.title)).toEqual(['Derivator', 'Integraler']);
    expect(efter.notebooks[0].notes.map((a) => a.content)).toEqual([
      'Forsta anteckningen',
      'Andra anteckningen',
    ]);
  });

  it('bevarar kopplingen kortlek till bokhylla', () => {
    const efter = rundtur(bibliotek());
    expect(efter.decks.map((d) => [d.id, d.bookshelfId])).toEqual([
      ['d1', 'h1'],
      ['d2', 'h1'],
      ['d3', null],
    ]);
    expect(efter.notebooks.map((b) => b.bookshelfId)).toEqual(['h1', null]);
  });

  it('bevarar kopplingen kort till mapp', () => {
    const efter = rundtur(bibliotek());
    const analys = efter.decks.find((d) => d.id === 'd1');
    expect(analys.cards.map((k) => [k.id, k.sectionId])).toEqual([
      ['k1', 's1'],
      ['k2', 's2'],
      ['k3', 's2'],
    ]);
    expect(efter.decks.find((d) => d.id === 'd2').cards[0].sectionId).toBeNull();
  });

  it('lagger inte kort i fel kortlek', () => {
    const efter = rundtur(bibliotek());
    expect(efter.decks.map((d) => d.cards.map((k) => k.id))).toEqual([
      ['k1', 'k2', 'k3'],
      ['k4'],
      [],
    ]);
  });

  it('aterstaller ordningen fran position aven nar raderna kommer huller om buller', () => {
    // Servern levererar rader sorterade pa updated_at, inte pa position.
    const rader = flatten(bibliotek(), ANVANDARE);
    const blandat = Object.fromEntries(TABLES.map((t) => [t, [...rader[t]].reverse()]));
    const efter = build(blandat);
    expect(efter.decks.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(efter.bookshelves.map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(efter.decks[0].cards.map((k) => k.id)).toEqual(['k1', 'k2', 'k3']);
    expect(efter.decks[0].sections.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(efter.notebooks[0].notes.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('ger samma position en gang till nar rundturen kors igen', () => {
    const forsta = flatten(bibliotek(), ANVANDARE);
    const andra = flatten(build(forsta), ANVANDARE);
    for (const tabell of TABLES) {
      expect(andra[tabell].map((r) => [r.id, r.position])).toEqual(
        forsta[tabell].map((r) => [r.id, r.position])
      );
    }
  });

  it('behaller alla SM-2-falt pa ett vanligt kort', () => {
    const efter = rundtur(bibliotek());
    const kort = efter.decks[0].cards[0];
    expect(kort).toEqual({
      id: 'k1',
      sectionId: 's1',
      front: 'Vad ar derivatan av x^2?',
      back: '2x',
      isLongForm: false,
      backImages: [],
      repetition: 4,
      interval: 12.5,
      easeFactor: 2.35,
      nextReviewDate: FORFALLER,
      lapses: 2,
      lastReviewed: REPETERAD,
    });
  });

  it('tappar inte en millisekund nar nextReviewDate gar via ISO-strang', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    expect(rader.cards[0].next_review_date).toBe('2025-01-01T00:00:12.345Z');
    expect(build(rader).decks[0].cards[0].nextReviewDate).toBe(FORFALLER);
  });

  it('behaller notiskortets innehall utan att ge det SM-2-falt', () => {
    const notis = rundtur(bibliotek()).decks[0].cards[2];
    expect(notis).toEqual({
      id: 'k3',
      sectionId: 's2',
      type: 'note',
      content: 'Kom ihag kedjeregeln',
    });
  });

  it('slapper aldrig igenom skrapfalt till kortet efter rundturen', () => {
    const data = bibliotek();
    data.decks[0].cards[0]._jeopardy = true;
    data.decks[0].cards[0].originalDeckId = 'd2';
    const kort = rundtur(data).decks[0].cards[0];
    expect(kort).not.toHaveProperty('_jeopardy');
    expect(kort).not.toHaveProperty('originalDeckId');
  });

  it('bevarar anteckningens createdAt genom rundturen', () => {
    // build() laser n.created_at, sa flatten() maste skriva ut kolumnen.
    // Annars far varje anteckning tidpunkten 0 efter en vanda genom molnet.
    const efter = rundtur(bibliotek());
    expect(efter.notebooks[0].notes[0].createdAt).toBe(1_700_000_000_000);
  });
});

describe('build', () => {
  const raderMed = (over = {}) => ({ ...flatten(bibliotek(), ANVANDARE), ...over });

  it('utelamnar rader som har deleted_at satt', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    const doda = new Date('2025-02-01T00:00:00.000Z').toISOString();
    rader.bookshelves[1].deleted_at = doda;
    rader.decks[2].deleted_at = doda;
    rader.sections[1].deleted_at = doda;
    rader.cards[1].deleted_at = doda;
    rader.notebooks[1].deleted_at = doda;
    rader.notes[0].deleted_at = doda;

    const efter = build(rader);
    expect(efter.bookshelves.map((h) => h.id)).toEqual(['h1']);
    expect(efter.decks.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(efter.decks[0].sections.map((s) => s.id)).toEqual(['s1']);
    expect(efter.decks[0].cards.map((k) => k.id)).toEqual(['k1', 'k3']);
    expect(efter.notebooks.map((b) => b.id)).toEqual(['b1']);
    expect(efter.notebooks[0].notes.map((a) => a.id)).toEqual(['a2']);
  });

  it('tar bort korten tillsammans med sin raderade kortlek', () => {
    const rader = flatten(bibliotek(), ANVANDARE);
    rader.decks[0].deleted_at = new Date().toISOString();
    const efter = build(rader);
    expect(efter.decks.map((d) => d.id)).toEqual(['d2', 'd3']);
    expect(efter.decks.flatMap((d) => d.cards.map((k) => k.id))).toEqual(['k4']);
  });

  it('tal att tabeller saknas helt', () => {
    expect(build({})).toEqual({ bookshelves: [], decks: [], notebooks: [] });
  });

  it('ger en kortlek utan farg appens standardfarg', () => {
    // Ingen standardfarg langre. Fargvaljaren ar borttagen: fargen ritades ut
    // pa en rubrikrad som inte finns, och indigo ar dessutom blatt.
    const rader = raderMed({ decks: [{ id: 'd9', title: 'Utan farg', position: 0, color: null }] });
    expect(build(rader).decks[0].color).toBeNull();
  });

  it('nollstaller sectionId nar mappen ar mjukraderad, sa kortet forblir synligt', () => {
    // deck.js renderar kort antingen som rotkort (!c.sectionId) eller under en
    // mapp (c.sectionId === section.id). Ett kort vars mapp ar mjukraderad
    // matchar ingendera och skulle forsvinna ur kortleksvyn, trots att det
    // finns kvar och studeras. Schemat sager on delete set null for
    // section_id, men mjuk radering utloser aldrig den regeln — build() maste
    // gora det sjalv.
    const rader = flatten(bibliotek(), ANVANDARE);
    rader.sections[0].deleted_at = new Date().toISOString(); // s1 = Derivator

    const kortlek = build(rader).decks[0];
    const kort = kortlek.cards.find((k) => k.id === 'k1');
    expect(kortlek.sections.map((s) => s.id)).toEqual(['s2']);
    expect(kort.sectionId).toBeNull();

    const synligtSomRotkort = !kort.sectionId;
    const synligtIMapp = kortlek.sections.some((s) => s.id === kort.sectionId);
    expect(synligtSomRotkort || synligtIMapp).toBe(true);
  });

  it('nollstaller bookshelfId nar bokhyllan ar mjukraderad, sa kortleken forblir synlig', () => {
    // library.js renderar en kortlek antingen under sin bokhylla eller i roten
    // (!deck.bookshelfId). Pekade bookshelfId pa en bokhylla som inte langre
    // finns forsvann hela kortleken ur biblioteket.
    const rader = flatten(bibliotek(), ANVANDARE);
    rader.bookshelves[0].deleted_at = new Date().toISOString(); // h1 = Matematik

    const efter = build(rader);
    const kortlek = efter.decks.find((d) => d.id === 'd1');
    expect(efter.bookshelves.map((h) => h.id)).toEqual(['h2']);
    expect(kortlek.bookshelfId).toBeNull();

    const synlig =
      !kortlek.bookshelfId || efter.bookshelves.some((h) => h.id === kortlek.bookshelfId);
    expect(synlig).toBe(true);
    expect(efter.notebooks[0].bookshelfId).toBeNull();
  });
});

describe('reviewRow', () => {
  const kort = { id: 'k1' };

  it('bygger en rad med kolumnerna som reviews-tabellen har', () => {
    const rad = reviewRow({
      card: kort,
      deckId: 'd1',
      userId: ANVANDARE,
      rating: 3,
      before: { interval: 6, easeFactor: 2.5 },
      after: { interval: 15, easeFactor: 2.5 },
      mode: 'playground',
      at: FORFALLER,
    });
    expect(rad).toEqual({
      user_id: ANVANDARE,
      card_id: 'k1',
      deck_id: 'd1',
      rating: 3,
      reviewed_at: new Date(FORFALLER).toISOString(),
      interval_before: 6,
      interval_after: 15,
      ease_after: 2.5,
      mode: 'playground',
    });
  });

  it('ger null i stallet for undefined nar tillstandet fore eller efter saknas', () => {
    const rad = reviewRow({ card: kort, userId: ANVANDARE, rating: 1, at: FORFALLER });
    expect(rad.deck_id).toBeNull();
    expect(rad.interval_before).toBeNull();
    expect(rad.interval_after).toBeNull();
    expect(rad.ease_after).toBeNull();
    expect(rad.mode).toBe('study');
  });
});


describe('beskrivningsfaltet', () => {
  // Ett kort har fram, bak och en fordjupning. Fordjupningen halls skild fran
  // svaret eftersom svaret ar det som ska kunna aterkallas; ett svar som
  // svaller gar inte att prova sig sjalv pa.
  const medBeskrivning = () => ({
    ...vanligtKort(),
    description: 'Foljer direkt ur definitionen.',
  });

  it('foljer med till databasraden', () => {
    expect(cardToRow(medBeskrivning(), 'd1', ANVANDARE).description).toBe(
      'Foljer direkt ur definitionen.'
    );
  });

  it('blir null pa raden nar kortet saknar den', () => {
    expect(cardToRow(vanligtKort(), 'd1', ANVANDARE).description).toBeNull();
  });

  it('overlever rundturen till databas och tillbaka', () => {
    const rad = cardToRow(medBeskrivning(), 'd1', ANVANDARE);
    expect(rowToCard(rad).description).toBe('Foljer direkt ur definitionen.');
  });

  it('satts inte alls pa kort utan fordjupning', () => {
    // Ett tomt falt skulle annars baras genom bade lagring och synk i onodan.
    const kort = rowToCard(cardToRow(vanligtKort(), 'd1', ANVANDARE));
    expect(kort).not.toHaveProperty('description');
  });

  it('notiskort far ingen beskrivning', () => {
    const rad = { id: 'n1', type: 'note', content: 'Text', description: 'skrap' };
    expect(rowToCard(rad)).not.toHaveProperty('description');
  });
});


describe('createCard', () => {
  it('ger ett nytt kort som ar forfallet direkt', () => {
    const kort = createCard('Fraga', 'Svar');
    expect(kort.front).toBe('Fraga');
    expect(kort.back).toBe('Svar');
    expect(kort.repetition).toBe(0);
    expect(kort.interval).toBe(0);
    expect(kort.easeFactor).toBe(2.5);
    expect(kort.nextReviewDate).toBeLessThanOrEqual(Date.now());
  });

  it('tar med fordjupningen och putsar den', () => {
    const kort = createCard('Fraga', 'Svar', false, [], null, {
      description: '  Foljer ur definitionen.  ',
    });
    expect(kort.description).toBe('Foljer ur definitionen.');
  });

  it('satter inget falt alls nar fordjupningen ar tom', () => {
    // Ett tomt falt skulle synas som en andring i diffen mot forra
    // ogonblicksbilden och skicka en meningslos rad till synken.
    for (const tom of [undefined, '', '   ', '\n']) {
      const kort = createCard('Fraga', 'Svar', false, [], null, { description: tom });
      expect(kort).not.toHaveProperty('description');
    }
  });

  it('klarar sig utan options-objektet', () => {
    expect(() => createCard('Fraga', 'Svar', false, [], null)).not.toThrow();
  });

  it('gor fordjupningen till en databasrad och tillbaka', () => {
    const kort = createCard('Fraga', 'Svar', false, [], null, { description: 'Djupet' });
    expect(rowToCard(cardToRow(kort, 'd1', ANVANDARE)).description).toBe('Djupet');
  });

  it('ger unika id aven for kort skapade i samma millisekund', () => {
    const id = new Set(Array.from({ length: 50 }, () => createCard('F', 'S').id));
    expect(id.size).toBe(50);
  });
});


describe('createNoteCard', () => {
  it('ar av typen note och baer text i stallet for tva sidor', () => {
    const notis = createNoteCard('En anteckning');
    expect(notis.type).toBe('note');
    expect(notis.content).toBe('En anteckning');
    expect(notis).not.toHaveProperty('front');
  });

  it('lagger sig i roten nar ingen mapp anges', () => {
    expect(createNoteCard('Text').sectionId).toBeNull();
    expect(createNoteCard('Text', 's1').sectionId).toBe('s1');
  });
});
