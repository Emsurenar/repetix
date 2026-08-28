import { aiErrorMessage, callAI } from './call.js';
import { createCard } from '../domain/model.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { openDeck } from '../ui/deck.js';
import { cardList } from '../ui/dom.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { showToast } from '../ui/toast.js';


// Cache: { deckId: { cardCount, sectionCount, summaryHtml, timestamp } }
export const deckSummaryCache = {};
export const SUMMARY_REGEN_THRESHOLD = 3; // regenerate after this many card changes

const buildDeckCardList = (deck) => {
    const cards = deck.cards.filter(c => c.type !== 'note');
    const sections = (deck.sections || []).map(s => s.title);
    const cardList = cards.map(c => {
        const sec = c.sectionId ? (deck.sections || []).find(s => s.id === c.sectionId) : null;
        return `F: ${c.front} | S: ${c.back}${sec ? ` [${sec.title}]` : ''}`;
    }).join('\n');
    const sectionInfo = sections.length > 0 ? `\nMappar: ${sections.join(', ')}` : '';
    return { cards, sections, cardList, sectionInfo };
};

const renderSuggestionCard = (card, container) => {
    container.innerHTML = `
        <div class="deck-ai-suggestion-card">
            <div class="deck-ai-suggestion-front">${safeParse(card.front)}</div>
            <div class="deck-ai-suggestion-back">${safeParse(card.back)}</div>
            ${card.reasoning ? `<div style="font-size:0.75rem;color:var(--text-secondary);opacity:0.7;font-style:italic;margin-top:0.15rem;">${escapeHtml(card.reasoning)}</div>` : ''}
            <div class="deck-ai-suggestion-actions">
                <button class="btn btn-add-suggestion" onclick="addSuggestedCard(this)">+ Lägg till</button>
                <button class="btn btn-skip-suggestion" onclick="refreshSuggestedCard()">↻ Nytt förslag</button>
            </div>
        </div>
    `;
    renderLatex(container);
    container._pendingCard = card;
};

const fetchSuggestion = async (deck, info, signal) => {
    const text = await callAI({
        system: `Du är en expert på spaced repetition och pedagogik. Du får en komplett lista med flashcards. Din uppgift: identifiera det kort som saknas mest i kortleken — den fråga som borde finnas men inte gör det. Tänk på:
- Vilka koncept testas men kopplingen mellan dem saknas?
- Finns det viktiga förkunskaper eller konsekvenser som aldrig frågas om?
- Vilka vanliga tentafrågor eller tillämpningar saknas?
- Var finns den största kunskapsluckan givet den nivå korten visar?

Kortet ska vara så träffsäkert att användaren tänker "Såklart ska jag ha den frågan!".

VIKTIGT: Föreslå INTE ett kort som liknar något som redan finns. Var originell och hitta en ny vinkel.

Svara med ENBART ett rent JSON-objekt: {"front": "fråga", "back": "svar", "reasoning": "En mening om varför just detta kort saknas"}
Ingen markdown, inget brus. Skriv kortet på samma språk som de befintliga korten.`,
        user: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`,
        maxTokens: 400,
        json: true,
        signal,
    });

    // Fence-strippningen står kvar trots json: true — den är billig och skyddar
    // mot en leverantör som ändå lägger på ett markdown-block.
    let raw = text.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (raw.startsWith('```')) raw = raw.replace(/^```/, '').replace(/```$/, '').trim();
    const card = JSON.parse(raw);
    if (!card || !card.front || !card.back) throw new Error('Invalid card format');
    return card;
};

export function initAiDeckInsights() {

  // --- DECK AI INSIGHTS ---
  S.deckInsightsAbort = null;

  window.generateDeckSummary = generateDeckSummary;

  window.generateDeckSuggestion = generateDeckSuggestion;

  window.addSuggestedCard = (btnEl) => {
      const suggestionContent = document.getElementById('deck-ai-suggestion-content');
      const card = suggestionContent._pendingCard;
      if (!card) return;

      const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
      if (!deck) return;

      deck.cards.push(createCard(card.front, card.back, false, [], null));
      saveData();
      openDeck(S.currentDeckId, S.currentSectionId);
      showToast('Kort tillagt!');
  };

  window.refreshSuggestedCard = () => {
      const suggestionContent = document.getElementById('deck-ai-suggestion-content');
      suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';

      (async () => {
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          const info = buildDeckCardList(deck);
          try {
              const card = await fetchSuggestion(deck, info);
              renderSuggestionCard(card, suggestionContent);
          } catch (e) {
              suggestionContent.innerHTML = `<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">${escapeHtml(aiErrorMessage(e))}</span>`;
          }
      })();
  };
}


export const generateDeckSummary = async () => {
    const summaryText = document.getElementById('deck-ai-summary-text');
    const summaryBox = document.getElementById('deck-ai-summary');
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    summaryText.innerHTML = '<div class="ai-shimmer"></div>';
    summaryBox.onclick = null;

    const info = buildDeckCardList(deck);

    try {
        const text = await callAI({
            system: `Du sammanfattar flashcard-kortlekar med precision och skärpa. Du får hela kortlistan. Skriv en kort, sofistikerad sammanfattning (2-4 meningar) som gör två saker:

1. Fånga kärnan: Vad handlar kortleken egentligen om, på en nivå djupare än titeln antyder?
2. Identifiera luckor: Nämn specifikt 1-2 ämnen/koncept som logiskt borde finnas med givet resten av materialet, men som saknas.

Tonen ska vara som en kunnig kollega som snabbt ger dig läget — inte en AI som analyserar. Skriv på svenska. Ingen inledning, gå rakt på sak.`,
            user: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`,
            maxTokens: 400,
        });

        const html = safeParse(text.trim());
        summaryText.innerHTML = html;
        renderLatex(summaryText);
        summaryBox.classList.add('deck-ai-loaded');
        deckSummaryCache[S.currentDeckId] = { cardCount: info.cards.length, sectionCount: info.sections.length, summaryHtml: html, timestamp: Date.now() };
    } catch (e) {
        // Rutan är sitt eget resultatfält, så felet stannar där i stället för att
        // avbryta med en toast. Klicket som gör om försöket sätts tillbaka.
        summaryText.innerHTML = `<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">${escapeHtml(aiErrorMessage(e))}</span>`;
        summaryBox.onclick = () => generateDeckSummary();
    }
};

export const generateDeckSuggestion = async () => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    const suggestionBox = document.getElementById('deck-ai-suggestion');
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';
    suggestionBox.onclick = null;

    const info = buildDeckCardList(deck);

    try {
        const card = await fetchSuggestion(deck, info);
        renderSuggestionCard(card, suggestionContent);
        suggestionBox.classList.add('deck-ai-loaded');
    } catch (e) {
        suggestionContent.innerHTML = `<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">${escapeHtml(aiErrorMessage(e))}</span>`;
        suggestionBox.onclick = () => generateDeckSuggestion();
    }
};