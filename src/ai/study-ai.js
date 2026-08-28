import { buildDeckContext } from './client.js';
import { S } from '../core/state.js';
import { fetchWithRetry } from '../core/utils.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';


export const fetchStudyAi = async (apiKey, card, question) => {
    document.getElementById('study-ai-loading').classList.remove('hidden');
    document.getElementById('study-ai-chat').classList.add('hidden');

    const instructions = `Du agerar som en hjälpsam tutor/lärare under en flashcard-repetition. Eleven har precis sett detta flashcard:\n\nFråga: ${card.front}\nSvar: ${card.back}\n\nEleven ställer nu följande fråga om kortet: "${question}"\n\nBesvara frågan direkt, kärnfullt och pedagogiskt. Använd LaTeX för eventuell matematik.${buildDeckContext(S.currentDeckId)}`;

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
                system: 'Du är en tutor. Svara kort och pedagogiskt på elevens fråga utifrån flashcard-kontexten. Håll dig till ämnet. Inga långdragna introduktioner, svara rakt på sak!',
                messages: [{ role: 'user', content: instructions }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();

        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');

        const chatElement = document.getElementById('study-ai-chat');
        chatElement.innerHTML = `<strong>AI:</strong><br/>` + safeParse(data.content[0].text.trim());
        renderLatex(chatElement);

    } catch (e) {
        console.error("AI Study Tutor Error:", e);
        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');
        document.getElementById('study-ai-chat').innerText = `Kunde inte hämta svar. Fel: ${e.message}`;
    }
};
