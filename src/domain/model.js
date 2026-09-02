// Översättning mellan appens inbyggda datastruktur och databasens rader.
//
// Appen håller data som ett nästlat träd (`appData`): kortlekar innehåller
// mappar och kort, anteckningsblock innehåller anteckningar. Databasen håller
// samma data platt, en tabell per typ, eftersom synken behöver kunna skicka en
// enskild ändrad rad i stället för hela biblioteket.
//
// Rena funktioner utan DOM, nätverk eller tillstånd.

/** Tabellerna som synkas, i beroendeordning. Föräldrar före barn. */
export const TABLES = [
  'bookshelves',
  'decks',
  'sections',
  'notebooks',
  'cards',
  'notes',
  'card_images',
];

/** Base64-bilder som annu inte laddats upp. De far aldrig synkas. */
const arDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
/** Talet om det ar andligt, annars reservvardet. Skyddar mot NaN och Infinity. */
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const ms = (isoString) => (isoString ? Date.parse(isoString) : null);

// ---------------------------------------------------------------------------
// Träd -> platta rader
// ---------------------------------------------------------------------------

/**
 * Plattar ut appData till en rad per entitet.
 * Ordningen i arrayerna blir `position`, så att sortering överlever synken.
 *
 * @param {object} appData
 * @param {string} userId
 * @returns {{bookshelves:object[], decks:object[], sections:object[], cards:object[], notebooks:object[], notes:object[]}}
 */
export function flatten(appData, userId) {
  const out = {
    bookshelves: [],
    decks: [],
    sections: [],
    cards: [],
    notebooks: [],
    notes: [],
    card_images: [],
  };

  (appData.bookshelves ?? []).forEach((shelf, i) => {
    out.bookshelves.push({
      id: shelf.id,
      user_id: userId,
      title: shelf.title ?? '',
      color: shelf.color ?? null,
      position: i,
    });
  });

  (appData.decks ?? []).forEach((deck, i) => {
    out.decks.push({
      id: deck.id,
      user_id: userId,
      bookshelf_id: deck.bookshelfId ?? null,
      title: deck.title ?? '',
      color: deck.color ?? null,
      position: i,
    });

    (deck.sections ?? []).forEach((section, j) => {
      out.sections.push({
        id: section.id,
        user_id: userId,
        deck_id: deck.id,
        title: section.title ?? '',
        position: j,
      });
    });

    (deck.cards ?? []).forEach((card, j) => {
      out.cards.push(cardToRow(card, deck.id, userId, j));

      // Bilder synkas som sokvagar till lagringen, aldrig som bytes. En bild
      // som annu inte laddats upp ligger kvar som base64 lokalt och hoppas
      // over har — annars hade flera megabyte text skickats vid varje synk.
      (card.backImages ?? []).forEach((bild, k) => {
        if (arDataUrl(bild)) return;
        out.card_images.push({
          // Sokvagen ar redan unik och stabil, sa den duger som nyckel. Ett
          // lopnummer hade i stallet gett falska andringar sa fort bilderna
          // ordnades om.
          id: bild,
          user_id: userId,
          card_id: card.id,
          storage_path: bild,
          position: k,
        });
      });
    });
  });

  (appData.notebooks ?? []).forEach((nb, i) => {
    out.notebooks.push({
      id: nb.id,
      user_id: userId,
      bookshelf_id: nb.bookshelfId ?? null,
      title: nb.title ?? '',
      position: i,
    });

    (nb.notes ?? []).forEach((note, j) => {
      out.notes.push({
        id: note.id,
        user_id: userId,
        notebook_id: nb.id,
        content: note.content ?? '',
        position: j,
        // build() laser tillbaka detta. Utan kolumnen blev createdAt 0 efter
        // en rundtur genom molnet.
        created_at: iso(note.createdAt) ?? undefined,
      });
    });
  });

  return out;
}

/**
 * Ett kort som databasrad.
 *
 * Bilder ingår inte: de ligger som base64 i `backImages` och hanteras separat
 * av bilduppladdningen, eftersom en enda mobilbild annars skulle skickas som
 * flera megabyte text vid varje synk.
 *
 * Fält som `_jeopardy`, `originalDeckId` och `_sectionTitle` tas medvetet inte
 * med. De är transienta kopior från spellägena som läckt in i sparad data.
 */
export function cardToRow(card, deckId, userId, position = 0) {
  return {
    id: card.id,
    user_id: userId,
    deck_id: deckId,
    section_id: card.sectionId ?? null,
    type: card.type === 'note' ? 'note' : 'card',
    front: card.front ?? null,
    back: card.back ?? null,
    // Fordjupningen som visas efter svaret. Skild fran back eftersom svaret
    // ska vara det man kan aterkalla — ett svar som svaller gar inte att
    // prova sig sjalv pa.
    description: card.description ?? null,
    content: card.content ?? null,
    is_long_form: Boolean(card.isLongForm),
    position,
    // Number.isFinite, inte ??, eftersom NaN passerar ?? oskadd och sedan
    // serialiseras till null i JSON. Raden bryter da mot bade not null och
    // check (ease_factor >= 1.3), upserten misslyckas, och mutationen ligger
    // kvar i utkorgen och gors om vid varje synk — kon fastnar permanent.
    repetition: finite(card.repetition, 0),
    interval_days: finite(card.interval, 0),
    ease_factor: Math.max(1.3, finite(card.easeFactor, 2.5)),
    next_review_date: iso(card.nextReviewDate) ?? new Date(0).toISOString(),
    lapses: finite(card.lapses, 0),
    last_reviewed: iso(card.lastReviewed),
  };
}

// ---------------------------------------------------------------------------
// Platta rader -> träd
// ---------------------------------------------------------------------------

/** Databasrad tillbaka till appens kortobjekt. */
export function rowToCard(row) {
  const card = {
    id: row.id,
    sectionId: row.section_id ?? null,
  };
  if (row.type === 'note') {
    card.type = 'note';
    card.content = row.content ?? '';
    return card;
  }
  card.front = row.front ?? '';
  card.back = row.back ?? '';
  if (row.description) card.description = row.description;
  card.isLongForm = Boolean(row.is_long_form);
  card.backImages = [];
  card.repetition = row.repetition ?? 0;
  card.interval = row.interval_days ?? 0;
  card.easeFactor = row.ease_factor ?? 2.5;
  card.nextReviewDate = ms(row.next_review_date) ?? Date.now();
  card.lapses = row.lapses ?? 0;
  if (row.last_reviewed) card.lastReviewed = ms(row.last_reviewed);
  return card;
}

const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0);
const alive = (row) => !row.deleted_at;

/**
 * Bygger tillbaka appData ur platta rader. Raderade rader utelämnas, och
 * ordningen återställs från `position`.
 */
export function build(rows) {
  const bookshelves = (rows.bookshelves ?? []).filter(alive).sort(byPosition);
  const deckRows = (rows.decks ?? []).filter(alive).sort(byPosition);
  const sectionRows = (rows.sections ?? []).filter(alive).sort(byPosition);
  const cardRows = (rows.cards ?? []).filter(alive).sort(byPosition);
  const notebookRows = (rows.notebooks ?? []).filter(alive).sort(byPosition);
  const noteRows = (rows.notes ?? []).filter(alive).sort(byPosition);

  const imageRows = (rows.card_images ?? []).filter(alive).sort(byPosition);
  const imagesByCard = groupBy(imageRows, 'card_id');

  const sectionsByDeck = groupBy(sectionRows, 'deck_id');
  const cardsByDeck = groupBy(cardRows, 'deck_id');
  const notesByNotebook = groupBy(noteRows, 'notebook_id');

  // Mjuk radering utloser aldrig databasens "on delete set null", sa
  // referenser till raderade rader maste nollstallas har. Annars far ett kort
  // ett sectionId till en mapp som inte langre finns, och renderingen visar
  // det varken som rotkort eller under nagon mapp — kortet forsvinner ur
  // granssnittet trots att det ligger kvar och studeras. Samma sak en niva
  // upp: en kortlek som pekar pa en raderad bokhylla forsvinner helt.
  const levandeMappar = new Set(sectionRows.map((r) => r.id));
  const levandeHyllor = new Set(bookshelves.map((r) => r.id));
  for (const row of cardRows) {
    if (row.section_id && !levandeMappar.has(row.section_id)) row.section_id = null;
  }
  for (const row of [...deckRows, ...notebookRows]) {
    if (row.bookshelf_id && !levandeHyllor.has(row.bookshelf_id)) row.bookshelf_id = null;
  }

  return {
    bookshelves: bookshelves.map((r) => ({
      id: r.id,
      title: r.title,
      ...(r.color != null ? { color: r.color } : {}),
    })),
    decks: deckRows.map((r) => ({
      id: r.id,
      title: r.title,
      color: r.color ?? null,
      bookshelfId: r.bookshelf_id ?? null,
      sections: (sectionsByDeck.get(r.id) ?? []).map((s) => ({ id: s.id, title: s.title })),
      cards: (cardsByDeck.get(r.id) ?? []).map((rad) => {
        const kort = rowToCard(rad);
        if (kort.backImages) {
          kort.backImages = (imagesByCard.get(rad.id) ?? []).map((b) => b.storage_path);
        }
        return kort;
      }),
    })),
    notebooks: notebookRows.map((r) => ({
      id: r.id,
      title: r.title,
      bookshelfId: r.bookshelf_id ?? null,
      notes: (notesByNotebook.get(r.id) ?? []).map((n) => ({
        id: n.id,
        content: n.content ?? '',
        createdAt: ms(n.created_at) ?? 0,
      })),
    })),
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// En repetition som logg-rad
// ---------------------------------------------------------------------------

/**
 * Bygger raden som skrivs till den append-only loggen `reviews`.
 * `before` och `after` är SM-2-tillståndet före respektive efter betyget.
 */
export function reviewRow({ card, deckId, userId, rating, before, after, mode = 'study', at }) {
  return {
    user_id: userId,
    card_id: card.id,
    deck_id: deckId ?? null,
    rating,
    reviewed_at: new Date(at ?? Date.now()).toISOString(),
    interval_before: before?.interval ?? null,
    interval_after: after?.interval ?? null,
    ease_after: after?.easeFactor ?? null,
    mode,
  };
}

// ---------------------------------------------------------------------------
// Datatvätt
// ---------------------------------------------------------------------------

/**
 * Fält som spellägena hänger på sina kopior av korten. De hör inte hemma i
 * sparad data, men hamnade där ändå eftersom lägena arbetar på ytliga kopior
 * som sedan skrivs tillbaka rakt in i biblioteket.
 */
const TRANSIENT_FIELDS = ['_jeopardy', '_sectionTitle', 'originalDeckId'];

/** Ett kort utan spellägenas transienta fält. Returnerar ett nytt objekt. */
export function stripTransientFields(card) {
  const clean = { ...card };
  for (const field of TRANSIENT_FIELDS) delete clean[field];
  return clean;
}

// ---------------------------------------------------------------------------
// Fabriker
//
// Nya kort och anteckningar skapas har och inte i lagringslagret. Fabrikerna
// ar rena och bestammer vilka falt ett kort overhuvudtaget har — det ar
// domankunskap, och det ar det enda stallet dar regeln "tom fordjupning blir
// inget falt alls" kan provas utan en webblasare.
// ---------------------------------------------------------------------------

/**
 * Skapar ett kort.
 *
 * De fem forsta argumenten ar positionella av historiska skal. Nya falt
 * laggs i options-objektet i stallet — en sjatte, sjunde och attonde
 * positionell parameter hade gjort varje anropsstalle olasligt.
 *
 * @param {string} front
 * @param {string} back
 * @param {boolean} [isLongForm]
 * @param {string[]} [backImages]
 * @param {string|null} [sectionId]
 * @param {{description?: string}} [options] `description` ar fordjupningen som
 *   visas efter svaret. Den halls skild fran `back` eftersom svaret ar det man
 *   ska kunna aterkalla; ett svar som svaller gar inte att prova sig sjalv pa.
 */
/**
 * Id för ett kort. Tidsstämpel plus slump: spelhallen läser den inledande
 * stämpeln för att sortera fram de dammigaste korten, så formen är inte fri.
 * Kortlekar och mappar har uuid ur core/utils.js; se kommentaren där.
 */
export const nyttKortId = () => Date.now().toString() + Math.random().toString(36).substr(2, 5);

export const createCard = (
    front,
    back,
    isLongForm = false,
    backImages = [],
    sectionId = null,
    options = {}
) => {
    const card = {
        id: nyttKortId(),
        front,
        back,
        isLongForm,
        backImages: backImages || [],
        sectionId: sectionId || null,
        repetition: 0,
        interval: 0,
        easeFactor: 2.5,
        nextReviewDate: Date.now() // ready to review immediately
    };
    // Utelamnas nar den ar tom, sa att kort utan fordjupning inte barer ett
    // tomt falt genom bade lagring och synk.
    if (options.description?.trim()) card.description = options.description.trim();
    return card;
};

export const createNoteCard = (content, sectionId = null) => {
    return {
        id: nyttKortId(),
        type: 'note',
        content,
        sectionId: sectionId || null,
    };
};
