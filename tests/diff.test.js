import { describe, expect, it } from 'vitest';
import { collapse, diffSnapshots, groupForSend, resolve } from '../src/domain/diff.js';
import { TABLES } from '../src/domain/model.js';

const ANVANDARE = '00000000-0000-4000-8000-000000000001';

const hylla = (id, over = {}) => ({
  id,
  user_id: ANVANDARE,
  title: `Hylla ${id}`,
  color: null,
  position: 0,
  ...over,
});

const kortlek = (id, over = {}) => ({
  id,
  user_id: ANVANDARE,
  bookshelf_id: 'h1',
  title: `Kortlek ${id}`,
  color: '#123456',
  position: 0,
  ...over,
});

const kort = (id, over = {}) => ({
  id,
  user_id: ANVANDARE,
  deck_id: 'd1',
  section_id: null,
  type: 'card',
  front: 'Fram',
  back: 'Bak',
  content: null,
  is_long_form: false,
  position: 0,
  repetition: 1,
  interval_days: 1,
  ease_factor: 2.5,
  next_review_date: '2025-01-01T00:00:00.000Z',
  lapses: 0,
  last_reviewed: null,
  ...over,
});

/** En tom ogonblicksbild med alla tabeller, som flatten() alltid ger. */
const tom = () => Object.fromEntries(TABLES.map((t) => [t, []]));

const bild = (over = {}) => ({ ...tom(), ...over });

describe('diffSnapshots', () => {
  it('ger inga mutationer nar ingenting andrats', () => {
    const bilden = bild({
      bookshelves: [hylla('h1')],
      decks: [kortlek('d1')],
      cards: [kort('k1')],
    });
    expect(diffSnapshots(bilden, bild({ ...bilden }))).toEqual([]);
  });

  it('ser ingen skillnad mot en identisk men separat kopia', () => {
    const forra = bild({ cards: [kort('k1'), kort('k2', { position: 1 })] });
    const nasta = bild({ cards: [kort('k1'), kort('k2', { position: 1 })] });
    expect(diffSnapshots(forra, nasta)).toEqual([]);
  });

  it('ger en upsert for en ny rad', () => {
    const nyRad = kort('k2', { position: 1 });
    const mutationer = diffSnapshots(
      bild({ cards: [kort('k1')] }),
      bild({ cards: [kort('k1'), nyRad] })
    );
    expect(mutationer).toEqual([{ table: 'cards', op: 'upsert', id: 'k2', row: nyRad }]);
  });

  it('ger en upsert for en andrad rad', () => {
    const efter = kort('k1', { back: 'Nytt svar' });
    const mutationer = diffSnapshots(bild({ cards: [kort('k1')] }), bild({ cards: [efter] }));
    expect(mutationer).toEqual([{ table: 'cards', op: 'upsert', id: 'k1', row: efter }]);
  });

  it('upptacker aven en andring som bara ar en ny position', () => {
    const mutationer = diffSnapshots(
      bild({ cards: [kort('k1'), kort('k2', { position: 1 })] }),
      bild({ cards: [kort('k1', { position: 1 }), kort('k2')] })
    );
    expect(mutationer.map((m) => m.id).sort()).toEqual(['k1', 'k2']);
    expect(mutationer.every((m) => m.op === 'upsert')).toBe(true);
  });

  it('upptacker att ett falt gatt fran ett varde till null', () => {
    const mutationer = diffSnapshots(
      bild({ cards: [kort('k1', { section_id: 's1' })] }),
      bild({ cards: [kort('k1', { section_id: null })] })
    );
    expect(mutationer).toHaveLength(1);
    expect(mutationer[0].row.section_id).toBeNull();
  });

  it('jamfor nycklarna fran bada raderna, inte bara den enas', () => {
    const utan = kort('k1');
    delete utan.last_reviewed;
    const medVarde = kort('k1', { last_reviewed: '2025-01-02T00:00:00.000Z' });
    expect(diffSnapshots(bild({ cards: [utan] }), bild({ cards: [medVarde] }))).toHaveLength(1);
    expect(diffSnapshots(bild({ cards: [medVarde] }), bild({ cards: [utan] }))).toHaveLength(1);
  });

  it('behandlar ett saknat falt och ett falt satt till null som samma sak', () => {
    // Utan normaliseringen sags en handbyggd rad utan kolumnen som evigt
    // andrad mot en rad dar kolumnen ar null, och synkades om vid varje varv.
    const utan = kort('k1');
    delete utan.last_reviewed;
    expect(diffSnapshots(bild({ cards: [utan] }), bild({ cards: [kort('k1')] }))).toEqual([]);
  });

  it('ger en delete for en borttagen rad, utan row-objekt', () => {
    const mutationer = diffSnapshots(
      bild({ cards: [kort('k1'), kort('k2')] }),
      bild({ cards: [kort('k1')] })
    );
    expect(mutationer).toEqual([{ table: 'cards', op: 'delete', id: 'k2' }]);
    expect(mutationer[0]).not.toHaveProperty('row');
  });

  it('raknar INTE updated_at eller created_at som en andring', () => {
    // Servern satter dessa falt sjalv. Om de raknades skulle varje rad se
    // andrad ut vid varje synk: en upsert som ger ett nytt updated_at, som ger
    // en ny upsert, i all oandlighet.
    const forra = bild({
      cards: [
        kort('k1', {
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        }),
      ],
    });
    const nasta = bild({
      cards: [
        kort('k1', {
          created_at: '2025-01-02T00:00:00.000Z',
          updated_at: '2025-06-30T12:00:00.000Z',
        }),
      ],
    });
    expect(diffSnapshots(forra, nasta)).toEqual([]);
  });

  it('upptacker en riktig andring aven nar updated_at ocksa andrats', () => {
    const forra = bild({ cards: [kort('k1', { updated_at: '2025-01-01T00:00:00.000Z' })] });
    const nasta = bild({
      cards: [kort('k1', { back: 'Annat', updated_at: '2025-06-30T12:00:00.000Z' })],
    });
    expect(diffSnapshots(forra, nasta)).toHaveLength(1);
  });

  it('raknar deleted_at som en andring, sa en aterskapad rad syns for synken', () => {
    // Bara de falt servern ager (updated_at, created_at) far hoppas over.
    // Hoppades aven deleted_at over blev en rad som aterskapats lokalt osynlig
    // for synken och forblev raderad pa andra enheter.
    const forra = bild({ cards: [kort('k1', { deleted_at: '2025-01-01T00:00:00.000Z' })] });
    const nasta = bild({ cards: [kort('k1', { deleted_at: null })] });
    expect(diffSnapshots(forra, nasta)).toEqual([
      { table: 'cards', op: 'upsert', id: 'k1', row: nasta.cards[0] },
    ]);
  });

  it('behandlar en saknad forra bild som att allt ar nytt', () => {
    const nasta = bild({ bookshelves: [hylla('h1')], decks: [kortlek('d1')], cards: [kort('k1')] });
    const mutationer = diffSnapshots(null, nasta);
    expect(mutationer).toHaveLength(3);
    expect(mutationer.every((m) => m.op === 'upsert')).toBe(true);
  });

  it('behandlar en saknad ny bild som att allt raderats', () => {
    const forra = bild({ decks: [kortlek('d1')], cards: [kort('k1')] });
    const mutationer = diffSnapshots(forra, null);
    expect(mutationer.map((m) => [m.table, m.op, m.id])).toEqual([
      ['decks', 'delete', 'd1'],
      ['cards', 'delete', 'k1'],
    ]);
  });

  it('gar igenom alla tabeller i TABLES', () => {
    const nasta = Object.fromEntries(TABLES.map((t) => [t, [{ id: `${t}-1`, title: t }]]));
    expect(diffSnapshots(tom(), nasta).map((m) => m.table)).toEqual([...TABLES]);
  });

  it('tal att en tabell saknas helt i bilden', () => {
    expect(diffSnapshots({}, { cards: [kort('k1')] })).toHaveLength(1);
    expect(diffSnapshots({ cards: [kort('k1')] }, {})).toHaveLength(1);
  });

  it('muterar inte bilderna den jamfor', () => {
    const forra = bild({ cards: [kort('k1')] });
    const nasta = bild({ cards: [kort('k1', { back: 'Nytt' })] });
    const kopiaForra = JSON.parse(JSON.stringify(forra));
    const kopiaNasta = JSON.parse(JSON.stringify(nasta));
    diffSnapshots(forra, nasta);
    expect(forra).toEqual(kopiaForra);
    expect(nasta).toEqual(kopiaNasta);
  });
});

describe('collapse', () => {
  it('behaller bara sista mutationen per rad', () => {
    const sista = { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1', { back: 'Tredje' }) };
    const resultat = collapse([
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1', { back: 'Forsta' }) },
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1', { back: 'Andra' }) },
      sista,
    ]);
    expect(resultat).toEqual([sista]);
  });

  it('later en senare delete ersatta en tidigare upsert for samma rad', () => {
    const resultat = collapse([
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
      { table: 'cards', op: 'delete', id: 'k1' },
    ]);
    expect(resultat).toEqual([{ table: 'cards', op: 'delete', id: 'k1' }]);
  });

  it('later en senare upsert ersatta en tidigare delete, sa att ett aterskapat kort lever', () => {
    const resultat = collapse([
      { table: 'cards', op: 'delete', id: 'k1' },
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
    ]);
    expect(resultat.map((m) => m.op)).toEqual(['upsert']);
  });

  it('blandar inte ihop rader med samma id i olika tabeller', () => {
    const resultat = collapse([
      { table: 'decks', op: 'upsert', id: 'x1', row: kortlek('x1') },
      { table: 'cards', op: 'upsert', id: 'x1', row: kort('x1') },
    ]);
    expect(resultat.map((m) => m.table)).toEqual(['decks', 'cards']);
  });

  it('sorterar sa att foraldrar kommer fore barn', () => {
    const resultat = collapse([
      { table: 'notes', op: 'upsert', id: 'a1', row: { id: 'a1' } },
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
      { table: 'notebooks', op: 'upsert', id: 'b1', row: { id: 'b1' } },
      { table: 'sections', op: 'upsert', id: 's1', row: { id: 's1' } },
      { table: 'decks', op: 'upsert', id: 'd1', row: kortlek('d1') },
      { table: 'bookshelves', op: 'upsert', id: 'h1', row: hylla('h1') },
    ]);
    const ordning = resultat.map((m) => m.table);
    expect(ordning).toEqual([...TABLES]);
    expect(ordning.indexOf('bookshelves')).toBeLessThan(ordning.indexOf('decks'));
    expect(ordning.indexOf('decks')).toBeLessThan(ordning.indexOf('cards'));
    expect(ordning.indexOf('sections')).toBeLessThan(ordning.indexOf('cards'));
    expect(ordning.indexOf('notebooks')).toBeLessThan(ordning.indexOf('notes'));
  });

  it('bevarar inbordes ordning inom samma tabell', () => {
    const resultat = collapse([
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
      { table: 'decks', op: 'upsert', id: 'd1', row: kortlek('d1') },
      { table: 'cards', op: 'upsert', id: 'k2', row: kort('k2') },
      { table: 'cards', op: 'upsert', id: 'k3', row: kort('k3') },
    ]);
    expect(resultat.map((m) => m.id)).toEqual(['d1', 'k1', 'k2', 'k3']);
  });

  it('ger en tom lista for en tom ko', () => {
    expect(collapse([])).toEqual([]);
  });
});

describe('groupForSend', () => {
  const mutationer = [
    { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
    { table: 'bookshelves', op: 'upsert', id: 'h1', row: hylla('h1') },
    { table: 'decks', op: 'upsert', id: 'd1', row: kortlek('d1') },
    { table: 'notes', op: 'delete', id: 'a1' },
    { table: 'notebooks', op: 'delete', id: 'b1' },
    { table: 'decks', op: 'delete', id: 'd2' },
  ];

  it('lagger upserts i foraldraordning', () => {
    const { upserts } = groupForSend(mutationer);
    expect(upserts.map((g) => g.table)).toEqual(['bookshelves', 'decks', 'cards']);
  });

  it('lagger deletes i omvand ordning, sa att barn tas bort fore foraldrar', () => {
    const { deletes } = groupForSend(mutationer);
    expect(deletes.map((g) => g.table)).toEqual(['notes', 'notebooks', 'decks']);
    const ordning = deletes.map((g) => g.table);
    expect(ordning.indexOf('notes')).toBeLessThan(ordning.indexOf('notebooks'));
    expect(ordning.indexOf('notebooks')).toBeLessThan(ordning.indexOf('decks'));
  });

  it('skickar hela raden vid upsert och bara id vid delete', () => {
    const { upserts, deletes } = groupForSend(mutationer);
    expect(upserts.find((g) => g.table === 'decks').rows).toEqual([kortlek('d1')]);
    expect(deletes.find((g) => g.table === 'decks').ids).toEqual(['d2']);
  });

  it('samlar flera rader i samma tabell i en enda grupp', () => {
    const { upserts, deletes } = groupForSend([
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
      { table: 'cards', op: 'upsert', id: 'k2', row: kort('k2') },
      { table: 'cards', op: 'delete', id: 'k3' },
      { table: 'cards', op: 'delete', id: 'k4' },
    ]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows.map((r) => r.id)).toEqual(['k1', 'k2']);
    expect(deletes[0].ids).toEqual(['k3', 'k4']);
  });

  it('utelamnar tabeller som inte har nagra mutationer', () => {
    const { upserts, deletes } = groupForSend([
      { table: 'cards', op: 'upsert', id: 'k1', row: kort('k1') },
    ]);
    expect(upserts.map((g) => g.table)).toEqual(['cards']);
    expect(deletes).toEqual([]);
  });

  it('ger tomma listor for en tom ko', () => {
    expect(groupForSend([])).toEqual({ upserts: [], deletes: [] });
  });

  it('muterar inte TABLES, trots att deletes vands', () => {
    const fore = [...TABLES];
    groupForSend(mutationer);
    groupForSend(mutationer);
    expect(TABLES).toEqual(fore);
  });
});

describe('resolve', () => {
  const rad = (updatedAt, over = {}) => ({ id: 'k1', updated_at: updatedAt, ...over });

  it('valjer den med senast updated_at', () => {
    const gammal = rad('2025-01-01T00:00:00.000Z', { back: 'Gammalt' });
    const ny = rad('2025-06-01T00:00:00.000Z', { back: 'Nytt' });
    expect(resolve(gammal, ny)).toBe(ny);
    expect(resolve(ny, gammal)).toBe(ny);
  });

  it('valjer fjarran vid exakt lika tidsstampel', () => {
    // Fjarran ar det alla andra enheter redan ser, sa alla konvergerar dit.
    const lokal = rad('2025-06-01T00:00:00.000Z', { back: 'Lokalt' });
    const fjarran = rad('2025-06-01T00:00:00.000Z', { back: 'Fjarran' });
    expect(resolve(lokal, fjarran)).toBe(fjarran);
  });

  it('jamfor tidpunkter, inte strangar', () => {
    // Samma ogonblick skrivet i olika tidszon ar oavgjort, alltsa fjarran.
    const lokal = rad('2025-06-01T12:00:00.000Z');
    const fjarran = rad('2025-06-01T14:00:00.000+02:00');
    expect(resolve(lokal, fjarran)).toBe(fjarran);
  });

  it('skiljer pa millisekunder', () => {
    const lokal = rad('2025-06-01T00:00:00.002Z');
    const fjarran = rad('2025-06-01T00:00:00.001Z');
    expect(resolve(lokal, fjarran)).toBe(lokal);
  });

  it('hanterar att lokal saknas', () => {
    const fjarran = rad('2025-06-01T00:00:00.000Z');
    expect(resolve(null, fjarran)).toBe(fjarran);
    expect(resolve(undefined, fjarran)).toBe(fjarran);
  });

  it('hanterar att fjarran saknas', () => {
    const lokal = rad('2025-06-01T00:00:00.000Z');
    expect(resolve(lokal, null)).toBe(lokal);
    expect(resolve(lokal, undefined)).toBe(lokal);
  });

  it('ger null nar bada saknas', () => {
    expect(resolve(null, null)).toBeNull();
  });

  it('later en obrukbar tidsstampel forlora mot en giltig', () => {
    const lokal = rad('inte ett datum');
    const fjarran = rad('2025-06-01T00:00:00.000Z');
    expect(resolve(lokal, fjarran)).toBe(fjarran);
  });

  it('behandlar en rad utan updated_at som epoken, inte som ar 2000', () => {
    // Date.parse(0) far talet strangat till "0" och tolkas som aret 2000, inte
    // som epoken. En lokal rad utan tidsstampel — precis vad flatten() ger —
    // hade darfor slagit en fjarran rad andrad pa 1900-talet.
    const lokal = { id: 'k1', back: 'Lokalt utan tidsstampel' };
    const fjarran = rad('1999-01-01T00:00:00.000Z', { back: 'Fjarran fran 1999' });
    expect(resolve(lokal, fjarran)).toBe(fjarran);
  });

  it('later anda en fjarran rad med nutida tidsstampel vinna over en utan', () => {
    const lokal = { id: 'k1' };
    const fjarran = rad('2025-06-01T00:00:00.000Z');
    expect(resolve(lokal, fjarran)).toBe(fjarran);
  });
});
