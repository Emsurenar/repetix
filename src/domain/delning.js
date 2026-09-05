// Delade kortlekar: ögonblicksbilden som skickas, och kopian som tas emot.
//
// Rena funktioner utan DOM, nätverk eller tillstånd. Allt som rör Supabase
// ligger i core/delning.js; här bestäms vad en delning INNEHÅLLER, vad som
// får tas emot, och hur den blir en kortlek i mottagarens bibliotek.
//
// Två regler bär säkerheten:
//
//   Nyttolasten litas aldrig på. Den skrevs av en annan användares webbläsare
//   och kan vara vad som helst — ett handbyggt anrop mot databasen, en
//   manipulerad klient. validera() prövar varje fält mot form och tak innan
//   något av det får bli en rad i mottagarens bibliotek.
//
//   Inga id följer med. Varje kort, mapp och kortlek får ett nytt id hos
//   mottagaren. Id är primärnyckel ENSAMT i molnet, i en namnrymd delad av
//   alla konton: ett id ur nyttolasten som råkade — eller avsåg — sammanfalla
//   med en rad mottagaren redan äger hade skrivit över den.

import { TECKENTAK } from './kalltext.js';

export const NYTTOLAST_VERSION = 1;

/** Första mappnivån i hinken för det som väntar på en mottagare. */
export const STAGING_PREFIX = 'delningar';

/**
 * Vad som delas: en hel kortlek, en mapp ur en, eller ett enda kort. Samma
 * ögonblicksbild i alla tre fallen — en lek med mappar och kort — sorten
 * säger bara vad mottagaren erbjuds att göra med den: en kortlek blir en
 * ny kortlek, en mapp och ett kort läggs i en av mottagarens egna.
 */
export const SORTER = new Set(['deck', 'section', 'card']);

/** Värdet som betyder "en ny kortlek" när mottagaren väljer var det ska in. */
export const NY_KORTLEK = '__ny__';

/**
 * Taken. Samma tal som check-villkoren i migration 0010 där de finns där.
 *
 * `text` gäller ett enskilt fält på ett kort. Tjugo tusen tecken är sju
 * A4-sidor — ett långformatskort med kodexempel ryms med marginal, medan en
 * nyttolast som försöker bära en hel bok i ett svar stoppas.
 */
export const TAK = Object.freeze({
  kort: 5000,
  mappar: 500,
  bilder: 500,
  bilderPerKort: 20,
  kallor: 50,
  text: 20_000,
  titel: 200,
  kalltext: TECKENTAK,
});

/** Filändelser som hinken tar emot, enligt migration 0004. */
const ANDELSER = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif']);

const MIME_TILL_ANDELSE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Filnamnet i väntområdet: ett löpnummer och en ändelse, inget annat. */
const FILNAMN = /^[0-9]{1,4}\.(jpg|jpeg|png|webp|gif|avif|heic|heif)$/;

const str = (v) => (typeof v === 'string' ? v : '');
const trimmad = (v, max) => str(v).trim().slice(0, max);

/**
 * Sökvägen i hinken för en fil som väntar på mottagaren.
 *
 * @param {string} delningsId
 * @param {string} filnamn
 */
export const stagingVag = (delningsId, filnamn) => `${STAGING_PREFIX}/${delningsId}/${filnamn}`;

/**
 * Ändelsen för en bildpost: ur sökvägens ändelse, eller ur en data-URL:s typ.
 * Null när posten inte går att tolka som en bild hinken tar emot.
 *
 * @param {string} post storage_path eller data-URL
 * @returns {string|null}
 */
export function bildandelse(post) {
  const s = str(post);
  if (s.startsWith('data:')) {
    const mime = s.slice(5, s.indexOf(';') > 0 ? s.indexOf(';') : s.indexOf(',')).toLowerCase();
    return MIME_TILL_ANDELSE[mime] ?? null;
  }
  const traff = /\.([a-z0-9]{2,5})$/i.exec(s);
  const andelse = traff ? traff[1].toLowerCase() : null;
  return andelse && ANDELSER.has(andelse) ? andelse : null;
}

/**
 * Kortets titel när det delas ensamt: framsidan utan markdown, kapad. Det
 * är vad inkorgen visar och vad en ny kortlek döps till om mottagaren inte
 * lägger kortet i en befintlig.
 *
 * @param {object} card
 */
export function kortTitel(card) {
  const t = str(card?.front)
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (t.length > 80 ? `${t.slice(0, 79)}…` : t) || 'Kort';
}

/**
 * En mapp som en delbar lek: mappens titel, inga mappar, mappens kort utan
 * mapp-pekare. byggNyttolast tar den som vilken lek som helst.
 *
 * @param {object} deck
 * @param {{id: string, title: string}} section
 */
export function delbarMapp(deck, section) {
  return {
    id: deck?.id,
    title: trimmad(section?.title, TAK.titel) || 'Mapp',
    sections: [],
    cards: (deck?.cards ?? [])
      .filter((c) => c && c.sectionId === section?.id)
      .map((c) => ({ ...c, sectionId: null })),
  };
}

/**
 * Ett kort som en delbar lek.
 *
 * @param {object} deck
 * @param {object} card
 */
export function delbartKort(deck, card) {
  return {
    id: deck?.id,
    title: kortTitel(card),
    sections: [],
    cards: card ? [{ ...card, sectionId: null }] : [],
  };
}

/**
 * Bygger nyttolasten för en kortlek.
 *
 * Bilderna ersätts av filnamn i väntområdet: nyttolasten bär aldrig bytes,
 * och aldrig avsändarens egna sökvägar — de säger vem avsändaren är och går
 * ändå inte att läsa för mottagaren. Vilken fil som ska kopieras vart står i
 * `bilder`, som core/delning.js utför.
 *
 * Kortens repetitionsläge följer inte med: kopian är mottagarens att lära
 * sig, och ett intervall på fyrtio dagar hos avsändaren säger ingenting om
 * vad mottagaren kan.
 *
 * @param {object} deck
 * @param {{kallor?: Array<{title: string, pages?: number, chars?: number, text: string}>, kind?: string}} [alternativ]
 * @returns {{ok: true, nyttolast: object, bilder: Array<{fran: string, filnamn: string}>}
 *   | {ok: false, fel: string}}
 */
export function byggNyttolast(deck, { kallor = [], kind = 'deck' } = {}) {
  const kort = (deck?.cards ?? []).filter((c) => c && typeof c === 'object');
  if (kort.length > TAK.kort) return { ok: false, fel: `En delning kan bära högst ${TAK.kort} kort.` };
  const mappar = deck?.sections ?? [];
  if (mappar.length > TAK.mappar) return { ok: false, fel: `En delning kan bära högst ${TAK.mappar} mappar.` };
  if (kallor.length > TAK.kallor) return { ok: false, fel: `En delning kan bära högst ${TAK.kallor} källor.` };

  const mappId = new Set(mappar.map((s) => s.id));
  const bilder = [];

  const cards = kort.map((c) => {
    const sectionId = c.sectionId && mappId.has(c.sectionId) ? c.sectionId : null;
    if (c.type === 'note') {
      return { type: 'note', content: trimmad(c.content, TAK.text), sectionId };
    }
    const images = [];
    for (const post of Array.isArray(c.backImages) ? c.backImages : []) {
      const andelse = bildandelse(post);
      // En bild utan tydbar typ eller över taket lämnas: kortet kommer fram
      // utan den, vilket delningsrutan säger i förväg.
      if (!andelse || bilder.length >= TAK.bilder || images.length >= TAK.bilderPerKort) continue;
      const filnamn = `${bilder.length}.${andelse}`;
      bilder.push({ fran: post, filnamn });
      images.push(filnamn);
    }
    const rad = {
      type: 'card',
      front: trimmad(c.front, TAK.text),
      back: trimmad(c.back, TAK.text),
      isLongForm: Boolean(c.isLongForm),
      sectionId,
      images,
    };
    if (str(c.description).trim()) rad.description = trimmad(c.description, TAK.text);
    return rad;
  });

  const nyttolast = {
    version: NYTTOLAST_VERSION,
    kind: SORTER.has(kind) ? kind : 'deck',
    title: trimmad(deck?.title, TAK.titel) || 'Kortlek',
    sections: mappar.map((s) => ({ id: str(s.id), title: trimmad(s.title, TAK.titel) })),
    cards,
    sources: kallor.map((k) => ({
      title: trimmad(k.title, TAK.titel) || 'Källa',
      pages: Number.isInteger(k.pages) ? k.pages : 0,
      chars: Number.isInteger(k.chars) ? k.chars : str(k.text).length,
      text: str(k.text).slice(0, TAK.kalltext),
    })),
  };

  return { ok: true, nyttolast, bilder };
}

const misslyckas = (fel) => ({ ok: false, fel });

/**
 * Prövar en mottagen nyttolast mot form och tak.
 *
 * Returnerar en normaliserad kopia: bara de fält som finns i formatet, i de
 * typer som väntas, kapade vid taken. Allt annat i objektet — okända fält,
 * id:n på kort, funktioner i en manipulerad klient — faller bort här.
 *
 * @param {unknown} nyttolast
 * @returns {{ok: true, varde: object} | {ok: false, fel: string}}
 */
export function validera(nyttolast) {
  if (!nyttolast || typeof nyttolast !== 'object' || Array.isArray(nyttolast)) {
    return misslyckas('Delningen saknar innehåll.');
  }
  if (nyttolast.version !== NYTTOLAST_VERSION) {
    return misslyckas('Delningen är skriven i ett format den här versionen av appen inte känner till.');
  }

  const title = trimmad(nyttolast.title, TAK.titel);
  if (!title) return misslyckas('Delningen saknar namn.');
  // Sorten saknas i laster från före 0011; de är hela kortlekar.
  const kind = SORTER.has(nyttolast.kind) ? nyttolast.kind : 'deck';

  const sections = nyttolast.sections;
  if (!Array.isArray(sections) || sections.length > TAK.mappar) {
    return misslyckas('Delningens mappar går inte att läsa.');
  }
  const mappId = new Set();
  const mappar = [];
  for (const s of sections) {
    const id = trimmad(s?.id, 100);
    const t = trimmad(s?.title, TAK.titel);
    if (!id || !t || mappId.has(id)) return misslyckas('Delningens mappar går inte att läsa.');
    mappId.add(id);
    mappar.push({ id, title: t });
  }

  const cards = nyttolast.cards;
  if (!Array.isArray(cards) || cards.length > TAK.kort) {
    return misslyckas('Delningens kort går inte att läsa.');
  }
  let antalBilder = 0;
  const kort = [];
  for (const c of cards) {
    if (!c || typeof c !== 'object') return misslyckas('Delningens kort går inte att läsa.');
    const sectionId = c.sectionId == null ? null : str(c.sectionId);
    if (sectionId !== null && !mappId.has(sectionId)) {
      return misslyckas('Ett kort pekar på en mapp som inte finns i delningen.');
    }
    if (c.type === 'note') {
      kort.push({ type: 'note', content: trimmad(c.content, TAK.text), sectionId });
      continue;
    }
    if (c.type !== 'card') return misslyckas('Delningen innehåller något som inte är ett kort.');
    const images = [];
    for (const namn of Array.isArray(c.images) ? c.images : []) {
      if (typeof namn !== 'string' || !FILNAMN.test(namn)) {
        return misslyckas('En bild i delningen har ett otillåtet namn.');
      }
      if (images.length >= TAK.bilderPerKort || antalBilder >= TAK.bilder) break;
      images.push(namn);
      antalBilder += 1;
    }
    const rad = {
      type: 'card',
      front: trimmad(c.front, TAK.text),
      back: trimmad(c.back, TAK.text),
      isLongForm: Boolean(c.isLongForm),
      sectionId,
      images,
    };
    if (str(c.description).trim()) rad.description = trimmad(c.description, TAK.text);
    kort.push(rad);
  }

  const sources = nyttolast.sources ?? [];
  if (!Array.isArray(sources) || sources.length > TAK.kallor) {
    return misslyckas('Delningens källor går inte att läsa.');
  }
  const kallor = [];
  for (const k of sources) {
    if (!k || typeof k !== 'object' || typeof k.text !== 'string') {
      return misslyckas('Delningens källor går inte att läsa.');
    }
    const text = k.text.slice(0, TAK.kalltext);
    kallor.push({
      title: trimmad(k.title, TAK.titel) || 'Källa',
      pages: Number.isInteger(k.pages) && k.pages >= 0 ? Math.min(k.pages, 100_000) : 0,
      chars: text.length,
      text,
    });
  }

  return {
    ok: true,
    varde: { version: NYTTOLAST_VERSION, kind, title, sections: mappar, cards: kort, sources: kallor },
  };
}

/**
 * Nyckeltalen för en inkorgsrad. Räknas ur nyttolasten hos avsändaren och
 * skrivs som kolumner, så att inkorgen kan visa dem utan att hämta lasten.
 *
 * @param {object} nyttolast
 */
export function sammanfatta(nyttolast) {
  const cards = nyttolast?.cards ?? [];
  return {
    kort: cards.filter((c) => c.type !== 'note').length,
    anteckningar: cards.filter((c) => c.type === 'note').length,
    mappar: (nyttolast?.sections ?? []).length,
    bilder: cards.reduce((s, c) => s + (c.images?.length ?? 0), 0),
    kallor: (nyttolast?.sources ?? []).length,
  };
}

/**
 * Gör en validerad nyttolast till en kortlek med färska id:n.
 *
 * Bilderna kopieras av anroparen: `bilder` säger vilken fil i väntområdet som
 * hör till vilket kort, och kortets backImages står tomt tills kopian finns.
 * Så blir ett kort aldrig sparat med en sökväg som inte går att läsa.
 *
 * @param {object} varde det validera() gav
 * @param {{nyttId: () => string, kortId: () => string, nu: number}} verktyg
 *   id-fabrikerna kommer utifrån: en ren funktion som slumpar id:n går inte
 *   att pröva, och kortens id har en egen form som spelhallen läser.
 * @returns {{deck: object, bilder: Array<{kortId: string, filnamn: string}>, kallor: object[]}}
 */
export function packaUpp(varde, { nyttId, kortId, nu }) {
  const mappId = new Map();
  const sections = varde.sections.map((s) => {
    const id = nyttId();
    mappId.set(s.id, id);
    return { id, title: s.title };
  });

  const bilder = [];
  const cards = varde.cards.map((c) => {
    const sectionId = c.sectionId ? (mappId.get(c.sectionId) ?? null) : null;
    const id = kortId();
    if (c.type === 'note') return { id, type: 'note', content: c.content, sectionId };
    for (const filnamn of c.images) bilder.push({ kortId: id, filnamn });
    const kort = {
      id,
      front: c.front,
      back: c.back,
      isLongForm: c.isLongForm,
      backImages: [],
      sectionId,
      repetition: 0,
      interval: 0,
      easeFactor: 2.5,
      nextReviewDate: nu,
    };
    if (c.description) kort.description = c.description;
    return kort;
  });

  return {
    deck: { id: nyttId(), title: varde.title, bookshelfId: null, sections, cards },
    bilder,
    kallor: varde.sources.map((k) => ({ ...k })),
  };
}

/**
 * Lägger en uppackad mapp eller ett uppackat kort i en av mottagarens egna
 * kortlekar. En mapp blir en ny mapp med lastens titel och sina kort; ett
 * kort läggs löst i leken. Kortens id är redan färska, från packaUpp.
 *
 * @param {{title: string, cards: object[]}} packad det packaUpp gav
 * @param {object} mal mottagarens kortlek, muteras
 * @param {{nyttId: () => string, kind: string}} verktyg
 * @returns {{deck: object, sectionId: string|null}}
 */
export function infogaIKortlek(packad, mal, { nyttId, kind }) {
  // Listorna garanteras oavsett sort: resten av appen läser deck.sections
  // och deck.cards utan att fråga om de finns.
  if (!Array.isArray(mal.sections)) mal.sections = [];
  if (!Array.isArray(mal.cards)) mal.cards = [];
  let sectionId = null;
  if (kind === 'section') {
    const mapp = { id: nyttId(), title: packad.title };
    mal.sections.push(mapp);
    sectionId = mapp.id;
  }
  for (const c of packad.cards) mal.cards.push({ ...c, sectionId });
  return { deck: mal, sectionId };
}
