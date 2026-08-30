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

import { S } from '../core/state.js';
import { hash, tilldelaBilder } from '../domain/wash-tilldelning.js';

const ANTAL_BILDER = 30;

/* De fasta panelerna, i den ordning de ska få sina bilder.
 *
 * De ingår i samma tilldelning som kortlekarna, eftersom "Dagens mapp" står i
 * biblioteket ovanför lekarna och de tre skapa-rutorna står bredvid varandra i
 * samma modal. Sist i listan med flit: kortlekarna är användarens innehåll och
 * får välja först.
 *
 * Spelhallens brickor står INTE här. Deras id:n ägs av playground.js, de visas
 * på en egen skärm, och de skulle äta åtta av trettio platser från lekarna för
 * att lösa en krock som ingen ser. De behåller sin rena hash. */
const FASTA_PANELER = [
    'dagens-mapp:tom',
    'skapa:kortlek',
    'skapa:block',
    'skapa:bokhylla',
];

/* Spelhallens brickor står åtta i bredd på samma skärm, så två likadana syns
 * direkt. De låg först utanför tilldelningen för att spara platser åt
 * kortlekarna — men åtta av trettio är ett pris värt att betala för att inga
 * två rutor i appen ska bära samma bild.
 *
 * Id:na står här och inte importeras, eftersom listan de kommer ur byggs inuti
 * renderPlayground() och alltså inte går att nå utifrån. Ett test läser
 * playground.js och ser till att de två inte glider isär. */
const SPELLAGEN = [
    'action',
    'lucktext',
    'fritext',
    'jeopardy',
    'dammiga',
    'suddendeath',
    'transportbandet',
    'dragkampen',
].map((id) => `spel:${id}`);

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

/* Tilldelningen räknas om när uppsättningen kortlekar ändrats, inte vid varje
 * panel som ritas. Nyckeln är listan själv: ändras den inte finns inget nytt
 * att räkna ut, och biblioteket ritar om sig ofta. */
let cachadNyckel = null;
let cachadTilldelning = new Map();

const tilldelning = () => {
    const deckIds = (S.appData?.decks ?? []).map((d) => d.id).filter(Boolean);
    const alla = [...deckIds, ...FASTA_PANELER, ...SPELLAGEN];
    const nyckel = alla.join('\u0000');

    if (nyckel !== cachadNyckel) {
        cachadNyckel = nyckel;
        cachadTilldelning = tilldelaBilder(alla, ANTAL_BILDER);
    }
    return cachadTilldelning;
};

/**
 * Bildens nummer, 1–30.
 *
 * Allt appen känner till hämtas ur tilldelningen, som ser hela mängden och
 * därför kan hålla panelerna isär. Faller något utanför — en lek som hunnit
 * raderas medan panelen ritas — används den rena hashen: en bild blir det,
 * den är bara inte garanterat unik.
 */
const bildnummer = (deckId) => {
    const nyckel = String(deckId);
    return tilldelning().get(nyckel) ?? (hash(nyckel) % ANTAL_BILDER) + 1;
};

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
