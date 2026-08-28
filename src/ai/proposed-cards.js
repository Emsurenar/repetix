import { aiErrorMessage, callAI } from './call.js';
import { S } from '../core/state.js';
import { showToast } from '../ui/toast.js';


export const renderProposedCards = () => {
    const container = document.getElementById('topic-cards-list');
    if (!container) return;
    container.innerHTML = '';

    // Update summary count
    // Bara talet. Instruktionen som stod här sade vad listan under redan visar.
    document.getElementById('topic-summary-count').innerText = `${S.proposedTopicCards.length} kort`;
    
    S.proposedTopicCards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'ai-generated-card-item';
        div.setAttribute('data-index', index);
        /* Klasser i stallet for inline-stilar. Raden bar tidigare sin egen
         * lila (#7C3AED), sin egen radie och sin egen bakgrund direkt i
         * markupen — tre varden utanfor tokens som ingen kunde hitta. */
        div.innerHTML = `
            <input type="checkbox" class="ai-card-select-checkbox" data-index="${index}" checked aria-label="Behall kortet">
            <div class="ai-card-fields">
                <label class="ai-card-field-group">
                    <span class="label">Framsida (Fråga)</span>
                    <textarea class="ai-card-front-input" rows="2" data-index="${index}">${card.front}</textarea>
                </label>
                <label class="ai-card-field-group">
                    <span class="label">Baksida (Svar)</span>
                    <textarea class="ai-card-back-input" rows="2" data-index="${index}">${card.back}</textarea>
                </label>
            </div>
            <div class="ai-card-actions">
                <button type="button" class="btn-icon btn-ai-card-regenerate" data-index="${index}" title="Generera om detta kort" aria-label="Generera om detta kort">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                </button>
                <button type="button" class="btn-icon btn-ai-card-delete" data-index="${index}" title="Ta bort" aria-label="Ta bort kortet">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;
        container.appendChild(div);
    });

    // Listen to changes to save textarea inputs back to the array immediately
    container.querySelectorAll('.ai-card-front-input').forEach(ta => {
        ta.addEventListener('input', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            S.proposedTopicCards[idx].front = e.currentTarget.value;
        });
    });

    container.querySelectorAll('.ai-card-back-input').forEach(ta => {
        ta.addEventListener('input', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            S.proposedTopicCards[idx].back = e.currentTarget.value;
        });
    });

    // Checkbox toggle changes
    container.querySelectorAll('.ai-card-select-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSaveCountBadge();
        });
    });

    // Individual delete
    container.querySelectorAll('.btn-ai-card-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            S.proposedTopicCards.splice(idx, 1);
            renderProposedCards();
            updateSaveCountBadge();
        });
    });

    // Individual regenerate
    container.querySelectorAll('.btn-ai-card-regenerate').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            regenerateSingleCard(idx);
        });
    });

    updateSaveCountBadge();

    // Show/hide topic preview step
    if (S.proposedTopicCards.length === 0) {
        document.getElementById('topic-preview-step').classList.add('hidden');
        document.getElementById('topic-setup-step').classList.remove('hidden');
    }
};

export const updateSaveCountBadge = () => {
    const checkedCount = document.querySelectorAll('.ai-card-select-checkbox:checked').length;
    const saveBtn = document.getElementById('btn-save-count');
    if (saveBtn) saveBtn.innerText = checkedCount;
};

const regenerateSingleCard = async (index) => {
    const container = document.getElementById('topic-cards-list');
    const cardEl = container.querySelector(`.ai-generated-card-item[data-index="${index}"]`);
    if (!cardEl) return;

    // Visar att just den har raden bytes ut. Faltvaljaren letade tidigare efter
    // en inline-stil ("div[style*=flex:1]") och slutade fungera sa fort raden
    // fick en klass i stallet.
    cardEl.classList.add('is-working');
    const fieldsDiv = cardEl.querySelector('.ai-card-fields');
    fieldsDiv.innerHTML = `
        <p class="ai-card-working">Ersätter med nytt kort...</p>
    `;
    const actionButtons = cardEl.querySelectorAll('button');
    actionButtons.forEach(btn => btn.style.display = 'none');

    // Build blacklist of existing proposed questions to avoid duplication
    const blacklist = S.proposedTopicCards
        .map((c, i) => i !== index ? `- ${c.front}` : "")
        .filter(q => q !== "")
        .join('\n');

    let deckContext = "";
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (deck && deck.cards.length > 0) {
        deckContext = deck.cards.map(c => `- ${c.front}`).join('\n');
        const sampleSize = Math.min(5, deck.cards.length);
        const samples = deck.cards.slice(-sampleSize).map(c => `F: ${c.front} | S: ${c.back}`).join('\n');
        deckContext += `\n\nFör att förstå nivå och stil, här är några fullständiga kort:\n${samples}`;
    }

    const difficultyPrompt = S.aiGeneratorOptions.difficulty === 'beginner' 
        ? 'Fokusera på grundläggande definitioner och enkla förklaringar (Nybörjarnivå).'
        : S.aiGeneratorOptions.difficulty === 'advanced'
        ? 'Fokusera på djupgående detaljer, bevis eller formler. Använd LaTeX (Avancerad nivå).'
        : 'Fokusera på mellannivå (Medelnivå).';

    const focusPrompt = S.aiGeneratorOptions.focus === 'definitions'
        ? 'Fokusera på begrepp och deras definitioner.'
        : S.aiGeneratorOptions.focus === 'practical'
        ? 'Fokusera på praktisk tillämpning, scenarier, problem eller kodexempel.'
        : S.aiGeneratorOptions.focus === 'details'
        ? 'Fokusera på exakta fakta och parametrar.'
        : 'Skapa ett välbalanserat kort.';

    const systemInstructions = 'Du är en pedagogisk expert. Skapa ett flashcard i JSON-format. Svara med ENBART ett städat JSON-objekt: {"front": "fråga", "back": "svar"}. Ingen markdown, inget brus. Om matematik ingår, använd LaTeX med $ eller $$.';

    const userInstructions = `Skapa ett helt nytt flashcard baserat på ämnet/texten "${S.currentTopicRawInput}".
${difficultyPrompt}
${focusPrompt}

Kortet får ABSOLUT INTE vara likt eller duplicera följande frågor:
${blacklist}
${deckContext}

Svara med ett enda JSON-objekt.`;

    try {
        const text = await callAI({
            system: systemInstructions,
            user: userInstructions,
            maxTokens: 1000,
            json: true,
        });

        // Fence-strippningen behålls trots json: true som skydd mot en
        // leverantör som ändå lägger på ett markdown-block.
        let rawContent = text.trim();

        if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();

        const newCard = JSON.parse(rawContent);
        if (newCard && newCard.front && newCard.back) {
            S.proposedTopicCards[index] = { front: newCard.front, back: newCard.back };
        }
        renderProposedCards();
    } catch (e) {
        showToast(aiErrorMessage(e));
        renderProposedCards();
    }
};

export function initAiProposedCards() {
  window.updateSaveCountBadge = updateSaveCountBadge;
  window.regenerateSingleCard = regenerateSingleCard;
}
