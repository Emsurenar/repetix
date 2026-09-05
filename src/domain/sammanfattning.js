// Kortlekens enmeningssammanfattning: när den gäller, och vad den bygger på.
//
// Meningen skrivs av modellen och kostar ett anrop, så den ska skrivas om när
// leken ändrats — inte vid varje öppning, och inte efter ett fast antal
// ändringar. Den förra regeln lät tre kort tillkomma innan sammanfattningen
// fick veta det, och ett byte av titel märktes aldrig. Här avgörs i stället
// vad "ändrats" betyder: en signatur av det meningen bygger på, så att samma
// innehåll alltid ger samma signatur och varje annat innehåll en ny.
//
// Allt här är rent och prövas utan webbläsare. Lagringen och anropet ligger i
// src/ui/sammanfattning.js respektive src/ai/deck-insights.js.

import { hash } from './wash-tilldelning.js';

/** Under det här finns inget att sammanfatta — två kort är två kort. */
export const MINSTA_ANTAL_KORT = 3;

/** Fler kort än så här skickas inte; meningen behöver ett urval, inte allt. */
const MAX_KORT_I_UNDERLAG = 80;

/** Längsta bit av en sida som tas med. Ett långformatssvar bär en hel essä. */
const MAX_TECKEN_PER_SIDA = 160;

/** Kort som ingår i underlaget: anteckningar är inte kort. */
const underlag = (deck) => (deck?.cards ?? []).filter((c) => c && c.type !== 'note');

/** Har leken tillräckligt att säga något om? */
export function kanSammanfattas(deck) {
  return underlag(deck).length >= MINSTA_ANTAL_KORT;
}

/**
 * Signaturen för det meningen bygger på: titeln, mapparna och varje korts
 * fram- och baksida i ordning. Ändras något av det ändras signaturen.
 * Repetitionsläget, bilderna och fördjupningen ingår inte — de säger inget
 * om vad leken handlar om, och en repetition ska inte kosta ett anrop.
 *
 * Antalet står framför hashen i klartext så att en post går att läsa med
 * ögat i lagringen, och så att två lekar med lika hash men olika storlek
 * aldrig kan tas för samma.
 *
 * @param {object} deck
 * @returns {string}
 */
export function signatur(deck) {
  const kort = underlag(deck);
  /* Skiljetecken mellan delarna, och ett annat mellan fram- och baksida:
   * utan dem hade "ab" + "c" och "a" + "bc" varit samma lek. */
  const delar = [
    deck?.title ?? '',
    ...(deck?.sections ?? []).map((s) => s?.title ?? ''),
    ...kort.map((c) => `${c.front ?? ''}\u0001${c.back ?? ''}`),
  ];
  return `${kort.length}:${hash(delar.join('\u0002')).toString(16)}`;
}

/**
 * Meningen att visa just nu, och om en ny behöver skrivas.
 *
 * Den gamla visas medan den nya skrivs. En rad som blinkar bort och kommer
 * tillbaka varje gång man lägger till ett kort är sämre än en som är ett
 * kort gammal i några sekunder.
 *
 * @param {{sign?: string, text?: string}|null|undefined} lagrad
 * @param {object} deck
 * @returns {{ text: string, aktuell: boolean, behovs: boolean }}
 */
export function bedom(lagrad, deck) {
  if (!kanSammanfattas(deck)) return { text: '', aktuell: false, behovs: false };
  const text = typeof lagrad?.text === 'string' ? lagrad.text.trim() : '';
  const aktuell = Boolean(text) && lagrad?.sign === signatur(deck);
  return { text, aktuell, behovs: !aktuell };
}

/**
 * Tar bort poster för lekar som inte finns längre.
 *
 * Lagringen är lokal och synkas inte, så ingen annan städar den. Utan detta
 * hade varje raderad lek lämnat en mening efter sig för alltid.
 *
 * @param {Record<string, unknown>} lagrade
 * @param {Array<{id: string}>} decks
 * @returns {Record<string, unknown>}
 */
export function gallra(lagrade, decks) {
  const finns = new Set((decks ?? []).map((d) => d.id));
  return Object.fromEntries(Object.entries(lagrade ?? {}).filter(([id]) => finns.has(id)));
}

const klipp = (s, max = MAX_TECKEN_PER_SIDA) => {
  const rad = String(s ?? '').replace(/\s+/g, ' ').trim();
  return rad.length > max ? `${rad.slice(0, max)}…` : rad;
};

/**
 * Texten modellen får läsa: titel, mappar och ett jämnt urval av korten,
 * varje kort med sin mapp i hakparentes.
 *
 * Jämnt, inte de första åttio: en lek fylls i den ordning ämnet lästes, och
 * de första korten är då bara första kapitlet. Varje sida klipps också —
 * meningen ska säga vad leken handlar om, och för det räcker början av ett
 * svar. Kortförslaget använder samma urval med rymligare tak: det ska hitta
 * en lucka, och behöver då se lite mer av varje kort.
 *
 * @param {object} deck
 * @param {{maxKort?: number, maxTecken?: number}} [tak]
 * @returns {string}
 */
export function underlagText(deck, { maxKort = MAX_KORT_I_UNDERLAG, maxTecken = MAX_TECKEN_PER_SIDA } = {}) {
  const kort = underlag(deck);
  const steg = Math.max(1, kort.length / maxKort);
  const urval = [];
  for (let i = 0; i < kort.length && urval.length < maxKort; i += steg) {
    urval.push(kort[Math.floor(i)]);
  }
  const kap = (v) => klipp(v, maxTecken);
  const mappnamn = new Map((deck?.sections ?? []).map((s) => [s?.id, s?.title]));

  const mappar = (deck?.sections ?? []).map((s) => s?.title).filter(Boolean);
  const huvud = [
    `Titel: ${kap(deck?.title)}`,
    mappar.length ? `Mappar: ${mappar.map(kap).join(', ')}` : '',
    `Antal kort: ${kort.length}${urval.length < kort.length ? ` (urval av ${urval.length})` : ''}`,
  ].filter(Boolean);
  const kortrader = urval.map((c) => {
    const mapp = c.sectionId && mappnamn.get(c.sectionId);
    return `F: ${kap(c.front)} | S: ${kap(c.back)}${mapp ? ` [${kap(mapp)}]` : ''}`;
  });
  return [...huvud, '', ...kortrader].join('\n');
}

/**
 * Städar modellens svar till löpande text på en rad.
 *
 * Modellen ombeds skriva en mening utan markdown och utan citattecken, men
 * ber man om något tillräckligt många gånger får man förr eller senare
 * "**Sammanfattning:** ..." tillbaka. Det som tas bort är bara sådant som
 * aldrig hör hemma i en mening under en rubrik; själva texten lämnas orörd.
 *
 * @param {string} svar
 * @returns {string}
 */
export function enMening(svar) {
  return String(svar ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(sammanfattning|summary)\s*:\s*/i, '')
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '')
    .trim();
}
