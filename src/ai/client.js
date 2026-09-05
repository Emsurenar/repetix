import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { renderCards } from '../ui/deck.js';
import { renderCardBackImages, renderImagePreviews, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { fokusera } from '../ui/fokus.js';
import { showConfirmModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';


export const openCardModal = (card) => {
    S.currentAiCard = card;
    S.currentAiResponseRaw = null;
    document.getElementById('detail-front-text').innerHTML = safeParse(card.front);
    const backEl = document.getElementById('detail-back-text');
    backEl.innerHTML = safeParse(card.back);
    renderCardBackImages(backEl, card.backImages);
    renderLatex(document.getElementById('detail-front-text'));
    renderLatex(backEl);
    document.getElementById('ai-explanation-container').classList.add('hidden');
    document.getElementById('test-question-actions').classList.add('hidden');
    document.getElementById('ai-text').innerText = '';
    document.getElementById('ai-loading').classList.add('hidden');
    document.getElementById('btn-explain-ai').style.display = 'flex';
    document.getElementById('btn-test-ai').style.display = 'flex';
    document.getElementById('modal-card-details').classList.remove('hidden');
};

export const renderMoveTargets = (filterText = '') => {
    const container = document.getElementById('move-targets-list');
    const confirmBtn = document.getElementById('btn-confirm-move-card');
    container.innerHTML = '';
    
    confirmBtn.disabled = true;
    document.getElementById('selected-move-target').value = '';

    const lowerFilter = filterText.toLowerCase();

    S.appData.decks.forEach(deck => {
        const deckVisible = deck.title.toLowerCase().includes(lowerFilter);
        
        // Deck Root Item
        if (deckVisible || (deck.sections && deck.sections.some(s => s.title.toLowerCase().includes(lowerFilter)))) {
            const deckItem = document.createElement('div');
            deckItem.className = 'move-target-item';
            const isCurrent = S.currentMoveCard && deck.id === S.currentDeckId && !S.currentMoveCard.sectionId;
            if (isCurrent) deckItem.classList.add('disabled');
            
            deckItem.innerHTML = `
                <div class="move-target-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="move-target-info">
                    <span class="move-target-name">${escapeHtml(deck.title)}${isCurrent ? ' (Här)' : ''}</span>
                    <span class="move-target-type">Kortlek</span>
                </div>
            `;
            
            if (!isCurrent) {
                deckItem.onclick = () => {
                    document.querySelectorAll('.move-target-item').forEach(el => el.classList.remove('selected'));
                    deckItem.classList.add('selected');
                    document.getElementById('selected-move-target').value = `${deck.id}:root`;
                    confirmBtn.disabled = false;
                };
            }
            container.appendChild(deckItem);
        }

        // Section Items
        if (deck.sections) {
            deck.sections.forEach(section => {
                if (section.title.toLowerCase().includes(lowerFilter) || deck.title.toLowerCase().includes(lowerFilter)) {
                    const secItem = document.createElement('div');
                    secItem.className = 'move-target-item section';
                    const isCurrent = S.currentMoveCard && deck.id === S.currentDeckId && S.currentMoveCard.sectionId === section.id;
                    if (isCurrent) secItem.classList.add('disabled');

                    secItem.innerHTML = `
                        <div class="move-target-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                        </div>
                        <div class="move-target-info">
                            <span class="move-target-name">${escapeHtml(section.title)}${isCurrent ? ' (Här)' : ''}</span>
                            <span class="move-target-type">${escapeHtml(deck.title)} &rsaquo; Mapp</span>
                        </div>
                    `;

                    if (!isCurrent) {
                        secItem.onclick = () => {
                            document.querySelectorAll('.move-target-item').forEach(el => el.classList.remove('selected'));
                            secItem.classList.add('selected');
                            document.getElementById('selected-move-target').value = `${deck.id}:${section.id}`;
                            confirmBtn.disabled = false;
                        };
                    }
                    container.appendChild(secItem);
                }
            });
        }
    });

    if (container.children.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary); opacity: 0.6;">Inga matchningar hittades</div>';
    }
};

export const openMoveCardModal = (card) => {
    S.currentMoveCard = card;
    document.getElementById('input-move-search').value = '';
    renderMoveTargets();
    document.getElementById('modal-move-card').classList.remove('hidden');
    setTimeout(() => fokusera(document.getElementById('input-move-search')), 100);
};

export const openMoveSectionModal = (sectionId) => {
    S.currentMoveSectionId = sectionId;
    const select = document.getElementById('select-move-section-deck');
    if (!select) return;
    select.innerHTML = '';

    S.appData.decks.forEach(deck => {
        if (deck.id === S.currentDeckId) return; // Cannot move to current deck
        const option = document.createElement('option');
        option.value = deck.id;
        option.innerText = deck.title;
        select.appendChild(option);
    });

    if (select.children.length === 0) {
        alert("Det finns inga andra kortlekar att flytta till.");
        return;
    }

    document.getElementById('modal-move-section').classList.remove('hidden');
};

export const openMoveItemModal = (item, type) => {
    S.currentMoveItem = item;
    S.currentMoveItemType = type;
    const select = document.getElementById('select-move-bookshelf');
    select.innerHTML = '';
    
    // Default option to remove from bookshelf
    const defaultOption = document.createElement('option');
    defaultOption.value = 'root';
    defaultOption.innerText = 'Ingen bokhylla (Huvudvyn)';
    select.appendChild(defaultOption);

    S.appData.bookshelves.forEach(shelf => {
        const option = document.createElement('option');
        option.value = shelf.id;
        option.innerText = shelf.title;
        if (item.bookshelfId === shelf.id) option.selected = true;
        select.appendChild(option);
    });
    
    document.getElementById('modal-move-item').classList.remove('hidden');
};

export const openSectionModal = (section = null) => {
    S.currentSectionToEdit = section;
    const modal = document.getElementById('modal-new-section');
    const title = document.getElementById('section-modal-title');
    const input = document.getElementById('new-section-name');
    
    if (section) {
        title.innerText = 'Redigera mapp';
        input.value = section.title;
    } else {
        title.innerText = 'Ny mapp';
        input.value = '';
    }
    
    modal.classList.remove('hidden');
    fokusera(input, { valj: Boolean(section) });
};

export const closeSectionModal = () => {
    document.getElementById('modal-new-section').classList.add('hidden');
    S.currentSectionToEdit = null;
};

export const deleteSection = async (sectionId) => {
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    const section = deck.sections.find(s => s.id === sectionId);
    if (!section) return;

    const cardsInSection = deck.cards.filter(c => c.sectionId === sectionId);

    if (cardsInSection.length > 0) {
        const deleteCards = await showConfirmModal(
            'Radera mapp',
            `Denna mapp innehåller ${cardsInSection.length} kort. Vill du radera även korten?`,
            'Radera allt',
            true
        );

        if (deleteCards) {
            deck.cards = deck.cards.filter(c => c.sectionId !== sectionId);
            showToast('Mappen raderad tillsammans med dess kort');
        } else {
            cardsInSection.forEach(c => c.sectionId = null);
            showToast('Mappen raderad, korten flyttades ut');
        }
    } else {
        showToast('Mappen raderad');
    }

    deck.sections = deck.sections.filter(s => s.id !== sectionId);
    saveData();
    renderCards(deck.cards);
};

export const openNoteCardModal = (card = null) => {
    S.currentNoteCard = card;
    document.getElementById('note-card-modal-title').textContent = card ? 'Redigera anteckning' : 'Lägg till anteckning';
    document.getElementById('note-card-content').value = card ? (card.content || '') : '';
    document.getElementById('modal-note-card').classList.remove('hidden');
};


export const openEditCardModal = (card) => {
    S.currentEditCard = card;
    document.getElementById('edit-card-front').value = card.front;
    document.getElementById('edit-card-back').value = card.back;
    document.getElementById('edit-card-description').value = card.description || '';
    document.getElementById('edit-card-longform').checked = card.isLongForm || false;
    // Load existing images into temp array
    S.editCardImages = card.backImages ? [...card.backImages] : [];
    const refreshEditPreviews = (idx) => {
        if (typeof idx === 'number') S.editCardImages.splice(idx, 1);
        renderImagePreviews(
            document.getElementById('edit-card-back-image-preview'),
            S.editCardImages,
            refreshEditPreviews
        );
    };
    refreshEditPreviews();
    document.getElementById('modal-edit-card').classList.remove('hidden');
};

// --- AI CONTEXT HELPER ---
export const buildDeckContext = (deckId) => {
    const deck = deckId ? S.appData.decks.find(d => d.id === deckId) : null;
    if (!deck || !deck.cards || deck.cards.length === 0) return '';

    const cards = deck.cards.filter(c => c.type !== 'note');
    if (cards.length === 0) return '';

    const sampleSize = Math.min(8, cards.length);
    const samples = cards.slice(-sampleSize);
    const sampleStr = samples.map(c => `F: ${c.front} | S: ${c.back}`).join('\n');

    const sections = (deck.sections || []).map(s => s.title);
    const sectionStr = sections.length > 0 ? `\nMappar i kortleken: ${sections.join(', ')}` : '';

    return `\n\n--- Kontext om kortleken "${deck.title}" (${cards.length} kort) ---\nHär är ett urval av befintliga kort som visar nivå och stil:\n${sampleStr}${sectionStr}\n---`;
};

export function initAiClient() {


  // --- AI LOGIC ---
  S.currentAiCard = null;
  S.currentAiResponseRaw = null;
  S.proposedTopicCards = [];
  S.currentTopicRawInput = "";
  S.proposedDiaryCards = [];
  S.aiGeneratorOptions = {
      sourceType: 'topic',
      quantity: 10,
      difficulty: 'intermediate',
      focus: 'mixed',
      sectionId: ''
  };

  S.currentEditCard = null;
  S.currentMoveCard = null;

  S.currentMoveSectionId = null;

  S.currentMoveItem = null;
  S.currentMoveItemType = null;

  S.currentSectionToEdit = null;
  S.preselectSectionId = null;

  S.currentNoteCard = null;
}
