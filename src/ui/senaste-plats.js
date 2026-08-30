// Kopplingen mellan var man står och sessionslagringen.
//
// Beslutet — får vyn sparas, finns den kvar? — ligger i domain/senaste-plats.js
// och testas utan webbläsare. Här finns bara det som måste röra webbläsaren:
// lagringen, lyssnaren på vybyte, och öppnandet vid uppstart.

import { platsAttOppna, platsAttSpara } from '../domain/senaste-plats.js';
import { S } from '../core/state.js';
import { openDeck, openNotebook } from './deck.js';
import { onViewChange, switchView } from './router.js';

/* sessionStorage, inte localStorage. Frågan var "kan jag uppdatera och vara
 * kvar där jag var", och det är en egenskap hos fliken man arbetar i — inte
 * hos appen. Med localStorage hade en ny flik i morgon bitti också öppnat
 * mitt i en kortlek, vilket ingen bett om. */
const NYCKEL = 'repetix_senaste_plats';

/* Lagringen kan vara avstängd, full, eller blockerad i privat läge. Att inte
 * minnas var man var är en obekvämlighet; att appen inte startar är det inte,
 * så ingen av vägarna får kasta. */
const las = () => {
  try {
    const rad = sessionStorage.getItem(NYCKEL);
    return rad ? JSON.parse(rad) : null;
  } catch {
    return null;
  }
};

const skriv = (plats) => {
  try {
    if (plats) sessionStorage.setItem(NYCKEL, JSON.stringify(plats));
    else sessionStorage.removeItem(NYCKEL);
  } catch {
    /* tomt med flit — se kommentaren ovan */
  }
};

/**
 * Öppnar platsen från förra sidvisningen, om den finns kvar.
 *
 * Anropas sist i uppstarten, när all koppling är gjord: openDeck ritar hela
 * kortlekens vy och förutsätter att knapparna den fyller redan har sina
 * lyssnare.
 *
 * @returns {boolean} sant om en plats öppnades
 */
export function aterstallSenastePlats() {
  const plats = platsAttOppna(las(), S.appData);
  if (!plats) return false;

  if (plats.vy === 'deck') openDeck(plats.deckId, plats.sectionId);
  else if (plats.vy === 'notebook') openNotebook(plats.notebookId);
  else switchView(plats.vy);
  return true;
}

/** Kopplar sparningen. Anropas av main.js. */
export function initSenastePlats() {
  onViewChange((viewName) => {
    /* Platsen läses ur S och inte ur argumentet: vyns namn räcker inte, det
     * är id:na som gör den återbesökbar. openDeck sätter dem innan den byter
     * vy, så de är färska när den här lyssnaren körs.
     *
     * En vy som inte får sparas rensar i stället. Annars hade ett pass i
     * repetitionen lämnat kvar förra kortleken, och en omladdning där tagit
     * en tillbaka till något man lämnat för länge sedan. */
    skriv(
      platsAttSpara({
        vy: viewName,
        deckId: S.currentDeckId,
        sectionId: S.currentSectionId,
        notebookId: S.currentNotebookId,
      })
    );
  });
}
