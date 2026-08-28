import { S } from '../core/state.js';
import { fritextReveal } from '../games/_legacy-fritext.js';
import { actionReveal } from '../games/action.js';


    // Attach to the actual div for click-to-flip
    export const flashcardDiv = document.getElementById('active-flashcard');
    export const flipBtn = document.getElementById('btn-flip');

    export const flipCard = () => {
        if (document.getElementById('study-flip-action').classList.contains('hidden')) return;

        document.getElementById('flashcard-inner').classList.add('flipped');
        document.getElementById('study-flip-action').classList.add('hidden');

        requestAnimationFrame(() => {
            const backFace = document.querySelector('.flashcard-back');
            const inner = document.getElementById('flashcard-inner');
            const flashcardEl = document.querySelector('.flashcard');

            // Reset minHeight and force reflow so scrollHeight reflects actual content
            if (inner) inner.style.minHeight = '0px';
            if (flashcardEl) flashcardEl.style.minHeight = '0px';
            backFace.style.position = 'static';
            backFace.offsetHeight; // force reflow
            const backHeight = backFace.scrollHeight;
            backFace.style.position = '';
            const finalHeight = Math.max(200, backHeight);

            if (inner) inner.style.minHeight = finalHeight + 'px';
            if (flashcardEl) flashcardEl.style.minHeight = finalHeight + 'px';
        });

        if (S.playgroundMode === 'action') {
            actionReveal();
        } else if (S.playgroundMode === 'fritext') {
            fritextReveal();
        } else {
            document.getElementById('study-actions').classList.remove('hidden');
        }
    };
