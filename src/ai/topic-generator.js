import { renderProposedCards } from './proposed-cards.js';
import { S } from '../core/state.js';
import { fetchWithRetry } from '../core/utils.js';
import { fixLatexInCards } from '../ui/images.js';


export const fetchCardsByTopic = async (apiKey, topic, modifier = null, deck = null) => {
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
        const existingFronts = deck.cards.map(c => `- ${c.front}`).join('\n');
        const sampleCards = deck.cards.slice(-3).map(c => `F: ${c.front} | S: ${c.back}`).join('\n');
        contextSnippet = `\n\nFöljande frågor finns redan i denna kortlek, du får ABSOLUT INTE skapa dubbletter av dessa eller frågor som är mycket lika dem:\n${existingFronts}\n\nFör att du ska förstå svårighetsgrad och tonaliteten, här är några fullständiga exempel på existerande kort:\n${sampleCards}\n\nDin uppgift är att skapa ${isAuto ? 'ett lämpligt antal' : qty} HELT UNIKA och NYA kort som kompletterar de befintliga!`;
    }

    // 2. Build instructions based on settings
    let sourceInstruction = "";
    if (S.aiGeneratorOptions.sourceType === 'text') {
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

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 3500,
                system: `Du är en pedagogisk expert. Din uppgift är att skapa flashcards.\n\nDu MÅSTE svara med ENBART en ren JSON-array, utan markdown-block, utan extra text. Formatet MÅSTE vara extremt strikt: [{"front": "fråga 1", "back": "svar 1"}].\nVIKTIGT: Eventuell matematik MÅSTE formateras med LaTeX. Eftersom du utvinner i JSON kan backslash försvinna. Använd därför konsekvent DUBBLA dollartecken $$ för block eller ENKLA dollartecken $ för inline formatering. Använd aldrig backslash-parenteser i din JSON.`,
                messages: [{
                    role: 'user',
                    content: instructions
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        let rawContent = data.content[0].text.trim();

        if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();

        S.proposedTopicCards = fixLatexInCards(JSON.parse(rawContent));
        if (!Array.isArray(S.proposedTopicCards)) throw new Error("Format returnerat var ej en städad Array.");

        // Transitions: Hide Loading step, show Preview step
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-preview-step').classList.remove('hidden');
        
        // Reset select all button label
        document.getElementById('btn-toggle-select-all').innerText = "Avmarkera alla";

        renderProposedCards();

    } catch (e) {
        console.error("AI Topic Error:", e);
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-setup-step').classList.remove('hidden');
        alert("Gick inte att generera kort. Fel: " + e.message);
    }
};
