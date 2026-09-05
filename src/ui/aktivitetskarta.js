// Aktivitetskartan som markup: veckokolumner med sju rutor, månadsnamn
// ovanför, idag som sista ruta.
//
// Bodde i Spelhallen; profilen ritar samma karta för någon annans dagar.
// Modulen rör inte DOM:en — den får dagsräkningarna och antalet veckor och
// ger tillbaka strängen — så att reglerna om veckostart, månadsnamn och
// framtida dagar går att pröva utan webbläsare. Hur många veckor som får
// plats mäter anroparen, som vet hur bred ytan är.

const MANADER = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const pad = (n) => String(n).padStart(2, '0');
const nyckel = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Cellerna, veckovis. Kolumnerna går måndag–söndag och den sista är den
 * vecka idag ligger i; dagarna efter idag märks som kommande.
 *
 * @param {Map<string, number>|Record<string, number>} dagsrakningar
 * @param {number} veckor
 * @param {Date} idag
 */
export function veckokolumner(dagsrakningar, veckor, idag) {
  const las = (k) =>
    dagsrakningar instanceof Map ? (dagsrakningar.get(k) ?? 0) : (dagsrakningar?.[k] ?? 0);
  const idagNyckel = nyckel(idag);
  const veckodag = idag.getDay(); // 0 = söndag
  const tillSondag = veckodag === 0 ? 0 : 7 - veckodag;
  // Mitt på dagen, så att en sommartidsväxling inte flyttar en dag.
  const sondag = new Date(idag.getFullYear(), idag.getMonth(), idag.getDate() + tillSondag, 12, 0, 0);
  const dagar = veckor * 7;
  const celler = [];
  for (let i = 0; i < dagar; i++) {
    const d = new Date(sondag.getTime());
    d.setDate(d.getDate() - (dagar - 1 - i));
    const k = nyckel(d);
    const kommande = k > idagNyckel;
    celler.push({ date: d, count: kommande ? 0 : Number(las(k)) || 0, kommande });
  }
  const kolumner = [];
  for (let i = 0; i < celler.length; i += 7) kolumner.push(celler.slice(i, i + 7));
  return kolumner;
}

/**
 * Månadsnamnen, ett per kolumn, tomt där månaden är samma som kolumnen
 * före. Kolumnen bär namnet på den månad den går in i: veckan som
 * innehåller en 1:a ÄR månadens första kolumn. Räknades namnet ur veckans
 * första dag fick den innevarande månaden inget namn förrän dess första
 * måndag passerat, och kartan såg ut att sluta i förrgår.
 *
 * @param {Array<Array<{date: Date}>>} kolumner
 */
export function manadsrad(kolumner) {
  const namn = (v) => MANADER[(v.find((c) => c.date.getDate() === 1) ?? v[0]).date.getMonth()];
  return kolumner.map((v, i) => (i === 0 || namn(v) !== namn(kolumner[i - 1]) ? namn(v) : ''));
}

/**
 * Fyra steg, inte en genomskinlighet per tal: en ruta ska gå att placera i
 * en skala med ögat, inte jämföras pixel mot pixel.
 */
export function heatNiva(count, max) {
  if (count <= 0) return '';
  const del = count / Math.max(1, max);
  if (del > 0.75) return ' is-4';
  if (del > 0.5) return ' is-3';
  if (del > 0.25) return ' is-2';
  return ' is-1';
}

/**
 * Hela kartan som markup, med samma klasser i Spelhallen och på profilen.
 *
 * @param {object} arg
 * @param {Map<string, number>|Record<string, number>} arg.dagsrakningar
 * @param {number} arg.veckor
 * @param {Date} [arg.idag]
 * @param {boolean} [arg.tona] lägg kolumnerna på plats en i taget (vybyte)
 * @returns {string}
 */
export function aktivitetskartaHtml({ dagsrakningar, veckor, idag = new Date(), tona = false }) {
  const kolumner = veckokolumner(dagsrakningar, veckor, idag);
  const max = Math.max(1, ...kolumner.flat().map((c) => c.count));
  const manader = manadsrad(kolumner);

  const cell = (c) => {
    /* Dagarna som återstår av veckan ritas inte — de såg ut som dagar utan
     * repetitioner. Platsen står kvar osynlig, eftersom kolumnen är veckans
     * sju rader: tas rutan bort glider resten av veckan uppåt. */
    if (c.kommande) return '<i class="heat-cell is-kommande" aria-hidden="true"></i>';
    const titel = `${c.date.getDate()}/${c.date.getMonth() + 1}: ${c.count} repetitioner`;
    return `<i class="heat-cell${heatNiva(c.count, max)}" title="${titel}"></i>`;
  };

  return `<div class="heat" style="--veckor:${kolumner.length}">
    <div class="heat-months">${manader.map((m) => `<span>${m}</span>`).join('')}</div>
    <div class="heat-grid">
        <div class="heat-days"><span>må</span><span></span><span>on</span><span></span><span>fr</span><span></span><span></span></div>
        <div class="heat-cols${tona ? ' is-entering' : ''}">
            ${kolumner.map((v, i) => `<div class="heat-col" style="--i:${i}">${v.map(cell).join('')}</div>`).join('')}
        </div>
    </div>
    <div class="heat-legend">
        <span>mindre</span>
        <i class="heat-cell"></i><i class="heat-cell is-1"></i><i class="heat-cell is-2"></i><i class="heat-cell is-3"></i><i class="heat-cell is-4"></i>
        <span>mer</span>
    </div>
</div>`;
}

/**
 * Så många veckor som får plats på en given bredd. Rutan är 19px plus 5px
 * mellanrum, och veckodagsetiketterna tar 26px.
 *
 * @param {number} bredd pixlar
 * @param {{min?: number, max?: number}} [granser]
 */
export function veckorSomFarPlats(bredd, { min = 12, max = 53 } = {}) {
  return Math.max(min, Math.min(max, Math.floor((bredd - 26) / 24) || min));
}
