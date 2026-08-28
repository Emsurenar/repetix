import { S } from '../core/state.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';


// --- DRAGKAMPEN OVERLAY ---
export const dragkampenReveal = (allCards) => {
    const cards = S.currentStudyCards;
    let meterValue = 0;
    let cardIdx = 0;
    let correctCount = 0;
    let driftTimer = null;
    let driftPaused = false;
    const startTime = Date.now();

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'rgba(10, 5, 0, 0.97)';

    overlay.innerHTML = `
        <div class="cinema-bar cinema-bar-top"></div>
        <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;position:relative;">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                <span id="dk-progress">Kort 1 / ${cards.length}</span>
                <span id="dk-drift-warn" style="color:#F59E0B;opacity:0;transition:opacity 0.3s ease;">Datorn drar...</span>
            </div>
            <div class="dk-meter-labels">
                <span class="dk-label-cpu">Dator</span>
                <span class="dk-label-player">Du</span>
            </div>
            <div class="dk-meter-track">
                <div id="dk-meter-fill-neg" class="dk-meter-fill-neg"></div>
                <div id="dk-meter-fill-pos" class="dk-meter-fill-pos"></div>
                <div id="dk-meter-cursor" class="dk-meter-cursor"></div>
            </div>
            <div id="dk-question" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.4;width:100%;"></div>
            <div id="dk-claim" style="font-size:1.05rem;color:#ccc;text-align:center;line-height:1.4;padding:0.75rem 1rem;background:rgba(255,255,255,0.05);border-radius:var(--radius-md);width:100%;"></div>
            <div id="dk-buttons" class="dk-buttons">
                <button id="dk-false" class="dk-btn dk-btn-false">← Falskt</button>
                <button id="dk-true" class="dk-btn dk-btn-true">Sant →</button>
            </div>
            <div id="dk-answer-area" style="display:none;width:100%;text-align:center;"></div>
        </div>
        <div class="cinema-bar cinema-bar-bottom"></div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const updateMeter = () => {
        const pct = (meterValue + 100) / 200;
        const cursor = overlay.querySelector('#dk-meter-cursor');
        if (cursor) cursor.style.left = `${pct * 100}%`;
        const negFill = overlay.querySelector('#dk-meter-fill-neg');
        const posFill = overlay.querySelector('#dk-meter-fill-pos');
        if (!negFill || !posFill) return;
        if (meterValue < 0) {
            negFill.style.width = `${Math.abs(meterValue) / 2}%`;
            negFill.style.right = '50%';
            posFill.style.width = '0%';
        } else {
            posFill.style.width = `${meterValue / 2}%`;
            posFill.style.left = '50%';
            negFill.style.width = '0%';
        }
    };

    const cleanup = () => {
        clearInterval(driftTimer);
        document.removeEventListener('keydown', globalKeyHandler);
    };

    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const showEndScreen = (won) => {
        cleanup();
        S.playgroundSessionStats._dragkampenWon = won;
        const timeSpent = Math.round((Date.now() - startTime) / 1000);
        const content = overlay.querySelector('.cinema-content');
        content.innerHTML = `
            <h2 style="font-family:'Bangers',cursive;font-size:2.8rem;color:${won ? '#34A853' : '#EA4335'};text-shadow:0 0 20px ${won ? 'rgba(52,168,83,0.4)' : 'rgba(234,67,53,0.4)'};margin:0;">${won ? 'DU VANN!' : 'DATORN VANN'}</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;font-size:0.95rem;">${won ? 'Du drog markören till din sida!' : 'Datorn drog ifrån dig.'}</p>
            <div class="sd-stats-grid" style="width:100%;max-width:400px;">
                <div class="sd-stat-row"><span class="sd-stat-label">Besvarade kort</span><span class="sd-stat-value">${cardIdx} / ${cards.length}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Rätt svar</span><span class="sd-stat-value">${correctCount}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Tid</span><span class="sd-stat-value">${timeSpent}s</span></div>
                <div class="sd-stat-row sd-stat-highlight"><span class="sd-stat-label">Slutposition</span><span class="sd-stat-value">${meterValue > 0 ? '+' : ''}${meterValue}</span></div>
            </div>
            <div class="sd-end-actions">
                <button id="dk-btn-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button>
            </div>
        `;
        overlay.querySelector('#dk-btn-exit').onclick = closeGame;
        const endKH = (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); }
        };
        document.addEventListener('keydown', endKH);
    };

    let roundKeyHandler = null;

    const showRound = () => {
        if (meterValue >= 100) { showEndScreen(true); return; }
        if (meterValue <= -100) { showEndScreen(false); return; }
        if (cardIdx >= cards.length) { showEndScreen(meterValue > 0); return; }

        driftPaused = false;
        const card = cards[cardIdx];
        const isCorrectAnswer = Math.random() < 0.5;

        const randomOther = !isCorrectAnswer ? (() => {
            const sameDeck = allCards.filter(c => c.id !== card.id && c.originalDeckId === card.originalDeckId);
            const pool = sameDeck.length > 0 ? sameDeck : allCards.filter(c => c.id !== card.id);
            return pool[Math.floor(Math.random() * pool.length)];
        })() : null;
        const rawClaim = isCorrectAnswer ? card.back : (randomOther ? randomOther.back : card.back);

        const progressEl = overlay.querySelector('#dk-progress');
        if (progressEl) progressEl.textContent = `Kort ${cardIdx + 1} / ${cards.length}`;

        const qEl = overlay.querySelector('#dk-question');
        qEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
        renderLatex(qEl);

        const claimEl = overlay.querySelector('#dk-claim');
        claimEl.innerHTML = `<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Påstående:</div>` + (typeof safeParse === 'function' ? safeParse(rawClaim) : rawClaim);
        renderLatex(claimEl);

        const buttonsEl = overlay.querySelector('#dk-buttons');
        const answerArea = overlay.querySelector('#dk-answer-area');
        buttonsEl.style.display = 'flex';
        answerArea.style.display = 'none';
        updateMeter();

        let answered = false;

        const handleAnswer = (userSaysTrue) => {
            if (answered) return;
            answered = true;
            driftPaused = true;
            if (roundKeyHandler) document.removeEventListener('keydown', roundKeyHandler);

            const correct = userSaysTrue === isCorrectAnswer;
            if (correct) { meterValue = Math.min(100, meterValue + 10); correctCount++; S.playgroundSessionStats.correct++; }
            else { meterValue = Math.max(-100, meterValue - 15); S.playgroundSessionStats.again++; }
            updateMeter();

            buttonsEl.style.display = 'none';
            answerArea.style.display = 'block';
            answerArea.innerHTML = `
                <div style="font-size:0.85rem;font-weight:700;color:${correct ? '#34A853' : '#EA4335'};margin-bottom:0.5rem;">${correct ? '✓ Rätt!' : '✗ Fel!'} Påståendet var ${isCorrectAnswer ? 'SANT' : 'FALSKT'}.</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:0.3rem;">Rätt svar:</div>
                <div id="dk-full-answer" style="font-size:1rem;color:#fff;background:rgba(255,255,255,0.04);padding:0.75rem;border-radius:8px;text-align:left;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);margin-top:0.5rem;font-style:italic;">[Space] fortsätt</div>
            `;
            const ansEl = answerArea.querySelector('#dk-full-answer');
            if (ansEl) { renderLatex(ansEl); if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages); }

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showRound();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#dk-true').onclick = () => handleAnswer(true);
        overlay.querySelector('#dk-false').onclick = () => handleAnswer(false);

        roundKeyHandler = (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); handleAnswer(true); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleAnswer(false); }
        };
        document.addEventListener('keydown', roundKeyHandler);
    };

    const globalKeyHandler = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(); overlay.remove(); finishPlaygroundSession(); }
    };
    document.addEventListener('keydown', globalKeyHandler);

    showRound();

    driftTimer = setInterval(() => {
        if (driftPaused) return;
        meterValue = Math.max(-100, meterValue - 2);
        updateMeter();
        const warn = overlay.querySelector('#dk-drift-warn');
        if (warn) { warn.style.opacity = '1'; setTimeout(() => { if (warn) warn.style.opacity = '0'; }, 800); }
        if (meterValue <= -100) showEndScreen(false);
    }, 1500);
};
