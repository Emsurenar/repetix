import { fetchExplanation, fetchTestQuestion } from '../../ai/card-ai.js';
import { generateDeckSuggestion } from '../../ai/deck-insights.js';
import { applyAiSort, fetchAiSort } from '../../ai/sort.js';
import { S } from '../../core/state.js';
import { saveData } from '../../core/storage.js';
import { renderLibrary } from '../library.js';
import { showConfirmModal } from '../modals.js';
import { switchView } from '../router.js';
import { showToast } from '../toast.js';


    const handleModifierClick = (modifier) => {
        fetchTestQuestion(S.currentAiCard, modifier);
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

      document.getElementById('btn-explain-ai').addEventListener('click', () => {
          fetchExplanation(S.currentAiCard);
      });

      document.getElementById('btn-test-ai').addEventListener('click', () => {
          fetchTestQuestion(S.currentAiCard, null);
      });

      document.getElementById('btn-test-easier').addEventListener('click', () => handleModifierClick('easier'));
      document.getElementById('btn-test-similar').addEventListener('click', () => handleModifierClick('similar'));
      document.getElementById('btn-test-harder').addEventListener('click', () => handleModifierClick('harder'));

      // Topic Generator Handlers
      /* Kortförslaget. Delegering på remsan i stället för en lyssnare på
       * knappen: remsan ritas inte om, och det gör det uppenbart att det bara
       * finns EN väg in. Sammanfattningen, som stod bredvid, skrivs numera av
       * sig själv under titeln — se src/ui/sammanfattning.js. */
      document.getElementById('deck-ai-strip')?.addEventListener('click', (e) => {
          if (e.target.closest('[data-ai-generate]')) generateDeckSuggestion();
      });

      document.getElementById('btn-ai-sort')?.addEventListener('click', () => {
          if (!S.currentDeckId) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          fetchAiSort(deck);
      });

      document.getElementById('btn-cancel-ai-sort')?.addEventListener('click', () => {
          S.pendingAiSort = null;
          document.getElementById('modal-ai-sort').classList.add('hidden');
      });

      document.getElementById('btn-apply-ai-sort')?.addEventListener('click', () => {
          applyAiSort();
      });
}
