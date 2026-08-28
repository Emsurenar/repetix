import { openMoveItemModal } from '../ai/client.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { renderDagensMapp } from './dagens-mapp.js';
import { openDeck, openNotebook } from './deck.js';
import { deckList } from './dom.js';
import { openColorModal, renderSidebar } from './modals-wiring.js';
import { showConfirmModal, showPromptModal } from './modals.js';
import { showToast } from './toast.js';


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

export const renderLibrary = () => {
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
                <div class="deck-header">
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-item-rename">Byt namn</button>
                            <button class="btn-item-move">Flytta till bokhylla</button>
                            <button class="btn-item-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
                <div class="deck-title">${escapeHtml(item.title)}</div>
                <div class="deck-progress">
                    <div class="deck-progress-track">
                        <div class="deck-progress-fill" style="width: ${reviewedPct}%"></div>
                    </div>
                </div>
            `;
            itemEl.onclick = () => openDeck(item.id);
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
                <div class="deck-header">
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-item-rename">Byt namn</button>
                            <button class="btn-item-move">Flytta till bokhylla</button>
                            <button class="btn-item-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
                <div class="deck-title">${escapeHtml(item.title)}</div>
                <div class="deck-meta">
                    <span>${total} anteckningar totalt</span>
                </div>
            `;
            itemEl.onclick = () => openNotebook(item.id);
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
        backBtn.innerHTML = `<button class="btn-action-chip" style="margin-bottom: 1.5rem;" onclick="filterBookshelf(null)">← Visa alla</button>`;
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

    shelvesToRender.forEach((shelf, shelfIndex) => {
        const shelfDone = isBookshelfFullyReviewed(shelf);
        const shelfEl = document.createElement('div');
        shelfEl.className = `bookshelf-container ${shelfDone ? 'bookshelf-done' : ''}`;
        shelfEl.style.gridColumn = "1 / -1";
        shelfEl.style.marginBottom = "1rem";
        
        if (shelf.color) {
            shelfEl.style.setProperty('--bookshelf-color', shelf.color);
        }

        shelfEl.innerHTML = `
            <div class="bookshelf-header" style="${shelf.color ? `border-bottom: 2px solid ${shelf.color};` : ''}">
                <div style="flex: 1; display: flex; align-items: center; gap: 1rem; cursor: pointer;" onclick="startBookshelfStudy('${shelf.id}')" title="Klicka för att repetera alla kortlekar i bokhyllan">
                    <h3>${escapeHtml(shelf.title)}</h3>
                    <button class="btn-action-chip btn-bookshelf-study">Repetera alla</button>
                </div>
                <div class="card-menu-container">
                    <button class="btn-bookshelf-menu-toggle btn-card-menu-toggle">⋮</button>
                    <div class="card-menu-dropdown">
                        <button class="btn-bookshelf-rename">Byt namn</button>
                        <button class="btn-bookshelf-color">Ändra färg</button>
                        <button class="btn-bookshelf-delete">Ta bort</button>
                    </div>
                </div>
            </div>
            <div class="bookshelf-items bookshelf-grid"></div>
        `;

        const itemsContainer = shelfEl.querySelector('.bookshelf-items');
        
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
            itemsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); font-size: 0.9rem; margin-top: 1rem;">Dra och släpp kortlekar eller anteckningsblock här</div>';
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

  // --- RENDERING ---
  S.draggedItemId = null;
  S.draggedItemType = null;
  S.draggedCardId = null;
  S.currentBookshelfToDelete = null;

  S.librarySearchFilter = '';
}
