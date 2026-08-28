import { uploadCardImages } from '../images.js';
import { createNoteCard } from '../../core/backup.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { openDeck, renderCards } from '../deck.js';
import { showToast } from '../toast.js';


export function initUiWiringCardForms() {

      document.getElementById('form-edit-card').addEventListener('submit', (e) => {
          e.preventDefault();
          if (!S.currentEditCard || !S.currentDeckId) return;

          const newFront = document.getElementById('edit-card-front').value.trim();
          const newBack = document.getElementById('edit-card-back').value.trim();
          const isLongForm = document.getElementById('edit-card-longform').checked;

          if (newFront && newBack) {
              const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
              const cardProxy = deck.cards.find(c => c.id === S.currentEditCard.id);
              if (cardProxy) {
                  cardProxy.front = newFront;
                  cardProxy.back = newBack;
                  cardProxy.isLongForm = isLongForm;
                  cardProxy.backImages = [...S.editCardImages];
                  saveData();
                  void uploadCardImages(cardProxy.backImages, cardProxy.id).then((sokvagar) => {
                      cardProxy.backImages = sokvagar;
                      saveData();
                  });
                  renderCards(deck.cards);
                  openDeck(S.currentDeckId);
                  showToast('Kort uppdaterat!');
              }
              document.getElementById('modal-edit-card').classList.add('hidden');
              S.editCardImages = [];
          }
      });

      document.getElementById('btn-add-note-card').addEventListener('click', (e) => {
          e.stopPropagation();
          S.currentNoteCard = null;
          const modal = document.getElementById('modal-note-card');
          document.getElementById('note-card-modal-title').textContent = 'Lägg till anteckning';
          document.getElementById('note-card-content').value = '';
          modal.classList.remove('hidden');
      });

      document.getElementById('btn-cancel-note-card').addEventListener('click', () => {
          document.getElementById('modal-note-card').classList.add('hidden');
      });

      document.getElementById('form-note-card').addEventListener('submit', (e) => {
          e.preventDefault();
          const content = document.getElementById('note-card-content').value.trim();
          if (!content || !S.currentDeckId) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (S.currentNoteCard) {
              const cardProxy = deck.cards.find(c => c.id === S.currentNoteCard.id);
              if (cardProxy) cardProxy.content = content;
              showToast('Anteckning uppdaterad!');
          } else {
              deck.cards.push(createNoteCard(content));
              showToast('Anteckning tillagd!');
          }
          saveData();
          renderCards(deck.cards);
          document.getElementById('modal-note-card').classList.add('hidden');
          S.currentNoteCard = null;
      });
}
