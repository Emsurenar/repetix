// Spaced repetition-schemaläggning. Rena funktioner utan DOM, tillstånd eller
// sidoeffekter, så att algoritmen går att testa och resonera om separat från
// gränssnittet. Varianten är SuperMemo-2 med fyra betygssteg.

/** Lägsta tillåtna ease factor. Under detta blir intervallen orimligt täta. */
export const MIN_EASE = 1.3;

/** Intervall i dagar från och med när ett kort räknas som mästrat. */
export const MASTERED_INTERVAL_DAYS = 21;

export const RATING = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hur mycket längre Lätt sträcker sig än Bra. */
const EASY_BONUS = 1.3;

/** Svårt växer, men långsammare än ease factor skulle ge. */
const HARD_FACTOR = 1.2;

/** Lätt på ett helt nytt kort hoppar direkt hit, förbi inlärningsstegen. */
const NEW_EASY_DAYS = 4;

/**
 * Golv för ett korrekt besvarat kort.
 *
 * Ett kort med repetition över noll men intervall noll är inkonsekvent data —
 * det kan bara uppstå ur en trasig import eller en gammal bugg. Utan golvet
 * ger multiplikationen noll för varje betyg, och ordningen mellan betygen
 * kollapsar just för de kort som redan är i dåligt skick.
 */
const MIN_HARD_DAYS = 0.5;
const MIN_GOOD_DAYS = 1;

/** Hoppet ett kort tar när det lämnar inlärningsfasen. */
const GRADUATING_DAYS = 6;

/**
 * Intervallet betyget Bra ger. Bruten ur `schedule` eftersom Lätt räknas som
 * detta gånger en bonus — det är så ordningen mellan betygen garanteras.
 *
 * Första gången ger 1 dag och andra gången ett hopp till 6, det klassiska
 * SM-2-mönstret. Därefter multipliceras föregående intervall med ease factor.
 *
 * De sex dagarna är ett golv, inte ett tak. Som fast värde tvingade de tillbaka
 * ett kort som redan hunnit längre — svarade man Lätt på ett nytt kort fick det
 * fyra dagar, och ett Bra därefter kortade ner det till sex i stället för att
 * följa kortets ease. Med golvet växer intervallet alltid monotont.
 */
function goodInterval(repetition, interval, easeFactor) {
  if (repetition === 0) return 1;
  const berakat = Math.max(interval * easeFactor, MIN_GOOD_DAYS);
  return repetition === 1 ? Math.max(GRADUATING_DAYS, berakat) : berakat;
}

/** Kort som betygsatts Igen visas igen efter en minut, inte efter en dag. */
const AGAIN_DELAY_MS = 60 * 1000;

/**
 * Startvärden för ett nytt kort. Används både när kort skapas och när gammal
 * data saknar fälten — utan detta blir easeFactor undefined och all vidare
 * räkning NaN.
 */
export function initialSchedule(now = Date.now()) {
  return { repetition: 0, interval: 0, easeFactor: 2.5, nextReviewDate: now };
}

/**
 * Fyller i saknade SM-2-fält på ett kort utan att röra de som finns.
 * Returnerar ett nytt objekt.
 */
export function withScheduleDefaults(card, now = Date.now()) {
  const d = initialSchedule(now);
  return {
    ...card,
    repetition: Number.isFinite(card.repetition) ? card.repetition : d.repetition,
    interval: Number.isFinite(card.interval) ? card.interval : d.interval,
    easeFactor: Number.isFinite(card.easeFactor) ? card.easeFactor : d.easeFactor,
    nextReviewDate: Number.isFinite(card.nextReviewDate) ? card.nextReviewDate : d.nextReviewDate,
  };
}

/**
 * Ett schemaläggningssteg. Tar nuvarande tillstånd och ett betyg, returnerar
 * det nya tillståndet. Muterar ingenting.
 *
 * @param {{repetition:number, interval:number, easeFactor:number}} state
 * @param {1|2|3|4} rating
 * @returns {{repetition:number, interval:number, easeFactor:number}}
 */
export function schedule(state, rating) {
  let { repetition, interval, easeFactor } = state;

  if (rating === RATING.AGAIN) {
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    repetition = 0;
    interval = 0;
  } else if (rating === RATING.HARD) {
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.15);
    interval = repetition === 0 ? 0.5 : Math.max(interval * HARD_FACTOR, MIN_HARD_DAYS);
    repetition += 1;
  } else if (rating === RATING.GOOD) {
    interval = goodInterval(repetition, interval, easeFactor);
    repetition += 1;
  } else if (rating === RATING.EASY) {
    // Lätt definieras utifrån Bra i stället för med en egen formel. Tidigare
    // räknades Lätt som interval * ease * 1.3, medan Bra vid andra
    // repetitionen hoppar till fasta 6 dagar — vid interval 1 gav det Lätt
    // 3,25 dagar mot Bras 6. Att svara att kortet var lätt straffade alltså
    // användaren. Med den här konstruktionen kan ordningen inte brytas för
    // något tillstånd, i stället för att råka stämma för vissa.
    interval =
      repetition === 0 ? NEW_EASY_DAYS : goodInterval(repetition, interval, easeFactor) * EASY_BONUS;
    easeFactor += 0.15;
    repetition += 1;
  }

  return { repetition, interval, easeFactor: Math.max(MIN_EASE, easeFactor) };
}

/**
 * När ska kortet visas igen efter ett betyg?
 * Igen ger en minut; övriga ger intervallet omräknat till millisekunder.
 */
export function nextReviewAt(nextState, rating, now = Date.now()) {
  return rating === RATING.AGAIN ? now + AGAIN_DELAY_MS : now + nextState.interval * DAY_MS;
}

/**
 * Intervallet som visas på betygsknapparna innan användaren väljer.
 *
 * OBS: detta speglar `schedule` exakt, till skillnad från den tidigare
 * förhandsvisningen som räknade `interval * ease` med den gamla ease-faktorn
 * och därför visade fel siffra för Svårt och Lätt — de betygen ändrar ju ease
 * i samma steg. Se tests/srs.test.js.
 */
export function previewInterval(state, rating) {
  return schedule(state, rating).interval;
}

/** Är kortet förfallet just nu? */
export function isDue(card, now = Date.now()) {
  return (card.nextReviewDate ?? 0) <= now;
}

/** Inlärningsstatus, används för statistiken i Spelhallen. */
export function maturity(card) {
  if (!card.repetition) return 'new';
  return card.interval >= MASTERED_INTERVAL_DAYS ? 'mastered' : 'learning';
}
