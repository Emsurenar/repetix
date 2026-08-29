import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { getLocalDateString } from '../domain/stats.js';
import { uppskattadTid } from '../domain/estimate.js';
import { ticksHtml } from './ticks.js';
import { applyWash } from './wash.js';
import { openDeck, studyDagensMapp } from './deck.js';


// --- DAGENS MAPP (DAILY RECOMMENDATION) ---
const getDagensMapp = () => {
    const todayStr = getLocalDateString();
    
    // Read from localStorage
    let stored = null;
    try {
        const saved = localStorage.getItem('noji_dagens_mapp');
        if (saved) {
            stored = JSON.parse(saved);
        }
    } catch (e) {
        console.error("Failed to parse dagens mapp", e);
    }
    
    // Check if stored is still valid (date matches today and deck + section still exist)
    if (stored && stored.date === todayStr) {
        const deck = S.appData.decks.find(d => d.id === stored.deckId);
        const section = deck ? (deck.sections || []).find(s => s.id === stored.sectionId) : null;
        if (deck && section) {
            return {
                deckId: deck.id,
                deckTitle: deck.title,
                sectionId: section.id,
                sectionTitle: section.title
            };
        }
    }
    
    // Re-roll or select new one
    // Collect all sections
    const allSections = [];
    S.appData.decks.forEach(deck => {
        if (deck.sections && deck.sections.length > 0) {
            deck.sections.forEach(sec => {
                allSections.push({
                    deckId: deck.id,
                    deckTitle: deck.title,
                    sectionId: sec.id,
                    sectionTitle: sec.title
                });
            });
        }
    });
    
    if (allSections.length === 0) {
        return null;
    }
    
    // Choose one at random
    const randomIndex = Math.floor(Math.random() * allSections.length);
    const chosen = allSections[randomIndex];
    
    // Save to localStorage
    const newState = {
        date: todayStr,
        deckId: chosen.deckId,
        sectionId: chosen.sectionId
    };
    try {
        localStorage.setItem('noji_dagens_mapp', JSON.stringify(newState));
    } catch (e) {
        console.error("Failed to save dagens mapp", e);
    }
    
    return chosen;
};

/* Knapparna bar tidigare kortlekens och mappens id i ett onclick-attribut.
 * Ett id kan komma från en importerad backupfil och kunde alltså bryta ut ur
 * citattecknen och köra egen kod. Här får de i stället sitt id ur stängningen
 * över `dagens`, och en sträng behöver aldrig bli kod. */
function kopplaHandlingar(container, dagens) {
    for (const knapp of container.querySelectorAll('[data-mapp-handling]')) {
        knapp.addEventListener('click', () => {
            if (knapp.dataset.mappHandling === 'repetera') {
                studyDagensMapp(dagens.deckId, dagens.sectionId);
            } else {
                openDeck(dagens.deckId, dagens.sectionId);
            }
        });
    }
}

export const renderDagensMapp = () => {
    const container = document.getElementById('dagens-mapp-container');
    if (!container) return;
    
    // If search filter is active, bookshelf filter is active, or library is empty, hide
    const isSearchActive = S.librarySearchFilter && S.librarySearchFilter.trim() !== '';
    const isLibraryEmpty = S.appData.decks.length === 0 && S.appData.notebooks.length === 0 && S.appData.bookshelves.length === 0;
    if (isSearchActive || S.currentBookshelfFilterId || isLibraryEmpty) {
        container.innerHTML = '';
        container.hidden = true;
        return;
    }
    
    container.hidden = false;
    
    const dagens = getDagensMapp();
    if (!dagens) {
        // Inga mappar än. Panelen förklarar vad den skulle ha visat i stället
        // för att försvinna spårlöst.
        container.innerHTML = `
            <section class="today-folder hero-wash is-empty">
                <div class="today-folder-body">
                    <p class="label today-folder-kicker">Dagens mapp</p>
                    <h2 class="today-folder-title">Dela in korten i mappar</h2>
                    <p class="today-folder-text">Med mappar i kortlekarna får du en rekommenderad mapp att repetera varje dag.</p>
                </div>
            </section>
        `;
        /* Tomma läget pekar inte på någon kortlek och har alltså inget id att
         * räkna fram en bild ur. Utan bild blev panelen en svart platta —
         * samma form som de andra två lägena, men utan det som gör dem till
         * inbjudningar. Fröet är därför en konstant: alltid samma bild, för
         * samma skäl som en kortlek alltid får sin egen. */
        applyWash(container.querySelector('.today-folder'), 'dagens-mapp:tom');
        return;
    }
    
    // If a section is selected, get stats
    const deck = S.appData.decks.find(d => d.id === dagens.deckId);
    if (!deck) return; // safety check
    
    const sectionCards = deck.cards.filter(c => c.type !== 'note' && c.sectionId === dagens.sectionId);
    const totalCards = sectionCards.length;
    const dueCards = sectionCards.filter(c => c.nextReviewDate <= Date.now()).length;

    if (dueCards === 0) {
        container.innerHTML = `
            <section class="today-folder hero-wash is-done">
                <div class="today-folder-body">
                    <p class="label today-folder-kicker">Dagens mapp</p>
                    <h2 class="today-folder-title">Klart för idag</h2>
                    <p class="today-folder-meta num">${escapeHtml(dagens.sectionTitle)} · ${totalCards} kort</p>
                </div>
                <div class="today-folder-actions">
                    <button type="button" class="btn text" data-mapp-handling="oppna">Öppna mappen</button>
                </div>
            </section>
        `;
        applyWash(container.querySelector('.today-folder'), dagens.deckId);
        kopplaHandlingar(container, dagens);
        return;
    }

    container.innerHTML = `
        <section class="today-folder hero-wash">
            <div class="today-folder-body">
                <p class="label today-folder-kicker">Dagens mapp</p>
                <h2 class="today-folder-title">${escapeHtml(dagens.deckTitle)} <span>/</span> ${escapeHtml(dagens.sectionTitle)}</h2>
                <p class="today-folder-meta num">
                    <span>${dueCards} kort</span>
                    ${ticksHtml(dueCards, 0)}
                    ${uppskattadTid(dueCards) ? `<span class="today-folder-time">${uppskattadTid(dueCards)}</span>` : ''}
                </p>
            </div>
            <div class="today-folder-actions">
                <button type="button" class="btn text" data-mapp-handling="oppna">Gå till mappen</button>
                <button type="button" class="btn primary lg" data-mapp-handling="repetera">Repetera mappen</button>
            </div>
        </section>
    `;
    // Panelen pekar på en kortlek och bär därför den lekens bild — samma som
    // man möter när man går in i den.
    applyWash(container.querySelector('.today-folder'), dagens.deckId);
    kopplaHandlingar(container, dagens);
};
