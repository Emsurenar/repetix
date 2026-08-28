import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';


// --- TRANSPORTBANDET OVERLAY ---
export const transportbandetReveal = () => {
    // Determine the top 4 section titles (by card count) from the candidate pool
    const allCandidates = S.currentStudyCards;
    const sectionCountMap = {};
    allCandidates.forEach(c => {
        sectionCountMap[c._sectionTitle] = (sectionCountMap[c._sectionTitle] || 0) + 1;
    });
    const sectionTitles = Object.entries(sectionCountMap)
        .sort((a, b) => b[1] - a[1])  // most cards first for a richer game
        .slice(0, 4)
        .map(([title]) => title);

    // Only keep cards that belong to one of the chosen categories
    const filteredPool = allCandidates.filter(c => sectionTitles.includes(c._sectionTitle));
    let cards = fisherYatesShuffle(filteredPool).slice(0, 20);
    
    const startTimeSession = Date.now();
    
    // State variables
    let cardIdx = 0;
    let score = 0;
    let streak = 0;
    let maxStreak = 0;
    let lives = 3;
    let correctCount = 0;
    let baseSpeed = 2.8; // seconds for full drop
    let fallingRAF = null;
    let activeBinIdx = 0;
    let gameActive = false; // Starts as false (intro screen)
    let gameOverActive = false;
    let dropped = false;
    
    // Determine highscore key & title based on playground focus filter
    let pbKey = 'spaced_rep_tb_pb_all';
    let pbTitle = 'Hela biblioteket';
    if (S.playgroundFilterSource && S.playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        S.playgroundFilterSource.forEach(val => {
            const match = val.match(/^deck:([^:]+)/);
            if (match) deckIds.add(match[1]);
        });
        if (deckIds.size === 1) {
            const singleDeckId = Array.from(deckIds)[0];
            const deckObj = S.appData.decks.find(d => d.id === singleDeckId);
            pbKey = `spaced_rep_tb_pb_${singleDeckId}`;
            pbTitle = deckObj ? deckObj.title : 'Fokusområde';
        } else {
            pbKey = `spaced_rep_tb_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitle = 'Fokusområde';
        }
    }
    
    let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'rgba(0, 5, 20, 0.97)';

    // Render Intro Screen initially
    overlay.innerHTML = `
        <div class="cinema-bar cinema-bar-top"></div>
        <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;position:relative;">
            <div class="tb-intro-card">
                <h2 class="tb-intro-title">TRANSPORTBANDET</h2>
                <p style="color: rgba(255,255,255,0.7); margin: 0; font-size: 0.95rem; line-height: 1.4;">
                    Sortera de fallande korten i rätt korgar i botten. Se upp för felaktiga placeringar!
                </p>
                
                <div style="width: 100%; text-align: left;">
                    <span style="font-size: 0.8rem; font-weight: 700; color: #60A5FA; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.5rem;">Kategorier i spel:</span>
                    <div class="tb-intro-categories">
                        ${sectionTitles.map((t, i) => {
                            const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                            const color = colors[i] || '#A78BFA';
                            return `
                                <div class="tb-intro-item">
                                    <span class="tb-category-dot" style="color: ${color}; background-color: ${color};"></span>
                                    <span class="tb-category-name">${t}</span>
                                    <span class="tb-category-key">${i + 1}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <div class="tb-intro-guide">
                    <strong>Kontroller:</strong><br/>
                    • <code>←</code> / <code>→</code> : Flytta korg-markering<br/>
                    • <code>↓</code> : Släpp kortet omedelbart<br/>
                    • <code>1</code>, <code>2</code>, <code>3</code>, <code>4</code> : Sortera direkt i korg 1-4
                </div>
                
                <button id="tb-btn-start" class="btn primary" style="width: 100%; padding: 0.9rem; font-weight: 600; font-size: 1rem; border-radius: 8px;">
                    Starta spelet
                </button>
            </div>
        </div>
        <div class="cinema-bar cinema-bar-bottom"></div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    let arena = null;
    let fallingCard = null;
    let bins = null;

    const renderLives = () => {
        const container = overlay.querySelector('#tb-lives');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const heart = document.createElement('span');
            heart.textContent = i < lives ? '' : '';
            heart.style.transition = 'transform 0.2s ease';
            if (i >= lives) {
                heart.style.opacity = '0.25';
                heart.style.transform = 'scale(0.8)';
            } else {
                heart.style.filter = 'drop-shadow(0 0 4px rgba(234,67,53,0.5))';
            }
            container.appendChild(heart);
        }
    };

    const showFloatingFeedback = (text, type) => {
        const floatEl = document.createElement('div');
        floatEl.className = `tb-float-feedback ${type}`;
        floatEl.textContent = text;
        overlay.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1000);
    };

    const triggerConfetti = () => {
        const colors = ['#FFD700', '#FF4500', '#FF0080', '#00FF00', '#00FFFF', '#8A2BE2'];
        for (let i = 0; i < 60; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'sd-confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(confetti);
            setTimeout(() => confetti.remove(), 4000);
        }
    };

    const showEndScreen = () => {
        cleanup();
        overlay.classList.remove('cinema-overlay--game');
        
        const isNewPB = score > personalBest;

        if (isNewPB) {
            personalBest = score;
            localStorage.setItem(pbKey, score);
        }
        
        // Sync stats
        S.playgroundSessionStats.correct = score;

        const isVictory = lives > 0 && cardIdx >= cards.length;
        const screenClass = isVictory ? 'victory' : '';
        const titleClass = isVictory ? 'victory' : 'gameover';
        const titleText = isVictory ? 'SEGER!' : 'SPELET SLUT';
        
        const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;position:relative;">
                <div class="tb-end-screen ${screenClass}">
                    <h2 class="tb-end-title ${titleClass}">${titleText}</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        ${isVictory ? 'Du lyckades sortera alla korten!' : 'Alla liv tog slut.'}
                    </p>
                    
                    <div class="sd-stats-grid">
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Sorterade kort</span>
                            <span class="sd-stat-value">${cardIdx} / ${cards.length}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Längsta streak</span>
                            <span class="sd-stat-value"> ${maxStreak}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Tid spelat</span>
                            <span class="sd-stat-value">⏱ ${timeSpent}s</span>
                        </div>
                        <div class="sd-stat-row sd-stat-highlight">
                            <span class="sd-stat-label">Slutpoäng</span>
                            <span class="sd-stat-value">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: rgba(255,215,0,0.15); border: 1px dashed #FFD700; border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #FFD700; text-shadow: 0 0 4px rgba(255,215,0,0.2);">
                                 NYTT REKORD! 
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="opacity: 0.7;">
                                <span class="sd-stat-label">Rekord (${pbTitle})</span>
                                <span class="sd-stat-value"> ${personalBest}</span>
                            </div>
                        `}
                    </div>
                    
                    <div class="sd-end-actions">
                        <button id="tb-btn-restart" class="btn primary">Spela igen</button>
                        <button id="tb-btn-exit" class="btn secondary">Avsluta</button>
                    </div>
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        gameOverActive = true;
        document.addEventListener('keydown', onKeyDown);
        
        overlay.querySelector('#tb-btn-restart').onclick = restartGame;
        overlay.querySelector('#tb-btn-exit').onclick = closeGame;
        
        if (isNewPB || isVictory) {
            triggerConfetti();
        }
    };

    const restartGame = () => {
        cleanup();
        
        cards = fisherYatesShuffle(filteredPool).slice(0, 20);
        S.currentStudyCards = cards;
        
        cardIdx = 0;
        score = 0;
        streak = 0;
        maxStreak = 0;
        lives = 3;
        correctCount = 0;
        activeBinIdx = 0;
        gameActive = false;
        gameOverActive = false;
        dropped = false;
        
        startGame();
    };

    const cleanup = () => {
        cancelAnimationFrame(fallingRAF);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keydown', introKeyHandler);
    };
    
    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const introKeyHandler = (e) => {
        if (!gameActive && !gameOverActive) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                startGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
        }
    };
    document.addEventListener('keydown', introKeyHandler);

    const startGame = () => {
        gameActive = true;
        document.removeEventListener('keydown', introKeyHandler);
        overlay.classList.add('cinema-overlay--game');
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="tb-container">
                <div class="tb-header">
                    <div id="tb-lives" style="display:flex;gap:0.3rem;font-size:1.6rem; z-index: 5;"></div>
                    <div style="display:flex; gap:1.2rem; align-items:center; font-weight:700; z-index: 5;">
                        <span id="tb-pb" style="color:#FFD700; font-size:0.9rem;"> Rekord: ${personalBest}</span>
                        <span id="tb-score" class="tb-score" style="font-size:1.1rem;">Poäng: 0</span>
                        <span id="tb-progress" class="tb-progress">1 / ${cards.length}</span>
                    </div>
                </div>
                
                <div style="text-align: center; height: 25px; margin-top: -0.25rem; z-index: 5;">
                    <span id="tb-streak" class="tb-streak" style="font-weight:900; transition: opacity 0.2s ease;"></span>
                </div>
                
                <div id="tb-arena" class="tb-arena">
                    <div id="tb-falling-card" class="tb-falling-card"></div>
                </div>
                
                <div id="tb-bins" class="tb-bins">
                    ${sectionTitles.map((t, i) => {
                        const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                        const color = colors[i] || '#A78BFA';
                        return `
                        <div class="tb-bin${i === 0 ? ' tb-bin-active' : ''}" data-idx="${i}" style="--bin-color: ${color};" title="${t}">
                            <div style="display:flex; flex-direction:column; align-items:center; gap:0.4rem; width:100%;">
                                <span class="tb-bin-num" style="background:${color}20; color:${color}; border:1.5px solid ${color}; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; flex-shrink:0;">${i + 1}</span>
                                <span class="tb-bin-label" style="color:${color};">${t}</span>
                            </div>
                        </div>
                    `}).join('')}
                </div>
                <div class="tb-controls-hint">← → Flytta &nbsp; ↓ Släpp &nbsp;|&nbsp; 1 - 4 Sortera direkt</div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        arena = overlay.querySelector('#tb-arena');
        fallingCard = overlay.querySelector('#tb-falling-card');
        bins = overlay.querySelectorAll('.tb-bin');
        
        document.addEventListener('keydown', onKeyDown);
        
        renderLives();
        dropCard();
    };

    const updateBinHighlight = () => {
        bins.forEach((b, i) => b.classList.toggle('tb-bin-active', i === activeBinIdx));
    };

    const dropCard = () => {
        if (cardIdx >= cards.length || lives <= 0) {
            showEndScreen();
            return;
        }

        dropped = false;
        const card = cards[cardIdx];
        
        fallingCard.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
        renderLatex(fallingCard);
        
        fallingCard.style.top = '0%';
        fallingCard.style.opacity = '1';
        fallingCard.className = 'tb-falling-card';

        const binWidth = 100 / sectionTitles.length;
        fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        fallingCard.style.transform = 'translateX(-50%)';

        updateBinHighlight();

        overlay.querySelector('#tb-progress').textContent = `${cardIdx + 1} / ${cards.length}`;
        overlay.querySelector('#tb-score').textContent = `Poäng: ${score}`;

        const streakEl = overlay.querySelector('#tb-streak');
        if (streak >= 2) {
            streakEl.textContent = ` ${streak} i rad`;
            streakEl.style.opacity = '1';
        } else {
            streakEl.style.opacity = '0';
        }

        // Falling speed increases as you score correct categories
        const dropDuration = Math.max(1.0, baseSpeed - correctCount * 0.08);
        const startTime = performance.now();

        const animateFall = (now) => {
            if (dropped) return;
            const elapsed = (now - startTime) / 1000;
            const pct = Math.min(1, elapsed / dropDuration);
            fallingCard.style.top = `${pct * 80}%`;

            if (pct >= 1) {
                handleLanding(card, true);
                return;
            }
            fallingRAF = requestAnimationFrame(animateFall);
        };
        fallingRAF = requestAnimationFrame(animateFall);

        const handleLanding = (c, isTimeout = false) => {
            if (dropped) return;
            dropped = true;
            cancelAnimationFrame(fallingRAF);

            const correctIdx = sectionTitles.indexOf(c._sectionTitle);
            const isCorrect = activeBinIdx === correctIdx;

            // Flip/Reveal the answer on the falling card
            fallingCard.innerHTML = typeof safeParse === 'function' ? safeParse(c.back) : c.back;
            renderLatex(fallingCard);
            fallingCard.classList.add('tb-revealed');
            
            // Center the card in the arena to prevent overflow/clipping of long text
            fallingCard.style.top = '40%';
            fallingCard.style.left = '50%';
            fallingCard.style.transform = 'translate(-50%, -50%)';

            if (isCorrect) {
                const multiplier = 1 + streak * 0.1;
                const gained = Math.round(10 * multiplier);
                score += gained;
                
                streak++;
                if (streak > maxStreak) maxStreak = streak;
                
                correctCount++;
                S.playgroundSessionStats.correct++;
                fallingCard.classList.add('tb-correct');
                bins[activeBinIdx].classList.add('tb-bin-flash-correct');
                showFloatingFeedback(`+${gained}`, 'correct');
            } else {
                streak = 0;
                lives--;
                S.playgroundSessionStats.again++;
                fallingCard.classList.add('tb-wrong');
                bins[activeBinIdx].classList.add('tb-bin-flash-wrong');
                if (correctIdx >= 0 && correctIdx < bins.length) {
                    bins[correctIdx].classList.add('tb-bin-flash-correct');
                }
                
                showFloatingFeedback(isTimeout ? 'MISSAD! -1 ' : '-1 ', 'wrong');
                renderLives();

                // Arena screen shake
                overlay.classList.add('shake-active');
                const flashOverlay = document.createElement('div');
                flashOverlay.style.position = 'absolute';
                flashOverlay.style.inset = '0';
                flashOverlay.style.background = 'rgba(234, 67, 53, 0.18)';
                flashOverlay.style.pointerEvents = 'none';
                flashOverlay.style.zIndex = '99';
                overlay.appendChild(flashOverlay);
                
                setTimeout(() => {
                    overlay.classList.remove('shake-active');
                    flashOverlay.remove();
                }, 300);
            }

            // Show correct category and wait for click/space to advance
            const correctLabel = sectionTitles[correctIdx] || '?';
            const hint = document.createElement('div');
            hint.style.cssText = 'position:absolute;bottom:8%;left:50%;transform:translateX(-50%);font-size:0.8rem;color:rgba(255,255,255,0.35);font-style:italic;z-index:10;white-space:nowrap;';
            hint.textContent = `${isCorrect ? '✓' : '✗'} Rätt mapp: ${correctLabel} — [Space] fortsätt`;
            arena.appendChild(hint);

            let tbAdvanced = false;
            const tbAdvanceHandler = (e) => {
                if (tbAdvanced) return;
                if (e.type === 'keydown') {
                    if (e.key !== ' ' && e.key !== 'Enter') return;
                    e.preventDefault();
                }
                if (e.target && e.target.closest && e.target.closest('button')) return;
                tbAdvanced = true;
                overlay.removeEventListener('mousedown', tbAdvanceHandler);
                document.removeEventListener('keydown', tbAdvanceHandler);
                hint.remove();
                bins.forEach(b => { b.classList.remove('tb-bin-flash-correct', 'tb-bin-flash-wrong'); });
                cardIdx++;
                dropCard();
            };
            overlay.addEventListener('mousedown', tbAdvanceHandler);
            document.addEventListener('keydown', tbAdvanceHandler);
        };

        overlay._handleLanding = (c) => handleLanding(c);
    };

    const onKeyDown = (e) => {
        if (gameOverActive) {
            if (e.key === 'Enter') {
                e.preventDefault();
                restartGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
            return;
        }

        if (!gameActive) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }

        if (dropped) return;

        const card = cards[cardIdx];

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            activeBinIdx = Math.max(0, activeBinIdx - 1);
            updateBinHighlight();
            const binWidth = 100 / sectionTitles.length;
            fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            activeBinIdx = Math.min(sectionTitles.length - 1, activeBinIdx + 1);
            updateBinHighlight();
            const binWidth = 100 / sectionTitles.length;
            fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (overlay._handleLanding) overlay._handleLanding(card);
        } else if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const binIndex = parseInt(e.key, 10) - 1;
            if (binIndex >= 0 && binIndex < sectionTitles.length) {
                activeBinIdx = binIndex;
                updateBinHighlight();
                const binWidth = 100 / sectionTitles.length;
                fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
                if (overlay._handleLanding) overlay._handleLanding(card);
            }
        }
    };

    // Skip intro, go straight into game
    startGame();
};
