import { fetchExplanation, fetchTestQuestion } from '../../ai/card-ai.js';
import { getApiKey } from '../../ai/client.js';
import { applyAiSort, fetchAiSort } from '../../ai/sort.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { renderLibrary } from '../library.js';
import { showConfirmModal } from '../modals.js';
import { switchView } from '../router.js';
import { showToast } from '../toast.js';


    const handleModifierClick = async (modifier) => {
        const apiKey = await getApiKey();
        if (apiKey) fetchTestQuestion(apiKey, S.currentAiCard, modifier);
    };

export function initUiWiringDeckActions() {

      document.getElementById('btn-delete-notebook').addEventListener('click', async () => {
          if (await showConfirmModal('Radera anteckningsblock', 'Är du säker på att du vill ta bort hela anteckningsblocket? Detta kan inte ångras.', 'Radera', true)) {
              S.appData.notebooks = S.appData.notebooks.filter(n => n.id !== S.currentNotebookId);
              saveData();
              S.currentNotebookId = null;
              renderLibrary();
              switchView('library');
              showToast('Anteckningsblock borttaget');
          }
      });

      // Modals bindings
      document.getElementById('btn-close-card-modal').addEventListener('click', () => {
          document.getElementById('modal-card-details').classList.add('hidden');
      });

      document.getElementById('btn-explain-ai').addEventListener('click', async () => {
          const apiKey = await getApiKey();
          if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
              alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
              return;
          }
          fetchExplanation(apiKey, S.currentAiCard);
      });

      document.getElementById('btn-test-ai').addEventListener('click', async () => {
          const apiKey = await getApiKey();
          if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
              alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
              return;
          }
          fetchTestQuestion(apiKey, S.currentAiCard, null);
      });

      document.getElementById('btn-test-easier').addEventListener('click', () => handleModifierClick('easier'));
      document.getElementById('btn-test-similar').addEventListener('click', () => handleModifierClick('similar'));
      document.getElementById('btn-test-harder').addEventListener('click', () => handleModifierClick('harder'));

      // Topic Generator Handlers
      document.getElementById('btn-ai-sort')?.addEventListener('click', async () => {
          if (!S.currentDeckId) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          const apiKey = await getApiKey();
          if (apiKey) fetchAiSort(apiKey, deck);
      });

      document.getElementById('btn-cancel-ai-sort')?.addEventListener('click', () => {
          S.pendingAiSort = null;
          document.getElementById('modal-ai-sort').classList.add('hidden');
      });

      document.getElementById('btn-apply-ai-sort')?.addEventListener('click', () => {
          applyAiSort();
      });
}
