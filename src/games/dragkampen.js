import { S } from '../core/state.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';


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

    overlay.innerHTML = `
        <div class="arena">
            <div class="arena-top">
                <span class="micro">Dragkampen</span>
                <span class="arena-meta num">
                    <span id="dk-drift-warn" class="dk-drift">Datorn drar</span>
                    <span id="dk-progress">1 av ${cards.length}</span>
                </span>
            </div>

            <div class="dk-meter">
                <div class="dk-meter-labels">
                    <span class="dk-label-cpu">Dator</span>
                    <span class="dk-label-player">Du</span>
                </div>
                <div class="dk-meter-track">
                    <div id="dk-meter-fill-neg" class="dk-meter-fill-neg"></div>
                    <div id="dk-meter-fill-pos" class="dk-meter-fill-pos"></div>
                    <div id="dk-meter-cursor" class="dk-meter-cursor"></div>
                </div>
            </div>

            <div class="arena-body">
                <p class="micro">Påstående</p>
                <div id="dk-question" class="arena-question"></div>
                <div id="dk-claim" class="arena-plain"></div>
            </div>

            <div id="dk-buttons" class="arena-options">
                <button id="dk-false" class="dk-btn dk-btn-false">← Falskt</button>
                <button id="dk-true" class="dk-btn dk-btn-true">Sant →</button>
            </div>

            <div id="dk-answer-area" class="arena-reveal" hidden></div>
        </div>
    `;

    oppnaSpelyta(overlay);

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
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    const showEndScreen = (won) => {
        cleanup();
        S.playgroundSessionStats._dragkampenWon = won;
        const timeSpent = Math.round((Date.now() - startTime) / 1000);
        const content = overlay.querySelector('.cinema-content');
        content.innerHTML = `
            <h2 style="font-family:var(--font-ui);font-size:var(--t-2xl);color:${won ? 'var(--accent)' : 'var(--danger)'};text-shadow:0 0 20px ${won ? 'var(--accent-soft)' : 'var(--danger-soft)'};margin:0;">${won ? 'DU VANN!' : 'DATORN VANN'}</h2>
            <p style="color:var(--text-2);margin:0;font-size:0.95rem;">${won ? 'Du drog markören till din sida!' : 'Datorn drog ifrån dig.'}</p>
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
        if (progressEl) progressEl.textContent = `${cardIdx + 1} av ${cards.length}`;

        const qEl = overlay.querySelector('#dk-question');
        qEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
        renderLatex(qEl);

        const claimEl = overlay.querySelector('#dk-claim');
        claimEl.innerHTML = typeof safeParse === 'function' ? safeParse(rawClaim) : rawClaim;
        renderLatex(claimEl);

        const buttonsEl = overlay.querySelector('#dk-buttons');
        const answerArea = overlay.querySelector('#dk-answer-area');
        buttonsEl.hidden = false;
        answerArea.hidden = true;
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

            buttonsEl.hidden = true;
            answerArea.hidden = false;
            answerArea.innerHTML = `
                <p class="arena-verdict${correct ? ' is-good' : ' is-bad'}">${correct ? 'Rätt' : 'Fel'} — påståendet var ${isCorrectAnswer ? 'sant' : 'falskt'}.</p>
                <p class="micro">Rätt svar</p>
                <div id="dk-full-answer" class="arena-answer">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <p class="arena-hint"><span class="kbd">Space</span> fortsätt</p>
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
        if (e.key === 'Escape') { e.preventDefault(); closeGame(); }
    };
    document.addEventListener('keydown', globalKeyHandler);

    showRound();

    driftTimer = setInterval(() => {
        if (driftPaused) return;
        meterValue = Math.max(-100, meterValue - 2);
        updateMeter();
        const warn = overlay.querySelector('#dk-drift-warn');
        if (warn) { warn.classList.add('is-on'); setTimeout(() => warn.classList.remove('is-on'), 800); }
        if (meterValue <= -100) showEndScreen(false);
    }, 1500);
};
