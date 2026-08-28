import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { renderLibrary } from '../library.js';
import { showToast } from '../toast.js';


    // creation modal handlers
    const modalCreateOptions = document.getElementById('modal-create-options');

    // Deck & Notebook Creation
    const modalDeck = document.getElementById('modal-new-deck');

export function initUiWiringCreate() {
      document.getElementById('btn-create-item')?.addEventListener('click', () => {
          modalCreateOptions.classList.remove('hidden');
      });
      document.getElementById('btn-create-item-top')?.addEventListener('click', () => {
          modalCreateOptions.classList.remove('hidden');
      });

      document.getElementById('btn-cancel-create-options')?.addEventListener('click', () => {
          modalCreateOptions.classList.add('hidden');
      });

      document.getElementById('option-create-deck')?.addEventListener('click', () => {
          modalCreateOptions.classList.add('hidden');
          S.currentCreationType = 'deck';
          modalDeck.querySelector('h2').innerText = 'Ny kortlek';
          modalDeck.classList.remove('hidden');
      });

      document.getElementById('option-create-notebook')?.addEventListener('click', () => {
          modalCreateOptions.classList.add('hidden');
          S.currentCreationType = 'notebook';
          modalDeck.querySelector('h2').innerText = 'Nytt anteckningsblock';
          modalDeck.classList.remove('hidden');
      });

      document.getElementById('option-create-bookshelf')?.addEventListener('click', () => {
          modalCreateOptions.classList.add('hidden');
          document.getElementById('modal-new-bookshelf').classList.remove('hidden');
      });
      S.currentCreationType = 'deck'; // 'deck' or 'notebook'

      document.getElementById('btn-cancel-deck').addEventListener('click', () => {
          modalDeck.classList.add('hidden');
          document.getElementById('new-deck-name').value = '';
      });

      // Color picker logic
      document.querySelectorAll('#deck-color-picker .color-dot').forEach(dot => {
          dot.addEventListener('click', () => {
              document.querySelectorAll('#deck-color-picker .color-dot').forEach(d => d.classList.remove('selected'));
              dot.classList.add('selected');
          });
      });

      document.getElementById('form-new-deck').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('new-deck-name').value.trim();
          const selectedColor = document.querySelector('#deck-color-picker .color-dot.selected')?.dataset.color || '#4F46E5';
          if (name) {
              if (S.currentCreationType === 'deck') {
                  const newDeck = { id: Date.now().toString(), title: name, cards: [], bookshelfId: null, color: selectedColor, sections: [] };
                  S.appData.decks.push(newDeck);
                  showToast('Kortlek skapad!');
              } else {
                  const newNotebook = { id: Date.now().toString(), title: name, notes: [], bookshelfId: null };
                  S.appData.notebooks.push(newNotebook);
                  showToast('Anteckningsblock skapat!');
              }
              saveData();
              renderLibrary();
              modalDeck.classList.add('hidden');
              document.getElementById('new-deck-name').value = '';
          }
      });

      // Bookshelf Creation
      document.getElementById('btn-cancel-bookshelf')?.addEventListener('click', () => {
          document.getElementById('modal-new-bookshelf').classList.add('hidden');
          document.getElementById('new-bookshelf-name').value = '';
      });

      document.getElementById('form-new-bookshelf')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('new-bookshelf-name').value.trim();
          if (name) {
              const newBookshelf = { id: Date.now().toString(), title: name };
              if (!S.appData.bookshelves) S.appData.bookshelves = [];
              S.appData.bookshelves.push(newBookshelf);
              saveData();
              renderLibrary();
              document.getElementById('modal-new-bookshelf').classList.add('hidden');
              document.getElementById('new-bookshelf-name').value = '';
              showToast('Bokhylla skapad!');
          }
      });

      // Bookshelf Deletion
      document.getElementById('btn-cancel-delete-bookshelf')?.addEventListener('click', () => {
          document.getElementById('modal-delete-bookshelf').classList.add('hidden');
          S.currentBookshelfToDelete = null;
      });

      document.getElementById('btn-delete-bookshelf-keep')?.addEventListener('click', () => {
          if (!S.currentBookshelfToDelete) return;
          // Move items to root
          S.appData.decks.forEach(d => { if (d.bookshelfId === S.currentBookshelfToDelete) d.bookshelfId = null; });
          S.appData.notebooks.forEach(n => { if (n.bookshelfId === S.currentBookshelfToDelete) n.bookshelfId = null; });
          // Delete bookshelf
          S.appData.bookshelves = S.appData.bookshelves.filter(b => b.id !== S.currentBookshelfToDelete);
          saveData();
          renderLibrary();
          document.getElementById('modal-delete-bookshelf').classList.add('hidden');
          S.currentBookshelfToDelete = null;
          showToast('Bokhylla raderad, allt innehåll behölls.');
      });

      document.getElementById('btn-delete-bookshelf-delete')?.addEventListener('click', () => {
          if (!S.currentBookshelfToDelete) return;
          // Delete items
          S.appData.decks = S.appData.decks.filter(d => d.bookshelfId !== S.currentBookshelfToDelete);
          S.appData.notebooks = S.appData.notebooks.filter(n => n.bookshelfId !== S.currentBookshelfToDelete);
          // Delete bookshelf
          S.appData.bookshelves = S.appData.bookshelves.filter(b => b.id !== S.currentBookshelfToDelete);
          saveData();
          renderLibrary();
          document.getElementById('modal-delete-bookshelf').classList.add('hidden');
          S.currentBookshelfToDelete = null;
          showToast('Bokhylla och allt dess innehåll raderat.');
      });
}
