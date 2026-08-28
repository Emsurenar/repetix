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


/* Samma menyikon och samma radmeny som i biblioteket. En <details> är alltid
 * synlig och öppnas av ett tryck; det gamla :hover-beroendet gjorde Redigera,
 * Flytta och Radera oåtkomliga på telefon. */
const MENU_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>`;

/* Attributvärde. escapeHtml() går via innerHTML och lämnar citattecken orörda,
 * vilket duger i textinnehåll men inte i ett attribut: en mapp som heter
 * 5" diskett skulle annars bryta sig ur aria-label. */
const attr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

const rowMenu = (label, items) => `
    <details class="row-menu">
        <summary class="row-menu-toggle" aria-label="${attr(label)}">${MENU_ICON}</summary>
        <div class="row-menu-items">${items}</div>
    </details>`;


export const studyDagensMapp = (deckId, sectionId) => {
    S.currentDeckId = deckId;
    startSectionStudy(sectionId, false);
};

// Update existing renderDecks calls to renderLibrary
/* Knappen som startar en AI-generering i insiktspanelerna. Texten sager vad
 * som hander, inte att man ska klicka: "Klicka for att generera" beskrev
 * musen, inte resultatet. */
const aiGenerateButton = (vilken) =>
    `<button type="button" class="btn deck-ai-generate" data-ai-generate="${vilken}">${
        vilken === 'summary' ? 'Sammanfatta kortleken' : 'Föreslå ett kort'
    }</button>`;

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

    // Underrubrik med kortlekens två tal, så att omfattningen syns direkt under
    // titeln i stället för att behöva räknas ihop ur listan.
    const metaEl = document.getElementById('current-deck-meta');
    if (metaEl) {
        const studyable = displayCards.filter(c => c.type !== 'note').length;
        metaEl.innerHTML = dueCount > 0
            ? `${studyable} kort <span class="deck-heading-due">${dueCount} förfallna</span>`
            : `${studyable} kort`;
    }

    /* Kortlekens ingång. Tre lägen, samma form: en etikett, en mening, och en
     * knapp som bär handlingen. Panelen följer "Dagens mapp" i biblioteket —
     * det är samma sorts påstående, och det ska se likadant ut. */
    const heroStatus = document.getElementById('deck-hero-status');
    const studyable = displayCards.filter(c => c.type !== 'note').length;

    if (studyable === 0) {
        heroStatus.className = 'deck-hero is-quiet';
        heroStatus.dataset.action = '';
        heroStatus.innerHTML = `
            <div class="deck-hero-body">
                <p class="label deck-hero-kicker">Tom kortlek</p>
                <p class="deck-hero-title">Inga kort i leken ännu</p>
            </div>
            <button type="button" class="btn" data-hero-action="new">Nytt kort</button>
        `;
    } else if (dueCount === 0) {
        heroStatus.className = 'deck-hero is-quiet';
        heroStatus.dataset.action = 'study-early';
        heroStatus.innerHTML = `
            <div class="deck-hero-body">
                <p class="label deck-hero-kicker">Klart för idag</p>
                <p class="deck-hero-title">Inget förfaller just nu</p>
            </div>
            <button type="button" class="btn" data-hero-action="study-early">Träna ändå</button>
        `;
    } else {
        heroStatus.className = 'deck-hero';
        heroStatus.dataset.action = 'study';
        heroStatus.innerHTML = `
            <div class="deck-hero-body">
                <p class="label deck-hero-kicker">Att repetera</p>
                <p class="deck-hero-title"><span class="num">${dueCount}</span> ${dueCount === 1 ? 'kort väntar' : 'kort väntar'}</p>
            </div>
            <button type="button" class="btn primary lg" data-hero-action="study">Repetera</button>
        `;
    }

    heroStatus.querySelector('[data-hero-action]')?.addEventListener('click', (e) => {
        const handling = e.currentTarget.dataset.heroAction;
        if (handling === 'new') document.getElementById('btn-add-card').click();
        else document.getElementById('btn-study').click();
    });

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
            summaryText.innerHTML = aiGenerateButton('summary');
            summaryBox.classList.remove('deck-ai-loaded');
            summaryBox.onclick = () => generateDeckSummary();
        }
        // Suggestion always starts as placeholder
        const suggestionContent = document.getElementById('deck-ai-suggestion-content');
        const suggestionBox = document.getElementById('deck-ai-suggestion');
        suggestionContent.innerHTML = aiGenerateButton('suggestion');
        suggestionBox.classList.remove('deck-ai-loaded');

        /* Knapparna ritas om varje gang kortleken oppnas. Delegering pa
         * behallaren i stallet for en lyssnare per knapp, sa att inget
         * staplas pa sig. */
        insightsContainer.onclick = (e) => {
            const knapp = e.target.closest('[data-ai-generate]');
            if (!knapp) return;
            if (knapp.dataset.aiGenerate === 'summary') window.generateDeckSummary();
            else window.generateDeckSuggestion();
        };
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
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="question">${safeParse(card.front)}</div>
            <div class="answer">${safeParse(card.back)}</div>
        </div>
        <div class="list-item-right">
            <span class="card-state${isDue ? ' is-due' : ''}" title="${isDue ? 'Ska repeteras' : 'Väntar'}"></span>
            ${rowMenu('Åtgärder för kortet', `
                    <button type="button" class="btn-study-card">Repetera direkt</button>
                    <button type="button" class="btn-edit-card">Redigera</button>
                    <button type="button" class="btn-move-card">Flytta</button>
                    <button type="button" class="btn-delete-card danger">Ta bort</button>`)}
        </div>
    `;

    listItem.addEventListener('click', (e) => {
        if (e.target.closest('.row-menu')) return;
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
        <div class="list-item-right">
            ${rowMenu('Åtgärder för anteckningen', `
                    <button type="button" class="btn-edit-note-card">Redigera</button>
                    <button type="button" class="btn-delete-card danger">Ta bort</button>`)}
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
        cardList.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
            </div>
            <h3>Kortleken väntar på sitt första kort</h3>
            <p>Skriv in ett själv, eller låt AI:n föreslå kort utifrån ett ämne eller en text du klistrar in.</p>
            <div class="empty-state-actions">
                <button type="button" class="btn primary" data-empty-action="card">Nytt kort</button>
                <button type="button" class="btn" data-empty-action="ai">AI-generera</button>
            </div>
        </div>`;
        cardList.querySelector('[data-empty-action="card"]')
            ?.addEventListener('click', () => document.getElementById('btn-add-card').click());
        cardList.querySelector('[data-empty-action="ai"]')
            ?.addEventListener('click', () => document.getElementById('btn-open-topic-generator').click());
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

        const sectionEl = document.createElement('div');
        sectionEl.id = 'section-' + section.id;
        sectionEl.className = 'section-container collapsed';
        // Utfällningsknappen är ett <button> och inte en <div>: mappar måste gå
        // att fälla ut med tangentbordet, inte bara med musen. Räknetalen ligger
        // utanför knappen eftersom en knapp inte får innehålla en annan knapp.
        sectionEl.innerHTML = `
            <div class="section-header">
                <button type="button" class="section-header-left" aria-expanded="false" title="Fäll ut eller in mappen">
                    <svg class="section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    <span class="section-title">${escapeHtml(section.title)}</span>
                </button>
                <span class="section-count num">${cardsInSection.length} kort</span>
                ${dueInSection > 0 ? `<button type="button" class="section-due num btn-section-study" title="Repetera mappen nu" aria-label="${dueInSection} förfallna kort, repetera mappen">${dueInSection}<span class="section-due-word"> förfallna</span></button>` : ''}
                <div class="section-tools">
                    <button type="button" class="btn-icon btn-section-add-card" title="Lägg till kort i ${attr(section.title)}" aria-label="Lägg till kort i ${attr(section.title)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    ${rowMenu(`Åtgärder för ${section.title}`, `
                            <button type="button" class="btn-section-rename">Byt namn</button>
                            <button type="button" class="btn-section-move">Flytta</button>
                            <button type="button" class="btn-section-delete danger">Ta bort</button>`)}
                </div>
            </div>
            <div class="section-items list-container"></div>
        `;

        const sectionHeader = sectionEl.querySelector('.section-header');
        const sectionItems = sectionEl.querySelector('.section-items');

        sectionEl.querySelector('.btn-section-study')?.addEventListener('click', (e) => {
            e.stopPropagation();
            startSectionStudy(section.id, false);
        });

        const addCardBtn = sectionEl.querySelector('.btn-section-add-card');
        addCardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            S.preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });
        
        if (cardsInSection.length === 0) {
            sectionItems.innerHTML = '<p class="section-empty">Inga kort ännu</p>';
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
            const collapsed = sectionEl.classList.toggle('collapsed');
            e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
        });

        // Double-click header to study section
        sectionEl.querySelector('.section-header-left').addEventListener('dblclick', () => {
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
            <div class="list-item-right">
                ${rowMenu('Åtgärder för anteckningen', `
                        <button type="button" class="btn-edit-note">Redigera</button>
                        <button type="button" class="btn-delete-note danger">Ta bort</button>`)}
            </div>
        `;

        noteEl.onclick = (e) => {
            if (e.target.closest('.row-menu')) return;
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
