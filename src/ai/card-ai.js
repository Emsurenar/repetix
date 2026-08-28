import { buildDeckContext } from './client.js';
import { S } from '../core/state.js';
import { fetchWithRetry } from '../core/utils.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';


export const fetchExplanation = async (apiKey, card) => {
    document.getElementById('btn-explain-ai').style.display = 'none';
    document.getElementById('btn-test-ai').style.display = 'none';
    document.getElementById('ai-explanation-container').classList.remove('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-text').innerText = '';

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
                max_tokens: 600,
                system: 'Du är en hjälpsam och pedagogisk lärare. Ge en kort, koncis förklaring eller minnesregel (max 300 ord totalt) för följande flashcard-fråga och svar. Målet är att hjälpa eleven förstå eller minnas svaret bättre. Eleven är däremot en vuxen person som förväntar sig rigorositet. Anpassa din förklaring efter den nivå och stil som framgår av kontexten.',
                messages: [{
                    role: 'user',
                    content: `Fråga: ${card.front}\nSvar: ${card.back}${buildDeckContext(S.currentDeckId)}`
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();

        document.getElementById('ai-loading').classList.add('hidden');

        const aiTextElement = document.getElementById('ai-text');
        // Render Markdown so newlines and formatting works
        aiTextElement.innerHTML = safeParse(data.content[0].text);

        // Auto-render LaTeX using KaTeX
        renderLatex(aiTextElement);

    } catch (e) {
        console.error("Anthropic API Error:", e);
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('ai-text').innerText = `Kunde inte hämta förklaring: ${e.message}`;
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};

export const fetchTestQuestion = async (apiKey, card, modifier = null) => {
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
                max_tokens: 600,
                system: 'Du är en sträng men pedagogisk examinator. Din uppgift är att testa elevens förståelse baserat PÅ EXAKT DEN information som finns på flashcardet.\nDu ska skapa EN (1) specifik tentafråga som direkt prövar kunskapen i flashcardet.\nMålet är att se om eleven verkligen kan tillämpa konceptet på kortet. Om kortet handlar om matematik, gör en passande räkneuppgift. Handlar det om något annat, gör en tillämpad faktafråga.\n\nFORMAT:\nSkriv först ut provfrågan.\nSkriv därefter, under rubriken "Lösning:", det korrekta svaret och en förklaring. Formatera all eventuell matematik med LaTeX.',
                messages: [{
                    role: 'user',
                    content: userContent
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        S.currentAiResponseRaw = data.content[0].text;

        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('test-question-actions').classList.remove('hidden');

        const aiTextElement = document.getElementById('ai-text');
        aiTextElement.innerHTML = safeParse(S.currentAiResponseRaw);

        renderLatex(aiTextElement);

    } catch (e) {
        console.error("Anthropic API Error:", e);
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('ai-text').innerText = `Kunde inte hämta provfråga: ${e.message}`;
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};
