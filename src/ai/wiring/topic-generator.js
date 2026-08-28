import { getApiKey } from '../client.js';
import { updateSaveCountBadge } from '../proposed-cards.js';
import { fetchCardsByTopic } from '../topic-generator.js';
import { createCard } from '../../core/backup.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { renderCards } from '../../ui/deck.js';
import { showToast } from '../../ui/toast.js';


    // Cancel / Close Handlers
    const closeTopicModal = () => document.getElementById('modal-topic-generator').classList.add('hidden');

export function initAiWiringTopicGenerator() {

      document.getElementById('btn-open-topic-generator').addEventListener('click', () => {
          if (!S.currentDeckId) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;

          S.proposedTopicCards = [];
          S.currentTopicRawInput = "";
        
          // Reset inputs
          document.getElementById('input-topic-name').value = '';
          document.getElementById('input-source-text').value = '';
          document.getElementById('input-new-section-name').value = '';
          document.getElementById('new-section-name-container').classList.add('hidden');
        
          // Reset Options
          S.aiGeneratorOptions = {
              sourceType: 'topic',
              quantity: 'auto',
              difficulty: 'intermediate',
              focus: 'mixed',
              sectionId: ''
          };

          // Reset toggles in DOM
          document.getElementById('toggle-source-topic').classList.add('active');
          document.getElementById('toggle-source-text').classList.remove('active');
          document.getElementById('topic-input-container').classList.remove('hidden');
          document.getElementById('text-input-container').classList.add('hidden');

          // Reset option buttons in DOM
          document.querySelectorAll('.btn-option-qty').forEach(btn => {
              btn.classList.toggle('active', btn.getAttribute('data-qty') === 'auto');
          });
          document.querySelectorAll('.btn-option-diff').forEach(btn => {
              btn.classList.toggle('active', btn.getAttribute('data-diff') === 'intermediate');
          });
          document.getElementById('select-topic-focus').value = 'mixed';

          // Load folder dropdown
          const sectionSelect = document.getElementById('select-topic-section');
          sectionSelect.innerHTML = '<option value="">Ingen mapp (Huvudnivå)</option>';
          if (deck.sections && deck.sections.length > 0) {
              deck.sections.forEach(sec => {
                  const opt = document.createElement('option');
                  opt.value = sec.id;
                  opt.innerText = sec.title;
                  sectionSelect.appendChild(opt);
              });
          }
          const optNew = document.createElement('option');
          optNew.value = '__new__';
          optNew.innerText = '+ Skapa ny mapp...';
          sectionSelect.appendChild(optNew);
          sectionSelect.value = '';

          // Show/hide steps
          document.getElementById('topic-setup-step').classList.remove('hidden');
          document.getElementById('topic-loading-step').classList.add('hidden');
          document.getElementById('topic-preview-step').classList.add('hidden');
          document.getElementById('modal-topic-generator').classList.remove('hidden');
      });

      // Toggle Source Handlers
      document.getElementById('toggle-source-topic').addEventListener('click', () => {
          document.getElementById('toggle-source-topic').classList.add('active');
          document.getElementById('toggle-source-text').classList.remove('active');
          document.getElementById('topic-input-container').classList.remove('hidden');
          document.getElementById('text-input-container').classList.add('hidden');
          S.aiGeneratorOptions.sourceType = 'topic';
      });

      document.getElementById('toggle-source-text').addEventListener('click', () => {
          document.getElementById('toggle-source-text').classList.add('active');
          document.getElementById('toggle-source-topic').classList.remove('active');
          document.getElementById('text-input-container').classList.remove('hidden');
          document.getElementById('topic-input-container').classList.add('hidden');
          S.aiGeneratorOptions.sourceType = 'text';
      });

      // Qty and Diff Options Handlers
      document.querySelectorAll('.btn-option-qty').forEach(btn => {
          btn.addEventListener('click', (e) => {
              document.querySelectorAll('.btn-option-qty').forEach(b => b.classList.remove('active'));
              e.currentTarget.classList.add('active');
              const qtyVal = e.currentTarget.getAttribute('data-qty');
              S.aiGeneratorOptions.quantity = qtyVal === 'auto' ? 'auto' : parseInt(qtyVal, 10);
          });
      });

      document.querySelectorAll('.btn-option-diff').forEach(btn => {
          btn.addEventListener('click', (e) => {
              document.querySelectorAll('.btn-option-diff').forEach(b => b.classList.remove('active'));
              e.currentTarget.classList.add('active');
              S.aiGeneratorOptions.difficulty = e.currentTarget.getAttribute('data-diff');
          });
      });

      // Focus handler
      document.getElementById('select-topic-focus').addEventListener('change', (e) => {
          S.aiGeneratorOptions.focus = e.target.value;
      });

      // Section handler
      document.getElementById('select-topic-section').addEventListener('change', (e) => {
          S.aiGeneratorOptions.sectionId = e.target.value;
          if (e.target.value === '__new__') {
              document.getElementById('new-section-name-container').classList.remove('hidden');
          } else {
              document.getElementById('new-section-name-container').classList.add('hidden');
          }
      });
      document.getElementById('btn-close-topic-modal-top').addEventListener('click', closeTopicModal);
      document.getElementById('btn-close-topic-modal').addEventListener('click', closeTopicModal);
    
      document.getElementById('btn-topic-preview-back').addEventListener('click', () => {
          document.getElementById('topic-setup-step').classList.remove('hidden');
          document.getElementById('topic-preview-step').classList.add('hidden');
          document.getElementById('topic-loading-step').classList.add('hidden');
      });

      // Submit Wizard Handler
      document.getElementById('btn-submit-topic-wizard').addEventListener('click', async () => {
          let inputVal = "";
          if (S.aiGeneratorOptions.sourceType === 'topic') {
              inputVal = document.getElementById('input-topic-name').value.trim();
              if (!inputVal) {
                  showToast("Fyll i ett ämne eller koncept!");
                  return;
              }
          } else {
              inputVal = document.getElementById('input-source-text').value.trim();
              if (!inputVal) {
                  showToast("Klistra in anteckningar eller text först!");
                  return;
              }
          }

          S.currentTopicRawInput = inputVal;
          const apiKey = await getApiKey();
          if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
              alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
              return;
          }
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          fetchCardsByTopic(apiKey, inputVal, null, deck);
      });

      // Modifiers Handlers
      document.getElementById('btn-topic-modifier-easier').addEventListener('click', async () => {
          const apiKey = await getApiKey();
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (apiKey) fetchCardsByTopic(apiKey, S.currentTopicRawInput, 'easier', deck);
      });

      document.getElementById('btn-topic-modifier-harder').addEventListener('click', async () => {
          const apiKey = await getApiKey();
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (apiKey) fetchCardsByTopic(apiKey, S.currentTopicRawInput, 'harder', deck);
      });

      document.getElementById('btn-topic-modifier-practical').addEventListener('click', async () => {
          const apiKey = await getApiKey();
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (apiKey) fetchCardsByTopic(apiKey, S.currentTopicRawInput, 'practical', deck);
      });

      // Toggle Select All
      document.getElementById('btn-toggle-select-all').addEventListener('click', (e) => {
          const checkboxes = document.querySelectorAll('.ai-card-select-checkbox');
          const allChecked = Array.from(checkboxes).every(cb => cb.checked);
          checkboxes.forEach(cb => {
              cb.checked = !allChecked;
          });
          e.currentTarget.innerText = allChecked ? "Välj alla" : "Avmarkera alla";
          updateSaveCountBadge();
      });

      // Save cards logic
      document.getElementById('btn-save-topic-cards-new').addEventListener('click', () => {
          if (!S.currentDeckId || S.proposedTopicCards.length === 0) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;

          // Gather all checked items and edited inputs
          const items = document.querySelectorAll('.ai-generated-card-item');
          const cardsToSave = [];
        
          items.forEach(item => {
              const idx = parseInt(item.getAttribute('data-index'));
              const cb = item.querySelector('.ai-card-select-checkbox');
              if (cb && cb.checked) {
                  const front = item.querySelector('.ai-card-front-input').value.trim();
                  const back = item.querySelector('.ai-card-back-input').value.trim();
                  if (front && back) {
                      cardsToSave.push({ front, back });
                  }
              }
          });

          if (cardsToSave.length === 0) {
              showToast("Inga kort valda att spara!");
              return;
          }

          // Handle target section folder
          let sectionId = null;
          if (S.aiGeneratorOptions.sectionId === '__new__') {
              const newSecName = document.getElementById('input-new-section-name').value.trim();
              if (!newSecName) {
                  showToast("Fyll i ett namn för den nya mappen!");
                  return;
              }
              if (!deck.sections) deck.sections = [];
              let existingSection = deck.sections.find(s => s.title.toLowerCase() === newSecName.toLowerCase());
              if (existingSection) {
                  sectionId = existingSection.id;
              } else {
                  const newSec = { id: Date.now().toString() + '_sec_gen', title: newSecName };
                  deck.sections.push(newSec);
                  sectionId = newSec.id;
              }
          } else if (S.aiGeneratorOptions.sectionId) {
              sectionId = S.aiGeneratorOptions.sectionId;
          }

          cardsToSave.forEach(c => {
              deck.cards.push(createCard(c.front, c.back, false, [], sectionId));
          });

          saveData();
          renderCards(deck.cards);
          showToast(`${cardsToSave.length} kort sparades!`);
          closeTopicModal();
      });
}
