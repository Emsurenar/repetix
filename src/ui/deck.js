import { generateDeckSuggestion, generateDeckSummary } from '../ai/deck-insights.js';
import { deleteSection, openCardModal, openEditCardModal, openMoveCardModal, openMoveSectionModal, openNoteCardModal, openSectionModal } from '../ai/client.js';
import { SUMMARY_REGEN_THRESHOLD, deckSummaryCache } from '../ai/deck-insights.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { cardList } from './dom.js';
import { safeParse } from './images.js';
import { renderLatex } from './latex.js';
import { renderLibrary } from './library.js';
import { showConfirmModal } from './modals.js';
import { switchView } from './router.js';
import { renderStudyCard, startSectionStudy, startStudy } from './study.js';


export const studyDagensMapp = (deckId, sectionId) => {
    S.currentDeckId = deckId;
    startSectionStudy(sectionId, false);
};

// Update existing renderDecks calls to renderLibrary
export const renderDecks = renderLibrary;

export const openDeck = (id, sectionId = null) => {
    S.currentDeckId = id;
    S.currentSectionId = sectionId;
    const deck = S.appData.decks.find(d => d.id === id);
    const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
    document.getElementById('current-deck-title').innerText = section ? `${deck.title} › ${section.title}` : deck.title;

    let displayCards = deck.cards;
    if (sectionId) {
        displayCards = deck.cards.filter(c => c.sectionId === sectionId);
    }

    const dueCount = displayCards.filter(c => c.nextReviewDate <= Date.now()).length;
    const heroStatus = document.getElementById('deck-hero-status');
    
    let itemColor = '#4F46E5';
    if (deck.bookshelfId) {
        const shelf = S.appData.bookshelves.find(s => s.id === deck.bookshelfId);
        if (shelf && shelf.color) itemColor = shelf.color;
    } else if (deck.color) {
        itemColor = deck.color;
    }
    
    heroStatus.style.setProperty('--deck-color', itemColor);

    if (displayCards.length === 0) {
        heroStatus.className = 'deck-hero-status asleep';
        heroStatus.innerHTML = `
            <div class="hero-status-number">0</div>
            <div class="hero-status-text">Inga kort i denna lek ännu.</div>
        `;
        heroStatus.dataset.action = '';
    } else if (dueCount === 0) {
        heroStatus.className = 'deck-hero-status done';
        heroStatus.innerHTML = `
            <div class="hero-done-check">✓</div>
            <div class="hero-status-text">Allt klart för idag</div>
            <div class="hero-done-link">Träna ändå →</div>
        `;
        heroStatus.dataset.action = 'study-early';
    } else {
        heroStatus.className = 'deck-hero-status active';
        heroStatus.innerHTML = `
            <div class="hero-status-number">${dueCount}</div>
            <div class="hero-status-text">kort väntar på dig. Börja repetera →</div>
        `;
        heroStatus.dataset.action = 'study';
    }

    document.getElementById('btn-study').onclick = (e) => {
        e.preventDefault();
        const action = heroStatus.dataset.action;
        if (!action) return;
        const isEarly = action === 'study-early';
        if (sectionId) startSectionStudy(sectionId, isEarly);
        else startStudy(isEarly);
    };

    renderCards(displayCards);
    switchView('deck', sectionId);

    // Show AI insight boxes (click-to-generate, not auto)
    const insightsContainer = document.getElementById('deck-ai-insights');
    const deckCards = deck.cards.filter(c => c.type !== 'note');
    if (!sectionId && deckCards.length >= 2) {
        insightsContainer.classList.remove('hidden');
        // Restore cached summary if available, otherwise show placeholder
        const cached = deckSummaryCache[id];
        const summaryText = document.getElementById('deck-ai-summary-text');
        const summaryBox = document.getElementById('deck-ai-summary');
        if (cached && cached.summaryHtml && Math.abs(deckCards.length - cached.cardCount) < SUMMARY_REGEN_THRESHOLD) {
            summaryText.innerHTML = cached.summaryHtml;
            renderLatex(summaryText);
            summaryBox.classList.add('deck-ai-loaded');
            summaryBox.onclick = null;
        } else {
            summaryText.innerHTML = '<span class="deck-ai-placeholder">Klicka för att generera</span>';
            summaryBox.classList.remove('deck-ai-loaded');
            summaryBox.onclick = () => generateDeckSummary();
        }
        // Suggestion always starts as placeholder
        const suggestionContent = document.getElementById('deck-ai-suggestion-content');
        const suggestionBox = document.getElementById('deck-ai-suggestion');
        suggestionContent.innerHTML = '<span class="deck-ai-placeholder">Klicka för att generera</span>';
        suggestionBox.classList.remove('deck-ai-loaded');
        suggestionBox.onclick = () => generateDeckSuggestion();
    } else {
        insightsContainer.classList.add('hidden');
    }
};

const renderCardItem = (card, deck) => {
    const isDue = card.nextReviewDate <= Date.now();
    const listItem = document.createElement('div');
    listItem.id = 'card-' + card.id;
    listItem.className = 'list-item';
    listItem.style.cursor = 'pointer';
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="question" style="font-size: 1.05rem; padding: 0.35rem 0;">${safeParse(card.front)}</div>
            <div class="answer">${safeParse(card.back)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;" class="list-item-right">
            ${isDue ? '<div title="Ska repeteras" style="width:10px; height:10px; border-radius:50%; background:var(--rate-1); border:none; flex-shrink:0;"></div>' : '<div title="Väntar" style="width:10px; height:10px; border-radius:50%; background:var(--border-color); border:none; flex-shrink:0;"></div>'}
            <div class="card-menu-container">
                <button class="btn-card-menu-toggle">⋮</button>
                <div class="card-menu-dropdown">
                    <button class="btn-study-card">Repetera direkt</button>
                    <button class="btn-edit-card">Redigera</button>
                    <button class="btn-move-card">Flytta</button>
                    <button class="btn-delete-card">Ta bort</button>
                </div>
            </div>
        </div>
    `;

    listItem.addEventListener('click', (e) => {
        if (e.target.closest('.card-menu-container')) return;
        if (listItem.classList.contains('expanded')) {
            listItem.classList.remove('expanded');
        } else {
            document.querySelectorAll('.list-item.expanded').forEach(el => el.classList.remove('expanded'));
            listItem.classList.add('expanded');
        }
    });
    listItem.addEventListener('dblclick', () => openCardModal(card));
    
    // Drag and Drop listeners
    listItem.addEventListener('dragstart', (e) => {
        S.draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id); // Explicit data transfer
        e.stopPropagation();
    });
    
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        S.draggedCardId = null;
    });

    const dropdown = listItem.querySelector('.card-menu-dropdown');

    listItem.querySelector('.btn-study-card').addEventListener('click', (e) => {
        e.stopPropagation();
        S.currentStudyCards = [card];
        S.currentStudyIndex = 0;
        renderStudyCard();
        switchView('study');
    });
    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera kort', 'Är du säker på att du vill radera detta kort?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(deck.cards);
        }
    });

    listItem.querySelector('.btn-edit-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditCardModal(card);
    });

    listItem.querySelector('.btn-move-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveCardModal(card);
    });

    renderLatex(listItem);
    return listItem;
};

const renderNoteCardItem = (card, deck) => {
    const listItem = document.createElement('div');
    listItem.id = 'card-' + card.id;
    listItem.className = 'list-item note-card-item';
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="note-card-icon"></div>
            <div class="note-card-text">${safeParse(card.content)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;" class="list-item-right">
            <div class="card-menu-container">
                <button class="btn-card-menu-toggle">⋮</button>
                <div class="card-menu-dropdown">
                    <button class="btn-edit-note-card">Redigera</button>
                    <button class="btn-delete-card">Ta bort</button>
                </div>
            </div>
        </div>
    `;

    listItem.addEventListener('dragstart', (e) => {
        S.draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id);
        e.stopPropagation();
    });
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        S.draggedCardId = null;
    });

    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera anteckning', 'Är du säker på att du vill radera denna anteckning?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(deck.cards);
        }
    });

    listItem.querySelector('.btn-edit-note-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteCardModal(card);
    });

    renderLatex(listItem);
    return listItem;
};

export const renderCards = (cards) => {
    cardList.innerHTML = '';
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    if (cards.length === 0 && deck.sections.length === 0) {
        cardList.innerHTML = `<div class="empty-state" style="padding: 2rem;">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
            </div>
            <h3>Denna kortlek är tom</h3>
            <p>Börja med att lägga till ett nytt kort i verktygsmenyn ovan.</p>
        </div>`;
        return;
    }

    // Render Root Section (cards without sectionId)
    const rootCards = deck.cards.filter(c => !c.sectionId);
    if (rootCards.length > 0 || deck.sections.length > 0) {
        const rootContainer = document.createElement('div');
        rootContainer.className = 'section-container root-section';
        rootContainer.innerHTML = `<div class="section-items list-container"></div>`;
        const itemsList = rootContainer.querySelector('.section-items');
        
        // Root Drop Zone logic
        rootContainer.addEventListener('dragover', (e) => e.preventDefault());
        
        rootContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            rootContainer.classList.add('dragging-over');
        });
        
        rootContainer.addEventListener('dragleave', () => {
            rootContainer.classList.remove('dragging-over');
        });

        rootContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            rootContainer.classList.remove('dragging-over');
            const cardId = e.dataTransfer.getData('cardId') || S.draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = null;
                    saveData();
                    renderCards(deck.cards);
                }
            }
        });

        rootCards.forEach(card => {
            itemsList.appendChild(card.type === 'note' ? renderNoteCardItem(card, deck) : renderCardItem(card, deck));
        });
        cardList.appendChild(rootContainer);
    }

    // Render Sections
    deck.sections.forEach(section => {
        const cardsInSection = deck.cards.filter(c => c.sectionId === section.id);
        const dueInSection = cardsInSection.filter(c => c.nextReviewDate <= Date.now() && c.type !== 'note').length;
        
        let dotColor = 'transparent';
        let dotTitle = 'Inga kort väntar';
        if (dueInSection > 0) {
            if (dueInSection < 5) dotColor = 'var(--rate-2)'; // yellow
            else if (dueInSection < 15) dotColor = '#f29900'; // orange
            else dotColor = 'var(--rate-1)'; // red
            dotTitle = `${dueInSection} kort väntar. Klicka för att repetera.`;
        }

        const sectionEl = document.createElement('div');
        sectionEl.id = 'section-' + section.id;
        sectionEl.className = 'section-container collapsed';
        sectionEl.innerHTML = `
            <div class="section-header">
                <div class="section-header-left" title="Klicka för att fälla ut/in">
                    <svg class="section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    <span>${escapeHtml(section.title)}</span>
                    ${dueInSection > 0 ? `<button onclick="event.stopPropagation(); startSectionStudy('${section.id}', false);" title="${dotTitle}" style="width:10px; height:10px; border-radius:50%; background:${dotColor}; border:none; padding:0; margin-left:0.5rem; cursor:pointer; flex-shrink:0;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'"></button>` : ''}
                </div>
                <div class="section-tools">
                    <button class="btn-section-add btn-section-add-card" title="Lägg till kort i ${escapeHtml(section.title)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-section-rename">Byt namn</button>
                            <button class="btn-section-move">Flytta</button>
                            <button class="btn-section-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="section-items list-container"></div>
        `;

        const sectionHeader = sectionEl.querySelector('.section-header');
        const sectionItems = sectionEl.querySelector('.section-items');

        const addCardBtn = sectionEl.querySelector('.btn-section-add-card');
        addCardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            S.preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });
        
        if (cardsInSection.length === 0) {
            sectionItems.innerHTML = '<div style="padding: 1rem 1.5rem; color: var(--text-secondary); font-size: 0.85rem; font-style: italic;">Inga kort ännu</div>';
        } else {
            cardsInSection.forEach(card => {
                sectionItems.appendChild(card.type === 'note' ? renderNoteCardItem(card, deck) : renderCardItem(card, deck));
            });
        }

        // Fix: Using a counter for dragenter/leave to prevent flicker when dragging over child elements
        let sectionDragCounter = 0;

        sectionHeader.addEventListener('dragenter', (e) => {
            e.preventDefault();
            sectionDragCounter++;
            if (sectionDragCounter === 1) {
                sectionHeader.classList.add('drag-over');
            }
        });
        sectionHeader.addEventListener('dragover', (e) => e.preventDefault());
        sectionHeader.addEventListener('dragleave', () => {
            sectionDragCounter--;
            if (sectionDragCounter === 0) {
                sectionHeader.classList.remove('drag-over');
            }
        });

        sectionEl.addEventListener('drop', (e) => {
            e.preventDefault();
            sectionHeader.classList.remove('drag-over');
            const cardId = e.dataTransfer.getData('cardId') || S.draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = section.id;
                    saveData();
                    renderCards(deck.cards);
                }
            }
        });

        // Collapse toggle
        sectionEl.querySelector('.section-header-left').addEventListener('click', (e) => {
            sectionEl.classList.toggle('collapsed');
        });

        // Double-click header to study section
        sectionEl.querySelector('.section-header-left').addEventListener('dblclick', (e) => {
            startSectionStudy(section.id);
        });

        sectionEl.querySelector('.btn-section-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openSectionModal(section);
        });

        sectionEl.querySelector('.btn-section-move').addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveSectionModal(section.id);
        });

        sectionEl.querySelector('.btn-section-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSection(section.id);
        });

        sectionEl.querySelector('.section-header').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            S.preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });

        cardList.appendChild(sectionEl);
    });
};

export const openNotebook = (id) => {
    S.currentNotebookId = id;
    const notebook = S.appData.notebooks.find(n => n.id === id);
    document.getElementById('current-notebook-title').innerText = notebook.title;
    renderNotes(notebook.notes);
    switchView('notebook');
};

const renderNotes = (notes) => {
    const noteList = document.getElementById('note-list');
    noteList.innerHTML = '';

    if (notes.length === 0) {
        noteList.innerHTML = `<div class="empty-state" style="padding: 2rem;">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </div>
            <h3>Inga anteckningar än</h3>
            <p>Klicka "Lägg till anteckning" för att börja skriva.</p>
        </div>`;
        return;
    }

    [...notes].reverse().forEach(note => {
        const noteEl = document.createElement('div');
        noteEl.className = 'note-item';
        noteEl.innerHTML = `
            <div class="note-content-summary">${safeParse(note.content)}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="card-menu-container">
                    <button class="btn-card-menu-toggle">⋮</button>
                    <div class="card-menu-dropdown">
                        <button class="btn-edit-note">Redigera</button>
                        <button class="btn-delete-note">Ta bort</button>
                    </div>
                </div>
            </div>
        `;

        noteEl.onclick = () => {
            S.currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Visa anteckning';
            switchView('addNote');
        };

        noteEl.querySelector('.btn-delete-note').onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirmModal('Radera anteckning', 'Vill du verkligen radera denna anteckning?', 'Radera', true)) {
                const notebook = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
                notebook.notes = notebook.notes.filter(n => n.id !== note.id);
                saveData();
                renderNotes(notebook.notes);
            }
        };

        noteEl.querySelector('.btn-edit-note').onclick = (e) => {
            e.stopPropagation();
            S.currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Redigera anteckning';
            switchView('addNote');
        };

        noteList.appendChild(noteEl);
        renderLatex(noteEl);
    });
};
