import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';


// --- SUDDEN DEATH OVERLAY ---
export const suddenDeathReveal = (allCards) => {
    const cards = S.currentStudyCards;
    const startTimeSession = Date.now();
    
    // Score & gamification state
    let score = 0;
    let streak = 0;
    let maxStreak = 0;
    let lives = 3;
    let cardIdx = 0;
    let correctCount = 0;
    let gameOverActive = false;
    let isIntro = true;
    let answered = false;
    let mistakes = [];
    let speedBonusCount = 0;
    let lateSaveCount = 0;
    
    // Auto-advance skip hook
    let advanceTimeout = null;

    // Timer handles
    let timerHandle = null;
    let timerRAF = null;

    // Visual key feedback handlers (declared here so cleanup() can reference them)
    let pressKeyHandler = null;
    let releaseKeyHandler = null;

    // Determine highscore key & title based on playground focus filter
    let pbKey = 'spaced_rep_sd_pb_all';
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
            pbKey = `spaced_rep_sd_pb_${singleDeckId}`;
            pbTitle = deckObj ? deckObj.title : 'Fokusområde';
        } else {
            pbKey = `spaced_rep_sd_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitle = 'Fokusområde';
        }
    }
    
    let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

    // Create container overlay
    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay pg-mode-suddendeath';
    overlay.style.background = 'radial-gradient(circle at center, #160214 0%, #06000d 80%, #000000 100%)';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '9999';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => {
        clearTimeout(timerHandle);
        clearTimeout(advanceTimeout);
        cancelAnimationFrame(timerRAF);
        document.removeEventListener('keydown', keyHandler);
        document.removeEventListener('keydown', pressKeyHandler);
        document.removeEventListener('keyup', releaseKeyHandler);
        overlay.classList.remove('sd-urgent-pulse');
    };

    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const showFloatingFeedback = (text, type) => {
        const floatEl = document.createElement('div');
        floatEl.className = `sd-float-feedback ${type}`;
        floatEl.textContent = text;
        overlay.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1100);
    };

    const triggerConfetti = () => {
        const colors = ['#FFD700', '#FF4500', '#FF0080', '#00FF00', '#00FFFF', '#8A2BE2'];
        for (let i = 0; i < 60; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'sd-confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
            confetti.style.animationDelay = `${Math.random() * 1.5}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(confetti);
            setTimeout(() => confetti.remove(), 3500);
        }
    };

    // Keyboard shortcut handler
    const keyHandler = (e) => {
        if (isIntro) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                startGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
            return;
        }

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
        
        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }
        
        // If question is already answered, space/enter/click advances to next card immediately
        if (answered) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                advanceNext();
            }
            return;
        }
        
        if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex] && !buttons[optIndex].disabled) {
                    buttons[optIndex].click();
                }
            }
        }
    };
    document.addEventListener('keydown', keyHandler);

    // Global click-to-skip listener during answers
    overlay.addEventListener('mousedown', (e) => {
        if (answered && !gameOverActive && !isIntro) {
            // Ignore if they click an expanded mistake or something interactive
            if (e.target.closest('.sd-mistake-item') || e.target.closest('button')) return;
            advanceNext();
        }
    });

    // Handle button visual click feedback during keyboard events
    pressKeyHandler = (e) => {
        if (['1', '2', '3', '4'].includes(e.key) && !answered && !isIntro && !gameOverActive) {
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex]) {
                    buttons[optIndex].classList.add('pressed');
                }
            }
        }
    };
    document.addEventListener('keydown', pressKeyHandler);

    releaseKeyHandler = (e) => {
        if (['1', '2', '3', '4'].includes(e.key)) {
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex]) {
                    buttons[optIndex].classList.remove('pressed');
                }
            }
        }
    };
    document.addEventListener('keyup', releaseKeyHandler);

    const advanceNext = () => {
        clearTimeout(advanceTimeout);
        cardIdx++;
        showCard();
    };

    const startGame = () => {
        isIntro = false;
        renderGameLayout();
        showCard();
    };

    const restartGame = () => {
        cleanup();
        
        // Shuffle fresh subset
        const freshCards = fisherYatesShuffle([...cards]);
        S.currentStudyCards = freshCards;
        
        score = 0;
        streak = 0;
        maxStreak = 0;
        lives = 3;
        cardIdx = 0;
        correctCount = 0;
        gameOverActive = false;
        isIntro = false;
        answered = false;
        mistakes = [];
        speedBonusCount = 0;
        lateSaveCount = 0;
        
        renderGameLayout();
        showCard();
    };

    const renderGameLayout = () => {
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.2rem;position:relative;">
                <!-- Top HUD -->
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:0.5rem; z-index: 5;">
                    <div id="sd-lives" style="display:flex;gap:0.4rem;font-size:1.8rem;transition:transform 0.2s ease;"></div>
                    <div style="display:flex; gap:1rem; font-size:0.95rem; font-weight:700; color:#fff; align-items:center;">
                        <span id="sd-pb" style="color:#FFD700; text-shadow:0 0 8px rgba(255,215,0,0.4); display:flex; align-items:center; gap:4px;">
                            Rekord: ${personalBest}
                        </span>
                        <span id="sd-card-progress" style="color:var(--text-secondary);">Kort ${cardIdx + 1} / ${cards.length}</span>
                    </div>
                </div>
                
                <!-- Timer Bar -->
                <div style="width:100%; display:flex; align-items:center; gap:0.75rem; z-index: 5;">
                    <div id="sd-timer-bar" style="flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;position:relative;">
                        <div id="sd-timer-fill" style="width:100%;height:100%;background:#00ffff;transform-origin:left;transform:scaleX(1);"></div>
                    </div>
                    <span id="sd-timer-text" style="font-family:monospace; font-size:1rem; font-weight:700; color:#00ffff; min-width:45px; text-align:right;">7.0s</span>
                </div>
                
                <!-- Score & Streak display -->
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; min-height:30px; z-index: 5;">
                    <span id="sd-score-hud" style="font-size:1.3rem; font-weight:900; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.15);">Poäng: 0</span>
                    <span id="sd-streak-hud" style="opacity:0; transition:all 0.2s ease;">
                        <div class="sd-combo-badge">
                            <span>Combo x<span id="sd-streak-count">0</span></span>
                        </div>
                    </span>
                </div>
                
                <!-- Question Area -->
                <div id="sd-question" style="font-size:1.4rem;font-weight:700;color:#fff;text-align:center;line-height:1.4;width:100%;margin:0.5rem 0;z-index: 5; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 1rem;"></div>
                
                <!-- Options Grid -->
                <div id="sd-options" style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;width:100%;z-index: 5;"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
    };

    const renderLives = () => {
        const container = overlay.querySelector('#sd-lives');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const heartSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            heartSvg.setAttribute('class', 'sd-heart-icon');
            heartSvg.setAttribute('viewBox', '0 0 24 24');
            heartSvg.innerHTML = `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`;
            
            if (i >= lives) {
                heartSvg.classList.add('lost');
                if (i === lives && answered) {
                    heartSvg.classList.add('shattered');
                }
            }
            container.appendChild(heartSvg);
        }
    };

    const stripHtmlForOption = (html) => {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').trim().substring(0, 120);
    };

    const showIntroScreen = () => {
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="sd-intro-screen">
                <div class="sd-crown-container">
                    <svg viewBox="0 0 24 24" width="60" height="60" fill="currentColor">
                        <path d="M2 22h20v-2H2v2zm1-3l2.5-9 4.5 4 2.5-10 2.5 10 4.5-4 2.5 9H3z"/>
                    </svg>
                </div>
                <h1 style="font-family:'Russo One', 'Impact', sans-serif; font-size:3rem; margin:0; color:#DC143C; text-shadow: 0 0 15px rgba(220,20,60,0.6), 2px 3px 0 #3a0008; letter-spacing:0.05em;">SUDDEN DEATH</h1>
                <div style="background: rgba(255, 215, 0, 0.08); border: 1px dashed #FFD700; padding: 0.75rem 1.5rem; border-radius: 12px; font-weight: 700; color: #FFD700; text-shadow: 0 0 6px rgba(255,215,0,0.3); font-size: 1.1rem;">
                    Rekord (${pbTitle}): ${personalBest} poäng
                </div>
                <p style="color: rgba(255,255,255,0.7); line-height: 1.6; font-size: 0.95rem; margin: 0;">
                    Välj rätt svar med <strong style="color:#fff;">[1] - [4]</strong>. Du har <strong style="color:#EA4335;">3 liv</strong>.<br>
                    Tiden tickar snabbare ju fler rätt du har!<br>
                    Vid fel visas rätt svar — studera det innan du fortsätter.
                </p>
                <div style="display:flex; flex-direction:column; gap:0.5rem; width:100%; align-items:center;">
                    <button id="sd-btn-start" class="btn primary" style="width: 100%; max-width: 250px; font-weight: 700; font-size: 1.1rem; padding: 0.9rem; border-radius: 10px;">STARTA UTMANINGEN</button>
                    <span style="font-size: 0.8rem; color: rgba(255,255,255,0.4); font-style: italic;">[Tryck på Space för att starta]</span>
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        overlay.querySelector('#sd-btn-start').onclick = startGame;
    };

    const showEndScreen = () => {
        cleanup();
        
        const isNewPB = score > personalBest;
        if (isNewPB) {
            personalBest = score;
            localStorage.setItem(pbKey, score);
        }
        
        // Sync stats to globally accessible playground session
        S.playgroundSessionStats.correct = score; 

        const isVictory = lives > 0 && cardIdx >= cards.length;
        const screenClass = isVictory ? 'victory' : '';
        const titleClass = isVictory ? 'victory' : 'gameover';
        const titleText = isVictory ? 'SEGER!' : 'SPELET SLUT';
        const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
        
        // Earned badges calculation
        const badges = [];
        if (speedBonusCount >= 5) {
            badges.push({
                text: 'Blixtsnabb',
                color: '#60A5FA',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#60A5FA"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34 1.2-2.11 3.03-5.34L13 3h1l-1 7h3.5c.49 0 .56.33.38.66l-4.5 8.34c-.18.33-.38.34-.38.34z"/></svg>`,
                desc: 'Svarade blixtsnabbt på 5+ kort'
            });
        }
        if (maxStreak >= 10) {
            badges.push({
                text: 'Streak-mästare',
                color: '#F59E0B',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#F59E0B"><path d="M12 23c4.97 0 9-4.03 9-9 0-2.12-.74-4.07-1.97-5.61L12.35 1c-.39-.4-.97-.3-1.09.26C10.74 3.76 8.44 6 5.86 8.62 3.42 11.08 2 13.9 2 17c0 3.31 2.69 6 6 6h4zm-3-9c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3-3-1.34-3-3z"/></svg>`,
                desc: 'Nådde en streak på 10+'
            });
        }
        if (lives === 3 && cardIdx > 0) {
            badges.push({
                text: 'Oslagbar',
                color: '#34A853',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#34A853"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`,
                desc: 'Förlorade inte ett enda liv'
            });
        }
        if (lateSaveCount >= 1) {
            badges.push({
                text: 'Sista sekunden',
                color: '#F87171',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#F87171"><path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6v6h12v-6h-.01L18 16l-4-4 4-4-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zM8 7.5V4h8v3.5l-4 4-4-4z"/></svg>`,
                desc: 'Svarade med under 0.5s kvar'
            });
        }
        if (badges.length === 0) {
            badges.push({
                text: 'Kämpe',
                color: '#A855F7',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#A855F7"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
                desc: 'Kämpade väl under spelrundan'
            });
        }

        // Mistakes list HTML
        const mistakesHtml = mistakes.length > 0 ? `
            <div class="sd-mistakes-list">
                ${mistakes.map((m, idx) => `
                    <div class="sd-mistake-item" data-idx="${idx}">
                        <div class="sd-mistake-summary">
                            <span class="sd-mistake-index">#${idx + 1}</span>
                            <span class="sd-mistake-front-preview">${stripHtmlForOption(m.card.front)}</span>
                            <span class="sd-mistake-chevron">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5H7z"/></svg>
                            </span>
                        </div>
                        <div class="sd-mistake-detail hidden">
                            <div class="sd-mistake-detail-section">
                                <strong>Fråga</strong>
                                <div class="sd-mistake-text">${typeof safeParse === 'function' ? safeParse(m.card.front) : m.card.front}</div>
                            </div>
                            <div class="sd-mistake-detail-section">
                                <strong>Ditt svar</strong>
                                <div class="sd-mistake-text wrong-text">${m.userAnswer}</div>
                            </div>
                            <div class="sd-mistake-detail-section">
                                <strong>Rätt svar</strong>
                                <div class="sd-mistake-text correct-text" id="sd-mistake-correct-${idx}">${typeof safeParse === 'function' ? safeParse(m.card.back) : m.card.back}</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; opacity:0.8; height: 100%;">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="#FFD700"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <span style="font-weight:700; color:#fff;">Perfekt spelrunda!</span>
                <span style="font-size:0.85rem; color:rgba(255,255,255,0.5); text-align:center;">Du gjorde inga misstag alls. Imponerande!</span>
            </div>
        `;

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="sd-end-layout">
                <!-- Left Screen: Stats & Badges -->
                <div class="sd-end-screen-left ${screenClass}">
                    <h2 class="sd-end-title ${titleClass}">${titleText}</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        ${isVictory ? 'Du överlevde alla korten!' : 'Du fick slut på liv.'}
                    </p>
                    
                    <div class="sd-stats-grid" style="margin: 0.5rem 0;">
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Besvarade kort</span>
                            <span class="sd-stat-value">${cardIdx} / ${cards.length}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Längsta streak</span>
                            <span class="sd-stat-value">${maxStreak}</span>
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
                            <div style="background: rgba(255,215,0,0.12); border: 1px dashed #FFD700; border-radius: 8px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #FFD700; text-shadow: 0 0 4px rgba(255,215,0,0.2);">
                                 NYTT REKORD! 👑
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="opacity: 0.65;">
                                <span class="sd-stat-label">Rekord</span>
                                <span class="sd-stat-value">${personalBest}</span>
                            </div>
                        `}
                    </div>

                    <!-- Badges Row -->
                    <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:1rem; text-align:left;">
                        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin-bottom:0.5rem; text-align:center;">Intjänade utmärkelser</div>
                        <div class="sd-badges-list">
                            ${badges.map(b => `<div class="sd-badge-item" title="${b.desc}">${b.svg} <span>${b.text}</span></div>`).join('')}
                        </div>
                    </div>
                    
                    <div class="sd-end-actions" style="margin-top:0.5rem;">
                        <button id="sd-btn-restart" class="btn primary" style="border-radius:10px;">Spela igen</button>
                        <button id="sd-btn-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button>
                    </div>
                </div>

                <!-- Right Screen: Mistakes Review -->
                <div class="sd-end-screen-right">
                    <div style="font-size: 1.15rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>Granska dina misstag</span>
                        <span style="font-size: 0.8rem; color: #EA4335; background: rgba(234, 67, 53, 0.15); padding: 2px 8px; border-radius: 12px; font-weight: 600;">
                            ${mistakes.length} fel
                        </span>
                    </div>
                    ${mistakesHtml}
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        gameOverActive = true;
        
        const endLayout = overlay.querySelector('.sd-end-layout');
        
        // Mistakes details expand/collapse handler
        const mistakeItems = endLayout.querySelectorAll('.sd-mistake-item');
        mistakeItems.forEach(item => {
            item.addEventListener('click', () => {
                const detail = item.querySelector('.sd-mistake-detail');
                const isExpanded = item.classList.contains('expanded');
                
                // Collapse all others
                mistakeItems.forEach(other => {
                    other.classList.remove('expanded');
                    other.querySelector('.sd-mistake-detail').classList.add('hidden');
                });
                
                if (!isExpanded) {
                    item.classList.add('expanded');
                    detail.classList.remove('hidden');
                    
                    const idx = parseInt(item.getAttribute('data-idx'));
                    const m = mistakes[idx];
                    const correctTextEl = detail.querySelector(`#sd-mistake-correct-${idx}`);
                    if (correctTextEl && typeof renderCardBackImages === 'function') {
                        renderCardBackImages(correctTextEl, m.card.backImages);
                    }
                    renderLatex(detail);
                }
            });
        });

        overlay.querySelector('#sd-btn-restart').onclick = restartGame;
        overlay.querySelector('#sd-btn-exit').onclick = closeGame;
        
        if (isNewPB || isVictory) {
            triggerConfetti();
        }
    };

    const showCard = () => {
        if (cardIdx >= cards.length || lives <= 0) {
            showEndScreen();
            return;
        }

        clearTimeout(timerHandle);
        clearTimeout(advanceTimeout);
        cancelAnimationFrame(timerRAF);
        overlay.classList.remove('sd-urgent-pulse');

        answered = false;
        const card = cards[cardIdx];
        
        // Update HUD
        const cardProgressEl = overlay.querySelector('#sd-card-progress');
        const scoreHudEl = overlay.querySelector('#sd-score-hud');
        if (cardProgressEl) cardProgressEl.textContent = `Kort ${cardIdx + 1} / ${cards.length}`;
        if (scoreHudEl) scoreHudEl.textContent = `Poäng: ${score}`;
        
        const streakHud = overlay.querySelector('#sd-streak-hud');
        if (streakHud) {
            if (streak >= 2) {
                overlay.querySelector('#sd-streak-count').textContent = streak;
                streakHud.style.opacity = '1';
            } else {
                streakHud.style.opacity = '0';
            }
        }

        const qEl = overlay.querySelector('#sd-question');
        if (qEl) {
            qEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
            renderLatex(qEl);
        }
        
        const showFullAnswer = () => {
            if (!qEl) return;
            qEl.style.maxHeight = 'none';
            qEl.innerHTML = `
                <div style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.25rem; text-align: left;">Fråga:</div>
                <div style="font-size: 1.05rem; margin-bottom: 0.75rem; text-align: left; font-weight:600;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size: 0.9rem; color: #34A853; margin-bottom: 0.25rem; font-weight: 700; text-align: left;">Rätt svar:</div>
                <div id="sd-full-answer-text" style="font-size: 1.1rem; color: #fff; background: rgba(52, 168, 83, 0.08); border: 1px solid rgba(52, 168, 83, 0.2); padding: 0.75rem; border-radius: 8px; text-align: left;">
                    ${typeof safeParse === 'function' ? safeParse(card.back) : card.back}
                </div>
                <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.35); margin-top: 0.75rem; text-align: center; font-style: italic;">
                    [Space] fortsätt
                </div>
            `;
            const answerTextEl = qEl.querySelector('#sd-full-answer-text');
            if (answerTextEl && typeof renderCardBackImages === 'function') {
                renderCardBackImages(answerTextEl, card.backImages);
            }
            renderLatex(qEl);
        };
        
        const revealCorrectOption = (button) => {
            button.classList.add('sd-correct');
            const optTextEl = button.querySelector('.sd-opt-text');
            if (optTextEl) {
                optTextEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.back) : card.back;
                if (typeof renderCardBackImages === 'function') {
                    renderCardBackImages(optTextEl, card.backImages);
                }
                renderLatex(button);
            }
        };
        
        renderLives();

        const optContainer = overlay.querySelector('#sd-options');
        if (!optContainer) return;
        optContainer.style.display = 'grid';

        const correctAnswer = stripHtmlForOption(card.back);
        const sameSectionCards = card.sectionId
            ? allCards.filter(c => c.id !== card.id && c.sectionId === card.sectionId && stripHtmlForOption(c.back) !== correctAnswer)
            : [];
        const sameDeckCards = allCards.filter(c =>
            c.id !== card.id &&
            c.originalDeckId === card.originalDeckId &&
            stripHtmlForOption(c.back) !== correctAnswer &&
            !sameSectionCards.some(s => s.id === c.id)
        );
        const otherCards = allCards.filter(c =>
            c.id !== card.id &&
            stripHtmlForOption(c.back) !== correctAnswer &&
            !sameSectionCards.some(s => s.id === c.id) &&
            !sameDeckCards.some(s => s.id === c.id)
        );
        const wrongPool = [...fisherYatesShuffle(sameSectionCards), ...fisherYatesShuffle(sameDeckCards), ...fisherYatesShuffle(otherCards)];
        const seen = new Set();
        const wrongs = [];
        for (const c of wrongPool) {
            const txt = stripHtmlForOption(c.back);
            if (!seen.has(txt)) {
                seen.add(txt);
                wrongs.push(txt);
                if (wrongs.length === 3) break;
            }
        }
        while (wrongs.length < 3) wrongs.push('...');

        const options = fisherYatesShuffle([
            { text: correctAnswer, correct: true },
            { text: wrongs[0], correct: false },
            { text: wrongs[1], correct: false },
            { text: wrongs[2], correct: false },
        ]);

        optContainer.innerHTML = '';

        options.forEach((opt, optIdx) => {
            const btn = document.createElement('button');
            btn.className = 'sd-option-btn sd-option-entry';
            btn.style.animationDelay = `${optIdx * 50}ms`;
            btn.innerHTML = `<span class="sd-key-badge">${optIdx + 1}</span><span class="sd-opt-text"></span>`;
            btn.querySelector('.sd-opt-text').innerHTML = typeof safeParse === 'function' ? safeParse(opt.text) : opt.text;
            renderLatex(btn);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (answered) return;
                answered = true;
                
                clearTimeout(timerHandle);
                cancelAnimationFrame(timerRAF);
                overlay.classList.remove('sd-urgent-pulse');

                const responseTime = performance.now() - startTime;
                const remainingTimePct = Math.max(0, 1 - (performance.now() - startTime) / duration);

                if (opt.correct) {
                    revealCorrectOption(btn);
                    correctCount++;
                    streak++;
                    if (streak > maxStreak) maxStreak = streak;

                    // Score logic with streak multiplier and speed bonus
                    const multiplier = 1 + streak * 0.1;
                    let basePoints = 100;
                    let isSpeedBonus = false;
                    
                    if (responseTime < 1200) {
                        basePoints += 50;
                        isSpeedBonus = true;
                        speedBonusCount++;
                    }
                    if (remainingTimePct < 0.08) {
                        lateSaveCount++;
                    }

                    const gainedPoints = Math.round(basePoints * multiplier);
                    score += gainedPoints;

                    // Extra life check at streak of 10
                    if (streak === 10) {
                        if (lives < 3) {
                            lives++;
                            showFloatingFeedback('EXTRA LIV! 🛡️', 'streak');
                            renderLives();
                        } else {
                            showFloatingFeedback('COMBO x10! 🔥', 'streak');
                        }
                    } else if (streak >= 3) {
                        showFloatingFeedback(`COMBO x${streak}! 🔥`, 'streak');
                    } else {
                        showFloatingFeedback(isSpeedBonus ? `BLIXTSNABB! +${gainedPoints}` : `+${gainedPoints}`, 'correct');
                    }
                    
                    if (scoreHudEl) scoreHudEl.textContent = `Poäng: ${score}`;
                    showFullAnswer();
                    if (optContainer) optContainer.style.display = 'none';
                    advanceTimeout = setTimeout(() => advanceNext(), 2000);
                } else {
                    btn.classList.add('sd-wrong');
                    optContainer.querySelectorAll('.sd-option-btn').forEach(b => {
                        const originalIndex = Array.from(optContainer.children).indexOf(b);
                        if (options[originalIndex]?.correct) revealCorrectOption(b);
                    });
                    
                    streak = 0;
                    lives--;
                    
                    // Log mistake
                    mistakes.push({
                        card: card,
                        userAnswer: opt.text || '(tomt)',
                        correctAnswer: correctAnswer
                    });
                    
                    showFloatingFeedback('FEL! -1 💔', 'wrong');
                    renderLives();

                    // Flash screen & shake
                    overlay.classList.add('shake-active');
                    const flashOverlay = document.createElement('div');
                    flashOverlay.style.position = 'absolute';
                    flashOverlay.style.inset = '0';
                    flashOverlay.style.background = 'rgba(234, 67, 53, 0.2)';
                    flashOverlay.style.pointerEvents = 'none';
                    flashOverlay.style.zIndex = '99';
                    overlay.appendChild(flashOverlay);
                    
                    setTimeout(() => {
                        overlay.classList.remove('shake-active');
                        flashOverlay.remove();
                    }, 300);

                    showFullAnswer();
                }
            });
            optContainer.appendChild(btn);
        });

        // Setup dynamic countdown timer
        const fill = overlay.querySelector('#sd-timer-fill');
        const timerText = overlay.querySelector('#sd-timer-text');
        if (fill) {
            fill.style.transition = 'none';
            fill.style.transform = 'scaleX(1)';
            fill.style.backgroundColor = '#00ffff';
            fill.style.setProperty('--timer-glow', '#00ffff');
        }

        // Timer duration scales down as correct count increases (down to 3.5s from 7.0s)
        const duration = Math.max(3500, 7000 - correctCount * 100);
        const startTime = performance.now();

        const animateTimer = (now) => {
            if (answered) return;
            const elapsed = now - startTime;
            const pct = Math.max(0, 1 - elapsed / duration);
            if (fill) fill.style.transform = `scaleX(${pct})`;
            
            const remainingSecs = (pct * (duration / 1000)).toFixed(1);
            if (timerText) {
                timerText.textContent = `${remainingSecs}s`;
            }

            if (pct <= 0.33) {
                if (fill) {
                    fill.style.backgroundColor = '#ff2200';
                    fill.style.setProperty('--timer-glow', '#ff2200');
                }
                if (timerText) timerText.style.color = '#ff2200';
                overlay.classList.add('sd-urgent-pulse');
            } else if (pct <= 0.66) {
                if (fill) {
                    fill.style.backgroundColor = '#ffaa00';
                    fill.style.setProperty('--timer-glow', '#ffaa00');
                }
                if (timerText) timerText.style.color = '#ffaa00';
            } else {
                if (fill) {
                    fill.style.backgroundColor = '#00ffff';
                    fill.style.setProperty('--timer-glow', '#00ffff');
                }
                if (timerText) timerText.style.color = '#00ffff';
                overlay.classList.remove('sd-urgent-pulse');
            }

            if (pct > 0) {
                timerRAF = requestAnimationFrame(animateTimer);
            }
        };
        timerRAF = requestAnimationFrame(animateTimer);

        timerHandle = setTimeout(() => {
            if (answered) return;
            answered = true;
            cancelAnimationFrame(timerRAF);
            overlay.classList.remove('sd-urgent-pulse');
            
            lives--;
            streak = 0;
            
            // Log mistake
            mistakes.push({
                card: card,
                userAnswer: '(Tiden ute)',
                correctAnswer: correctAnswer
            });
            
            showFloatingFeedback('TIDEN UTE! -1 💔', 'wrong');
            renderLives();

            optContainer.querySelectorAll('.sd-option-btn').forEach(b => {
                const originalIndex = Array.from(optContainer.children).indexOf(b);
                if (options[originalIndex]?.correct) revealCorrectOption(b);
            });
            
            showFullAnswer();
            
            // Shake and red flash
            overlay.classList.add('shake-active');
            const flashOverlay = document.createElement('div');
            flashOverlay.style.position = 'absolute';
            flashOverlay.style.inset = '0';
            flashOverlay.style.background = 'rgba(234, 67, 53, 0.2)';
            flashOverlay.style.pointerEvents = 'none';
            flashOverlay.style.zIndex = '99';
            overlay.appendChild(flashOverlay);

            setTimeout(() => {
                overlay.classList.remove('shake-active');
                flashOverlay.remove();
            }, 300);
        }, duration);
    };

    showIntroScreen();
};
