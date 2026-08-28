import { getApiKey } from './client.js';
import { createCard } from '../core/backup.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml, fetchWithRetry } from '../core/utils.js';
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

const fetchSuggestion = async (apiKey, deck, info, signal) => {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 400,
            system: `Du är en expert på spaced repetition och pedagogik. Du får en komplett lista med flashcards. Din uppgift: identifiera det kort som saknas mest i kortleken — den fråga som borde finnas men inte gör det. Tänk på:
- Vilka koncept testas men kopplingen mellan dem saknas?
- Finns det viktiga förkunskaper eller konsekvenser som aldrig frågas om?
- Vilka vanliga tentafrågor eller tillämpningar saknas?
- Var finns den största kunskapsluckan givet den nivå korten visar?

Kortet ska vara så träffsäkert att användaren tänker "Såklart ska jag ha den frågan!".

VIKTIGT: Föreslå INTE ett kort som liknar något som redan finns. Var originell och hitta en ny vinkel.

Svara med ENBART ett rent JSON-objekt: {"front": "fråga", "back": "svar", "reasoning": "En mening om varför just detta kort saknas"}
Ingen markdown, inget brus. Skriv kortet på samma språk som de befintliga korten.`,
            messages: [{
                role: 'user',
                content: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`
            }]
        })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let raw = data.content[0].text.trim();
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
          const apiKey = await getApiKey();
          if (!apiKey) return;
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          const info = buildDeckCardList(deck);
          try {
              const card = await fetchSuggestion(apiKey, deck, info);
              renderSuggestionCard(card, suggestionContent);
          } catch (e) {
              console.error('AI suggestion refresh error:', e);
              suggestionContent.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda förslag.</span>';
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

    const apiKey = await getApiKey();
    if (!apiKey) { summaryText.innerHTML = '<span class="deck-ai-placeholder">Ingen API-nyckel.</span>'; return; }

    const info = buildDeckCardList(deck);

    try {
        const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 400,
                system: `Du sammanfattar flashcard-kortlekar med precision och skärpa. Du får hela kortlistan. Skriv en kort, sofistikerad sammanfattning (2-4 meningar) som gör två saker:

1. Fånga kärnan: Vad handlar kortleken egentligen om, på en nivå djupare än titeln antyder?
2. Identifiera luckor: Nämn specifikt 1-2 ämnen/koncept som logiskt borde finnas med givet resten av materialet, men som saknas.

Tonen ska vara som en kunnig kollega som snabbt ger dig läget — inte en AI som analyserar. Skriv på svenska. Ingen inledning, gå rakt på sak.`,
                messages: [{
                    role: 'user',
                    content: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`
                }]
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const html = safeParse(data.content[0].text.trim());
        summaryText.innerHTML = html;
        renderLatex(summaryText);
        summaryBox.classList.add('deck-ai-loaded');
        deckSummaryCache[S.currentDeckId] = { cardCount: info.cards.length, sectionCount: info.sections.length, summaryHtml: html, timestamp: Date.now() };
    } catch (e) {
        console.error('AI summary error:', e);
        summaryText.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda sammanfattning.</span>';
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

    const apiKey = await getApiKey();
    if (!apiKey) { suggestionContent.innerHTML = '<span class="deck-ai-placeholder">Ingen API-nyckel.</span>'; return; }

    const info = buildDeckCardList(deck);

    try {
        const card = await fetchSuggestion(apiKey, deck, info);
        renderSuggestionCard(card, suggestionContent);
        suggestionBox.classList.add('deck-ai-loaded');
    } catch (e) {
        console.error('AI suggestion error:', e);
        suggestionContent.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda förslag.</span>';
        suggestionBox.onclick = () => generateDeckSuggestion();
    }
};