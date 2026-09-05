import { aiErrorMessage, callAIDetailed } from './call.js';
import { parseKortlista } from './svarstolk.js';
import { medTankeutrymme } from './tak.js';
import { renderProposedCards } from './proposed-cards.js';
import { S } from '../core/state.js';
import { hamtaKalltext } from '../core/sources.js';
import { fixLatexInCards } from '../ui/images.js';
import { showToast } from '../ui/toast.js';


/**
 * Mappväljarens värde för "Låt AI välja", och förvalet.
 *
 * Ett eget värde och inte tomma strängen: tomt betyder redan "ingen mapp", och
 * att låta det betyda två saker hade gjort skillnaden mellan "lägg dem på
 * toppnivån" och "bestäm åt mig" omöjlig att avläsa.
 */
export const AI_VALJER_MAPP = '__ai__';

export const fetchCardsByTopic = async (topic, modifier = null, deck = null) => {
    // Show Loading step, hide others
    document.getElementById('topic-setup-step').classList.add('hidden');
    document.getElementById('topic-preview-step').classList.add('hidden');
    document.getElementById('topic-loading-step').classList.remove('hidden');
    
    // Set loading message based on source type
    const loadingTitle = document.getElementById('topic-loading-title');
    const loadingText = document.getElementById('topic-loading-text');
    if (S.aiGeneratorOptions.sourceType === 'text') {
        loadingTitle.innerText = "Analyserar dina anteckningar...";
        loadingText.innerText = "AI läser igenom din text och formulerar pedagogiska kort...";
    } else {
        loadingTitle.innerText = "AI skapar dina kort...";
        loadingText.innerText = "Funderar och strukturerar frågor på ämnet...";
    }

    const qty = S.aiGeneratorOptions.quantity || 'auto';
    const isAuto = qty === 'auto';
    const qtyPhrase = isAuto ? 'ett lämpligt antal (mellan 5 och 20 stycken, anpassat för att täcka allt väsentligt material utan att skapa redundans)' : `exakt ${qty}`;
    
    // 1. Gather existing questions to prevent duplicates
    let contextSnippet = "";
    if (deck && deck.cards.length > 0) {
        /* Frågorna som redan finns, för att slippa dubbletter. Högst
         * tvåhundra, de senaste: en lek på tusen kort skickade tidigare
         * tusen rader för varje generering, och de äldsta säger minst om vad
         * som brukar läggas till nu. Att det finns fler sägs, så att
         * modellen inte tror att listan är hela leken. */
        const alla = deck.cards.filter(c => c.type !== 'note');
        const senaste = alla.slice(-200);
        const kap = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const existingFronts = senaste.map(c => `- ${kap(c.front)}`).join('\n');
        const fler = alla.length > senaste.length ? `\n(och ${alla.length - senaste.length} äldre frågor till)` : '';
        const sampleCards = alla.slice(-3).map(c => `F: ${kap(c.front)} | S: ${kap(c.back)}`).join('\n');
        contextSnippet = `\n\nFöljande frågor finns redan i denna kortlek, du får ABSOLUT INTE skapa dubbletter av dessa eller frågor som är mycket lika dem:\n${existingFronts}${fler}\n\nFör att du ska förstå svårighetsgrad och tonaliteten, här är några fullständiga exempel på existerande kort:\n${sampleCards}\n\nDin uppgift är att skapa ${isAuto ? 'ett lämpligt antal' : qty} HELT UNIKA och NYA kort som kompletterar de befintliga!`;
    }

    /* Källans text hämtas först här, inte när källan valdes: den är hundra
     * kilobyte och behövs bara i det ögonblick den ska skickas — och bara
     * utan modifier. Sätts "lättare/svårare/praktisk" byggs instructions om
     * från grunden längre ner och sourceInstruction kastas, så hämtningen
     * vore bortkastat arbete mot hundra kilobyte i onödan. */
    let kallText = null;
    if (S.aiGeneratorOptions.sourceType === 'kalla' && !modifier) {
        kallText = await hamtaKalltext(S.aiGeneratorOptions.sourceId);
        if (!kallText) {
            // Samma återställning som catch-blocket nedan gör vid ett AI-fel —
            // annars fastnar guiden på laddningssteget utan väg tillbaka.
            document.getElementById('topic-loading-step').classList.add('hidden');
            document.getElementById('topic-setup-step').classList.remove('hidden');
            showToast('Kunde inte läsa källans text.');
            return;
        }
    }

    // 2. Build instructions based on settings
    let sourceInstruction = "";
    if (S.aiGeneratorOptions.sourceType === 'kalla') {
        sourceInstruction = `Du MÅSTE utgå strikt ifrån följande föreläsningstext som källmaterial. Hämta all information och fakta från denna text:\n\n"""\n${kallText}\n"""`;
    } else if (S.aiGeneratorOptions.sourceType === 'text') {
        sourceInstruction = `Du MÅSTE utgå strikt ifrån följande text/anteckningar som källmaterial. Hämta all information och fakta från denna text:\n\n"""\n${topic}\n"""`;
    } else {
        sourceInstruction = `Generera kort baserat på följande ämne/nyckelord: "${topic}".`;
    }

    let difficultyPrompt = "Fokusera på medelnivå (Medelnivå).";
    if (S.aiGeneratorOptions.difficulty === 'beginner') {
        difficultyPrompt = "Fokusera på grundläggande definitioner, enkla förklaringar och kärnkoncept. Förklara pedagogiskt och undvik onödig jargong (Nybörjarnivå).";
    } else if (S.aiGeneratorOptions.difficulty === 'advanced') {
        difficultyPrompt = "Fokusera på djupgående detaljer, teoretisk bakgrund, formler, ekvationer eller kantfall. Använd LaTeX för all matematik och formler (Avancerad nivå).";
    }

    let focusPrompt = "Skapa en bra blandning av begreppsdefinitioner, faktakort och praktiska tillämpningsfrågor.";
    if (S.aiGeneratorOptions.focus === 'definitions') {
        focusPrompt = "Korten ska fokusera strikt på nyckelbegrepp och deras definitioner. Framsidan ska innehålla begreppet eller en fråga om vad det betyder, baksidan ska innehålla den exakta definitionen och en kort förklaring.";
    } else if (S.aiGeneratorOptions.focus === 'practical') {
        focusPrompt = "Korten ska fokusera på praktisk tillämpning, kodexempel, scenarier eller problemlösning. Ställ praktiska frågor, visa hur man gör i praktiken.";
    } else if (S.aiGeneratorOptions.focus === 'details') {
        focusPrompt = "Korten ska fokusera på exakta detaljer, fakta, datum, formler eller parametrar som kräver utantillkunskap.";
    }

    let instructions = `Du ska generera ${qtyPhrase} högkvalitativa flashcards.
${sourceInstruction}

Inställningar för inlärning:
- Svårighetsgrad: ${difficultyPrompt}
- Pedagogiskt fokus: ${focusPrompt}

Korten ska vara pedagogiska, extremt korrekta och anpassade för effektiv spaced repetition-inlärning.
${contextSnippet}`;

    // 3. Handle modifiers (Easier, Harder, Practical adjustments)
    if (modifier && S.proposedTopicCards.length > 0) {
        let prevCardsStr = S.proposedTopicCards.map(c => `F: ${c.front}\nS: ${c.back}`).join('\n\n');
        if (modifier === 'easier') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men gör dem TYDLIGT LÄTTARE, mer grundläggande och enklare att förstå.`;
        } else if (modifier === 'harder') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men gör dem TYDLIGT SVÅRARE, mer detaljerade, avancerade och utmanande.`;
        } else if (modifier === 'practical') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men inrikta dem betydligt mer på praktiska exempel, scenarier, tillämpning eller kod.`;
        }
    }

    /* Mappval per kort, men bara när väljaren står kvar på "Låt AI välja".
     * Ett uttalat val i inställningssteget är ett krav och inte en gissning —
     * samma regel som routningen följer när ett anropsställe kräver en viss
     * leverantör. Ber vi ändå om en mapp får vi ett svar vi måste kasta, och
     * betalar för tokens ingen använder. */
    const valjMapp = S.aiGeneratorOptions.sectionId === AI_VALJER_MAPP;
    const befintligaMappar = (deck?.sections ?? []).map((s) => s.title);
    const mappFormat = valjMapp ? ', "section": "mappnamn"' : '';
    const mappRegler = valjMapp
        ? `\n\nVarje kort ska dessutom ha fältet "section" med namnet på mappen kortet hör hemma i.\nBefintliga mappar i kortleken: ${befintligaMappar.length > 0 ? JSON.stringify(befintligaMappar) : '(inga mappar finns ännu)'}\nRegler för mappen:\n- Använd en befintlig mapp när den passar, och matcha då namnet exakt.\n- Hitta annars på ett kort och beskrivande namn. Kort som hör ihop tematiskt ska få samma namn.\n- Undvik att skapa för många mappar. Sikta på meningsfulla grupperingar.\n- Sätt "section" till null när kortet inte hör hemma i någon mapp.`
        : '';

    try {
        const { text, truncated } = await callAIDetailed({
            system: `Du är en pedagogisk expert. Din uppgift är att skapa flashcards.\n\nDu MÅSTE svara med ENBART en ren JSON-array, utan markdown-block, utan extra text. Formatet MÅSTE vara extremt strikt: [{"front": "fråga 1", "back": "svar 1"${mappFormat}}].${mappRegler}\nVIKTIGT: Eventuell matematik MÅSTE formateras med LaTeX. Eftersom du utvinner i JSON kan backslash försvinna. Använd därför konsekvent DUBBLA dollartecken $$ för block eller ENKLA dollartecken $ för inline formatering. Använd aldrig backslash-parenteser i din JSON.`,
            user: instructions,
            maxTokens: medTankeutrymme(3500),
            json: true,
            feature: S.aiGeneratorOptions.sourceType === 'kalla' ? 'kalla-kort' : 'topic',
            /* Att plocka kort ur en text användaren själv gett — en PDF eller
             * inklistrade anteckningar — är närmare extraktion än resonemang.
             * Tänkandet debiteras som utdata och är den största posten vid
             * generering; låg ansträngning skär bort merparten utan att korten
             * blir sämre. Ett fritt ämne får däremot tänka: där finns ingen
             * text att hämta ur, och urvalet är hela uppgiften. */
            effort: S.aiGeneratorOptions.sourceType === 'topic' ? undefined : 'low',
        });

        /* Vakten låg tidigare EFTER fixLatexInCards, som redan hade anropat
         * .map på värdet — den kunde alltså aldrig utlösa. Nu prövas formen
         * innan den används, och ett avhugget svar ger de kort som hann bli
         * färdiga i stället för ingenting alls. */
        const { kort, bortfall, avhugget } = parseKortlista(text, { truncated });
        S.proposedTopicCards = fixLatexInCards(kort);

        if (avhugget) {
            showToast(`Modellen hann inte skriva klart. ${kort.length} kort kunde räddas.`);
        } else if (bortfall > 0) {
            showToast(`${bortfall} kort saknade fråga eller svar och hoppades över.`);
        }

        // Transitions: Hide Loading step, show Preview step
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-preview-step').classList.remove('hidden');
        
        // Reset select all button label
        document.getElementById('btn-toggle-select-all').innerText = "Avmarkera alla";

        renderProposedCards();

    } catch (e) {
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-setup-step').classList.remove('hidden');
        // Guiden är redan tillbaka på inställningssteget, så felet behöver inte
        // blockera med en alert — en toast räcker och ser likadan ut överallt.
        showToast(aiErrorMessage(e));
    }
};
