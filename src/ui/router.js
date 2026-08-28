import { S } from '../core/state.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { views } from './dom.js';
import { renderSidebar } from './modals-wiring.js';
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
    S.currentViewName = viewName;

    // Vyn visas synkront. Tidigare doldes allt direkt och malvyn visades i en
    // setTimeout pa 10 ms, vilket gjorde vaxlingen till en kapplopning: tva
    // byten tatt inpa varandra — t.ex. att oppna en kortlek och genast starta
    // en repetition — lat den forsta timeouten av-dolja sin vy EFTER att den
    // andra gomt allt. Bada vyerna blev da synliga samtidigt, staplade.
    // Overtoningen gors numera av CSS-animationen pa .view och behover ingen
    // fordrojning.
    for (const v of Object.values(views)) {
        v.classList.toggle('hidden', v !== views[viewName]);
    }
    window.scrollTo(0, 0);
    // Repetitionen tar hela ytan. Sidopanelen ar bibliotekets navigering och
    // har inget arende mitt i ett pass.
    document.body.classList.toggle('focus-mode', viewName === 'study');
    for (const fn of viewListeners) fn(viewName);

    // Update breadcrumb
    const lib = { label: 'Bibliotek', action: "renderLibrary();switchView('library');renderSidebar();" };
    if (viewName === 'library') {
        updateBreadcrumb([{ label: 'Bibliotek' }]);
    } else if (viewName === 'deck') {
        const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
        if (section) {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: `openDeck('${S.currentDeckId}')` }, { label: section.title }]);
        } else {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek' }]);
        }
    } else if (viewName === 'addCard') {
        const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: `openDeck('${S.currentDeckId}')` }, { label: 'Nytt kort' }]);
    } else if (viewName === 'notebook') {
        const nb = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock' }]);
    } else if (viewName === 'addNote') {
        const nb = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock', action: `openNotebook('${S.currentNotebookId}')` }, { label: 'Anteckning' }]);
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
