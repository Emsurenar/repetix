import { fetchDiaryCards } from '../diary.js';
import { createCard } from '../../domain/model.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { renderLibrary } from '../../ui/library.js';
import { showToast } from '../../ui/toast.js';


    // Diary Handlers
    const closeDiaryModal = () => document.getElementById('modal-diary').classList.add('hidden');

export function initAiWiringDiary() {
      document.getElementById('btn-open-diary').addEventListener('click', () => {
          S.proposedDiaryCards = [];
          document.getElementById('input-diary-text').value = '';
          document.getElementById('diary-cards-container').innerHTML = '';
          document.getElementById('diary-cards-container').classList.add('hidden');
          document.getElementById('diary-actions-container').classList.add('hidden');
          document.getElementById('diary-loading').classList.add('hidden');
          document.getElementById('btn-close-diary-top').classList.remove('hidden');
          document.getElementById('modal-diary').classList.remove('hidden');
      });
      document.getElementById('btn-close-diary-top').addEventListener('click', closeDiaryModal);
      document.getElementById('btn-close-diary').addEventListener('click', closeDiaryModal);

      document.getElementById('form-diary').addEventListener('submit', (e) => {
          e.preventDefault();
          const text = document.getElementById('input-diary-text').value.trim();
          if (!text) return;
          fetchDiaryCards(text);
      });

      document.getElementById('btn-save-diary-cards').addEventListener('click', () => {
          if (S.proposedDiaryCards.length === 0) return;
          const deckSelects = document.querySelectorAll('.diary-deck-select');
          const bookshelfSelects = document.querySelectorAll('.diary-bookshelf-select');
          const sectionSelects = document.querySelectorAll('.diary-section-select');
          let savedCount = 0;

          deckSelects.forEach((sel, i) => {
              const card = S.proposedDiaryCards[i];
              if (!card) return;
              let deckTarget;

              let deckName = sel.value;
              if (deckName.startsWith('__new__:')) {
                  deckName = deckName.replace('__new__:', '');
              }
              deckTarget = S.appData.decks.find(d => d.title === deckName);
              if (!deckTarget && sel.value.startsWith('__new__:')) {
                  deckTarget = { id: Date.now().toString() + '_' + i, title: deckName, cards: [], bookshelfId: null, sections: [] };
                  S.appData.decks.push(deckTarget);
              }

              if (!deckTarget) return;

              const bookshelfSel = bookshelfSelects[i];
              if (bookshelfSel && bookshelfSel.value) {
                  let shelfName = bookshelfSel.value;
                  if (shelfName.startsWith('__new__:')) {
                      shelfName = shelfName.replace('__new__:', '');
                  }
                  let shelf = S.appData.bookshelves.find(s => s.title === shelfName);
                  if (!shelf && bookshelfSel.value.startsWith('__new__:')) {
                      shelf = { id: Date.now().toString() + '_shelf_' + i, title: shelfName, color: null };
                      S.appData.bookshelves.push(shelf);
                  }
                  if (shelf) {
                      deckTarget.bookshelfId = shelf.id;
                  }
              }

              let sectionId = null;
              const sectionSel = sectionSelects[i];
              if (sectionSel && sectionSel.value) {
                  let secName = sectionSel.value;
                  if (secName.startsWith('__new__:')) {
                      secName = secName.replace('__new__:', '');
                  }
                  if (!deckTarget.sections) deckTarget.sections = [];
                  let existingSection = deckTarget.sections.find(s => s.title === secName);
                  if (!existingSection && sectionSel.value.startsWith('__new__:')) {
                      existingSection = { id: Date.now().toString() + '_sec_' + i, title: secName };
                      deckTarget.sections.push(existingSection);
                  }
                  if (existingSection) {
                      sectionId = existingSection.id;
                  }
              }

              deckTarget.cards.push(createCard(card.front, card.back, false, [], sectionId));
              savedCount++;
          });

          saveData();
          renderLibrary();
          showToast(`${savedCount} kort sparades i sina kortlekar!`);
          closeDiaryModal();
      });
}
