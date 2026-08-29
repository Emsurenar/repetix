// Fördjupningen — kortets tredje fält, genererat.
//
// Modulen är ren och rör inget DOM, av samma skäl som domain/: prompten är den
// enda delen av funktionen som går att pröva utan webbläsare, och den är också
// den enda del som är värd att pröva.
//
// Fördjupningen är inte samma sak som förklaringen i card-ai.js. Förklaringen
// beställs mitt i en repetition, visas en gång och försvinner. Fördjupningen
// sparas PÅ kortet, står under svaret varje gång kortet dyker upp, och ingår
// aldrig i bedömningen. Skillnaden styr prompten: en förklaring får gärna
// säga om svaret med andra ord, medan en fördjupning som gör det ger kortet
// samma innehåll två gånger — en gång i fältet man ska kunna återkalla, en
// gång i fältet man läser efteråt.

/** Fältet är kort med flit. En fördjupning ingen orkar läsa är ingen alls. */
const MAX_TOKENS = 700;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Vad som fattas innan en fördjupning kan genereras.
 *
 * Ordningen är formulärets: frågan först, svaret sedan. Att peka ut det
 * understa tomma fältet när det översta också är tomt skickar användaren till
 * fel ställe.
 *
 * @param {{front?: string, back?: string}} kort
 * @returns {string|null} null när ingenting fattas
 */
export function saknasForFordjupning({ front, back }) {
  if (!text(front)) return 'Skriv en fråga på framsidan först.';
  if (!text(back)) return 'Skriv eller generera ett svar först.';
  return null;
}

/**
 * Bygger anropet. Anropas först när saknasForFordjupning gett null.
 *
 * @param {{front: string, back: string, deckContext?: string}} kort
 * @returns {{system: string, user: string, maxTokens: number}}
 */
export function fordjupningsPrompt({ front, back, deckContext = '' }) {
  const system = [
    'Du skriver fördjupningen till ett flashcard: den text som visas UNDER svaret,',
    'efter att eleven redan har svarat och sett facit. Eleven är vuxen och förväntar sig rigorositet.',
    '',
    'Du får inte upprepa svaret. Det står redan på kortet, och en fördjupning som säger om det',
    'ger kortet samma innehåll två gånger.',
    '',
    'Skriv i stället det som svaret inte hade plats för. Välj det som faktiskt hjälper här:',
    'varför det stämmer, vad det brukar förväxlas med, ett kort exempel, eller vad det hänger ihop med.',
    '',
    'Högst 150 ord. Markdown för struktur, LaTeX mellan dollartecken för all matematik.',
    'Hittar du inte på något som tillför utöver svaret, skriv exakt "Ingen fördjupning behövs".',
  ].join('\n');

  const user = `Fråga: ${text(front)}\nSvar: ${text(back)}${deckContext}`;

  return { system, user, maxTokens: MAX_TOKENS };
}
