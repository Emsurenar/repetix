// Raden under kortlekens titel: en mening om vad leken handlar om.
//
// Beslutet — gäller den lagrade meningen, eller behövs en ny? — ligger i
// domain/sammanfattning.js och prövas utan webbläsare. Här finns bara det som
// måste röra webbläsaren: lagringen, anropet och raden.
//
// Meningen lagras lokalt och synkas inte. Den är härledd ur innehållet och
// går att räkna fram igen på varje enhet; att ge den en kolumn i molnet hade
// krävt en migration för en rad text som ändå skrivs om så fort leken ändras.

import { hamtaSammanfattning } from '../ai/deck-insights.js';
import { S } from '../core/state.js';
import { getUserId } from '../core/supabase.js';
import { bedom, gallra, signatur } from '../domain/sammanfattning.js';

const NYCKEL = 'repetix_kortlekssammanfattningar';

/* Lagringen kan vara avstängd, full eller blockerad i privat läge. En mening
 * som inte minns är en obekvämlighet; en kortlek som inte öppnas är det inte,
 * så ingen av vägarna får kasta. */
const las = () => {
  try {
    const rad = localStorage.getItem(NYCKEL);
    const data = rad ? JSON.parse(rad) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
};

const skriv = (lagrade) => {
  try {
    localStorage.setItem(NYCKEL, JSON.stringify(lagrade));
  } catch {
    /* tomt med flit — se kommentaren ovan */
  }
};

/**
 * Anrop som pågår, per lek. Utan detta hade tre snabba ändringar gett tre
 * anrop i luften och den som svarade sist vunnit — oavsett vilken lek den
 * beskrev.
 * @type {Map<string, AbortController>}
 */
const pagaende = new Map();

/**
 * Signaturer som redan misslyckats den här sessionen, per lek. Ett anrop som
 * går fel — ingen nyckel, inget nät — ska inte göras om vid varje öppning;
 * det görs om när leken ändrats, eller efter en omladdning.
 * @type {Map<string, string>}
 */
const misslyckade = new Map();

const rad = () => document.getElementById('deck-sammanfattning');

const visaRad = (text) => {
  const p = rad();
  if (!p) return;
  p.textContent = text;
  p.hidden = !text;
};

/**
 * Ritar meningen för leken som just öppnats, och skriver en ny om det behövs.
 *
 * Anropas av openDeck, som körs både när leken öppnas och efter varje
 * ändring i den — det är därför regeln "ny mening när leken ändrats" inte
 * behöver en enda lyssnare på mutationerna.
 *
 * @param {object|null} deck
 * @param {{ visa?: boolean }} [val] visa=false döljer raden (en mapp i leken)
 */
export function visaSammanfattning(deck, { visa = true } = {}) {
  if (!deck || !visa) {
    visaRad('');
    return;
  }

  const lagrade = las();
  const { text, behovs } = bedom(lagrade[deck.id], deck);
  visaRad(text);
  if (!behovs) return;

  /* Utan konto finns ingen nyckel, och ett anrop hade bara gett ett fel att
   * tiga om. Raden får stå tom tills man loggat in. */
  if (!getUserId()) return;

  const sign = signatur(deck);
  if (misslyckade.get(deck.id) === sign) return;

  // Det som är på väg beskriver en lek som inte längre finns.
  pagaende.get(deck.id)?.abort();
  const styr = new AbortController();
  pagaende.set(deck.id, styr);

  (async () => {
    try {
      const mening = await hamtaSammanfattning(deck, styr.signal);
      if (styr.signal.aborted) return;
      if (!mening) throw new Error('Tomt svar.');

      const nu = gallra(las(), S.appData?.decks);
      nu[deck.id] = { sign, text: mening };
      skriv(nu);

      // Bara om leken fortfarande är den som visas, och oförändrad sedan
      // anropet gick. Annars står raden och beskriver fel lek.
      const oppen = S.appData?.decks?.find((d) => d.id === S.currentDeckId);
      if (oppen && oppen.id === deck.id && signatur(oppen) === sign) visaRad(mening);
    } catch (e) {
      if (styr.signal.aborted) return;
      misslyckade.set(deck.id, sign);
      /* Ingen toast: meningen är en bekvämlighet som ingen bett om just nu,
       * och ett fel i den ska inte avbryta det man kom för att göra. Skälet
       * står i konsolen för den som undrar varför raden är tom. */
      console.warn('Kunde inte skriva kortlekens sammanfattning:', e?.message ?? e);
    } finally {
      if (pagaende.get(deck.id) === styr) pagaende.delete(deck.id);
    }
  })();
}
