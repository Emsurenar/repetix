// Vad kortleksvyn ska visa.
//
// Vyn har två lägen: hela leken, och en enskild mapp. Skillnaden låg tidigare
// bara i rubriken — listan ritades ur deck.cards oavsett, så en öppnad mapp
// visade hela lekens innehåll under en rubrik som räknat bara mappens. Valet
// hör inte hemma i renderingen: det är ett beslut om vilken delmängd som är
// vyn, och det går att pröva utan webbläsare.

/**
 * Korten som hör till vyn.
 *
 * @param {{cards?: Array<{sectionId?: string|null}>}} deck
 * @param {string|null} [sectionId] mappen som är öppen, eller null för hela leken
 */
export function kortIVyn(deck, sectionId = null) {
  const cards = deck?.cards ?? [];
  if (!sectionId) return cards;
  return cards.filter((c) => c.sectionId === sectionId);
}

/**
 * Mapparna som ska ritas som rubriker i vyn.
 *
 * I leksvyn ingår ÄVEN tomma mappar. De är släppytor, och en mapp man inte ser
 * går inte att lägga ett kort i.
 *
 * En öppnad mapp som inte finns kvar ger tom lista i stället för hela leken.
 * Att falla tillbaka på allt hade gjort en raderad mapp till en vy som ser
 * riktig ut men visar något annat än den påstår.
 *
 * @param {{sections?: Array<{id: string}>}} deck
 * @param {string|null} [sectionId]
 */
export function sektionerIVyn(deck, sectionId = null) {
  const sections = deck?.sections ?? [];
  if (!sectionId) return sections;
  return sections.filter((s) => s.id === sectionId);
}
