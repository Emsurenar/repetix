import { S } from '../core/state.js';
import { actionReveal } from '../games/action.js';


    // Attach to the actual div for click-to-flip
    export const flashcardDiv = document.getElementById('active-flashcard');
    export const flipBtn = document.getElementById('btn-flip');

    /* Vander kortet.
     *
     * Hojden mattes tidigare upp har och lades pa kortet i pixlar, sa att
     * betygsraden inte skulle hoppa. Raden ar sedan dess forankrad i vyns
     * nederkant och kan inte hoppa; matningen lamnade bara ett dott falt under
     * svaret. Kortet far vara sa hogt som sitt innehall.
     *
     * Fritext-grenen ledde till _legacy-fritext.js, som aldrig kunde nas:
     * lagets egen start visar en helskarmsyta och passerar aldrig den har
     * knappen. Filen ar borttagen.
     */
    export const flipCard = () => {
        if (document.getElementById('study-flip-action').classList.contains('hidden')) return;

        document.getElementById('flashcard-inner').classList.add('flipped');
        document.getElementById('study-flip-action').classList.add('hidden');

        if (S.playgroundMode === 'action') {
            actionReveal();
        } else {
            document.getElementById('study-actions').classList.remove('hidden');
        }
    };
