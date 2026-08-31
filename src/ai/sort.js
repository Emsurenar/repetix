import { nyttId } from '../core/utils.js';
import { aiErrorMessage, callAIDetailed } from './call.js';
import { parseLista } from './svarstolk.js';
import { medTankeutrymme } from './tak.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { openDeck } from '../ui/deck.js';
import { safeParse } from '../ui/images.js';
import { showToast } from '../ui/toast.js';


export const fetchAiSort = async (deck) => {
    const unsortedCards = deck.cards.filter(c => !c.sectionId && c.type !== 'note');
    if (unsortedCards.length === 0) {
        showToast('Inga osorterade kort att sortera.');
        return;
    }

    const modal = document.getElementById('modal-ai-sort');
    const loading = document.getElementById('ai-sort-loading');
    const preview = document.getElementById('ai-sort-preview');
    const actions = document.getElementById('ai-sort-actions');
    const status = document.getElementById('ai-sort-status');

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    preview.classList.add('hidden');
    actions.classList.add('hidden');
    status.textContent = `Analyserar ${unsortedCards.length} osorterade kort...`;

    const existingSections = (deck.sections || []).map(s => s.title);
    const cardSummaries = unsortedCards.map(c => ({ id: c.id, front: c.front, back: c.back }));

    try {
        const { text, truncated } = await callAIDetailed({
            system: `Du är en expert på att organisera flashcards i logiska mappar/kategorier. Analysera korten noggrant och gruppera dem i mappar baserat på ämne, tema, eller logisk koppling.\n\nBefintliga mappar i kortleken: ${existingSections.length > 0 ? JSON.stringify(existingSections) : '(inga mappar finns ännu)'}\n\nRegler:\n- Använd befintliga mappar om de passar. Matcha exakt på namn.\n- Skapa nya mappar med tydliga, koncisa namn när inget befintligt passar.\n- Varje kort MÅSTE tilldelas exakt en mapp.\n- Tänk djupt på den bästa grupperingen. Kort som hör ihop tematiskt ska hamna i samma mapp.\n- Undvik att skapa för många mappar. Sikta på meningsfulla grupperingar.\n- Mapp-namn ska vara korta och beskrivande.\n\nSvara med ENBART en ren JSON-array:\n[{"cardId": "...", "section": "mappnamn"}]`,
            user: `Här är korten att sortera:\n${JSON.stringify(cardSummaries)}`,
            maxTokens: medTankeutrymme(4000),
            json: true,
            feature: 'sort',
        });

        // Sorteringen listar {cardId, section}, inte kort — därför den råa
        // listtolkningen. Ett avhugget svar sorterar de kort som hann med i
        // stället för inga alls.
        const { poster: sortResult, avhugget } = parseLista(text, { truncated });
        if (avhugget) {
            showToast(`Modellen hann inte skriva klart. ${sortResult.length} kort sorterades.`);
        }

        const sectionGroups = {};
        sortResult.forEach(item => {
            if (!sectionGroups[item.section]) sectionGroups[item.section] = [];
            const card = unsortedCards.find(c => c.id === item.cardId);
            if (card) sectionGroups[item.section].push(card);
        });

        S.pendingAiSort = { deck, sectionGroups };

        loading.classList.add('hidden');
        preview.classList.remove('hidden');
        actions.classList.remove('hidden');
        status.textContent = `${unsortedCards.length} kort sorterade i ${Object.keys(sectionGroups).length} mappar. Granska och godkänn:`;

        preview.innerHTML = '';
        Object.entries(sectionGroups).forEach(([sectionName, cards]) => {
            const isExisting = existingSections.includes(sectionName);
            const groupEl = document.createElement('div');
            groupEl.style.cssText = 'margin-bottom: 1rem;';
            groupEl.innerHTML = `
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    ${escapeHtml(sectionName)}
                    ${!isExisting ? '<span style="font-size: 0.75rem; color: var(--primary-color); font-weight: 500; background: var(--primary-light); padding: 0.1rem 0.5rem; border-radius: 999px;">Ny mapp</span>' : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25rem; padding-left: 1.5rem;">
                    ${cards.map(c => `<div style="font-size: 0.85rem; color: var(--text-secondary); padding: 0.3rem 0; border-bottom: 1px solid var(--border-color);">${safeParse(c.front)}</div>`).join('')}
                </div>
            `;
            preview.appendChild(groupEl);
        });

    } catch (e) {
        loading.classList.add('hidden');
        // Statusraden i sorteringsdialogen är resultatfältet här.
        status.textContent = aiErrorMessage(e);
    }
};

export const applyAiSort = () => {
    if (!S.pendingAiSort) return;
    const { deck, sectionGroups } = S.pendingAiSort;

    Object.entries(sectionGroups).forEach(([sectionName, cards]) => {
        let section = (deck.sections || []).find(s => s.title === sectionName);
        if (!section) {
            section = { id: nyttId(), title: sectionName };
            if (!deck.sections) deck.sections = [];
            deck.sections.push(section);
        }
        cards.forEach(c => {
            const original = deck.cards.find(oc => oc.id === c.id);
            if (original) original.sectionId = section.id;
        });
    });

    saveData();
    S.pendingAiSort = null;
    document.getElementById('modal-ai-sort').classList.add('hidden');
    openDeck(S.currentDeckId);
    showToast('Sortering tillämpad!');
};

export function initAiSort() {

  S.pendingAiSort = null;
}
