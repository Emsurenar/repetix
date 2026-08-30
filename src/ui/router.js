import { S } from '../core/state.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { views } from './dom.js';
import { renderLibrary } from './library.js';
import { renderSidebar } from './modals-wiring.js';
import { openDeck, openNotebook } from './deck.js';
import { renderPlayground } from './playground.js';


// Lyssnare pa vybyte. Molnlagret anvander detta for att veta nar appen ar i
// vila och en inkommande andring kan bytas in utan att avbryta anvandaren.
const viewListeners = new Set();

export function onViewChange(fn) {
    viewListeners.add(fn);
    return () => viewListeners.delete(fn);
}

// --- ROUTING / VIEW LOGIC ---
export const switchView = (viewName, sectionId = null) => {
    // Ett byte ar bara ett byte nar man faktiskt byter yta. Att oppna en mapp
    // i en kortlek man redan star i gar ocksa genom den har funktionen, och
    // utan jamforelsen hade hela vyn tonat in pa nytt varje gang — en blinkning
    // mitt i en rorelse som skulle kannas sammanhangande.
    const bytterVy = S.currentViewName !== viewName;
    S.currentViewName = viewName;

    /* Bytet ar synkront och rent: den gamla vyn doljs i samma bildruta som
     * den nya visas. Ingen korsovertoning — tva synliga vyer samtidigt ar en
     * dubbelexponering, och det underkande agaren. Ingen setTimeout heller:
     * varje fordrojd doljning har tidigare skapat kapplopningar dar tva
     * byten tatt inpa varandra lamnade bada vyerna synliga.
     *
     * Att den nya vyn anda inte klipper fram beror pa att dess intoning i
     * motion.css aldrig ror genomskinligheten — vyn star fardig i forsta
     * bildrutan och satter sig, medan innehallet tonar in forskjutet. */
    const inkommandeVy = views[viewName];
    for (const v of Object.values(views)) {
        if (v === inkommandeVy) {
            v.classList.remove('hidden');
        } else {
            v.classList.add('hidden');
        }
    }
    window.scrollTo(0, 0);

    /* Vyn markeras som inkommande sa lange rorelsen pagar. Forskjutningen i
     * listorna hanger pa den klassen och spelas darfor en gang per byte, inte
     * en gang per omritning — annars rycker biblioteket vid varje tangenttryck
     * i soken. */
    const inkommande = views[viewName];
    if (inkommande && bytterVy) {
        // Animationen maste startas om explicit: klassen far inte sitta kvar
        // fran forra besoket, och en klass som bara laggs tillbaka startar
        // ingen ny animation.
        inkommande.classList.remove('is-entering');
        void inkommande.offsetWidth;
        inkommande.classList.add('is-entering');
        clearTimeout(inkommande._entryTimer);
        inkommande._entryTimer = setTimeout(() => inkommande.classList.remove('is-entering'), 700);
    }
    // Repetitionen tar hela ytan. Sidopanelen ar bibliotekets navigering och
    // har inget arende mitt i ett pass.
    /* Överlägget fälls in vid varje vybyte.
     *
     * På telefon ligger sidopanelen ÖVER innehållet, så en meny som står kvar
     * efter ett tryck döljer just det man tryckte fram. Kortlekarna stängde
     * den redan via klicket utanför panelen, men Spelhallen gjorde det inte —
     * och att lägga en rad i varje ingång är att be nästa ingång att komma
     * ihåg. Vybytet är det de har gemensamt. */
    document.body.classList.remove('sidebar-open');

    document.body.classList.toggle('focus-mode', viewName === 'study');
    for (const fn of viewListeners) fn(viewName);

    // Update breadcrumb
    /* Handlingen är en funktion, inte en kodsträng: id:t bakas in här och kan
     * därmed aldrig läsas som kod. Det fångas i en lokal konstant så att
     * smulan pekar på den lek man stod i när den ritades, precis som förut. */
    const lib = { label: 'Bibliotek', action: () => { renderLibrary(); switchView('library'); renderSidebar(); } };
    const deckId = S.currentDeckId;
    const notebookId = S.currentNotebookId;
    if (viewName === 'library') {
        updateBreadcrumb([{ label: 'Bibliotek' }]);
    } else if (viewName === 'deck') {
        const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
        if (section) {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: () => openDeck(deckId) }, { label: section.title }]);
        } else {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek' }]);
        }
    } else if (viewName === 'addCard') {
        const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: () => openDeck(deckId) }, { label: 'Nytt kort' }]);
    } else if (viewName === 'notebook') {
        const nb = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock' }]);
    } else if (viewName === 'addNote') {
        const nb = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock', action: () => openNotebook(notebookId) }, { label: 'Anteckning' }]);
    } else if (viewName === 'study') {
        // Repetitionen bar sin egen toppslist med kortlek, mapp och kolangd.
        // En brodsmula ovanfor den hade sagt samma sak en gang till.
        updateBreadcrumb([]);
    } else if (viewName === 'complete') {
        updateBreadcrumb([lib, { label: 'Klart!' }]);
    } else if (viewName === 'playground') {
        updateBreadcrumb([lib, { label: 'Spelhallen' }]);
        // Ensure playground content is rendered even if called without openPlayground()
        setTimeout(() => renderPlayground(), 15);
    }

    renderSidebar();
};

export function initUiRouter() {

  const openPlayground = () => {
      S.isPlaygroundSession = false;
      S.playgroundFilterSource = new Set();
      S.playgroundFilterAll = true;
      S.playgroundExpandedNodes = new Set();
      S.playgroundDropdownOpen = false;
      switchView('playground');
      renderPlayground();
  };

  window.openPlayground = openPlayground;

  // Sidopanelens fot ar enda vagen till spelhallen. Knappen fanns i markupen
  // men var aldrig kopplad — den forlitade sig pa en inline-onclick i tradet,
  // som forsvann nar tradet blev en lista over kortlekar.
  document.getElementById('btn-open-playground')?.addEventListener('click', openPlayground);
}
