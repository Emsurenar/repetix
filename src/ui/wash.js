/* Kortlekens egen bakgrund.
 *
 * Varje kortlek får en bild ur en bas på trettio, och samma kortlek får alltid
 * samma — det är därför valet räknas fram ur lekens id och inte lottas. En
 * bakgrund som byter utseende mellan två besök är inte en identitet, den är
 * brus.
 *
 * Bilderna är fyrtio pixlar breda. Uppskalade till panelens bredd ÄR de
 * oskärpan: en gaussisk suddning av ett fotografi och en uppskalning av dess
 * miniatyr ger samma yta, och den senare väger ett par kilobyte i stället för
 * några hundra. Därför ligger de som filer och inte i bygget — panelen har en
 * mörk grundton under sig och ser hel ut även om bilden aldrig kommer fram.
 */

const ANTAL_BILDER = 30;

/* FNV-1a. Kortlekens id kan vara 'd1' eller en tidsstämpel på tretton
 * siffror; en hash som bara tittar på längden eller sista tecknet hade gett
 * samma bild till alla lekar som skapades samma sekund. */
const hash = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

export const washUrl = (deckId) => {
    if (!deckId) return null;
    const n = (hash(String(deckId)) % ANTAL_BILDER) + 1;
    return `wash/w${String(n).padStart(2, '0')}.jpg`;
};

/* Bilden sätts som egenskap på elementet, inte som en klass per bild. Trettio
 * klasser i stilmallen hade varit trettio ställen att glömma. */
export const applyWash = (el, deckId) => {
    if (!el) return;
    const url = washUrl(deckId);
    if (url) el.style.setProperty('--wash-photo', `url("${url}")`);
    else el.style.removeProperty('--wash-photo');
};
