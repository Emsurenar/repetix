import { filterBookshelf } from '../ui/modals-wiring.js';
import { deleteSection } from '../ai/client.js';
import { exportBackup, importBackupFromFile, maybeAutoBackup, renderBackupStatus } from '../core/backup.js';
import { S } from '../core/state.js';
import { showToast } from '../ui/toast.js';
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
    /* Vägen ut ur trasig data kopplas FÖRE datan läses.
     *
     * loadData() låg tidigare först i try-blocket. En importfil som gjorde
     * appdatan otolkbar fick den att kasta, och då kopplades ingenting efter
     * den — inte heller importknappen, som är enda sättet att lägga in en
     * frisk backup. Användaren satt med en app som varken startade eller gick
     * att laga. Knapparna nedan behöver ingen laddad data för att fungera. */
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

    try {
        loadData();
        renderDecks();
        renderSidebar();
        

        document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && S.isPlaygroundSession) S.playgroundEscAbort = true;
    }, true);

        // Knapparna är redan kopplade ovanför; här behövs bara tillståndet.
        maybeAutoBackup();
        renderBackupStatus();

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

        /* Sidopanelen flyttas ut ur bild med transform. Den finns darmed kvar
         * i tabbordningen: infalld gav den tretton osynliga kontroller att
         * tabba igenom innan man nadde hamburgaren, och mitt i en repetition
         * tabbade man rakt in i det osynliga biblioteket.
         *
         * inert tar bort hela tradet ur bade tabbordning och skarmlasare sa
         * lange panelen ar utanfor skarmen. Lyssnaren sitter pa <body>:
         * klasserna satts fran fyra olika hall — infallning, hamburgare, ett
         * tryck vid sidan om, och vybytet till fokuslage — och en observator
         * fangar alla fyra utan att nagon av dem behover komma ihag det. */
        const sidebar = document.getElementById('sidebar');
        const syncSidebarInert = () => {
            if (!sidebar) return;
            const overlay = window.matchMedia('(max-width: 900px)').matches;
            const utanforBild = overlay
                ? !document.body.classList.contains('sidebar-open')
                : document.body.classList.contains('sidebar-collapsed') ||
                  document.body.classList.contains('focus-mode');
            sidebar.inert = utanforBild;
        };
        new MutationObserver(syncSidebarInert).observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
        });
        window.addEventListener('resize', syncSidebarInert);
        syncSidebarInert();

        // Läget bärs av två klasser på <body>, eftersom både panelen, dess
        // överlägg och innehållsytans marginal måste ändras samtidigt.
        // Knapparna satte tidigare klasser på panelen och innehållsytan som
        // stilmallen inte längre kände till, och gjorde därför ingenting alls.
        const isOverlay = () => window.matchMedia('(max-width: 900px)').matches;

        sidebarCollapse?.addEventListener('click', () => {
            if (isOverlay()) {
                document.body.classList.remove('sidebar-open');
            } else {
                document.body.classList.add('sidebar-collapsed');
            }
            syncSidebarExpanded(false);
        });

        sidebarToggle?.addEventListener('click', () => {
            if (isOverlay()) {
                const open = document.body.classList.toggle('sidebar-open');
                syncSidebarExpanded(open);
            } else {
                document.body.classList.remove('sidebar-collapsed');
                syncSidebarExpanded(true);
            }
        });

        // Överlägget stängs av ett tryck vid sidan om, annars är den lilla
        // infällningsknappen enda vägen ut på telefon.
        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('sidebar-open')) return;
            if (e.target.closest('#sidebar') || e.target.closest('#sidebar-toggle')) return;
            document.body.classList.remove('sidebar-open');
            syncSidebarExpanded(false);
        });

        // Märket är vägen hem. Knappen fanns i markupen men var aldrig
        // kopplad: ett tryck gjorde ingenting.
        document.getElementById('btn-sidebar-home')?.addEventListener('click', () => {
            filterBookshelf(null);
            if (isOverlay()) document.body.classList.remove('sidebar-open');
        });

        document.getElementById('note-content')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('form-add-note')?.requestSubmit();
            }
        });
    } catch (err) {
        console.error('Initial load failed', err);
        /* Spärren måste sättas här. Utan den skriver nästa sparning över den
         * data som inte gick att läsa — alltså raderas ett bibliotek som
         * kanske bara var otolkbart för att en importfil var trasig. */
        S.dataLoadBlocked = true;
        /* Och renderingen får inte kasta en gång till på samma data: gör den
         * det försvinner även importknappens vy. */
        try {
            renderLibrary();
        } catch (renderFel) {
            console.error('Kunde inte rita biblioteket efter misslyckad laddning', renderFel);
        }
        showToast('Kunde inte läsa dina data. Importera en backup för att återställa.');
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
