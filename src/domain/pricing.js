// Prislista, i dollar per miljon tokens.
//
// Kostnad lagras aldrig — den räknas fram här, ur tokentalen i ai_usage. Det är
// samma delning som mellan repetitionsloggen och streaken: det som mätts sparas,
// det som härleds beräknas. Ändrar en leverantör sitt pris räknas historiken om
// i stället för att bli fel.
//
// Listan innehåller bara Anthropics modeller, eftersom det är de priser som
// gått att verifiera. Övriga leverantörer faller på regeln i kostnad(): tokental
// visas, kostnaden lämnas tom. En påhittad prislapp vore sämre än en ärlig lucka.

const PRISER = {
  'claude-opus-5': { in: 5, ut: 25 },
  'claude-opus-4-8': { in: 5, ut: 25 },
  'claude-sonnet-5': { in: 2, ut: 10 },
  'claude-haiku-4-5': { in: 1, ut: 5 },
  'claude-fable-5': { in: 10, ut: 50 },
};

// Cachade tokens prissätts ur input i stället för som egna tal. Skrevs de ut
// per modell vore det fyra tal att hålla i synk i stället för två, och den
// dagen ett pris ändras är det två av dem som glöms.
const CACHE_LAS = 0.1;
const CACHE_SKRIV = 1.25;

const MILJON = 1_000_000;

/** Finns ett pris för modellen? */
export function harPris(model) {
  return Object.hasOwn(PRISER, String(model));
}

/**
 * Vad ett anrop kostade, i dollar.
 *
 * @returns {number|null} null när modellen saknar pris — "vet inte", inte "gratis".
 */
export function kostnad({ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  const pris = PRISER[String(model)];
  if (!pris) return null;

  return (
    ((inputTokens ?? 0) * pris.in +
      (outputTokens ?? 0) * pris.ut +
      (cacheReadTokens ?? 0) * pris.in * CACHE_LAS +
      (cacheWriteTokens ?? 0) * pris.in * CACHE_SKRIV) /
    MILJON
  );
}
