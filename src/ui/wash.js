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
 *
 * Just den reservutgången dolde ett fel i ett halvår: sökvägen var relativ
 * och gav 404 i produktion, men panelen såg ut som en panel — bara svart.
 * Se kommentaren vid washUrl.
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

/* Ljuslyft per bild.
 *
 * De trettio fotografierna är inte lika ljusa. Medelljuset spänner från 37
 * till 204 av 255, och de fyra mörkaste — w01, w02, w05, w29 — är så mörka i
 * källan att panelen blev en svart platta: skärmen ovanpå bilden lägger till
 * ytterligare mörker, och ett foto på 37 syns inte under den. Ingen justering
 * av filtret kunde rädda det, eftersom det inte fanns något ljus att dra fram.
 *
 * Talen är 125 delat med bildens uppmätta medelljus, aldrig under 1 (en bild
 * som redan fungerar rörs inte) och aldrig över 2,6. Taket är satt av ögat:
 * över det börjar färgbruset i en fyrtio pixlar bred miniatyr synas som
 * fläckar när den skalas upp.
 *
 * Mätt en gång med canvas över de faktiska filerna. Byts en bild ut måste dess
 * tal mätas om — därför står de i en enda lista och inte utspridda.
 */
const LYFT = [
    2.6, 2.6, 1.47, 1.56, 2.6, 1, 1.01, 1.74, 1, 1,
    1.15, 1, 1, 1, 1.06, 1, 1.09, 1, 1, 1,
    1, 1.84, 1.05, 1, 1, 1, 1, 1.79, 2.6, 1,
];

/** Bildens nummer, 1–30. Samma frö ger alltid samma bild. */
const bildnummer = (deckId) => (hash(String(deckId)) % ANTAL_BILDER) + 1;

/* Absolut sökväg, med ledande snedstreck.
 *
 * Den var relativ, och det gick inte att se under utveckling. En relativ
 * url() inuti en CSS-variabel löses mot basadressen för den STILMALL som
 * använder var() — inte mot dokumentet. Vite bakar in stilarna i sidan när
 * den servar källkoden, alltså bas '/', men bygget lägger dem i en fil under
 * /assets/. Exakt samma rad blev därför /wash/w13.jpg lokalt och
 * /assets/wash/w13.jpg i produktion, där den gav 404 och en helsvart panel.
 *
 * Appen serveras från roten (ingen base i vite.config.js), så det ledande
 * snedstrecket gäller i båda lägena. */
export const washUrl = (deckId) => {
    if (!deckId) return null;
    return `/wash/w${String(bildnummer(deckId)).padStart(2, '0')}.jpg`;
};

/* Bilden sätts som egenskap på elementet, inte som en klass per bild. Trettio
 * klasser i stilmallen hade varit trettio ställen att glömma. */
export const applyWash = (el, deckId) => {
    if (!el) return;
    if (!deckId) {
        el.style.removeProperty('--wash-photo');
        el.style.removeProperty('--wash-lift');
        return;
    }
    el.style.setProperty('--wash-photo', `url("${washUrl(deckId)}")`);
    el.style.setProperty('--wash-lift', String(LYFT[bildnummer(deckId) - 1]));
};

/* Samma två variabler som en sträng, för de ställen som bygger sitt element
 * med en mall i stället för att nå det som DOM — spelhallens brickor. Utan
 * den här hade de satt bilden men inte lyftet, och de fyra mörka bilderna
 * hade fortsatt vara svarta just där. */
export const washStyle = (deckId) => {
    if (!deckId) return '';
    return `--wash-photo:url('${washUrl(deckId)}');--wash-lift:${LYFT[bildnummer(deckId) - 1]}`;
};
