import { aiErrorMessage, callAI } from './call.js';
import { buildDeckContext } from './client.js';
import { S } from '../core/state.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';


export const fetchStudyAi = async (card, question) => {
    document.getElementById('study-ai-loading').classList.remove('hidden');
    document.getElementById('study-ai-chat').classList.add('hidden');

    const instructions = `Du agerar som en hjälpsam tutor/lärare under en flashcard-repetition. Eleven har precis sett detta flashcard:\n\nFråga: ${card.front}\nSvar: ${card.back}\n\nEleven ställer nu följande fråga om kortet: "${question}"\n\nBesvara frågan direkt, kärnfullt och pedagogiskt. Använd LaTeX för eventuell matematik.${buildDeckContext(S.currentDeckId)}`;

    try {
        const text = await callAI({
            system: 'Du är en tutor. Svara kort och pedagogiskt på elevens fråga utifrån flashcard-kontexten. Håll dig till ämnet. Inga långdragna introduktioner, svara rakt på sak!',
            user: instructions,
            maxTokens: 600,
        });

        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');

        const chatElement = document.getElementById('study-ai-chat');
        chatElement.innerHTML = `<strong>AI:</strong><br/>` + safeParse(text.trim());
        renderLatex(chatElement);

    } catch (e) {
        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');
        // Chattbubblan är svarsfältet — felet hamnar där svaret skulle ha stått
        // i stället för att avbryta repetitionen med en dialog.
        document.getElementById('study-ai-chat').innerText = aiErrorMessage(e);
    }
};
