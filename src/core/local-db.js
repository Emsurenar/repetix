// Lokal spegel av molndatan, byggd på IndexedDB.
//
// Det kritiska flödet — bläddra i biblioteket, plugga, betygsätta — läser och
// skriver uteslutande härifrån. Nätet är en synk som sker vid sidan om, aldrig
// något en interaktion väntar på. Därför måste allt appen behöver finnas
// lokalt, och därför bär den här modulen också utkorgen: kön av ändringar som
// ännu inte nått servern.
//
// Rå IndexedDB utan wrapper-bibliotek. Lagret är litet nog att inte motivera
// ett beroende, och ett beroende hade dessutom behövt laddas innan appen kunde
// läsa sin egen data — precis det som ska fungera offline.

import { TABLES } from '../domain/model.js';

const DB_NAME = 'repetix';
const DB_VERSION = 1;

/** Append-only lokal logg av repetitioner som väntar på uppladdning. */
const REVIEWS = 'reviews';

/** Kön av mutationer som ska skickas till servern. */
const OUTBOX = 'outbox';

/** Nyckel/värde för synkmarkörer och liknande. */
const META = 'meta';

const OP_UPSERT = 'upsert';
const OP_DELETE = 'delete';

/**
 * Hur många poster som som mest läses ut i en batch när anroparen inte anger
 * något. En enhet som varit offline länge kan ha tusentals köade poster, och
 * att dra in hela kön i minnet för att skicka de tio första vore slöseri.
 */
const DEFAULT_BATCH = 500;

/**
 * Index per tabell. Frågorna de finns för: kortets kortlek, kortets förfallo-
 * datum (drivkraften i hela appen: "vad ska repeteras nu"), och barnens
 * förälder vid uppbyggnad av trädet.
 */
const TABLE_INDEXES = {
  decks: [],
  bookshelves: [],
  sections: [{ name: 'deck_id', keyPath: 'deck_id' }],
  notebooks: [],
  cards: [
    { name: 'deck_id', keyPath: 'deck_id' },
    { name: 'next_review_date', keyPath: 'next_review_date' },
  ],
  notes: [{ name: 'notebook_id', keyPath: 'notebook_id' }],
};

/** Lagren som håller vanliga datarader, ett per tabell i model.js. */
const TABLE_STORES = TABLES.map((table) => ({
  name: table,
  keyPath: 'id',
  autoIncrement: false,
  indexes: TABLE_INDEXES[table] ?? [],
}));

const STORES = [
  ...TABLE_STORES,
  // Loggen sorteras på tidpunkt, inte på id: id:t är ett uuid och säger
  // ingenting om ordning, medan uppladdningen vill ta äldsta först.
  {
    name: REVIEWS,
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      { name: 'reviewed_at', keyPath: 'reviewed_at' },
      // Sammansatt: hamtar obehandlade rader i tidsordning i en enda sokning.
      // pending ar 1 eller 0 och inte en boolean, eftersom IndexedDB inte
      // accepterar booleaner som nyckelvarden.
      { name: 'pending_time', keyPath: ['pending', 'reviewed_at'] },
    ],
  },
  // seq är löpnummer och därmed också köordning: getAll ger dem i nyckelordning.
  { name: OUTBOX, keyPath: 'seq', autoIncrement: true, indexes: [] },
  { name: META, keyPath: 'key', autoIncrement: false, indexes: [] },
];

const ROW_STORES = new Set(TABLES);

// ---------------------------------------------------------------------------
// Fel
// ---------------------------------------------------------------------------

/**
 * Alla fel härifrån är Error med name 'LocalDbError' och en `code`, aldrig ett
 * rått DOMException. Anroparen ska kunna visa `message` rakt av för
 * användaren, och skilja "webbläsaren tillåter inte lagring" (då är hela appen
 * oanvändbar) från ett enskilt misslyckat skrivförsök.
 */
function localDbError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'LocalDbError';
  error.code = code;
  return error;
}

const unavailable = (cause) =>
  localDbError(
    'unavailable',
    'Repetix kan inte spara data i den här webbläsaren. Tillåt cookies och webbplatsdata, eller stäng av privat läge, och ladda om sidan.',
    cause
  );

const blocked = () =>
  localDbError(
    'blocked',
    'Databasen kunde inte uppdateras eftersom Repetix är öppet i en annan flik. Stäng de andra flikarna och ladda om sidan.'
  );

const writeFailed = (cause) =>
  localDbError('io', 'Kunde inte spara lokalt. Din data är oförändrad — försök igen.', cause);

const invalid = (message) => localDbError('invalid', message);

// ---------------------------------------------------------------------------
// Koppling
// ---------------------------------------------------------------------------

/**
 * Kopplingen cachas som ett löfte, inte som en databas. Två samtidiga anrop
 * innan den hunnit öppnas ska dela samma öppning i stället för att köa upp två
 * — och varje publik funktion får därför anropa openDb() utan att bry sig om
 * huruvida någon annan redan gjort det.
 */
let connection = null;

/** Den öppnade databasen, så att release() kan jämföra synkront. */
let activeDb = null;

export async function openDb() {
  if (!connection) {
    const attempt = connect();
    connection = attempt;
    // Ett misslyckat försök får inte cementeras: användaren kan ha nekat
    // webbplatsdata, ändrat sig och laddat om utan att stänga fliken.
    attempt.catch(() => {
      if (connection === attempt) connection = null;
    });
  }
  return connection;
}

function connect() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(unavailable());
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (cause) {
      // Vissa webbläsare kastar direkt i privat läge i stället för att lämna
      // tillbaka en förfrågan som sedan misslyckas.
      reject(unavailable(cause));
      return;
    }

    request.onupgradeneeded = (event) => applySchema(request.result, event.target.transaction);
    request.onblocked = () => reject(blocked());
    request.onerror = () => reject(unavailable(request.error));
    request.onsuccess = () => {
      const db = request.result;
      // En annan flik som vill uppgradera schemat blockeras så länge den här
      // kopplingen står öppen. Släpp den frivilligt; nästa anrop öppnar en ny
      // koppling mot det uppgraderade schemat.
      db.onversionchange = () => {
        db.close();
        release(db);
      };
      db.onclose = () => release(db);
      activeDb = db;
      resolve(db);
    };
  });
}

function release(db) {
  // Bara om cachen fortfarande pekar på just den här kopplingen. En nyare
  // koppling kan redan ha hunnit ersätta den.
  if (activeDb !== db) return;
  activeDb = null;
  connection = null;
}

/**
 * Skapar lager och index som saknas, och rör inte de som finns. Skriven för
 * att kunna köras om vid en framtida versionshöjning: då kommer den hit med
 * ett halvfärdigt schema och ska bara fylla i skillnaden.
 */
function applySchema(db, tx) {
  for (const spec of STORES) {
    const store = db.objectStoreNames.contains(spec.name)
      ? tx.objectStore(spec.name)
      : db.createObjectStore(spec.name, {
          keyPath: spec.keyPath,
          autoIncrement: spec.autoIncrement,
        });

    for (const index of spec.indexes) {
      if (!store.indexNames.contains(index.name)) store.createIndex(index.name, index.keyPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Transaktioner
// ---------------------------------------------------------------------------

/**
 * Kör en transaktion och löser först när den har committat.
 *
 * `body` får transaktionen och returnerar en funktion som plockar fram
 * resultatet. Resultatet läses alltså inte förrän skrivningarna faktiskt gått
 * igenom, så en anropare kan aldrig få tillbaka data ur en transaktion som
 * strax därefter avbryts.
 *
 * `body` får inte await:a: en IndexedDB-transaktion stängs så fort dess
 * händelsekö tömts, och ett await släpper igenom just den vändan.
 */
function transact(db, storeNames, mode, body) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (cause) {
      reject(writeFailed(cause));
      return;
    }

    let collect;
    let failure = null;

    tx.oncomplete = () => resolve(collect ? collect() : undefined);
    tx.onerror = () => reject(failure ?? writeFailed(tx.error));
    tx.onabort = () => reject(failure ?? writeFailed(tx.error));

    try {
      collect = body(tx);
    } catch (cause) {
      // Behåll det ursprungliga felet: tx.error är tomt vid en frivillig abort
      // och skulle annars dölja varför det gick fel.
      failure = cause?.name === 'LocalDbError' ? cause : writeFailed(cause);
      try {
        tx.abort();
      } catch {
        reject(failure);
      }
    }
  });
}

/** Kortform för de många enkla läsningarna. */
async function read(storeNames, body) {
  const db = await openDb();
  return transact(db, storeNames, 'readonly', body);
}

/** Läser ut allt ur ett lager eller index, som mest `limit` poster. */
function getAllFrom(source, limit, range) {
  const box = { rows: [] };
  const bounded = Number.isFinite(limit) && limit > 0;
  const request = bounded ? source.getAll(range ?? null, limit) : source.getAll(range ?? null);
  request.onsuccess = () => {
    box.rows = request.result ?? [];
  };
  return () => box.rows;
}

// ---------------------------------------------------------------------------
// Rader
// ---------------------------------------------------------------------------

function assertTable(table) {
  if (!ROW_STORES.has(table)) {
    throw invalid(`Okänd tabell: ${String(table)}`);
  }
}

function asArray(value, what) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid(`${what} måste vara en array`);
  return value;
}

/** Alla tabeller i en enda läsning, i den form model.build() förväntar sig. */
export async function getAllRows() {
  const db = await openDb();
  return transact(db, TABLES, 'readonly', (tx) => {
    const collectors = TABLES.map((table) => [table, getAllFrom(tx.objectStore(table))]);
    return () => Object.fromEntries(collectors.map(([table, pick]) => [table, pick()]));
  });
}

export async function getRows(table) {
  assertTable(table);
  return read([table], (tx) => getAllFrom(tx.objectStore(table)));
}

/** Upsert. En tom lista rör inte databasen alls. */
export async function putRows(table, rows) {
  assertTable(table);
  const list = asArray(rows, 'rows');
  if (list.length === 0) return;

  const db = await openDb();
  await transact(db, [table], 'readwrite', (tx) => {
    const store = tx.objectStore(table);
    for (const row of list) {
      if (!row || typeof row !== 'object' || !row.id) {
        throw invalid(`Rad utan id kan inte sparas i ${table}`);
      }
      store.put(row);
    }
  });
}

/**
 * Hård radering lokalt. Mjuk radering (deleted_at) hör hemma på servern, där
 * den behövs för att en radering ska nå andra enheter; lokalt är raden redan
 * borta ur användarens värld och behöver inte ligga kvar.
 */
export async function deleteRows(table, ids) {
  assertTable(table);
  const list = asArray(ids, 'ids');
  if (list.length === 0) return;

  const db = await openDb();
  await transact(db, [table], 'readwrite', (tx) => {
    const store = tx.objectStore(table);
    for (const id of list) store.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Utkorg
// ---------------------------------------------------------------------------

function normalizeMutation(mutation) {
  if (!mutation || typeof mutation !== 'object') throw invalid('Mutationen måste vara ett objekt');

  const { table, op } = mutation;
  assertTable(table);
  if (op !== OP_UPSERT && op !== OP_DELETE) {
    throw invalid(`Okänd operation: ${String(op)}`);
  }

  const id = mutation.id ?? mutation.row?.id;
  if (typeof id !== 'string' || id === '') throw invalid('Mutationen saknar id');

  if (op === OP_DELETE) return { table, op, id, row: null };
  if (!mutation.row || typeof mutation.row !== 'object') {
    throw invalid(`Upsert av ${id} saknar rad`);
  }
  // id:t är facit. Skulle raden bära ett annat id vore köposten och den lokala
  // raden två olika saker, och en ack skulle kvittera fel rad.
  return { table, op, id, row: { ...mutation.row, id } };
}

/**
 * Skriver mutationerna lokalt och köar dem för uppladdning — i EN transaktion.
 *
 * Det är hela poängen med utkorgen. Skulle raden och köposten skrivas var för
 * sig kan appen krascha emellan, och då finns ändringen på enheten men når
 * aldrig servern: den försvinner tyst nästa gång användaren loggar in någon
 * annanstans. Antingen båda eller ingen.
 *
 * @param {{table:string, op:'upsert'|'delete', id?:string, row?:object}[]} mutations
 * @returns {Promise<number[]>} tilldelade seq-nummer, i samma ordning
 */
export async function enqueue(mutations) {
  const list = asArray(mutations, 'mutations').map(normalizeMutation);
  if (list.length === 0) return [];

  const stores = new Set([OUTBOX]);
  for (const mutation of list) stores.add(mutation.table);

  const db = await openDb();
  return transact(db, [...stores], 'readwrite', (tx) => {
    const outbox = tx.objectStore(OUTBOX);
    const seqs = [];
    const queuedAt = Date.now();

    for (const mutation of list) {
      const store = tx.objectStore(mutation.table);
      if (mutation.op === OP_UPSERT) store.put(mutation.row);
      else store.delete(mutation.id);

      const request = outbox.add({
        table: mutation.table,
        op: mutation.op,
        id: mutation.id,
        row: mutation.row,
        queued_at: queuedAt,
      });
      // add-förfrågningar avslutas i den ordning de skickades, så seqs hamnar
      // i samma ordning som mutationerna kom in.
      request.onsuccess = () => seqs.push(request.result);
    }

    return () => seqs;
  });
}

/** Äldsta först: seq är löpnummer, och getAll ger nyckelordning. */
export async function getOutbox(limit = DEFAULT_BATCH) {
  return read([OUTBOX], (tx) => getAllFrom(tx.objectStore(OUTBOX), limit));
}

/** Kvitterar utförda köposter. Poster som inte nämns lämnas kvar. */
export async function ackOutbox(seqs) {
  const list = asArray(seqs, 'seqs');
  if (list.length === 0) return;

  const db = await openDb();
  await transact(db, [OUTBOX], 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX);
    for (const seq of list) store.delete(seq);
  });
}

export async function outboxSize() {
  return read([OUTBOX], (tx) => {
    const box = { count: 0 };
    const request = tx.objectStore(OUTBOX).count();
    request.onsuccess = () => {
      box.count = request.result ?? 0;
    };
    return () => box.count;
  });
}

// ---------------------------------------------------------------------------
// Repetitionslogg
// ---------------------------------------------------------------------------

const UUID_TEMPLATE = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
const NIBBLE_MASK = 0xf;
const UUID_VARIANT_MASK = 0x3;
const UUID_VARIANT_BITS = 0x8;

function randomNibble() {
  if (typeof crypto !== 'undefined' && crypto?.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(1))[0] & NIBBLE_MASK;
  }
  return Math.floor(Math.random() * (NIBBLE_MASK + 1));
}

/**
 * Id:t måste ha uuid-form eftersom reviews.id är en uuid-kolumn på servern.
 * randomUUID saknas på osäkra ursprung (http) och i äldre webbläsare, därav
 * reservvägen.
 */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto?.randomUUID) return crypto.randomUUID();
  return UUID_TEMPLATE.replace(/[xy]/g, (char) => {
    const nibble = randomNibble();
    const value = char === 'x' ? nibble : (nibble & UUID_VARIANT_MASK) | UUID_VARIANT_BITS;
    return value.toString(16);
  });
}

/**
 * Lägger till repetitionsrader. Loggen är append-only och ändras aldrig: en
 * rad som saknar id eller tidpunkt får dem här, eftersom en rad utan
 * tidpunkt skulle falla ur indexet och därmed aldrig laddas upp.
 *
 * @returns {Promise<string[]>} id:na som raderna fick
 */
export async function appendReviews(rows) {
  const list = asArray(rows, 'rows');
  if (list.length === 0) return [];

  const stamped = list.map((row) => {
    if (!row || typeof row !== 'object') throw invalid('Repetitionsraden måste vara ett objekt');
    return {
      ...row,
      id: typeof row.id === 'string' && row.id !== '' ? row.id : uuid(),
      reviewed_at: row.reviewed_at ?? new Date().toISOString(),
      pending: 1,
    };
  });

  const db = await openDb();
  await transact(db, [REVIEWS], 'readwrite', (tx) => {
    const store = tx.objectStore(REVIEWS);
    for (const row of stamped) store.put(row);
  });

  return stamped.map((row) => row.id);
}

/**
 * Rader som ännu inte laddats upp, äldsta först. Alla rader i lagret väntar
 * per definition på uppladdning — kvitterade rader tas bort av ackReviews.
 */
export async function getPendingReviews(limit = DEFAULT_BATCH) {
  const range = IDBKeyRange.bound([1, ''], [1, '\uffff']);
  return read([REVIEWS], (tx) =>
    getAllFrom(tx.objectStore(REVIEWS).index('pending_time'), limit, range)
  );
}

/**
 * Hela repetitionsloggen från och med en tidpunkt, aven de rader som redan
 * laddats upp.
 *
 * Loggen raderas aldrig lokalt: den ar underlaget for streak, heatmap och
 * rekord, och de siffrorna ska kunna visas aven utan natet. En rad ar nagra
 * tiotal byte, sa tiotusen repetitioner tar under en megabyte.
 */
export async function getReviewsSince(sinceIso = '') {
  const range = sinceIso ? IDBKeyRange.lowerBound(sinceIso) : undefined;
  return read([REVIEWS], (tx) =>
    getAllFrom(tx.objectStore(REVIEWS).index('reviewed_at'), Infinity, range)
  );
}

/**
 * Markerar rader som uppladdade. De tas medvetet INTE bort: loggen ar
 * underlaget for all statistik och maste finnas kvar aven offline.
 */
export async function ackReviews(ids) {
  const list = asArray(ids, 'ids');
  if (list.length === 0) return;

  const db = await openDb();
  await transact(db, [REVIEWS], 'readwrite', (tx) => {
    const store = tx.objectStore(REVIEWS);
    for (const id of list) {
      const request = store.get(id);
      request.onsuccess = () => {
        const row = request.result;
        if (row) store.put({ ...row, pending: 0 });
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** Returnerar `fallback` bara när nyckeln saknas — lagrat 0, '' och false överlever. */
export async function getMeta(key, fallback = undefined) {
  return read([META], (tx) => {
    const box = { value: fallback };
    const request = tx.objectStore(META).get(key);
    request.onsuccess = () => {
      box.value = request.result === undefined ? fallback : request.result.value;
    };
    return () => box.value;
  });
}

export async function setMeta(key, value) {
  const db = await openDb();
  await transact(db, [META], 'readwrite', (tx) => {
    tx.objectStore(META).put({ key, value });
  });
}

// ---------------------------------------------------------------------------
// Utloggning
// ---------------------------------------------------------------------------

/**
 * Tömmer allt. Används vid utloggning: nästa användare på samma enhet får
 * aldrig se spår av den förra. Ett enda svep i en transaktion, så att inget
 * halvtömt tillstånd kan bli kvar om något går fel på vägen.
 */
export async function clearAll() {
  const db = await openDb();
  const names = STORES.map((spec) => spec.name);
  await transact(db, names, 'readwrite', (tx) => {
    for (const name of names) tx.objectStore(name).clear();
  });
}
