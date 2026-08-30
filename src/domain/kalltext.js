/* Källtexten som den ser ut efter utvinning ur en PDF.
 *
 * Ren funktion utan DOM: pdf.js ger en lista med sidor, och det som är värt att
 * pröva är vad som händer med dem — inte att biblioteket fungerar.
 */

/* Taket i tecken, ungefär 50 000 tokens.
 *
 * En hel kursbok spränger både kontextfönstret och plånboken. Gränsen sitter
 * här och inte i gränssnittet, så att den gäller oavsett vem som anropar. */
export const TECKENTAK = 200_000;

/**
 * Fogar ihop pdf.js sidor till en text.
 *
 * Tomma sidor hoppas över: omslag och avdelare ger tomma strängar, och en
 * blankrad per sådan hade gett en text som mest består av luft.
 *
 * @param {string[]} sidor
 * @returns {string}
 */
export function sammanfogaSidor(sidor) {
  return (sidor ?? [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Är texten för lång för att skickas? */
export function overTaket(text) {
  return String(text ?? '').length > TECKENTAK;
}
