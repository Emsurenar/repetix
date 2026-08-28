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
    /* Nar svaret vandes fram byter betygsraden plats med "Visa svar" pa samma
     * pixlar: mittpunkten pa "Visa svar" hamnar inuti "Bra". Ett otaligt andra
     * klick — eller en dubbelklick — satte darfor ett betyg pa ett kort man
     * inte hunnit lasa, och betyget gar inte att ta tillbaka: det skriver om
     * kortets schemalaggning.
     *
     * Fonstret ar kort med flit. Det ska fanga studsen fran samma tryck, inte
     * hindra nagon som faktiskt bestamt sig. Tangenterna 1-4 gar forbi det
     * helt — den som anvander dem har inte rakat trycka. */
    export const KLICKSPARR_MS = 350;
    let vandesVid = 0;

    export const nyssVand = () => performance.now() - vandesVid < KLICKSPARR_MS;

    export const flipCard = () => {
        if (document.getElementById('study-flip-action').classList.contains('hidden')) return;
        vandesVid = performance.now();

        document.getElementById('flashcard-inner').classList.add('flipped');
        document.getElementById('study-flip-action').classList.add('hidden');

        if (S.playgroundMode === 'action') {
            actionReveal();
        } else {
            document.getElementById('study-actions').classList.remove('hidden');
        }
    };
