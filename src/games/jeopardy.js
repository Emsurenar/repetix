import { S } from '../core/state.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';


// --- JEOPARDY OVERLAY ---
export const jeopardyReveal = () => {
    const cards = S.currentStudyCards;
    let cardIdx = 0;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];

        overlay.innerHTML = `
            <div class="arena">
                <div class="arena-top">
                    <span class="micro">Jeopardy</span>
                    <span class="arena-meta num">${cardIdx + 1} av ${cards.length}</span>
                </div>
                <div class="arena-body">
                    <p class="micro">Svaret är</p>
                    <div id="jp-answer" class="arena-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <p class="arena-hint">Vad är frågan? Tänk efter, avslöja sedan.</p>
                </div>
                <div class="arena-foot arena-foot--center">
                    <button id="jp-reveal-btn" class="btn primary lg">Visa frågan <span class="kbd">Space</span></button>
                </div>
            </div>
        `;
        const ansEl = overlay.querySelector('#jp-answer');
        renderLatex(ansEl);
        if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages);

        const revealQuestion = () => {
            const btn = overlay.querySelector('#jp-reveal-btn');
            if (!btn) return;
            btn.remove();
            overlay.querySelector('.arena-hint')?.remove();
            overlay.querySelector('.arena-foot')?.remove();

            const qDiv = document.createElement('div');
            qDiv.className = 'arena-reveal';
            qDiv.innerHTML = `
                <p class="micro">Frågan var</p>
                <div id="jp-question" class="arena-answer">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <p class="arena-hint"><span class="kbd">Space</span> nästa kort</p>
            `;
            overlay.querySelector('.arena-body').appendChild(qDiv);
            renderLatex(qDiv);

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                if (e.target && e.target.closest && e.target.closest('button')) return;
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showCard();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#jp-reveal-btn').onclick = revealQuestion;
        const revealKH = (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', revealKH); revealQuestion(); }
        };
        document.addEventListener('keydown', revealKH);
    };

    const showEnd = () => {
        cleanup();
        overlay.innerHTML = `
            <div class="arena arena--end">
                <p class="micro">Jeopardy</p>
                <h2 class="arena-end-title">Klart</h2>
                <p class="arena-end-lead">${cards.length} kort omvänt repeterade.</p>
                <div class="arena-end-actions"><button id="jp-exit" class="btn">Avsluta</button></div>
            </div>
        `;
        overlay.querySelector('#jp-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
