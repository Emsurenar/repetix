// Taket för ett AI-anrop, räknat så att det rymmer tänkandet.
//
// Varje anropsställe vet hur långt svaret ska bli, och satte länge maxTokens
// efter just det. Det höll så länge modellen skrev direkt. Opus 5 tänker som
// förval — en utelämnad `thinking` betyder adaptivt tänkande, till skillnad
// från Opus 4.8 där den betydde inget alls — och tänkandet debiteras som
// utdata ur samma tak. Ett tak satt efter texten räcker då inte till texten:
// modellen tänker upp budgeten, börjar skriva, och klipps mitt i meningen.
//
// Det upptäcktes först i kortlekssammanfattningen och togs då för ett fel i
// just den. Det var det inte. Samma sorts tak låg under svarsknappen,
// mappgissningen och fördjupningen, och kapade dem likadant — svarsknappen
// tystast av alla, eftersom den visar sin text utan att läsa avhuggningen.
// Regeln står därför här i stället för som ett påslag på varje ställe: nästa
// anropsställe ska ärva den utan att först göra om felet.
//
// Ingen leverantör slipper undan. Google och OpenAI resonerar också ur
// utdatabudgeten, och att låta taket bero på vem som råkar svara hade gjort
// samma bugg till något som bara dyker upp för vissa användare.

/**
 * Utrymme för modellens tänkande, utöver texten.
 *
 * Tilltaget med marginal, för ett oanvänt tak kostar ingenting — bara det som
 * faktiskt genereras debiteras. Ett för snålt tak kostar däremot hela anropet:
 * ett avhugget svar måste beställas om, och då betalas tänkandet två gånger.
 */
const TANKEUTRYMME = 900;

/**
 * @param {number} textTokens hur långt svaret självt ska få bli
 * @returns {number} tak som rymmer både texten och tänkandet
 */
export const medTankeutrymme = (textTokens) => textTokens + TANKEUTRYMME;
