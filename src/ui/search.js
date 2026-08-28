import { filterBookshelf } from './modals-wiring.js';
import { deleteSection } from '../ai/client.js';
import { renameDeck } from '../app/init.js';
import { stripHtml } from '../core/backup.js';
import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { renderDagensMapp } from './dagens-mapp.js';
import { openDeck, openNotebook, studyDagensMapp } from './deck.js';
import { renderLibrary } from './library.js';
import { renderSidebar } from './modals-wiring.js';
import { switchView } from './router.js';
import { startBookshelfStudy, startSectionStudy } from './study.js';


/** Id:t på en träffrad. Behövs för aria-activedescendant. */
const resultId = (index) => `global-search-result-${index}`;

export const openGlobalSearch = () => {
    const modal = document.getElementById('modal-global-search');
    const input = document.getElementById('global-search-input');
    if (!modal || !input) return;

    modal.classList.remove('hidden');
    input.value = '';
    S.activeSearchResultIndex = -1;
    S.currentSearchResults = [];
    performGlobalSearch();

    setTimeout(() => input.focus(), 50);
};

export const closeGlobalSearch = () => {
    const modal = document.getElementById('modal-global-search');
    if (modal) modal.classList.add('hidden');
    // Listan finns inte längre, så fältet får inte fortsätta hävda att den är
    // öppen eller peka ut en rad som inte visas.
    const input = document.getElementById('global-search-input');
    input?.setAttribute('aria-expanded', 'false');
    input?.removeAttribute('aria-activedescendant');
};



const highlightMatch = (text, query) => {
    const escapedText = escapeHtml(text);
    if (!query) return escapedText;
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight-match">$1</span>');
};

export const performGlobalSearch = () => {
    const resultsContainer = document.getElementById('global-search-results');
    const countSpan = document.getElementById('global-search-count');
    const input = document.getElementById('global-search-input');
    if (!resultsContainer || !countSpan || !input) return;

    const query = input.value.trim().toLowerCase();
    resultsContainer.innerHTML = '';
    S.activeSearchResultIndex = -1;
    S.currentSearchResults = [];
    // Ingen markerad rad kvar att peka på när listan ritas om.
    input.removeAttribute('aria-activedescendant');

    if (!query) {
        input.setAttribute('aria-expanded', 'false');
        // Tomt, inte en uppmaning. Fältet ovanför säger redan "Sök i
        // biblioteket"; en rad under som säger "Skriv för att söka" är samma
        // mening en gång till. Panelen faller ihop till fält och fot.
        countSpan.textContent = '';
        return;
    }

    const matchedBookshelves = [];
    const matchedDecks = [];
    const matchedSections = [];
    const matchedCards = [];
    const matchedNotebooks = [];
    const matchedNotes = [];

    // 1. Search Bookshelves
    S.appData.bookshelves.forEach(shelf => {
        if (shelf.title.toLowerCase().includes(query)) {
            matchedBookshelves.push({
                type: 'bookshelf',
                id: shelf.id,
                title: shelf.title,
                subtitle: 'Bokhylla',
                action: () => {
                    filterBookshelf(shelf.id);
                    closeGlobalSearch();
                }
            });
        }
    });

    // 2. Search Decks & Sections & Cards
    S.appData.decks.forEach(deck => {
        const bookshelf = deck.bookshelfId ? S.appData.bookshelves.find(s => s.id === deck.bookshelfId) : null;
        const deckPath = bookshelf ? `${bookshelf.title}` : 'Rotkatalog';

        // Check Deck title
        if (deck.title.toLowerCase().includes(query)) {
            matchedDecks.push({
                type: 'deck',
                id: deck.id,
                title: deck.title,
                subtitle: `Kortlek • I ${deckPath} • ${deck.cards.filter(c => c.type !== 'note').length} kort`,
                action: () => {
                    openDeck(deck.id);
                    closeGlobalSearch();
                }
            });
        }

        // Check Sections
        if (deck.sections) {
            deck.sections.forEach(section => {
                if (section.title.toLowerCase().includes(query)) {
                    matchedSections.push({
                        type: 'section',
                        id: section.id,
                        deckId: deck.id,
                        title: section.title,
                        subtitle: `Mapp i "${deck.title}" • ${deckPath}`,
                        action: () => {
                            highlightSection(deck.id, section.id);
                            closeGlobalSearch();
                        }
                    });
                }
            });
        }

        // Check Cards
        deck.cards.forEach(card => {
            const frontText = stripHtml(card.front);
            const backText = stripHtml(card.back || card.content || '');
            if (frontText.toLowerCase().includes(query) || backText.toLowerCase().includes(query)) {
                let cardLabel = card.type === 'note' ? 'Anteckningskort' : 'Kort';
                const section = card.sectionId && deck.sections ? deck.sections.find(s => s.id === card.sectionId) : null;
                const path = section ? `"${deck.title}" › "${section.title}"` : `"${deck.title}"`;
                
                // Construct matched snippet preview
                let snippet = '';
                if (frontText.toLowerCase().includes(query)) {
                    snippet = `Fråga: ${frontText}`;
                } else {
                    snippet = `Svar: ${backText}`;
                }

                // Limit snippet size
                if (snippet.length > 90) {
                    const idx = snippet.toLowerCase().indexOf(query);
                    const start = Math.max(0, idx - 30);
                    snippet = (start > 0 ? '...' : '') + snippet.substring(start, start + 90) + (snippet.length > start + 90 ? '...' : '');
                }

                matchedCards.push({
                    type: card.type === 'note' ? 'notecard' : 'card',
                    id: card.id,
                    deckId: deck.id,
                    title: card.type === 'note' ? backText.substring(0, 50) + (backText.length > 50 ? '...' : '') : frontText,
                    subtitle: `${cardLabel} i ${path}`,
                    snippet: snippet,
                    action: () => {
                        highlightCard(card.id);
                        closeGlobalSearch();
                    }
                });
            }
        });
    });

    // 3. Search Notebooks & Notes
    S.appData.notebooks.forEach(notebook => {
        const bookshelf = notebook.bookshelfId ? S.appData.bookshelves.find(s => s.id === notebook.bookshelfId) : null;
        const shelfPath = bookshelf ? `${bookshelf.title}` : 'Rotkatalog';

        if (notebook.title.toLowerCase().includes(query)) {
            matchedNotebooks.push({
                type: 'notebook',
                id: notebook.id,
                title: notebook.title,
                subtitle: `Anteckningsblock • I ${shelfPath} • ${notebook.notes ? notebook.notes.length : 0} anteckningar`,
                action: () => {
                    openNotebook(notebook.id);
                    closeGlobalSearch();
                }
            });
        }

        if (notebook.notes) {
            notebook.notes.forEach(note => {
                const contentText = stripHtml(note.content);
                if (contentText.toLowerCase().includes(query)) {
                    const firstLine = contentText.split('\n')[0] || 'Anteckning';
                    let snippet = contentText;
                    if (snippet.length > 90) {
                        const idx = snippet.toLowerCase().indexOf(query);
                        const start = Math.max(0, idx - 30);
                        snippet = (start > 0 ? '...' : '') + snippet.substring(start, start + 90) + (snippet.length > start + 90 ? '...' : '');
                    }

                    matchedNotes.push({
                        type: 'note',
                        id: note.id,
                        notebookId: notebook.id,
                        title: firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : ''),
                        subtitle: `Anteckning i "${notebook.title}"`,
                        snippet: snippet,
                        action: () => {
                            openNote(notebook.id, note.id);
                            closeGlobalSearch();
                        }
                    });
                }
            });
        }
    });

    // Group and render
    const groups = [
        { title: 'Bokhyllor', items: matchedBookshelves, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>` },
        { title: 'Kortlekar', items: matchedDecks, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 21h12"/></svg>` },
        { title: 'Mappar', items: matchedSections, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` },
        { title: 'Kort', items: matchedCards, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>` },
        { title: 'Anteckningsblock', items: matchedNotebooks, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="6" y1="6" x2="18" y2="6"/><line x1="6" y1="10" x2="18" y2="10"/></svg>` },
        { title: 'Anteckningar', items: matchedNotes, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` }
    ];

    let globalIndex = 0;
    let totalCount = 0;
    let html = '';

    // Paletten är en listbox: fältet behåller fokus, raderna är options och
    // markeringen pekas ut med aria-activedescendant. Det är därför raderna
    // inte är knappar — en knapp inuti en listbox går inte att nå med samma
    // pilnavigering, och två fokusmodeller i samma lista blir obegriplig.
    groups.forEach(group => {
        if (group.items.length === 0) return;
        totalCount += group.items.length;

        const groupId = `search-group-${group.title.toLowerCase()}`;
        html += `
            <div class="search-result-group" role="group" aria-labelledby="${groupId}">
                <div class="search-result-group-title" id="${groupId}">
                    ${group.icon}
                    <span>${group.title}</span>
                </div>
        `;

        group.items.forEach(item => {
            S.currentSearchResults.push(item);
            const idx = globalIndex++;

            html += `
                <div class="search-result-item" role="option" aria-selected="false" id="${resultId(idx)}" data-index="${idx}">
                    <span class="search-result-icon" aria-hidden="true">
                        ${group.icon}
                    </span>
                    <span class="search-result-details">
                        <span class="search-result-title">${highlightMatch(item.title, query)}</span>
                        <span class="search-result-subtitle">${highlightMatch(item.subtitle, query)}</span>
                        ${item.snippet ? `<span class="search-result-snippet">${highlightMatch(item.snippet, query)}</span>` : ''}
                    </span>
                </div>
            `;
        });

        html += `</div>`;
    });

    if (totalCount === 0) {
        input.setAttribute('aria-expanded', 'false');
        resultsContainer.innerHTML = `<p class="search-empty">Inga träffar för "${escapeHtml(query)}".</p>`;
        countSpan.textContent = '0 resultat';
    } else {
        input.setAttribute('aria-expanded', 'true');
        resultsContainer.innerHTML = html;
        countSpan.textContent = `${totalCount} resultat`;
        navigateSearchResults(1);
    }
};

/**
 * Flyttar markeringen i träfflistan.
 *
 * Markeringen bärs av aria-selected i stället för av en klass, så att den syns
 * och hörs av samma attribut. Fältet får aria-activedescendant, vilket är hur
 * en skärmläsare läser upp den markerade raden utan att fokus lämnar fältet.
 *
 * @param {1|-1} direction
 */
export const navigateSearchResults = (direction) => {
    if (S.currentSearchResults.length === 0) return;

    const input = document.getElementById('global-search-input');

    if (S.activeSearchResultIndex >= 0) {
        const prevEl = document.getElementById(resultId(S.activeSearchResultIndex));
        if (prevEl) prevEl.setAttribute('aria-selected', 'false');
    }

    if (S.activeSearchResultIndex === -1 && direction === 1) {
        S.activeSearchResultIndex = 0;
    } else {
        S.activeSearchResultIndex += direction;
        if (S.activeSearchResultIndex >= S.currentSearchResults.length) {
            S.activeSearchResultIndex = 0;
        } else if (S.activeSearchResultIndex < 0) {
            S.activeSearchResultIndex = S.currentSearchResults.length - 1;
        }
    }

    const activeEl = document.getElementById(resultId(S.activeSearchResultIndex));
    if (activeEl) {
        activeEl.setAttribute('aria-selected', 'true');
        activeEl.scrollIntoView({ block: 'nearest' });
        input?.setAttribute('aria-activedescendant', activeEl.id);
    }
};

export const triggerActiveSearchResult = () => {
    if (S.activeSearchResultIndex >= 0 && S.activeSearchResultIndex < S.currentSearchResults.length) {
        S.currentSearchResults[S.activeSearchResultIndex].action();
    }
};

const highlightCard = (cardId) => {
    let foundDeck = null;
    let foundCard = null;
    S.appData.decks.forEach(d => {
        const c = d.cards.find(card => card.id === cardId);
        if (c) {
            foundDeck = d;
            foundCard = c;
        }
    });

    if (!foundDeck || !foundCard) return;

    openDeck(foundDeck.id);

    if (foundCard.sectionId) {
        const secEl = document.getElementById(`section-${foundCard.sectionId}`);
        if (secEl) secEl.classList.remove('collapsed');
    }

    setTimeout(() => {
        const cardEl = document.getElementById(`card-${cardId}`);
        if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('search-highlight');
            setTimeout(() => cardEl.classList.remove('search-highlight'), 2500);
        }
    }, 150);
};

const highlightSection = (deckId, sectionId) => {
    openDeck(deckId);
    
    const secEl = document.getElementById(`section-${sectionId}`);
    if (secEl) {
        secEl.classList.remove('collapsed');
        setTimeout(() => {
            secEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const header = secEl.querySelector('.section-header');
            if (header) {
                header.classList.add('search-highlight-section');
                setTimeout(() => header.classList.remove('search-highlight-section'), 2500);
            }
        }, 150);
    }
};

const openNote = (notebookId, noteId) => {
    openNotebook(notebookId);
    const notebook = S.appData.notebooks.find(n => n.id === notebookId);
    if (!notebook) return;
    const note = notebook.notes.find(n => n.id === noteId);
    if (!note) return;
    
    setTimeout(() => {
        S.currentNoteId = note.id;
        document.getElementById('note-content').value = note.content;
        document.getElementById('note-form-title').innerText = 'Visa anteckning';
        switchView('addNote');
    }, 150);
};

export function initUiSearch() {

  // ==========================================
  // GLOBAL SEARCH ENGINE (COMMAND PALETTE)
  // ==========================================

  S.activeSearchResultIndex = -1;
  S.currentSearchResults = [];

  // Klicket ligger på behållaren i stället för på varje rad. Raderna ritas om
  // vid varje tangenttryckning, och en inline-onclick per rad hade betytt en
  // global funktion till bara för att komma åt listan.
  document.getElementById('global-search-results')?.addEventListener('click', (event) => {
      const row = event.target.closest('.search-result-item');
      if (!row) return;
      const idx = Number(row.dataset.index);
      S.currentSearchResults[idx]?.action();
  });

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
  window.openGlobalSearch = openGlobalSearch;
  window.closeGlobalSearch = closeGlobalSearch;
  window.performGlobalSearch = performGlobalSearch;
  window.navigateSearchResults = navigateSearchResults;
  window.triggerActiveSearchResult = triggerActiveSearchResult;
  window.highlightCard = highlightCard;
  window.highlightSection = highlightSection;
  window.openNote = openNote;

}
