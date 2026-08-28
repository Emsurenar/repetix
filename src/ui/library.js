import { openMoveItemModal } from '../ai/client.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { getReviewLog } from '../core/sync.js';
import { escapeHtml } from '../core/utils.js';
import { currentStreak, dailyCounts, mergeLegacyCounts } from '../domain/history.js';
import { loadRecords } from '../domain/stats.js';
import { renderDagensMapp } from './dagens-mapp.js';
import { openDeck, openNotebook } from './deck.js';
import { deckList } from './dom.js';
import { openColorModal, renderSidebar } from './modals-wiring.js';
import { showConfirmModal, showPromptModal } from './modals.js';
import { startBookshelfStudy } from './study.js';
import { showToast } from './toast.js';


/* Menyknappens ikon. Tre punkter i stället för tecknet "⋮": ett glyf som
 * saknas i vald font faller tillbaka på systemets, och storleken hoppar då
 * mellan rader. En svg ritar likadant överallt. */
const MENU_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>`;

/* Attributvärde. escapeHtml() går via innerHTML och lämnar citattecken orörda,
 * vilket duger i textinnehåll men inte i ett attribut: en kortlek som heter
 * 5" diskett skulle annars bryta sig ur aria-label. */
const attr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

/* Radmeny som <details>. Knappen är därmed alltid synlig och öppnas av ett
 * tryck — den gamla lösningen låg bakom :hover och gick inte att nå med ett
 * finger. */
const rowMenu = (label, items) => `
    <details class="row-menu">
        <summary class="row-menu-toggle" aria-label="${attr(label)}">${MENU_ICON}</summary>
        <div class="row-menu-items">${items}</div>
    </details>`;


const itemMatchesFilter = (item, type, flt) => {
    if (!flt) return true;
    if (item.title.toLowerCase().includes(flt)) return true;
    if (type === 'deck' && item.cards) {
        return item.cards.some(c => 
            (c.front && c.front.toLowerCase().includes(flt)) || 
            (c.back && c.back.toLowerCase().includes(flt))
        );
    }
    if (type === 'notebook' && item.notes) {
        return item.notes.some(n => 
            n.content && n.content.toLowerCase().includes(flt)
        );
    }
    return false;
};

/* Nyckeltalen överst i biblioteket.
 *
 * Streak och totalsumma räknas ur repetitionsloggen och inte ur
 * card.lastReviewed: det fältet skrivs över vid varje ny repetition och tappar
 * därmed all historik bakåt. Dagsräkningarna från tiden före loggen vävs in,
 * annars skulle en befintlig användares streak nollställas vid uppgraderingen.
 */
const renderLibrarySummary = () => {
    const dueEl = document.getElementById('library-stat-due');
    const streakEl = document.getElementById('library-stat-streak');
    const reviewsEl = document.getElementById('library-stat-reviews');
    if (!dueEl || !streakEl || !reviewsEl) return;

    const now = Date.now();
    const cards = S.appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note'));
    const due = cards.filter(c => c.nextReviewDate <= now).length;

    const counts = mergeLegacyCounts(dailyCounts(getReviewLog()), loadRecords().dailyCounts);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

    // Svenskt tusentalsavstånd: 1 340 läses snabbare än 1340 i en kolumn.
    const fmt = (n) => n.toLocaleString('sv-SE');

    dueEl.textContent = fmt(due);
    // Accent bara när det finns något kvar att göra. En nolla ska inte ropa.
    dueEl.classList.toggle('is-accent', due > 0);
    streakEl.textContent = fmt(currentStreak(counts));
    reviewsEl.textContent = fmt(total);
};

export const renderLibrary = () => {
    renderLibrarySummary();
    renderDagensMapp();
    deckList.innerHTML = '';
    const filter = S.librarySearchFilter.toLowerCase();
    
    // Add dragover/drop on deckList for dropping items outside bookshelves
    deckList.ondragover = (e) => e.preventDefault();
    deckList.ondrop = (e) => {
        e.preventDefault();
        // Check if we dropped on a deck card or bookshelf container
        const closestContainer = e.target.closest('.bookshelf-items');
        if (!closestContainer && S.draggedItemId !== null && S.draggedItemType !== null) {
            if (S.draggedItemType === 'deck') {
                const item = S.appData.decks.find(d => d.id === S.draggedItemId);
                if (item) item.bookshelfId = null;
            } else if (S.draggedItemType === 'notebook') {
                const item = S.appData.notebooks.find(n => n.id === S.draggedItemId);
                if (item) item.bookshelfId = null;
            }
            saveData();
            renderLibrary();
        }
    };

    if (S.appData.decks.length === 0 && S.appData.notebooks.length === 0 && S.appData.bookshelves.length === 0) {
        deckList.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="11" x2="13" y2="11"/></svg>
            </div>
            <h3>Inga kortlekar eller anteckningsblock än</h3>
            <p>Tryck "Ny" ovan för att skapa din första kortlek och börja lära dig.</p>
        </div>`;
        return;
    }

    // Helper to render deck or notebook
    const isDeckFullyReviewed = (deck) => {
        const deckCards = deck.cards.filter(c => c.type !== 'note');
        return deckCards.length > 0 && deckCards.every(c => c.nextReviewDate > Date.now());
    };

    const renderItem = (item, type) => {
        const itemEl = document.createElement('div');
        const done = type === 'deck' && isDeckFullyReviewed(item);
        itemEl.className = `deck-card ${type === 'notebook' ? 'notebook' : ''} ${done ? 'deck-done' : ''}`;
        itemEl.draggable = true;
        itemEl.dataset.id = item.id;
        itemEl.dataset.type = type;

        if (type === 'deck') {
            const deckCards = item.cards.filter(c => c.type !== 'note');
            const total = deckCards.length;
            const dueCards = deckCards.filter(c => c.nextReviewDate <= Date.now()).length;
            const doneCards = total - dueCards;
            const reviewedPct = total > 0 ? Math.round((doneCards / total) * 100) : 0;
            
            let itemColor = '#4F46E5';
            if (item.bookshelfId) {
                const shelf = S.appData.bookshelves.find(s => s.id === item.bookshelfId);
                if (shelf && shelf.color) itemColor = shelf.color;
            } else if (item.color) { // Legacy fallback
                itemColor = item.color;
            }
            itemEl.style.setProperty('--deck-color', itemColor);

            itemEl.innerHTML = `
                <div class="deck-card-top">
                    <h3 class="deck-card-title">${escapeHtml(item.title)}</h3>
                    ${rowMenu(`Åtgärder för ${item.title}`, `
                            <button type="button" class="btn-item-rename">Byt namn</button>
                            <button type="button" class="btn-item-move">Flytta till bokhylla</button>
                            <button type="button" class="btn-item-delete danger">Ta bort</button>`)}
                </div>
                <div class="deck-card-foot">
                    <div class="progress" aria-hidden="true">
                        <div class="progress-fill" style="width: ${reviewedPct}%"></div>
                    </div>
                    <div class="deck-card-nums">
                        <span class="deck-card-count num">${total} kort</span>
                        <span class="deck-card-due num${dueCards === 0 ? ' is-clear' : ''}">${dueCards} förfallna</span>
                    </div>
                </div>
            `;
            itemEl.onclick = (e) => {
                // Menyn ligger inuti kortet; utan detta öppnar varje menyval
                // också kortleken bakom.
                if (e.target.closest('.row-menu')) return;
                openDeck(item.id);
            };
        } else if (type === 'notebook') {
            const total = item.notes.length;
            
            let itemColor = '#FF6D01';
            if (item.bookshelfId) {
                const shelf = S.appData.bookshelves.find(s => s.id === item.bookshelfId);
                if (shelf && shelf.color) itemColor = shelf.color;
            } else if (item.color) {
                itemColor = item.color;
            }
            itemEl.style.setProperty('--deck-color', itemColor);

            itemEl.innerHTML = `
                <div class="deck-card-top">
                    <h3 class="deck-card-title">${escapeHtml(item.title)}</h3>
                    ${rowMenu(`Åtgärder för ${item.title}`, `
                            <button type="button" class="btn-item-rename">Byt namn</button>
                            <button type="button" class="btn-item-move">Flytta till bokhylla</button>
                            <button type="button" class="btn-item-delete danger">Ta bort</button>`)}
                </div>
                <div class="deck-card-foot">
                    <div class="deck-card-nums">
                        <span class="deck-card-count num">${total} anteckningar</span>
                    </div>
                </div>
            `;
            itemEl.onclick = (e) => {
                if (e.target.closest('.row-menu')) return;
                openNotebook(item.id);
            };
        }


        itemEl.querySelector('.btn-item-rename')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const newName = await showPromptModal(`Nytt namn för ${type === 'deck' ? 'kortleken' : 'anteckningsblocket'}:`, item.title);
            if (newName && newName.trim()) {
                item.title = newName.trim();
                saveData();
                renderLibrary();
                renderSidebar();
            }
        });

        itemEl.querySelector('.btn-item-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openColorModal(item);
        });

        itemEl.querySelector('.btn-item-move').addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveItemModal(item, type);
        });

        itemEl.querySelector('.btn-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmMsg = type === 'deck'
                ? `Är du säker på att du vill radera kortleken "${item.title}" och alla dess kort?`
                : `Är du säker på att du vill radera anteckningsblocket "${item.title}" och alla dess anteckningar?`;

            if (await showConfirmModal('Radera', confirmMsg, 'Radera', true)) {
                if (type === 'deck') {
                    S.appData.decks = S.appData.decks.filter(d => d.id !== item.id);
                } else {
                    S.appData.notebooks = S.appData.notebooks.filter(n => n.id !== item.id);
                }
                saveData();
                renderLibrary();
                showToast(type === 'deck' ? 'Kortleken har raderats' : 'Anteckningsblocket har raderats');
            }
        });

        itemEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            itemEl.classList.add('dragging');
            S.draggedItemId = item.id;
            S.draggedItemType = type;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', type);
        });

        itemEl.addEventListener('dragend', (e) => {
            e.stopPropagation();
            itemEl.classList.remove('dragging');
            S.draggedItemId = null;
            S.draggedItemType = null;
        });

        itemEl.addEventListener('dragover', (e) => e.preventDefault());
        itemEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            itemEl.classList.remove('drag-over');
            
            if (S.draggedItemId !== null && S.draggedItemType !== null) {
                const sourceList = S.draggedItemType === 'deck' ? S.appData.decks : S.appData.notebooks;
                const targetBookshelfId = item.bookshelfId;
                
                const draggedItem = sourceList.find(i => i.id === S.draggedItemId);
                if (draggedItem) {
                    draggedItem.bookshelfId = targetBookshelfId;
                    
                    if (S.draggedItemType === type && S.draggedItemId !== item.id) {
                        const originalIndex = sourceList.findIndex(i => i.id === S.draggedItemId);
                        const targetIndex = sourceList.findIndex(i => i.id === item.id);
                        if (originalIndex !== -1 && targetIndex !== -1) {
                            const [removed] = sourceList.splice(originalIndex, 1);
                            const newTargetIndex = targetIndex > originalIndex ? targetIndex - 1 : targetIndex;
                            sourceList.splice(newTargetIndex, 0, removed);
                        }
                    }
                }
                
                saveData();
                renderLibrary();
            }
        });
        
        return itemEl;
    };

    // Render Bookshelves
    let shelvesToRender = S.appData.bookshelves;
    if (S.currentBookshelfFilterId) {
        shelvesToRender = S.appData.bookshelves.filter(s => s.id === S.currentBookshelfFilterId);
        
        // Render a back to all button
        const backBtn = document.createElement('div');
        backBtn.className = 'library-filter-row';
        backBtn.innerHTML = `<button type="button" class="chip" onclick="filterBookshelf(null)">← Visa alla</button>`;
        deckList.appendChild(backBtn);
    }

    const isBookshelfFullyReviewed = (shelf) => {
        const shelfDecks = S.appData.decks.filter(d => d.bookshelfId === shelf.id);
        return shelfDecks.length > 0 && shelfDecks.every(d => isDeckFullyReviewed(d));
    };

    shelvesToRender = [...shelvesToRender].sort((a, b) => {
        const aDone = isBookshelfFullyReviewed(a);
        const bDone = isBookshelfFullyReviewed(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return 0;
    });

    shelvesToRender.forEach((shelf) => {
        const shelfDone = isBookshelfFullyReviewed(shelf);
        const shelfEl = document.createElement('div');
        shelfEl.className = `bookshelf-container ${shelfDone ? 'bookshelf-done' : ''}`;

        if (shelf.color) {
            shelfEl.style.setProperty('--bookshelf-color', shelf.color);
        }

        shelfEl.innerHTML = `
            <div class="bookshelf-header">
                <h3 class="bookshelf-title">${escapeHtml(shelf.title)}</h3>
                <button type="button" class="chip btn-bookshelf-study" title="Repetera alla kortlekar i bokhyllan">Repetera alla</button>
                ${rowMenu(`Åtgärder för ${shelf.title}`, `
                        <button type="button" class="btn-bookshelf-rename">Byt namn</button>
                        <button type="button" class="btn-bookshelf-color">Ändra färg</button>
                        <button type="button" class="btn-bookshelf-delete danger">Ta bort</button>`)}
            </div>
            <div class="bookshelf-items grid-container"></div>
        `;

        const itemsContainer = shelfEl.querySelector('.bookshelf-items');

        shelfEl.querySelector('.btn-bookshelf-study').addEventListener('click', (e) => {
            e.stopPropagation();
            startBookshelfStudy(shelf.id);
        });

        shelfEl.querySelector('.btn-bookshelf-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openColorModal(shelf);
        });
        
        itemsContainer.addEventListener('dragover', (e) => e.preventDefault());
        itemsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Don't trigger deckList root drop
            if (S.draggedItemId !== null && S.draggedItemType !== null) {
                if (S.draggedItemType === 'deck') {
                    const item = S.appData.decks.find(d => d.id === S.draggedItemId);
                    if (item) item.bookshelfId = shelf.id;
                } else if (S.draggedItemType === 'notebook') {
                    const item = S.appData.notebooks.find(n => n.id === S.draggedItemId);
                    if (item) item.bookshelfId = shelf.id;
                }
                saveData();
                renderLibrary();
            }
        });

        // Add items to this bookshelf, sorted by latest addition
        const shelfItems = [];
        const getLastUpdated = (item) => {
            let max = parseInt(item.id, 10) || 0;
            if (item.cards) {
                item.cards.forEach(c => {
                    const time = parseInt(c.id, 10) || 0;
                    if (time > max) max = time;
                });
            } else if (item.notes) {
                item.notes.forEach(n => {
                    const time = parseInt(n.id, 10) || 0;
                    if (time > max) max = time;
                });
            }
            return max;
        };

        const shelfTitleMatches = shelf.title.toLowerCase().includes(filter);
        S.appData.decks.forEach((deck, index) => {
            if (deck.bookshelfId === shelf.id && (shelfTitleMatches || itemMatchesFilter(deck, 'deck', filter))) {
                shelfItems.push({ element: renderItem(deck, 'deck', index), updated: getLastUpdated(deck), done: isDeckFullyReviewed(deck) });
            }
        });
        S.appData.notebooks.forEach((notebook, index) => {
            if (notebook.bookshelfId === shelf.id && (shelfTitleMatches || itemMatchesFilter(notebook, 'notebook', filter))) {
                shelfItems.push({ element: renderItem(notebook, 'notebook', index), updated: getLastUpdated(notebook), done: false });
            }
        });

        shelfItems.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.updated - a.updated;
        });
        shelfItems.forEach(item => itemsContainer.appendChild(item.element));

        if(itemsContainer.children.length === 0) {
            itemsContainer.innerHTML = '<p class="bookshelf-empty">Dra och släpp kortlekar eller anteckningsblock här</p>';
        }

        shelfEl.querySelector('.btn-bookshelf-rename').addEventListener('click', async (e) => {
            e.stopPropagation();
            const newTitle = await showPromptModal('Nytt namn för bokhyllan:', shelf.title);
            if (newTitle && newTitle.trim() !== '') {
                shelf.title = newTitle.trim();
                saveData();
                renderLibrary();
                renderSidebar();
                showToast('Bokhyllan har bytt namn');
            }
        });

        shelfEl.querySelector('.btn-bookshelf-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            S.currentBookshelfToDelete = shelf.id;
            document.getElementById('modal-delete-bookshelf').classList.remove('hidden');
        });

        if (!filter || shelfTitleMatches || shelfItems.length > 0) {
            deckList.appendChild(shelfEl);
        }
    });

    // Root items (No bookshelfId)
    if (!S.currentBookshelfFilterId) {
        const rootItems = [];
        const getLastUpdated = (item) => {
            let max = parseInt(item.id, 10) || 0;
            if (item.cards) {
                item.cards.forEach(c => {
                    const time = parseInt(c.id, 10) || 0;
                    if (time > max) max = time;
                });
            } else if (item.notes) {
                item.notes.forEach(n => {
                    const time = parseInt(n.id, 10) || 0;
                    if (time > max) max = time;
                });
            }
            return max;
        };

        S.appData.decks.forEach((deck, index) => {
            if (!deck.bookshelfId && itemMatchesFilter(deck, 'deck', filter)) {
                rootItems.push({ element: renderItem(deck, 'deck', index), updated: getLastUpdated(deck), done: isDeckFullyReviewed(deck) });
            }
        });
        S.appData.notebooks.forEach((notebook, index) => {
            if (!notebook.bookshelfId && itemMatchesFilter(notebook, 'notebook', filter)) {
                rootItems.push({ element: renderItem(notebook, 'notebook', index), updated: getLastUpdated(notebook), done: false });
            }
        });

        rootItems.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.updated - a.updated;
        });

        // Rubrik bara när det finns bokhyllor ovanför. Utan den ser de lösa
        // kortlekarna ut som om de hörde till den sista bokhyllan.
        if (rootItems.length > 0 && deckList.querySelector('.bookshelf-container')) {
            const label = document.createElement('div');
            label.className = 'library-group-label label';
            label.textContent = 'Utan bokhylla';
            deckList.appendChild(label);
        }

        rootItems.forEach(item => deckList.appendChild(item.element));
    }

    // Update global study button
    const allDueCards = S.appData.decks.flatMap(d => d.cards.filter(c => c.nextReviewDate <= Date.now()));
    const globalBtn = document.getElementById('btn-study-all');
    const globalLabel = document.getElementById('btn-study-all-label');
    if (allDueCards.length > 0) {
        globalBtn.classList.remove('hidden');
        globalLabel.innerText = `Repetera`;
    } else {
        globalBtn.classList.add('hidden');
    }

    renderSidebar();
};

export function initUiLibrary() {

  /* Radmenyerna är <details> och stängs inte av sig själva. Utan detta blir
   * varje öppnad meny liggande kvar, och på en lista med trettio kort står
   * snart lika många menyer öppna samtidigt. Escape stänger också, eftersom
   * en meny som bara går att stänga med musen inte går att stänga alls med
   * tangentbordet. */
  const closeRowMenus = (except) => {
      document.querySelectorAll('.row-menu[open]').forEach((menu) => {
          if (menu !== except) menu.removeAttribute('open');
      });
  };

  document.addEventListener('click', (e) => {
      // Bara menyn vars egen knapp trycktes får stå kvar. Ett tryck på ett
      // menyval stänger menyn, eftersom valet är utfört.
      const toggle = e.target.closest('.row-menu-toggle');
      closeRowMenus(toggle ? toggle.parentElement : null);
  });

  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeRowMenus(null);
  });

  // --- RENDERING ---
  S.draggedItemId = null;
  S.draggedItemType = null;
  S.draggedCardId = null;
  S.currentBookshelfToDelete = null;

  S.librarySearchFilter = '';
}
