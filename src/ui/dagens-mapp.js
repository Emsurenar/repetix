import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { getLocalDateString } from '../domain/stats.js';


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

export const renderDagensMapp = () => {
    const container = document.getElementById('dagens-mapp-container');
    if (!container) return;
    
    // If search filter is active, bookshelf filter is active, or library is empty, hide
    const isSearchActive = S.librarySearchFilter && S.librarySearchFilter.trim() !== '';
    const isLibraryEmpty = S.appData.decks.length === 0 && S.appData.notebooks.length === 0 && S.appData.bookshelves.length === 0;
    if (isSearchActive || S.currentBookshelfFilterId || isLibraryEmpty) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    const dagens = getDagensMapp();
    if (!dagens) {
        // No sections created yet - show encouragement CTA
        container.innerHTML = `
            <div class="dagens-mapp-banner empty">
                <div class="dagens-mapp-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4.5px; vertical-align: middle;"><path d="M9 18h6m-3-15a7 7 0 0 0-7 7c0 2.3 1.2 4.3 3 5.3V18h8v-2.7c1.8-1 3-3 3-5.3a7 7 0 0 0-7-7z"/></svg>
                    Dagens Mapp
                </div>
                <div class="dagens-mapp-content">
                    <div class="dagens-mapp-info">
                        <h3 class="dagens-mapp-name" style="font-size: 1.15rem; margin-bottom: 0.25rem;">Organisera dina kort i mappar!</h3>
                        <p class="dagens-mapp-deck-name" style="max-width: 600px; font-weight: normal; line-height: 1.45; color: var(--text-secondary);">
                            Dela in dina flashcards i mappar för att få en personlig rekommenderad mapp att repetera varje dag. 
                            Du kan enkelt skapa mappar i dina kortlekar, eller använda AI-sortering för att strukturera dem direkt.
                        </p>
                    </div>
                    <div class="dagens-mapp-actions">
                        <button class="btn-dagens-action secondary" onclick="if(appData.decks.length > 0) { openDeck(appData.decks[0].id); } else { showToast('Skapa en kortlek först!'); }">Kolla dina kortlekar</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    // If a section is selected, get stats
    const deck = S.appData.decks.find(d => d.id === dagens.deckId);
    if (!deck) return; // safety check
    
    const sectionCards = deck.cards.filter(c => c.type !== 'note' && c.sectionId === dagens.sectionId);
    const totalCards = sectionCards.length;
    const dueCards = sectionCards.filter(c => c.nextReviewDate <= Date.now()).length;
    
    // Choose colour
    let itemColor = '#4F46E5';
    if (deck.bookshelfId) {
        const shelf = S.appData.bookshelves.find(s => s.id === deck.bookshelfId);
        if (shelf && shelf.color) itemColor = shelf.color;
    } else if (deck.color) {
        itemColor = deck.color;
    }
    
    if (dueCards === 0) {
        container.innerHTML = `
            <div class="dagens-mapp-banner completed" style="padding: 1rem 1.25rem; margin-bottom: 1.5rem; gap: 0.5rem;">
                <div class="dagens-mapp-content" style="gap: 1rem;">
                    <div class="dagens-mapp-info" style="flex-direction: row; align-items: center; gap: 0.75rem;">
                        <span class="dagens-mapp-icon completed" style="width: 32px; height: 32px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        </span>
                        <div class="dagens-mapp-titles">
                            <h3 class="dagens-mapp-name completed" style="font-size: 1.05rem; font-weight: 700; margin: 0;">Klar med dagens rekommendation</h3>
                            <p class="dagens-mapp-deck-name completed" style="font-size: 0.8rem; margin: 0; opacity: 0.8;">Mapp: ${escapeHtml(dagens.sectionTitle)}</p>
                        </div>
                    </div>
                    <div class="dagens-mapp-actions" style="margin-top: 0;">
                        <button class="btn-dagens-action secondary completed" style="padding: 0.45rem 1rem; font-size: 0.8rem; border-color: rgba(16, 185, 129, 0.2); color: #047857;" onclick="openDeck('${dagens.deckId}', '${dagens.sectionId}')">Öppna mappen</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="dagens-mapp-banner" style="border-left-color: ${itemColor}; --primary-color: ${itemColor};">
            <div class="dagens-mapp-badge" style="background-color: ${itemColor}15; color: ${itemColor};">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4.5px; vertical-align: middle;"><path d="M9 18h6m-3-15a7 7 0 0 0-7 7c0 2.3 1.2 4.3 3 5.3V18h8v-2.7c1.8-1 3-3 3-5.3a7 7 0 0 0-7-7z"/></svg>
                Dagens rekommendation
            </div>
            <div class="dagens-mapp-content">
                <div class="dagens-mapp-info">
                    <div class="dagens-mapp-title-row">
                        <span class="dagens-mapp-icon" style="background-color: ${itemColor}15; color: ${itemColor};">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        </span>
                        <div class="dagens-mapp-titles">
                            <h3 class="dagens-mapp-name">${escapeHtml(dagens.sectionTitle)}</h3>
                            <p class="dagens-mapp-deck-name">Kortlek: ${escapeHtml(dagens.deckTitle)}</p>
                        </div>
                    </div>
                    <div class="dagens-mapp-stats">
                        <span class="stat-badge">${totalCards} kort totalt</span>
                        <span class="stat-badge due">${dueCards} att repetera idag</span>
                    </div>
                </div>
                <div class="dagens-mapp-actions">
                    <button class="btn-dagens-action secondary" onclick="openDeck('${dagens.deckId}', '${dagens.sectionId}')">Gå till mappen</button>
                    <button class="btn-dagens-action primary" style="background-color: ${itemColor};" onclick="studyDagensMapp('${dagens.deckId}', '${dagens.sectionId}')">Börja repetera</button>
                </div>
            </div>
        </div>
    `;
};
