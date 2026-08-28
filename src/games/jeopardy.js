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
    overlay.style.background = 'radial-gradient(ellipse at center, #001050 0%, #000820 60%, #000510 100%)';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.25rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="color:#FBBC04;">JEOPARDY</span>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(251,188,4,0.6);font-weight:700;">Svaret är:</div>
                <div id="jp-answer" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.5;width:100%;padding:1.25rem;background:rgba(251,188,4,0.06);border:1px solid rgba(251,188,4,0.2);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size:0.85rem;color:rgba(255,255,255,0.35);font-style:italic;">Vad är frågan? Tänk efter, klicka sedan för att avslöja.</div>
                <button id="jp-reveal-btn" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;">Visa frågan [Space]</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        const ansEl = overlay.querySelector('#jp-answer');
        renderLatex(ansEl);
        if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages);

        const revealQuestion = () => {
            const btn = overlay.querySelector('#jp-reveal-btn');
            if (!btn) return;
            btn.remove();
            const hint = overlay.querySelector('.cinema-content div[style*="font-style:italic"]');
            if (hint) hint.remove();

            const qDiv = document.createElement('div');
            qDiv.style.cssText = 'width:100%;text-align:center;';
            qDiv.innerHTML = `
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(52,168,83,0.7);font-weight:700;margin-bottom:0.5rem;">Frågan var:</div>
                <div id="jp-question" style="font-size:1.2rem;color:#fff;line-height:1.5;padding:1rem;background:rgba(52,168,83,0.06);border:1px solid rgba(52,168,83,0.2);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);margin-top:0.75rem;font-style:italic;">[Space] nästa kort</div>
            `;
            overlay.querySelector('.cinema-content').appendChild(qDiv);
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
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Bebas Neue','Impact',sans-serif;font-size:2.5rem;color:#FBBC04;margin:0;">KLART!</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;">${cards.length} kort omvänt repeterade.</p>
            <div class="sd-end-actions"><button id="jp-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#jp-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
