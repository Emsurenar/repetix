/* Fokus som inte drar upp tangentbordet.
 *
 * Varje dialog med ett fält ställde markören i fältet så fort den öppnades.
 * Med tangentbord är det en artighet: man kan börja skriva direkt. På en
 * telefon är det tvärtom — fokus i ett fält ÄR att tangentbordet kommer upp,
 * och då knuffas dialogen man just öppnat upp över det innan man hunnit läsa
 * vad den frågar om. Ägaren såg det i dagboken och sade att det inte får ske
 * någonstans.
 *
 * Skillnaden görs på pekaren, inte på skärmbredden: en surfplatta med
 * tangentbord ska bete sig som en dator, och en smal telefon med mus finns
 * inte. Samma mediefråga som styr kontrollhöjden i tokens.css.
 */

/** Sant när den primära pekaren är ett finger. */
export const pekskarm = () => window.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * Fokuserar ett fält — men bara där det inte öppnar ett tangentbord.
 *
 * @param {HTMLElement|null|undefined} el
 * @param {{valj?: boolean}} [alternativ] `valj` markerar fältets text, så att
 *   man kan skriva över ett befintligt namn direkt.
 * @returns {boolean} sant om fältet fick fokus
 */
export function fokusera(el, { valj = false } = {}) {
  if (!el || pekskarm()) return false;
  el.focus();
  if (valj && typeof el.select === 'function') el.select();
  return true;
}
