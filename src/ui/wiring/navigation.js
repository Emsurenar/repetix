import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { openDeck, openNotebook } from '../deck.js';
import { renderLibrary } from '../library.js';
import { showConfirmModal } from '../modals.js';
import { renderPlayground } from '../playground.js';
import { switchView } from '../router.js';
import { deleteCurrentStudyCard, startGlobalStudy } from '../study.js';
import { showToast } from '../toast.js';


    // Logic was moved to the bottom of the file for reliability

    export const handleBackgroundBack = () => {
        switch(S.currentViewName) {
            case 'deck':
            case 'notebook':
                switchView('library');
                break;
            case 'addCard':
                switchView('deck');
                break;
            case 'addNote':
                switchView('notebook');
                break;
            case 'study':
            case 'complete':
                switchView('deck');
                break;
        }
    };

export function initUiWiringNavigation() {

      // Navigation
      document.getElementById('nav-library')?.addEventListener('click', () => {
          switchView('library');
          renderLibrary();
        
      });
      document.getElementById('btn-back-library').addEventListener('click', () => {
          renderLibrary();
        
          switchView('library');
      });
      document.getElementById('btn-back-library-notebook').addEventListener('click', () => {
          renderLibrary();
        
          switchView('library');
      });
      document.getElementById('btn-back-deck').addEventListener('click', () => openDeck(S.currentDeckId));
      document.getElementById('btn-back-notebook').addEventListener('click', () => openNotebook(S.currentNotebookId));

      document.getElementById('btn-complete-back').addEventListener('click', () => {
          if (S.isPlaygroundSession || S.lastSessionWasPlayground) {
              S.lastSessionWasPlayground = false;
              switchView('playground');
              renderPlayground();
          } else if (S.currentDeckId) {
              openDeck(S.currentDeckId);
          } else {
              renderLibrary();
              switchView('library');
          }
      });

      document.getElementById('btn-delete-card-study').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCurrentStudyCard();
      });

      document.getElementById('btn-end-study').addEventListener('click', () => {
          if (S.isPlaygroundSession || S.lastSessionWasPlayground) {
              S.lastSessionWasPlayground = false;
              S.isPlaygroundSession = false;
              switchView('playground');
              renderPlayground();
          } else if (S.currentDeckId) {
              openDeck(S.currentDeckId);
          } else {
              renderLibrary();
              switchView('library');
          }
      });

      document.getElementById('btn-study-all').addEventListener('click', () => {
          startGlobalStudy();
      });

      // Delete Deck / Notebook
      document.getElementById('btn-delete-deck').addEventListener('click', async () => {
          if (await showConfirmModal('Radera kortlek', 'Är du säker på att du vill ta bort hela kortleken? Detta kan inte ångras.', 'Radera', true)) {
              S.appData.decks = S.appData.decks.filter(d => d.id !== S.currentDeckId);
              saveData();
              S.currentDeckId = null;
              renderLibrary();
              switchView('library');
              showToast('Kortlek borttagen');
          }
      });
}
