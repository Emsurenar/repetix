import { nyttId } from '../../core/utils.js';
import { closeSectionModal, openSectionModal } from '../../ai/client.js';
import { createCard } from '../../domain/model.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { openDeck } from '../deck.js';
import { fileToDataUrl, renderImagePreviews, uploadCardImages } from '../images.js';
import { switchView } from '../router.js';
import { showToast } from '../toast.js';


    // --- Image upload button wiring ---


    export const populateAddCardSections = (deck, selectedVal = null) => {
        const sectionSelect = document.getElementById('card-section-select');
        if (!sectionSelect) return;
        sectionSelect.innerHTML = '<option value="">Ingen mapp</option>';
        if (deck) {
            const sections = deck.sections || [];
            sections.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.title;
                sectionSelect.appendChild(opt);
            });
            if (selectedVal && selectedVal.startsWith('__new__:')) {
                const newTitle = selectedVal.substring(8);
                const opt = document.createElement('option');
                opt.value = selectedVal;
                opt.textContent = ` Skapa ny: "${newTitle}"`;
                sectionSelect.appendChild(opt);
            }
            document.getElementById('card-section-group').style.display = '';
        } else {
            document.getElementById('card-section-group').style.display = 'none';
        }
        if (selectedVal) {
            sectionSelect.value = selectedVal;
        }
    };

export function initUiWiringAddCard() {

      // document.getElementById('btn-add-card').addEventListener('click', () => switchView('addCard'));
      document.getElementById('form-add-card').addEventListener('submit', (e) => {
          e.preventDefault();
          const front = document.getElementById('card-front').value.trim();
          const back = document.getElementById('card-back').value.trim();
          const isLongForm = document.getElementById('card-longform').checked;
          const selectedSectionId = document.getElementById('card-section-select').value || null;
          if (front && back && S.currentDeckId) {
              const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
            
              let finalSectionId = selectedSectionId;
              if (selectedSectionId && selectedSectionId.startsWith('__new__:')) {
                  const newSecName = selectedSectionId.substring(8).trim();
                  if (!deck.sections) deck.sections = [];
                  let existingSection = deck.sections.find(s => s.title.toLowerCase() === newSecName.toLowerCase());
                  if (existingSection) {
                      finalSectionId = existingSection.id;
                  } else {
                      const newSec = { id: nyttId(), title: newSecName };
                      deck.sections.push(newSec);
                      finalSectionId = newSec.id;
                  }
              }

              const description = document.getElementById('card-description').value;
              const nyttKort = createCard(front, back, isLongForm, [...S.addCardImages], finalSectionId, {
                  description,
              });
              deck.cards.push(nyttKort);
              saveData();

              // Bilderna laddas upp i bakgrunden och byts mot sina sokvagar.
              // Kortet ar redan sparat, sa en misslyckad uppladdning betyder
              // bara att bilden ligger kvar som base64 och migreras senare.
              void uploadCardImages(nyttKort.backImages, nyttKort.id).then((sokvagar) => {
                  nyttKort.backImages = sokvagar;
                  saveData();
              });

              populateAddCardSections(deck);

              document.getElementById('card-front').value = '';
              document.getElementById('card-back').value = '';
              document.getElementById('card-description').value = '';
              document.getElementById('card-longform').checked = false;
              S.addCardImages = [];
              renderImagePreviews(document.getElementById('card-back-image-preview'), S.addCardImages, () => {});
              showToast('Kort sparat!');
              document.getElementById('card-front').focus();
          }
      });

      // Wire Add Card image upload
      document.getElementById('btn-add-card-image').addEventListener('click', () => {
          document.getElementById('card-back-image-input').click();
      });
      document.getElementById('card-back-image-input').addEventListener('change', async (e) => {
          const files = Array.from(e.target.files);
          for (const file of files) {
              if (!file.type.startsWith('image/')) continue;
              try { S.addCardImages.push(await fileToDataUrl(file)); } catch {}
          }
          e.target.value = '';
          const previewRefresh = (idx) => {
              S.addCardImages.splice(idx, 1);
              renderImagePreviews(document.getElementById('card-back-image-preview'), S.addCardImages, previewRefresh);
          };
          renderImagePreviews(document.getElementById('card-back-image-preview'), S.addCardImages, previewRefresh);
      });

      // Wire Edit Card image upload
      document.getElementById('btn-edit-card-image').addEventListener('click', () => {
          document.getElementById('edit-card-back-image-input').click();
      });
      document.getElementById('edit-card-back-image-input').addEventListener('change', async (e) => {
          const files = Array.from(e.target.files);
          for (const file of files) {
              if (!file.type.startsWith('image/')) continue;
              try { S.editCardImages.push(await fileToDataUrl(file)); } catch {}
          }
          e.target.value = '';
          const previewRefresh = (idx) => {
              S.editCardImages.splice(idx, 1);
              renderImagePreviews(document.getElementById('edit-card-back-image-preview'), S.editCardImages, previewRefresh);
          };
          renderImagePreviews(document.getElementById('edit-card-back-image-preview'), S.editCardImages, previewRefresh);
      });

      // Reset addCardImages and populate section dropdown when navigating to Add Card view
      document.getElementById('btn-add-card').addEventListener('click', () => {
          switchView('addCard');
          S.addCardImages = [];
          renderImagePreviews(document.getElementById('card-back-image-preview'), S.addCardImages, () => {});
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
        
          let initialSelectVal = null;
          if (S.preselectSectionId) {
              initialSelectVal = S.preselectSectionId;
              S.preselectSectionId = null;
          } else if (S.currentSectionId) {
              initialSelectVal = S.currentSectionId;
          }
          populateAddCardSections(deck, initialSelectVal);
          // Dörren öppnas och pennan är redan i handen: första fältet har
          // fokus så att man kan börja skriva utan ett klick till.
          document.getElementById('card-front').focus();
      }, true);

      // --- Section (mapp) create/rename modal ---
      document.getElementById('btn-add-section').addEventListener('click', () => {
          openSectionModal();
      });

      document.getElementById('btn-cancel-section').addEventListener('click', () => {
          closeSectionModal();
      });

      document.getElementById('form-new-section').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('new-section-name').value.trim();
          if (!name) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          if (!deck.sections) deck.sections = [];

          if (S.currentSectionToEdit) {
              S.currentSectionToEdit.title = name;
          } else {
              const newSection = { id: nyttId(), title: name };
              deck.sections.push(newSection);
          }
          saveData();
          closeSectionModal();
          openDeck(S.currentDeckId, S.currentSectionId);
      });
}
