/* Minnet mellan frågor om en källa.
 *
 * Tre turer, inte hela samtalet. Historiken skickas med varje anrop, så ett
 * obegränsat samtal blir dyrare för varje tur — den tionde frågan hade kostat
 * mer än den första utan att vara mer värd. Tre räcker för att "utveckla det
 * där" ska fungera.
 *
 * Ren funktion: historiken lever i minnet i vyn och sparas aldrig, men vad som
 * ryms i den är värt att pröva.
 */

export const TURER = 3;

/**
 * @param {{fraga: string, svar: string}[]} historik
 * @returns {{fraga: string, svar: string}[]} ny lista; den inskickade rörs inte
 */
export function laggTill(historik, fraga, svar) {
  return [...(historik ?? []), { fraga, svar }].slice(-TURER);
}
