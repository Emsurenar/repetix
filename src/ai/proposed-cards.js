import { AiError, aiErrorMessage, callAIDetailed } from './call.js';
import { parseObjekt } from './svarstolk.js';
import { fordelaMappar } from '../domain/mappval.js';
import { medTankeutrymme } from './tak.js';
import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { showToast } from '../ui/toast.js';


export const renderProposedCards = () => {
    const container = document.getElementById('topic-cards-list');
    if (!container) return;
    container.innerHTML = '';

    // Update summary count
    // Bara talet. Instruktionen som stod här sade vad listan under redan visar.
    document.getElementById('topic-summary-count').innerText = `${S.proposedTopicCards.length} kort`;
    
    /* Mappväljaren visas bara när modellen faktiskt föreslagit mappar. Har
     * användaren pekat ut en mapp i inställningssteget gäller den för hela
     * omgången, och en väljare per rad hade påstått att korten kan hamna på
     * olika ställen när de inte kan det. */
    const deck = S.appData?.decks?.find((d) => d.id === S.currentDeckId);
    const befintliga = deck?.sections ?? [];
    const namnen = S.proposedTopicCards.map((c) => c.section);
    const visaMapp = namnen.some((n) => typeof n === 'string' && n.trim() !== '');
    // Samma fördelning som sparandet gör, så listan över nya mappar i väljaren
    // är exakt de som faktiskt kommer att skapas.
    const nyaNamn = visaMapp ? fordelaMappar(befintliga, namnen).nya : [];
    const samma = (a, b) =>
        typeof a === 'string' &&
        typeof b === 'string' &&
        a.trim().toLowerCase() === b.trim().toLowerCase();

    const mappval = (index) =>
        visaMapp
            ? `
                <label class="ai-card-field-group">
                    <span class="label">Mapp</span>
                    <span class="select-wrap">
                        <select class="ai-card-section-select field" data-index="${index}"></select>
                        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M1 1.5L4.5 5L8 1.5" />
                        </svg>
                    </span>
                </label>`
            : '';

    /* Alternativen byggs som noder, inte som markup. escapeHtml bygger på
     * textContent och lämnar citattecknet orört: i ett value-attribut stänger
     * ett " värdet, och resten av mappnamnet blir egna attribut på option —
     * mätt till ett riktigt onerror. Namnet kommer från modellen, som kan ha
     * läst det ur en text användaren klistrat in, så det är inte appens egen
     * sträng. En nod tar värdet som värde och kan inte tolkas som något. */
    const fyllMappval = (rad, card) => {
        const sel = rad.querySelector('.ai-card-section-select');
        if (!sel) return;
        const alternativ = (text, varde) => {
            const opt = document.createElement('option');
            opt.textContent = text;
            opt.value = varde;
            sel.appendChild(opt);
        };
        alternativ('Ingen mapp', '');
        befintliga.forEach((sec) => alternativ(sec.title, sec.title));
        nyaNamn.forEach((titel) => alternativ(`${titel} (ny)`, titel));
        const traff = [...sel.options].find((o) => samma(o.value, card.section));
        sel.value = traff ? traff.value : '';
    };

    S.proposedTopicCards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'ai-generated-card-item';
        div.setAttribute('data-index', index);
        /* Klasser i stallet for inline-stilar. Raden bar tidigare sin egen
         * lila (#7C3AED), sin egen radie och sin egen bakgrund direkt i
         * markupen — tre varden utanfor tokens som ingen kunde hitta. */
        /* Modellens svar escapas. En textarea skyddar ingenting: `</textarea>`
         * i svaret stänger fältet och resten av strängen blir markup. Ett kort
         * kan komma från en webbsida användaren klistrat in, så texten är inte
         * appens egen. */
        div.innerHTML = `
            <input type="checkbox" class="ai-card-select-checkbox" data-index="${index}" checked aria-label="Behall kortet">
            <div class="ai-card-fields">
                <label class="ai-card-field-group">
                    <span class="label">Framsida (Fråga)</span>
                    <textarea class="ai-card-front-input" rows="2" data-index="${index}">${escapeHtml(card.front)}</textarea>
                </label>
                <label class="ai-card-field-group">
                    <span class="label">Baksida (Svar)</span>
                    <textarea class="ai-card-back-input" rows="2" data-index="${index}">${escapeHtml(card.back)}</textarea>
                </label>${mappval(index)}
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
        fyllMappval(div, card);
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

    container.querySelectorAll('.ai-card-section-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            S.proposedTopicCards[idx].section = e.currentTarget.value;
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
        const { text, truncated } = await callAIDetailed({
            system: systemInstructions,
            user: userInstructions,
            maxTokens: medTankeutrymme(1000),
            json: true,
            feature: 'regenerate',
        });

        const newCard = parseObjekt(text, { truncated });
        if (!newCard.front || !newCard.back) {
            // Tyst utbyte av kortet mot ingenting var svårare att förstå än ett
            // felmeddelande: rutan såg likadan ut som innan man tryckte.
            throw new AiError('Det nya kortet saknade fråga eller svar.', 'provider_error');
        }
        S.proposedTopicCards[index] = { front: newCard.front, back: newCard.back };
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
