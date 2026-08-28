import { renderMoveTargets } from '../../ai/client.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { openDeck, renderCards } from '../deck.js';
import { renderLibrary } from '../library.js';
import { renderSidebar } from '../modals-wiring.js';
import { showToast } from '../toast.js';


export function initUiWiringMove() {

      // Card Actions
      document.getElementById('btn-cancel-edit-card').addEventListener('click', () => {
          document.getElementById('modal-edit-card').classList.add('hidden');
      });

      document.getElementById('btn-cancel-move-card')?.addEventListener('click', () => {
          document.getElementById('modal-move-card').classList.add('hidden');
          S.currentMoveCard = null;
      });

      document.getElementById('input-move-search')?.addEventListener('input', (e) => {
          renderMoveTargets(e.target.value);
      });

      document.getElementById('btn-confirm-move-card')?.addEventListener('click', () => {
          const selection = document.getElementById('selected-move-target').value;
          if (!selection || !S.currentMoveCard) return;

          const [targetDeckId, targetSectionId] = selection.split(':');
        
          const currentDeck = S.appData.decks.find(d => d.id === S.currentDeckId);
          const targetDeck = S.appData.decks.find(d => d.id === targetDeckId);
        
          if (currentDeck && targetDeck) {
              // Remove from current deck
              currentDeck.cards = currentDeck.cards.filter(c => c.id !== S.currentMoveCard.id);
            
              // Set new properties
              S.currentMoveCard.sectionId = (targetSectionId === 'root') ? null : targetSectionId;
            
              // Add to target deck
              targetDeck.cards.push(S.currentMoveCard);
            
              saveData();
              renderCards(currentDeck.cards);
              document.getElementById('modal-move-card').classList.add('hidden');
              S.currentMoveCard = null;
              showToast("Kortet flyttades!");
              renderLibrary();
            
              // If moved to current deck (different folder), stay in view
              if (targetDeckId === S.currentDeckId) {
                  renderCards(currentDeck.cards);
              }
          }
      });

      document.getElementById('btn-cancel-move-item')?.addEventListener('click', () => {
          document.getElementById('modal-move-item').classList.add('hidden');
          S.currentMoveItem = null;
          S.currentMoveItemType = null;
      });

      document.getElementById('form-move-item')?.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!S.currentMoveItem) return;
        
          let targetBookshelfId = document.getElementById('select-move-bookshelf').value;
          if (targetBookshelfId === 'root') targetBookshelfId = null;

          let sourceList = S.currentMoveItemType === 'deck' ? S.appData.decks : S.appData.notebooks;
          let itemRef = sourceList.find(i => i.id === S.currentMoveItem.id);
          if (itemRef) {
              itemRef.bookshelfId = targetBookshelfId;
              saveData();
              renderLibrary();
              document.getElementById('modal-move-item').classList.add('hidden');
              S.currentMoveItem = null;
              S.currentMoveItemType = null;
              showToast("Objektet flyttades!");
          }
      });

      document.getElementById('btn-cancel-move-section')?.addEventListener('click', () => {
          document.getElementById('modal-move-section').classList.add('hidden');
          S.currentMoveSectionId = null;
      });

      document.getElementById('form-move-section')?.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!S.currentMoveSectionId || !S.currentDeckId) return;

          const targetDeckId = document.getElementById('select-move-section-deck').value;
          const sourceDeck = S.appData.decks.find(d => d.id === S.currentDeckId);
          const targetDeck = S.appData.decks.find(d => d.id === targetDeckId);

          if (sourceDeck && targetDeck) {
              const sectionIdx = sourceDeck.sections.findIndex(s => s.id === S.currentMoveSectionId);
              if (sectionIdx > -1) {
                  const section = sourceDeck.sections[sectionIdx];
                
                  // 1. Move section object
                  sourceDeck.sections.splice(sectionIdx, 1);
                  if (!targetDeck.sections) targetDeck.sections = [];
                  targetDeck.sections.push(section);

                  // 2. Move cards belonging to section
                  const cardsToMove = sourceDeck.cards.filter(c => c.sectionId === S.currentMoveSectionId);
                  sourceDeck.cards = sourceDeck.cards.filter(c => c.sectionId !== S.currentMoveSectionId);
                  targetDeck.cards.push(...cardsToMove);

                  saveData();
                  renderLibrary();
                  renderSidebar();
                  openDeck(S.currentDeckId);
                  document.getElementById('modal-move-section').classList.add('hidden');
                  S.currentMoveSectionId = null;
                  showToast("Mappen flyttades!");
              }
          }
      });
}
