import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABLES } from '../src/domain/model.js';
import {
  ackOutbox,
  ackReviews,
  appendReviews,
  clearAll,
  deleteRows,
  enqueue,
  getAllRows,
  getMeta,
  getOutbox,
  getPendingReviews,
  getReviewsSince,
  getRows,
  openDb,
  outboxSize,
  putRows,
  setMeta,
} from '../src/core/local-db.js';

const ANVANDARE = '00000000-0000-4000-8000-000000000000';

/** Minsta giltiga rad per tabell, med de främmande nycklar tabellen kräver. */
const radFor = (tabell, id) => {
  const bas = { id, user_id: ANVANDARE, position: 0 };
  if (tabell === 'sections') return { ...bas, deck_id: 'deck-1', title: id };
  if (tabell === 'notes') return { ...bas, notebook_id: 'nb-1', content: id };
  if (tabell === 'cards') {
    return { ...bas, deck_id: 'deck-1', type: 'card', front: id, back: 'baksida' };
  }
  return { ...bas, title: id };
};

const repetition = (id, tidpunkt) => ({
  id,
  user_id: ANVANDARE,
  card_id: 'kort-1',
  deck_id: 'deck-1',
  rating: 3,
  reviewed_at: tidpunkt,
  mode: 'study',
});

beforeEach(async () => {
  await clearAll();
});

describe('openDb', () => {
  it('ger samma koppling vid upprepade anrop', async () => {
    expect(await openDb()).toBe(await openDb());
  });

  it('skapar ett lager per tabell plus reviews, outbox och meta', async () => {
    const namn = [...(await openDb()).objectStoreNames];
    for (const tabell of [...TABLES, 'reviews', 'outbox', 'meta']) {
      expect(namn).toContain(tabell);
    }
  });

  it('indexerar kort på kortlek och förfallodatum', async () => {
    const tx = (await openDb()).transaction(['cards', 'sections', 'notes'], 'readonly');
    expect([...tx.objectStore('cards').indexNames].sort()).toEqual(['deck_id', 'next_review_date']);
    expect([...tx.objectStore('sections').indexNames]).toEqual(['deck_id']);
    expect([...tx.objectStore('notes').indexNames]).toEqual(['notebook_id']);
  });
});

describe('putRows och getRows', () => {
  it('gör en rundtur per tabell', async () => {
    for (const tabell of TABLES) {
      const rad = radFor(tabell, `${tabell}-1`);
      await putRows(tabell, [rad]);
      expect(await getRows(tabell)).toEqual([rad]);
    }
  });

  it('skriver över befintlig rad med samma id', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await putRows('decks', [{ ...radFor('decks', 'd1'), title: 'Nytt namn' }]);

    const rader = await getRows('decks');
    expect(rader).toHaveLength(1);
    expect(rader[0].title).toBe('Nytt namn');
  });

  it('gör ingenting vid tom array', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await expect(putRows('decks', [])).resolves.toBeUndefined();
    expect(await getRows('decks')).toHaveLength(1);
  });

  it('avvisar okänd tabell med ett läsbart fel', async () => {
    await expect(putRows('kortlekar', [{ id: 'x' }])).rejects.toMatchObject({
      name: 'LocalDbError',
      code: 'invalid',
    });
  });

  it('avvisar rader utan id', async () => {
    await expect(putRows('decks', [{ title: 'utan id' }])).rejects.toMatchObject({
      name: 'LocalDbError',
    });
  });
});

describe('getAllRows', () => {
  it('ger en array per tabell även när allt är tomt', async () => {
    expect(await getAllRows()).toEqual(Object.fromEntries(TABLES.map((t) => [t, []])));
  });

  it('ger tillbaka det som skrivits', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await putRows('cards', [radFor('cards', 'c1')]);

    const allt = await getAllRows();
    expect(allt.decks).toHaveLength(1);
    expect(allt.cards[0].id).toBe('c1');
    expect(allt.notes).toEqual([]);
  });
});

describe('deleteRows', () => {
  it('tar bort angivna rader och lämnar resten', async () => {
    await putRows('decks', [radFor('decks', 'd1'), radFor('decks', 'd2'), radFor('decks', 'd3')]);
    await deleteRows('decks', ['d1', 'd3']);
    expect((await getRows('decks')).map((r) => r.id)).toEqual(['d2']);
  });

  it('gör ingenting vid tom array', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await expect(deleteRows('decks', [])).resolves.toBeUndefined();
    expect(await getRows('decks')).toHaveLength(1);
  });
});

describe('utkorgen', () => {
  const upsert = (id) => ({ table: 'decks', op: 'upsert', id, row: radFor('decks', id) });

  it('tilldelar stigande seq och returnerar dem i ordning', async () => {
    const forsta = await enqueue([upsert('d1'), upsert('d2')]);
    const andra = await enqueue([upsert('d3')]);

    expect(forsta.every(Number.isInteger)).toBe(true);
    expect(forsta[1]).toBeGreaterThan(forsta[0]);
    expect(andra[0]).toBeGreaterThan(forsta[1]);
  });

  it('ger getOutbox äldsta först', async () => {
    const seqs = [
      await enqueue([upsert('d1')]),
      await enqueue([upsert('d2')]),
      await enqueue([upsert('d3')]),
    ];

    const kon = await getOutbox();
    expect(kon.map((p) => p.id)).toEqual(['d1', 'd2', 'd3']);
    // Löpnumret ligger i posten, så uppladdningen kan kvittera exakt det den skickat.
    expect(kon.map((p) => p.seq)).toEqual([...seqs].flat());
  });

  it('begränsar getOutbox till limit poster, fortfarande äldsta först', async () => {
    await enqueue([upsert('d1'), upsert('d2'), upsert('d3')]);
    expect((await getOutbox(2)).map((p) => p.id)).toEqual(['d1', 'd2']);
  });

  it('ackOutbox tar bort rätt poster och lämnar resten', async () => {
    const seqs = await enqueue([upsert('d1'), upsert('d2'), upsert('d3')]);
    await ackOutbox([seqs[0], seqs[2]]);

    expect((await getOutbox()).map((p) => p.id)).toEqual(['d2']);
    expect(await outboxSize()).toBe(1);
  });

  it('räknar kön med outboxSize', async () => {
    expect(await outboxSize()).toBe(0);
    await enqueue([upsert('d1'), upsert('d2')]);
    expect(await outboxSize()).toBe(2);
  });

  it('köar radering utan rad', async () => {
    await enqueue([{ table: 'decks', op: 'delete', id: 'd1' }]);
    const [post] = await getOutbox();
    expect(post).toMatchObject({ table: 'decks', op: 'delete', id: 'd1', row: null });
  });

  it('avvisar okänd operation', async () => {
    await expect(
      enqueue([{ table: 'decks', op: 'patch', id: 'd1', row: {} }])
    ).rejects.toMatchObject({ name: 'LocalDbError', code: 'invalid' });
  });
});

describe('atomicitet mellan rad och köpost', () => {
  const upsert = (id) => ({ table: 'decks', op: 'upsert', id, row: radFor('decks', id) });

  it('skriver både raden och köposten', async () => {
    await enqueue([upsert('d1')]);
    expect((await getRows('decks')).map((r) => r.id)).toEqual(['d1']);
    expect((await getOutbox()).map((p) => p.id)).toEqual(['d1']);
  });

  it('tar bort raden lokalt när en radering köas', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await enqueue([{ table: 'decks', op: 'delete', id: 'd1' }]);

    expect(await getRows('decks')).toEqual([]);
    expect(await outboxSize()).toBe(1);
  });

  // Den andra mutationen bär ett värde som inte går att spara. Hade raden och
  // köposten skrivits var för sig hade d1 blivit kvar utan köpost — precis det
  // tillstånd utkorgen finns för att omöjliggöra.
  it('skriver varken rad eller köpost när en mutation i batchen misslyckas', async () => {
    const trasig = {
      table: 'decks',
      op: 'upsert',
      id: 'd2',
      row: { ...radFor('decks', 'd2'), onSave: () => 'går inte att klona' },
    };

    await expect(enqueue([upsert('d1'), trasig])).rejects.toThrow();

    expect(await getRows('decks')).toEqual([]);
    expect(await outboxSize()).toBe(0);
  });

  it('lämnar tidigare data orörd när en batch misslyckas', async () => {
    await enqueue([upsert('d1')]);
    const trasig = {
      table: 'decks',
      op: 'upsert',
      id: 'd2',
      row: { ...radFor('decks', 'd2'), onSave: () => 'går inte att klona' },
    };

    await expect(enqueue([trasig])).rejects.toThrow();

    expect((await getRows('decks')).map((r) => r.id)).toEqual(['d1']);
    expect(await outboxSize()).toBe(1);
  });
});

describe('repetitionsloggen', () => {
  it('tilldelar id när det saknas', async () => {
    const [id] = await appendReviews([{ card_id: 'k1', rating: 3 }]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getPendingReviews())[0].id).toBe(id);
  });

  it('behåller id som redan finns', async () => {
    await appendReviews([repetition('r1', '2026-01-01T10:00:00.000Z')]);
    expect((await getPendingReviews())[0].id).toBe('r1');
  });

  it('sätter reviewed_at när det saknas, så raden inte faller ur indexet', async () => {
    await appendReviews([{ card_id: 'k1', rating: 3 }]);
    expect((await getPendingReviews())[0].reviewed_at).toBeTruthy();
  });

  it('ger äldsta först', async () => {
    await appendReviews([
      repetition('r2', '2026-01-02T10:00:00.000Z'),
      repetition('r1', '2026-01-01T10:00:00.000Z'),
      repetition('r3', '2026-01-03T10:00:00.000Z'),
    ]);
    expect((await getPendingReviews()).map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('ackReviews tar rätt rader ur kön', async () => {
    await appendReviews([
      repetition('r1', '2026-01-01T10:00:00.000Z'),
      repetition('r2', '2026-01-02T10:00:00.000Z'),
    ]);
    await ackReviews(['r1']);
    expect((await getPendingReviews()).map((r) => r.id)).toEqual(['r2']);
  });

  it('behåller uppladdade rader lokalt i stället för att radera dem', async () => {
    // Loggen är underlaget för streak, heatmap och rekord. Raderades raderna
    // efter uppladdning gick statistiken inte att räkna utan nätet.
    await appendReviews([
      repetition('r1', '2026-01-01T10:00:00.000Z'),
      repetition('r2', '2026-01-02T10:00:00.000Z'),
    ]);
    await ackReviews(['r1']);

    const kvar = await getReviewsSince();
    expect(kvar.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(kvar.find((r) => r.id === 'r1').pending).toBe(0);
    expect(kvar.find((r) => r.id === 'r2').pending).toBe(1);
  });

  it('getReviewsSince filtrerar på tidpunkt', async () => {
    await appendReviews([
      repetition('gammal', '2026-01-01T10:00:00.000Z'),
      repetition('ny', '2026-06-01T10:00:00.000Z'),
    ]);
    const fran = await getReviewsSince('2026-03-01T00:00:00.000Z');
    expect(fran.map((r) => r.id)).toEqual(['ny']);
  });

  it('gör ingenting vid tom array', async () => {
    await expect(appendReviews([])).resolves.toEqual([]);
    await expect(ackReviews([])).resolves.toBeUndefined();
  });
});

describe('meta', () => {
  it('returnerar fallback när nyckeln saknas', async () => {
    expect(await getMeta('senaste_synk', 0)).toBe(0);
    expect(await getMeta('saknas')).toBeUndefined();
  });

  it('gör en rundtur', async () => {
    await setMeta('senaste_synk', '2026-08-28T12:00:00.000Z');
    expect(await getMeta('senaste_synk', 0)).toBe('2026-08-28T12:00:00.000Z');
  });

  it('skiljer ett lagrat falsy-värde från en saknad nyckel', async () => {
    await setMeta('antal', 0);
    expect(await getMeta('antal', 99)).toBe(0);
  });

  it('sparar sammansatta värden', async () => {
    await setMeta('kursor', { decks: '2026-01-01', cards: null });
    expect(await getMeta('kursor')).toEqual({ decks: '2026-01-01', cards: null });
  });
});

describe('clearAll', () => {
  it('tömmer rader, kö, logg och meta', async () => {
    await putRows('decks', [radFor('decks', 'd1')]);
    await enqueue([{ table: 'cards', op: 'upsert', id: 'c1', row: radFor('cards', 'c1') }]);
    await appendReviews([repetition('r1', '2026-01-01T10:00:00.000Z')]);
    await setMeta('senaste_synk', 'nu');

    await clearAll();

    expect(await getAllRows()).toEqual(Object.fromEntries(TABLES.map((t) => [t, []])));
    expect(await outboxSize()).toBe(0);
    expect(await getPendingReviews()).toEqual([]);
    expect(await getMeta('senaste_synk', null)).toBeNull();
  });
});
