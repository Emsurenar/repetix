/* Segmenterad kontroll: brickan glider.
 *
 * Tidigare släcktes det ena valet och tändes det andra. Det är två händelser
 * som råkar följa på varandra, och ögat får själv dra slutsatsen att det var
 * samma sak som flyttade sig. En bricka som glider säger i stället att valet
 * ÄR en position på en skala — att fem och tio ligger bredvid varandra, och
 * att man just gick från det ena till det andra.
 *
 * Rörelsen bryter inte sexpixelregeln i motion.css. Den regeln gäller det som
 * kommer in: en yta som reser sig för långt ser ut att flyga. Brickan kommer
 * inte in, den förflyttar sig, och en förflyttning som stannar efter sex
 * pixlar har inte flyttat sig alls.
 *
 * Modulen rör aldrig `.active` själv. Den lyssnar på klassen och räknar om
 * brickan, så att varje befintlig klickhanterare får glidningen utan att veta
 * om den. Det är också det som gör att ett val som sätts i kod — ett
 * återställt formulär, ett förvalt läge — flyttar brickan precis som ett
 * klick.
 */

const VALD = 'active';

/** Grupper som redan är kopplade. Init får köras om utan att dubbelkoppla. */
const kopplade = new WeakSet();

/**
 * Vilket segment som är valt.
 *
 * Två sätt att bära valet, båda befintliga i appen: en klass på knappen, och
 * en radioknapp inuti en etikett. Modulen läser båda i stället för att kräva
 * att den ena skrivs om till den andra — leverantörsväljaren ÄR en radiogrupp
 * och ska förbli det för hjälpmedel, medan antal och svårighetsgrad är
 * knappar.
 */
function valtSegment(grupp) {
  const medKlass = grupp.querySelector(`.${VALD}`);
  if (medKlass) return medKlass;

  // Radioknappen sitter inuti sin etikett. Brickan ska ligga under etiketten,
  // alltså under gruppens direkta barn — därför klättringen uppåt.
  let nod = grupp.querySelector('input:checked');
  while (nod && nod.parentElement !== grupp) nod = nod.parentElement;
  return nod;
}

/**
 * Flyttar brickan till det valda segmentet.
 *
 * Måtten sätts som variabler i stället för som `left`/`width` direkt, så att
 * stilmallen äger utseendet och den här filen bara äger positionen.
 */
function flyttaBricka(grupp) {
  const vald = valtSegment(grupp);

  // Inget valt: brickan tas ur bruk hellre än att bli kvar på ett gammalt
  // segment och påstå ett val som inte finns.
  grupp.classList.toggle('has-thumb', Boolean(vald));
  if (!vald) return;

  /* Båda axlarna mäts, inte bara x. På telefon staplas grupperna på höjden
   * (mediefrågan i forms.css), och en bricka som bara kan flytta sig i sidled
   * hade stannat kvar på det första segmentet där.
   *
   * offsetLeft/offsetTop är relativa närmaste positionerade förälder, vilket
   * är gruppen själv. Alternativet — två getBoundingClientRect och en
   * subtraktion — hade gett samma tal och tvingat fram en extra layout. */
  grupp.style.setProperty('--seg-x', `${vald.offsetLeft}px`);
  grupp.style.setProperty('--seg-y', `${vald.offsetTop}px`);
  grupp.style.setProperty('--seg-w', `${vald.offsetWidth}px`);
  grupp.style.setProperty('--seg-h', `${vald.offsetHeight}px`);

  /* Första mätningen får inte animeras. En modal mäts först när den öppnas,
   * och utan det här hade brickan glidit in från vänsterkanten varje gång —
   * en rörelse som påstår att valet just ändrades när det bara visades. */
  if (!grupp.classList.contains('is-ready')) {
    // Tvingar fram en layout så att webbläsaren ser startvärdet innan
    // övergången slås på. Utan avläsningen slås båda ihop till en bildruta.
    void grupp.offsetWidth;
    grupp.classList.add('is-ready');
  }
}

/**
 * Speglar valet till hjälpmedel.
 *
 * Knapparna behåller sin roll som knappar: en radiogrupp kräver
 * piltangentsnavigering för att inte vara ett löfte som inte hålls, och det
 * är en större ändring än den här. aria-pressed är sant om ett knappval och
 * behöver ingenting utöver klassen.
 */
function speglaTillstand(grupp) {
  // Radiogrupper bär redan sitt tillstånd i sina egna knappar. Att lägga
  // aria-pressed ovanpå det hade sagt samma sak två gånger, med två ord.
  if (grupp.querySelector('input[type="radio"]')) return;
  for (const knapp of grupp.querySelectorAll('button')) {
    knapp.setAttribute('aria-pressed', String(knapp.classList.contains(VALD)));
  }
}

function uppdatera(grupp) {
  flyttaBricka(grupp);
  speglaTillstand(grupp);
}

/**
 * Kopplar en grupp.
 *
 * @param {Element} grupp elementet som håller segmenten
 */
export function initSegmentedGroup(grupp) {
  if (!grupp || kopplade.has(grupp)) return;
  kopplade.add(grupp);
  grupp.classList.add('segmented');

  /* Klassbytet kommer från någon annans klickhanterare. En observatör är det
   * enda som fångar alla vägar dit — klick, tangentbord, och kod som väljer åt
   * användaren — utan att varje sådant ställe måste hittas och ändras.
   *
   * childList är med för grupper som fylls i efterhand: leverantörsbrickorna
   * ritas av settings.js långt efter att den här modulen kopplat dem, och en
   * grupp som var tom vid mätningen har inget segment att lägga brickan på. */
  new MutationObserver(() => uppdatera(grupp)).observe(grupp, {
    attributes: true,
    attributeFilter: ['class', 'checked'],
    childList: true,
    subtree: true,
  });

  // Radioknappar byter tillstånd utan att röra en enda klass eller nod.
  grupp.addEventListener('change', () => uppdatera(grupp));

  /* Bredden ändras av mer än fönstret: mediefrågan för finger byter
   * kontrollhöjd, och en grupp som staplas på telefon byter riktning helt. */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => flyttaBricka(grupp)).observe(grupp);
  }

  /* Modalen är ett eget fall och får inte lita på ResizeObserver.
   *
   * En grupp i en stängd modal ligger i display:none och mäter noll. När
   * modalen öppnas ska brickan räknas om — men en observatör på ett element
   * som saknar ruta rapporterar noll en gång och hörs sedan inte av när rutan
   * dyker upp. Resultatet var en bricka som satt kvar på noll pixlar tills
   * användaren råkade byta val, alltså osynlig precis när den behövdes.
   *
   * Klassen på modalen är det appen faktiskt växlar, så det är den vi lyssnar
   * på. Då vet vi att rutan finns när vi mäter. */
  const modal = grupp.closest('.modal');
  if (modal) {
    new MutationObserver(() => {
      if (!modal.classList.contains('hidden')) flyttaBricka(grupp);
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  uppdatera(grupp);
}

/**
 * Kopplar alla segmenterade grupper som finns i dokumentet.
 *
 * Anropas en gång vid start. Grupperna ligger i markup som alltid finns —
 * modalerna byggs inte om, de visas och göms — så en engångskoppling räcker.
 */
export function initUiSegmented() {
  const grupper = document.querySelectorAll(
    '.toggle-button-group, .option-buttons-group, .provider-grid, [data-segmented]'
  );
  for (const grupp of grupper) initSegmentedGroup(grupp);
}
