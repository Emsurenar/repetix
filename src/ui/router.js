import { S } from '../core/state.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { views } from './dom.js';
import { renderSidebar } from './modals-wiring.js';
import { renderPlayground } from './playground.js';


// --- ROUTING / VIEW LOGIC ---
export const switchView = (viewName, sectionId = null) => {
    S.currentViewName = viewName;
    Object.values(views).forEach(v => v.classList.add('hidden'));

    setTimeout(() => {
        views[viewName].classList.remove('hidden');
    }, 10);
    window.scrollTo(0, 0);

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
        const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        updateBreadcrumb([lib, { label: deck?.title || 'Repetition', action: S.currentDeckId ? `openDeck('${S.currentDeckId}')` : '' }, { label: 'Repetition' }]);
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

  window.openPlayground = () => {
      S.isPlaygroundSession = false;
      S.playgroundFilterSource = new Set();
      S.playgroundFilterAll = true;
      S.playgroundExpandedNodes = new Set();
      S.playgroundDropdownOpen = false;
      switchView('playground');
      renderPlayground();
  };
}
