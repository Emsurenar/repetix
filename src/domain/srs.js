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
    interval = repetition === 0 ? 0.5 : interval * 1.2;
    repetition += 1;
  } else if (rating === RATING.GOOD) {
    interval = repetition === 0 ? 1 : repetition === 1 ? 6 : interval * easeFactor;
    repetition += 1;
  } else if (rating === RATING.EASY) {
    easeFactor += 0.15;
    interval = repetition === 0 ? 4 : interval * easeFactor * 1.3;
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
