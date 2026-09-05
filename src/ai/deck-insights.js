import { AiError, aiErrorMessage, callAIDetailed } from './call.js';
import { parseObjekt } from './svarstolk.js';
import { medTankeutrymme } from './tak.js';
import { createCard } from '../domain/model.js';
import { hittaMapp } from '../domain/mappval.js';
import { enMening, underlagText } from '../domain/sammanfattning.js';
import { nyttId } from '../core/utils.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { openDeck, visaInsikt } from '../ui/deck.js';
import { cardList } from '../ui/dom.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { showToast } from '../ui/toast.js';


/* Taket för kortförslaget.
 *
 * Det stod på 400, satt efter hur mycket text som skulle SYNAS: ett
 * kortförslag med motivering är ungefär 200 tokens. Det slog ändå i taket i
 * praktiken — modellen betalar ur samma budget för allt den skriver, inte
 * bara för det som blir kvar i svaret, och 400 räckte inte till det.
 *
 * 2000 är inte ett behov utan en marginal. Fakturan är användarens egen och
 * bara förbrukade tokens debiteras, så ett tak som aldrig nås kostar
 * ingenting — medan ett för lågt tak kostar hela anropet och ger noll
 * tillbaka. */
const INSIKT_MAX_TOKENS = medTankeutrymme(2000);

const renderSuggestionCard = (card, container) => {
    container.innerHTML = `
        <div class="deck-ai-suggestion-card">
            <div class="deck-ai-suggestion-front">${safeParse(card.front)}</div>
            <div class="deck-ai-suggestion-back">${safeParse(card.back)}</div>
            ${card.reasoning ? `<p class="deck-ai-suggestion-why">${escapeHtml(card.reasoning)}</p>` : ''}
            ${card.section ? `<p class="deck-ai-suggestion-where">Läggs i <strong>${escapeHtml(card.section)}</strong></p>` : ''}
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

/* Förslaget läser ett jämnt urval av leken — högst 120 kort, 200 tecken per
 * sida — och inte hela listan. En lek på tusen kort skickade tidigare allt,
 * och kostade i ett anrop vad en veckas repetitioner kostar. Luckan syns i
 * urvalet: det som saknas saknas oavsett om modellen sett vartannat kort
 * eller varje. Mappnamnen står per kort, så att svaret kan peka rätt. */
const fetchSuggestion = async (deck, signal) => {
    const { text, truncated } = await callAIDetailed({
        feature: 'suggest',
        system: `Du är en expert på spaced repetition och pedagogik. Du får en komplett lista med flashcards. Din uppgift: identifiera det kort som saknas mest i kortleken — den fråga som borde finnas men inte gör det. Tänk på:
- Vilka koncept testas men kopplingen mellan dem saknas?
- Finns det viktiga förkunskaper eller konsekvenser som aldrig frågas om?
- Vilka vanliga tentafrågor eller tillämpningar saknas?
- Var finns den största kunskapsluckan givet den nivå korten visar?

Kortet ska vara så träffsäkert att användaren tänker "Såklart ska jag ha den frågan!".

VIKTIGT: Föreslå INTE ett kort som liknar något som redan finns. Var originell och hitta en ny vinkel.

Ange också vilken mapp kortet hör hemma i. Använd EXAKT namnet på en befintlig mapp när någon passar — de står listade ovanför korten. Passar ingen, föreslå ett kort och beskrivande namn på en ny. Saknar kortleken mappar helt, svara med tom sträng.

Svara med ENBART ett rent JSON-objekt: {"front": "fråga", "back": "svar", "reasoning": "En mening om varför just detta kort saknas", "section": "mappnamn eller tom sträng"}
Ingen markdown, inget brus. Skriv kortet på samma språk som de befintliga korten.`,
        user: underlagText(deck, { maxKort: 120, maxTecken: 200 }),
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

      /* Kortet hamnade tidigare alltid löst i roten, oavsett hur välsorterad
       * leken var — man fick sortera in det för hand direkt efteråt. Mappen
       * kommer nu ur samma svar som kortet: modellen ser ändå hela listan och
       * vilka mappar som finns, så den vet redan var kortet hör hemma. Ett
       * andra anrop hade kostat en begäran till för ett beslut som redan var
       * fattat. */
      let sectionId = null;
      const onskad = typeof card.section === 'string' ? card.section.trim() : '';
      if (onskad) {
          if (!deck.sections) deck.sections = [];
          const befintlig = hittaMapp(deck.sections, onskad);
          if (befintlig) {
              sectionId = befintlig.id;
          } else {
              // Namnet matchade ingen: modellen föreslog en ny mapp, och den
              // fick användaren se innan hen tryckte.
              const ny = { id: nyttId(), title: onskad };
              deck.sections.push(ny);
              sectionId = ny.id;
          }
      }

      deck.cards.push(createCard(card.front, card.back, false, [], sectionId));
      saveData();
      openDeck(S.currentDeckId, S.currentSectionId);
      showToast(onskad ? `Kort tillagt i ${onskad}` : 'Kort tillagt!');
  };

  window.refreshSuggestedCard = () => {
      const suggestionContent = document.getElementById('deck-ai-suggestion-content');
      suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';

      (async () => {
          const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
          if (!deck) return;
          try {
              const card = await fetchSuggestion(deck);
              renderSuggestionCard(card, suggestionContent);
          } catch (e) {
              suggestionContent.innerHTML = `<span class="deck-ai-error">${escapeHtml(aiErrorMessage(e))}</span>`;
          }
      })();
  };
}


/**
 * En mening om vad kortleken handlar om.
 *
 * Det var en panel på 2–4 meningar som fylldes av en knapp i verktygsraden.
 * Den skrevs sällan, för den krävde att man bad om den — och stod sedan kvar
 * som ett stycke ovanför korten man kom för att se. Nu är den en rad under
 * titeln som skrivs av sig själv när leken ändrats (src/ui/sammanfattning.js
 * avgör när), och då ska den kosta så lite som en rad kan: låg ansträngning,
 * ett urval av korten och ett tak för en mening — inte för ett resonemang.
 *
 * Svaret är löpande text, aldrig markdown: raden sätts som textContent, så
 * ett svar med formatering hade visat sina stjärnor.
 *
 * @param {object} deck
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} meningen, städad
 * @throws {AiError}
 */
export const hamtaSammanfattning = async (deck, signal) => {
    const { text } = await callAIDetailed({
        feature: 'summary',
        system: `Du skriver EN mening som säger vad en samling flashcards handlar om. Meningen ska vara konkret och specifik: nämn ämnet och vad korten faktiskt övar, på en nivå djupare än titeln. Högst 25 ord. Löpande text utan markdown, utan citattecken, utan inledning och utan orden "kortlek" eller "flashcards". Skriv på svenska, på samma nivå som en kunnig kollega som beskriver materialet för en annan.`,
        user: underlagText(deck),
        maxTokens: medTankeutrymme(120),
        effort: 'low',
        signal,
    });
    return enMening(text);
};

export const generateDeckSuggestion = async () => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    const suggestionBox = document.getElementById('deck-ai-suggestion');
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';
    visaInsikt(suggestionBox);

    try {
        const card = await fetchSuggestion(deck);
        renderSuggestionCard(card, suggestionContent);
        suggestionBox.classList.add('deck-ai-loaded');
    } catch (e) {
        suggestionContent.innerHTML = `<span class="deck-ai-error">${escapeHtml(aiErrorMessage(e))}</span>`;
        suggestionBox.classList.remove('deck-ai-loaded');
    }
};