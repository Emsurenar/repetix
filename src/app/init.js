import { filterBookshelf } from '../ui/modals-wiring.js';
import { deleteSection } from '../ai/client.js';
import { exportBackup, importBackupFromFile, maybeAutoBackup, renderBackupStatus } from '../core/backup.js';
import { S } from '../core/state.js';
import { loadData, saveData } from '../core/storage.js';
import { renderDagensMapp } from '../ui/dagens-mapp.js';
import { openDeck, openNotebook, renderDecks, studyDagensMapp } from '../ui/deck.js';
import { renderLibrary } from '../ui/library.js';
import { renderSidebar } from '../ui/modals-wiring.js';
import { closeTopModal, setExpanded, showPromptModal } from '../ui/modals.js';
import { switchView } from '../ui/router.js';
import { closeGlobalSearch, navigateSearchResults, openGlobalSearch, performGlobalSearch, triggerActiveSearchResult } from '../ui/search.js';
import { startBookshelfStudy, startSectionStudy } from '../ui/study.js';
import { handleBackgroundBack } from '../ui/wiring/navigation.js';


// --- INITIALIZATION ---
const initApp = () => {
    try {
        loadData();
        renderDecks();
        renderSidebar();
        

        document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && S.isPlaygroundSession) S.playgroundEscAbort = true;
    }, true);

        // Backup: run auto-backup once conditions are met, show status, wire buttons
        maybeAutoBackup();
        renderBackupStatus();
        document.getElementById('btn-export-backup')?.addEventListener('click', () => {
            exportBackup();
            renderBackupStatus();
        });
        document.getElementById('btn-import-backup')?.addEventListener('click', () => {
            document.getElementById('import-backup-input')?.click();
        });
        document.getElementById('import-backup-input')?.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) await importBackupFromFile(file);
        });

    // Global click handler for closing modals
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
                return;
            }
            if (e.target === document.body || e.target === document.documentElement) {
                if (typeof handleBackgroundBack === 'function') {
                    handleBackgroundBack();
                }
            }
        });

        // Escape key closes the topmost open modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Fokusfällan i modals.js tar hand om öppna överlägg och
                // stoppar händelsen där. Kommer vi hit finns inget öppet, men
                // anropet står kvar som spärr: att dölja modalen härifrån
                // skulle hoppa över avbryt-knappens uppstädning.
                if (closeTopModal()) return;
                if (S.currentViewName === 'complete') {
                    document.getElementById('btn-complete-back').click();
                } else if (S.currentViewName === 'study' && !document.getElementById('cinema-overlay')) {
                    document.getElementById('btn-end-study').click();
                } else if (S.currentViewName === 'deck') {
                    filterBookshelf(null);
                } else if (S.currentViewName === 'addCard') {
                    openDeck(S.currentDeckId);
                } else if (S.currentViewName === 'notebook') {
                    filterBookshelf(null);
                } else if (S.currentViewName === 'addNote') {
                    openNotebook(S.currentNotebookId);
                }
            }
        });

        // Global Command Palette Key Shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                openGlobalSearch();
            }
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                openGlobalSearch();
            }
        });

        let librarySearchTimeout = null;
        document.getElementById('library-search')?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (librarySearchTimeout) clearTimeout(librarySearchTimeout);
            librarySearchTimeout = setTimeout(() => {
                S.librarySearchFilter = val;
                renderLibrary();
            }, 100);
        });

        // Sidebar search input event to filter sidebar
        let sidebarSearchTimeout = null;
        const sidebarSearchInput = document.getElementById('sidebar-search');
        if (sidebarSearchInput) {
            sidebarSearchInput.addEventListener('input', () => {
                if (sidebarSearchTimeout) clearTimeout(sidebarSearchTimeout);
                sidebarSearchTimeout = setTimeout(() => {
                    renderSidebar();
                }, 100);
            });
        }

        // Global search triggers on clicking the search icon
        const globalSearchTrigger = document.getElementById('btn-global-search-trigger');
        if (globalSearchTrigger) {
            globalSearchTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openGlobalSearch();
            });
        }

        // Global Search Input Handlers
        let globalSearchTimeout = null;
        const globalSearchInput = document.getElementById('global-search-input');
        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', () => {
                if (globalSearchTimeout) clearTimeout(globalSearchTimeout);
                globalSearchTimeout = setTimeout(() => {
                    performGlobalSearch();
                }, 100);
            });
            globalSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateSearchResults(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateSearchResults(-1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    triggerActiveSearchResult();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeGlobalSearch();
                }
            });
        }

        // Sidopanelen är en utfällbar yta med två knappar: en som fäller in och
        // en som fäller ut. Båda måste bära samma aria-expanded, annars säger
        // skärmläsaren fel sak om panelens läge.
        const sidebarCollapse = document.getElementById('sidebar-collapse');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const syncSidebarExpanded = (open) => {
            setExpanded(sidebarCollapse, open);
            setExpanded(sidebarToggle, open);
        };
        syncSidebarExpanded(true);

        // Sidebar collapse (desktop)
        sidebarCollapse?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('collapsed');
            document.getElementById('app-container').classList.add('expanded');
            sidebarToggle.classList.add('visible');
            document.getElementById('sidebar').classList.remove('open');
            syncSidebarExpanded(false);
        });

        // Sidebar expand (desktop/mobile)
        sidebarToggle?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('collapsed');
            document.getElementById('app-container').classList.remove('expanded');
            sidebarToggle.classList.remove('visible');
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.toggle('open');
            }
            syncSidebarExpanded(
                !document.getElementById('sidebar').classList.contains('collapsed')
            );
        });

        document.getElementById('note-content')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('form-add-note')?.requestSubmit();
            }
        });
    } catch (err) {
        console.error("Initial load failed", err);
        if (typeof renderLibrary === 'function') renderLibrary();
    }
};

export const renameDeck = async (event, id, type = 'deck') => {
    event.stopPropagation();
    const list = type === 'deck' ? S.appData.decks : S.appData.notebooks;
    const item = list.find(i => i.id === id);
    if (!item) return;
    const newTitle = await showPromptModal('Skriv in nytt namn:', item.title);
    if (newTitle && newTitle.trim() !== '') {
        item.title = newTitle.trim();
        saveData();
        renderLibrary();
        if (type === 'deck' && S.currentDeckId === id) {
            document.getElementById('current-deck-title').innerText = item.title;
        } else if (type === 'notebook' && S.currentNotebookId === id) {
            document.getElementById('current-notebook-title').innerText = item.title;
        }
    }
};

export function initAppInit() {

  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initApp);
  } else {
      initApp();
  }

  window.renameDeck = renameDeck;
  window.startBookshelfStudy = startBookshelfStudy;
  window.startSectionStudy = startSectionStudy;
  window.deleteSection = deleteSection;
  window.openDeck = openDeck;
  window.openNotebook = openNotebook;
  window.renderLibrary = renderLibrary;
  window.renderSidebar = renderSidebar;
  window.switchView = switchView;
  window.studyDagensMapp = studyDagensMapp;
  window.renderDagensMapp = renderDagensMapp;
}
