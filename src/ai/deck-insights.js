import { AiError, aiErrorMessage, callAIDetailed } from './call.js';
import { parseObjekt } from './svarstolk.js';
import { createCard } from '../domain/model.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { aiGenerateButton, openDeck } from '../ui/deck.js';
import { cardList } from '../ui/dom.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { showToast } from '../ui/toast.js';


/* Taket för de två insikterna.
 *
 * Båda stod på 400, satt efter hur mycket text som skulle SYNAS: en
 * sammanfattning på 2-4 meningar är ungefär 150 tokens och ett kortförslag
 * med motivering ungefär 200. Båda slog ändå i taket i praktiken — modellen
 * betalar ur samma budget för allt den skriver, inte bara för det som blir
 * kvar i svaret, och 400 räckte inte till det.
 *
 * 2000 är inte ett behov utan en marginal. Fakturan är användarens egen och
 * bara förbrukade tokens debiteras, så ett tak som aldrig nås kostar
 * ingenting — medan ett för lågt tak kostar hela anropet och ger noll
 * tillbaka. */
const INSIKT_MAX_TOKENS = 2000;

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
                <button type="button" class="btn btn-add-suggestion" data-forslag="lagg-till">+ Lägg till</button>
                <button type="button" class="btn btn-skip-suggestion" data-forslag="nytt">↻ Nytt förslag</button>
            </div>
        </div>
    `;
    renderLatex(container);
    container._pendingCard = card;

    /* Handlingarna kopplas här i stället för att bo i onclick-attribut. Ett
     * attribut som körs som kod går inte att sanera och hindrar en CSP med
     * script-src 'self'; funktionerna finns dessutom redan. */
    container.querySelector('[data-forslag="lagg-till"]')
        ?.addEventListener('click', (e) => window.addSuggestedCard(e.currentTarget));
    container.querySelector('[data-forslag="nytt"]')
        ?.addEventListener('click', () => window.refreshSuggestedCard());
};

const fetchSuggestion = async (deck, info, signal) => {
    const { text, truncated } = await callAIDetailed({
        feature: 'suggest',
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
        maxTokens: INSIKT_MAX_TOKENS,
        json: true,
        signal,
    });

    /* truncated skickas vidare i stället för att avgöra saken här.
     *
     * Ett avhugget svar är inte automatiskt oanvändbart: hade modellen redan
     * skrivit klart objektet när taket tog slut är förslaget helt, och att
     * kasta det hade betytt att användaren betalade för ett kort som fanns.
     * Tolken avvisar bara när texten faktiskt inte går att läsa — och säger
     * då att den avbröts, i stället för det generiska "något gick fel". */
    const card = parseObjekt(text, { truncated });

    /* Sträng, inte bara sanningsvärde. renderSuggestionCard körs inne i
     * anroparens try och skickar fälten till safeParse, som anropar .replace
     * på dem — ett tal eller ett objekt där hade kastat ett TypeError från
     * renderingen, alltså tillbaka till just den generiska meningen som allt
     * det här handlar om att bli av med. */
    const arText = (v) => typeof v === 'string' && v.trim() !== '';
    if (!arText(card.front) || !arText(card.back)) {
        throw new AiError('Modellens förslag saknade fråga eller svar.', 'provider_error');
    }
    return card;
};

export function initAiDeckInsights() {

  // --- DECK AI INSIGHTS ---
  S.deckInsightsAbort = null;

  /* De två genereringarna låg tidigare på window. Deras enda konsument var
   * deck.js, som redan importerar dem — omvägen gav ingenting utom ett par
   * globaler till att hålla reda på. */

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

    const info = buildDeckCardList(deck);

    try {
        const { text, truncated } = await callAIDetailed({
            feature: 'summary',
            system: `Du sammanfattar flashcard-kortlekar med precision och skärpa. Du får hela kortlistan. Skriv en kort, sofistikerad sammanfattning (2-4 meningar) som gör två saker:

1. Fånga kärnan: Vad handlar kortleken egentligen om, på en nivå djupare än titeln antyder?
2. Identifiera luckor: Nämn specifikt 1-2 ämnen/koncept som logiskt borde finnas med givet resten av materialet, men som saknas.

Tonen ska vara som en kunnig kollega som snabbt ger dig läget — inte en AI som analyserar. Skriv på svenska. Ingen inledning, gå rakt på sak.`,
            user: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`,
            maxTokens: INSIKT_MAX_TOKENS,
        });

        /* Den halva meningen får stå kvar — den säger något — men den ska inte
         * utge sig för att vara hela svaret. Utan raden nedan slutar
         * sammanfattningen bara mitt i, och det ser ut som appens fel. */
        const html = safeParse(
            truncated ? `${text.trim()}\n\n*Svaret avbröts innan det var färdigt.*` : text.trim()
        );
        summaryText.innerHTML = html;
        renderLatex(summaryText);
        summaryBox.classList.add('deck-ai-loaded');
        deckSummaryCache[S.currentDeckId] = { cardCount: info.cards.length, sectionCount: info.sections.length, summaryHtml: html, timestamp: Date.now() };
    } catch (e) {
        /* Rutan är sitt eget resultatfält, så felet stannar där i stället för
         * att avbryta med en toast. Nytt försök erbjuds som en riktig knapp
         * och inte som ett klick var som helst i rutan: knappen syns, går att
         * nå med tangentbordet, och plockas upp av samma delegering som allt
         * annat — alltså en väg in, inte två. */
        summaryText.innerHTML =
            `<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">${escapeHtml(aiErrorMessage(e))}</span>` +
            aiGenerateButton('summary');
        summaryBox.classList.remove('deck-ai-loaded');
    }
};

export const generateDeckSuggestion = async () => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    const suggestionBox = document.getElementById('deck-ai-suggestion');
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';

    const info = buildDeckCardList(deck);

    try {
        const card = await fetchSuggestion(deck, info);
        renderSuggestionCard(card, suggestionContent);
        suggestionBox.classList.add('deck-ai-loaded');
    } catch (e) {
        suggestionContent.innerHTML =
            `<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">${escapeHtml(aiErrorMessage(e))}</span>` +
            aiGenerateButton('suggestion');
        suggestionBox.classList.remove('deck-ai-loaded');
    }
};