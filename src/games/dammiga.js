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
    overlay.style.background = 'radial-gradient(ellipse at center, #1a1200 0%, #100c00 60%, #0a0800 100%)';

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
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>Uppfriskat ${cardIdx} / ${cards.length}</span>
                    <span style="color:#C5A059;">Senast: ${timeSince(card.lastReviewed)}</span>
                </div>
                <div style="width:100%;height:4px;background:rgba(197,160,89,0.15);border-radius:2px;overflow:hidden;">
                    <div style="width:${(cardIdx / cards.length) * 100}%;height:100%;background:#C5A059;border-radius:2px;transition:width 0.3s ease;"></div>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(197,160,89,0.6);font-weight:700;">Fråga</div>
                <div id="dm-question" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.5;width:100%;padding:1rem;background:rgba(197,160,89,0.05);border:1px solid rgba(197,160,89,0.15);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <button id="dm-flip-btn" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;background:#C5A059;border-color:#C5A059;">Visa svar [Space]</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        renderLatex(overlay.querySelector('#dm-question'));

        const flipToAnswer = () => {
            const btn = overlay.querySelector('#dm-flip-btn');
            if (!btn) return;
            btn.remove();

            const content = overlay.querySelector('.cinema-content');
            const ansDiv = document.createElement('div');
            ansDiv.style.cssText = 'width:100%;text-align:center;';
            ansDiv.innerHTML = `
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(52,168,83,0.7);font-weight:700;margin-bottom:0.5rem;">Svar</div>
                <div id="dm-answer" style="font-size:1.1rem;color:#fff;line-height:1.5;padding:1rem;background:rgba(52,168,83,0.06);border:1px solid rgba(52,168,83,0.15);border-radius:12px;text-align:left;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
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
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Special Elite',Georgia,serif;font-size:2.2rem;color:#C5A059;margin:0;">Alla kort uppfriskas!</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;">${cards.length} bortglömda kort repeterade.</p>
            <div class="sd-end-actions"><button id="dm-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#dm-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
