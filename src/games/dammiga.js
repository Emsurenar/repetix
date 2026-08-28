import { S } from '../core/state.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { processRating } from '../ui/study.js';


// --- DAMMIGA KORT OVERLAY ---
export const dammigaReveal = () => {
    const cards = S.currentStudyCards;
    let cardIdx = 0;
    const now = Date.now();

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const timeSince = (ts) => {
        if (!ts) return 'Aldrig repeterad';
        const days = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
        if (days === 0) return 'Idag';
        if (days === 1) return '1 dag sedan';
        if (days < 30) return `${days} dagar sedan`;
        const months = Math.floor(days / 30);
        return months === 1 ? '1 månad sedan' : `${months} månader sedan`;
    };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];

        overlay.innerHTML = `
            <div class="arena">
                <div class="arena-top">
                    <span class="micro">Dammiga kort</span>
                    <span class="arena-meta num">
                        <span>Senast ${timeSince(card.lastReviewed)}</span>
                        <span class="arena-sep" aria-hidden="true"></span>
                        <span>${cardIdx} av ${cards.length}</span>
                    </span>
                </div>
                <div class="progress" aria-hidden="true">
                    <i class="progress-fill" style="width:${(cardIdx / cards.length) * 100}%"></i>
                </div>
                <div class="arena-body">
                    <p class="micro">Fråga</p>
                    <div id="dm-question" class="arena-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                </div>
                <div class="arena-foot arena-foot--center">
                    <button id="dm-flip-btn" class="btn primary lg">Visa svar <span class="kbd">Space</span></button>
                </div>
            </div>
        `;
        renderLatex(overlay.querySelector('#dm-question'));

        const flipToAnswer = () => {
            const btn = overlay.querySelector('#dm-flip-btn');
            if (!btn) return;
            btn.remove();

            const content = overlay.querySelector('.arena');
            overlay.querySelector('.arena-foot')?.remove();
            const ansDiv = document.createElement('div');
            ansDiv.className = 'arena-reveal';
            ansDiv.innerHTML = `
                <p class="micro">Svar</p>
                <div id="dm-answer" class="arena-answer">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
            `;
            content.appendChild(ansDiv);
            const ansEl = ansDiv.querySelector('#dm-answer');
            renderLatex(ansEl);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages);

            // Rating buttons
            const ratingDiv = document.createElement('div');
            ratingDiv.id = 'dm-rating';
            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'dm-study-actions';
            clonedActions.classList.remove('hidden');
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const rating = parseInt(btn.getAttribute('data-rating'), 10);
                    S.currentStudyIndex = cardIdx;
                    processRating(rating);
                    if (rating === 1) S.playgroundSessionStats.again++;
                    else S.playgroundSessionStats.correct++;
                    cardIdx++;
                    showCard();
                });
            });
            ratingDiv.appendChild(clonedActions);
            content.appendChild(ratingDiv);

            // Keyboard rating
            const rateKH = (e) => {
                if (['1','2','3','4'].includes(e.key)) {
                    e.preventDefault();
                    document.removeEventListener('keydown', rateKH);
                    const rating = parseInt(e.key, 10);
                    S.currentStudyIndex = cardIdx;
                    processRating(rating);
                    if (rating === 1) S.playgroundSessionStats.again++;
                    else S.playgroundSessionStats.correct++;
                    cardIdx++;
                    showCard();
                }
            };
            document.addEventListener('keydown', rateKH);
        };

        overlay.querySelector('#dm-flip-btn').onclick = flipToAnswer;
        const flipKH = (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', flipKH); flipToAnswer(); }
        };
        document.addEventListener('keydown', flipKH);
    };

    const showEnd = () => {
        cleanup();
        overlay.innerHTML = `
            <div class="arena arena--end">
                <p class="micro">Dammiga kort</p>
                <h2 class="arena-end-title">Alla uppfriskade</h2>
                <p class="arena-end-lead">${cards.length} bortglömda kort repeterade.</p>
                <div class="arena-end-actions"><button id="dm-exit" class="btn">Avsluta</button></div>
            </div>
        `;
        overlay.querySelector('#dm-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
