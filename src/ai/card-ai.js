import { aiErrorMessage, callAI } from './call.js';
import { buildDeckContext } from './client.js';
import { medTankeutrymme } from './tak.js';
import { S } from '../core/state.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';


export const fetchExplanation = async (card) => {
    document.getElementById('btn-explain-ai').style.display = 'none';
    document.getElementById('btn-test-ai').style.display = 'none';
    document.getElementById('ai-explanation-container').classList.remove('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-text').innerText = '';

    try {
        const text = await callAI({
            system: 'Du är en hjälpsam och pedagogisk lärare. Ge en kort, koncis förklaring eller minnesregel (max 300 ord totalt) för följande flashcard-fråga och svar. Målet är att hjälpa eleven förstå eller minnas svaret bättre. Eleven är däremot en vuxen person som förväntar sig rigorositet. Anpassa din förklaring efter den nivå och stil som framgår av kontexten.',
            user: `Fråga: ${card.front}\nSvar: ${card.back}${buildDeckContext(S.currentDeckId)}`,
            maxTokens: medTankeutrymme(600),
            feature: 'explain',
        });

        document.getElementById('ai-loading').classList.add('hidden');

        const aiTextElement = document.getElementById('ai-text');
        // Render Markdown so newlines and formatting works
        aiTextElement.innerHTML = safeParse(text);

        // Auto-render LaTeX using KaTeX
        renderLatex(aiTextElement);

    } catch (e) {
        document.getElementById('ai-loading').classList.add('hidden');
        // Felet visas i samma fält som förklaringen skulle ha stått i, så att
        // användaren hittar det där blicken redan är.
        document.getElementById('ai-text').innerText = aiErrorMessage(e);
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};

export const fetchTestQuestion = async (card, modifier = null) => {
    document.getElementById('btn-explain-ai').style.display = 'none';
    document.getElementById('btn-test-ai').style.display = 'none';
    document.getElementById('test-question-actions').classList.add('hidden');
    document.getElementById('ai-explanation-container').classList.remove('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-text').innerText = '';

    const deckCtx = buildDeckContext(S.currentDeckId);
    let userContent = `Skapa en tentafråga som DIREKT testar och tillämpar detta flashcard:\nKort-fråga: ${card.front}\nKort-svar: ${card.back}${deckCtx}`;

    if (modifier && S.currentAiResponseRaw) {
        if (modifier === 'easier') {
            userContent = `Din tidigare provfråga var:\n${S.currentAiResponseRaw}\n\nGör nu en NY provfråga på exakt samma koncept för detta flashcard, men gör den Tydligt LÄTTARE att förstå eller räkna ut.`;
        } else if (modifier === 'harder') {
            userContent = `Din tidigare provfråga var:\n${S.currentAiResponseRaw}\n\nGör nu en NY provfråga på exakt samma koncept för detta flashcard, men gör den Tydligt SVÅRARE och mer komplex.`;
        } else if (modifier === 'similar') {
            userContent = `Din tidigare provfråga var:\n${S.currentAiResponseRaw}\n\nGör nu en helt NY, LIKNANDE provfråga (samma svårighetsgrad) på exakt samma koncept för detta flashcard. Ange andra siffror eller scenarion.`;
        }
    }

    try {
        const text = await callAI({
            system: 'Du är en sträng men pedagogisk examinator. Din uppgift är att testa elevens förståelse baserat PÅ EXAKT DEN information som finns på flashcardet.\nDu ska skapa EN (1) specifik tentafråga som direkt prövar kunskapen i flashcardet.\nMålet är att se om eleven verkligen kan tillämpa konceptet på kortet. Om kortet handlar om matematik, gör en passande räkneuppgift. Handlar det om något annat, gör en tillämpad faktafråga.\n\nFORMAT:\nSkriv först ut provfrågan.\nSkriv därefter, under rubriken "Lösning:", det korrekta svaret och en förklaring. Formatera all eventuell matematik med LaTeX.',
            user: userContent,
            maxTokens: medTankeutrymme(600),
            feature: 'testquestion',
        });

        S.currentAiResponseRaw = text;

        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('test-question-actions').classList.remove('hidden');

        const aiTextElement = document.getElementById('ai-text');
        aiTextElement.innerHTML = safeParse(S.currentAiResponseRaw);

        renderLatex(aiTextElement);

    } catch (e) {
        document.getElementById('ai-loading').classList.add('hidden');
        // Samma sak här: resultatfältet är platsen användaren tittar på.
        document.getElementById('ai-text').innerText = aiErrorMessage(e);
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};
