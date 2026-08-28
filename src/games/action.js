import { stripHtml } from '../core/backup.js';
import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { processRating } from '../ui/study.js';


    export const actionReveal = (allCards) => {
        const cards = S.currentStudyCards;
        const startTimeSession = Date.now();
        
        let score = 0;
        let combo = 0;
        let maxCombo = 0;
        let cardIdx = 0;
        
        // Stats for session summary
        let totalPerfects = 0;
        let totalHits = 0;
        let totalWordsProcessed = 0;
        
        const stripHtmlForOption = (html) => stripHtml(html).substring(0, 120);
        
        // Personal best tracking
        let pbKey = 'spaced_rep_action_pb_all';
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
                pbKey = `spaced_rep_action_pb_${singleDeckId}`;
                pbTitle = deckObj ? deckObj.title : 'Fokusområde';
            } else {
                pbKey = `spaced_rep_action_pb_focus_${Array.from(deckIds).sort().join('_')}`;
                pbTitle = 'Fokusområde';
            }
        }
        let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);
        
        // Create full screen cinema overlay
        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay action-game-overlay';
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-particles"></div>
            <div class="cinema-flash"></div>
            <div class="cinema-content" id="action-game-container" style="width:95%; max-width:800px; height:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding: 12vh 0 10vh; position:relative; z-index:5;">
                <!-- HUD -->
                <div class="arena-top action-hud">
                    <span class="arena-meta num">
                        <span id="action-score">Poäng 0</span>
                        <span id="action-combo" class="arena-combo">x0</span>
                    </span>
                    <span class="arena-meta num">
                        <span id="action-pb">Rekord ${personalBest}</span>
                        <span class="arena-sep" aria-hidden="true"></span>
                        <span id="action-progress">${cardIdx + 1} av ${cards.length}</span>
                    </span>
                </div>
                
                <!-- Main Arena -->
                <div id="action-arena" class="action-arena"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        
        // Spawn glowing embers in background
        const particlesContainer = overlay.querySelector('.cinema-particles');
        const spawnEmber = () => {
            if (!document.getElementById('cinema-overlay')) return;
            const ember = document.createElement('div');
            ember.className = 'action-ember';
            ember.style.left = Math.random() * 100 + 'vw';
            const size = 3 + Math.random() * 8;
            ember.style.width = size + 'px';
            ember.style.height = size + 'px';
            const drift = -80 + Math.random() * 160;
            ember.style.setProperty('--drift', drift + 'px');
            ember.style.animationDuration = (3 + Math.random() * 4) + 's';
            particlesContainer.appendChild(ember);
            setTimeout(() => ember.remove(), 7000);
            
            // Spawn next after delay
            setTimeout(spawnEmber, 350);
        };
        spawnEmber();

        // Helper to trigger confetti
        const triggerConfetti = () => {
            const colors = ['var(--rate-2)', 'var(--danger)', 'var(--rate-2)', 'var(--rate-2)', 'var(--danger)'];
            for (let j = 0; j < 60; j++) {
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

        // Helper to spawn hit sparks
        const spawnSparks = (x, y, count = 15) => {
            for (let j = 0; j < count; j++) {
                const spark = document.createElement('div');
                spark.className = 'action-spark';
                spark.style.left = x + 'px';
                spark.style.top = y + 'px';
                spark.style.background = 'radial-gradient(circle, var(--rate-2), var(--danger))';
                const tx = (Math.random() - 0.5) * 160;
                const ty = (Math.random() - 0.5) * 160;
                spark.style.setProperty('--tx', tx + 'px');
                spark.style.setProperty('--ty', ty + 'px');
                overlay.appendChild(spark);
                setTimeout(() => spark.remove(), 500);
            }
        };

        // UI state variables
        let currentPhase = 'intro'; // 'intro', 'think', 'slam', 'review', 'end'
        let thinkTimerHandle = null;
        let slamTimeoutHandle = null;
        let rhythmIntervalHandle = null;
        let targetRingTime = 0;
        let isWordPressed = false;
        let activeWordDuration = 0;
        let wordList = [];
        let wordIdx = 0;
        
        const arena = overlay.querySelector('#action-arena');
        const scoreHUD = overlay.querySelector('#action-score');
        const comboHUD = overlay.querySelector('#action-combo');
        const progressHUD = overlay.querySelector('#action-progress');

        const updateHUD = () => {
            scoreHUD.textContent = `Poäng ${score}`;
            if (combo >= 2) {
                comboHUD.textContent = ` ${combo}`;
                comboHUD.classList.add('is-on');
                comboHUD.classList.add('pulse');
                setTimeout(() => comboHUD.classList.remove('pulse'), 150);
            } else {
                comboHUD.classList.remove('is-on');
            }
            progressHUD.textContent = `${cardIdx + 1} av ${cards.length}`;
        };

        const cleanup = () => {
            clearTimeout(thinkTimerHandle);
            clearTimeout(slamTimeoutHandle);
            clearInterval(rhythmIntervalHandle);
            document.removeEventListener('keydown', handleGlobalKeydown);
        };

        let isClosed = false;
        const closeGame = () => {
            if (isClosed) return;
            isClosed = true;
            cleanup();
            overlay.remove();
            finishPlaygroundSession();
        };

        // --- KEYDOWN DISPATCHER ---
        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
                return;
            }

            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (currentPhase === 'intro') {
                    startThinkPhase();
                } else if (currentPhase === 'think') {
                    startSlamPhase();
                } else if (currentPhase === 'slam') {
                    if (e.key === ' ') {
                        triggerRhythmHit();
                    } else if (e.key === 'Enter') {
                        startReviewPhase();
                    }
                } else if (currentPhase === 'end') {
                    if (e.key === 'Enter') {
                        restartGame();
                    }
                }
            } else if (currentPhase === 'review') {
                if (['1', '2', '3', '4'].includes(e.key)) {
                    e.preventDefault();
                    const rating = parseInt(e.key, 10);
                    submitCardRating(rating);
                }
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        // --- MOUSE CLICK ON GAME CONTAINER FOR MOBILE TIMING ---
        overlay.addEventListener('mousedown', (e) => {
            // Don't intercept clicks on buttons/inputs
            if (e.target.closest('button') || e.target.closest('.study-actions')) return;
            
            if (currentPhase === 'intro') {
                startThinkPhase();
            } else if (currentPhase === 'think') {
                startSlamPhase();
            } else if (currentPhase === 'slam') {
                triggerRhythmHit();
            }
        });

        // --- RHYTHM INTERACTION (HIT LOGIC) ---
        const triggerRhythmHit = () => {
            if (isWordPressed || currentPhase !== 'slam' || wordList.length === 0) return;
            isWordPressed = true;
            
            const now = Date.now();
            const diff = Math.abs(now - targetRingTime);
            
            const feedbackContainer = overlay.querySelector('#action-timing-feedback');
            if (!feedbackContainer) return;
            feedbackContainer.innerHTML = '';
            
            // Get center coordinates of word wrapper to spawn sparks
            const wordWrapper = overlay.querySelector('.action-word-wrapper');
            const rect = wordWrapper ? wordWrapper.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            if (diff <= 80) {
                // PERFECT
                totalPerfects++;
                totalHits++;
                combo++;
                if (combo > maxCombo) maxCombo = combo;
                
                const gained = Math.round(50 * (1 + combo * 0.1));
                score += gained;
                
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt perfect';
                msg.textContent = `PERFECT! +${gained}`;
                feedbackContainer.appendChild(msg);
                
                spawnSparks(cx, cy, 20);
                
                // Shockwave flash
                const flash = overlay.querySelector('.cinema-flash');
                flash.classList.add('flash-active');
                overlay.classList.add('shake-active');
                setTimeout(() => {
                    flash.classList.remove('flash-active');
                    overlay.classList.remove('shake-active');
                }, 100);
            } else if (diff <= 160) {
                // GREAT
                totalHits++;
                combo++;
                if (combo > maxCombo) maxCombo = combo;
                
                const gained = Math.round(30 * (1 + combo * 0.1));
                score += gained;
                
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt great';
                msg.textContent = `GREAT! +${gained}`;
                feedbackContainer.appendChild(msg);
                
                spawnSparks(cx, cy, 10);
            } else {
                // MISS
                combo = 0;
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt miss';
                msg.textContent = 'MISS! (FÖR TIDIG/SEN)';
                feedbackContainer.appendChild(msg);
            }
            updateHUD();
        };

        // --- PHASE 1: INTRO ---
        const showIntro = () => {
            currentPhase = 'intro';
            arena.innerHTML = `
                <div class="action-card">
                    <h1 class="action-title">ACTIONREPETITION</h1>
                    <p class="action-subtitle">Slammande ord under tidspress. Genuin action.</p>
                    <p class="action-subtitle" style="font-size:0.95rem; color:var(--text-2);">
                        Klicka på <strong>Mellanslag</strong> eller tryck på skärmen i perfekt timing när ringen möter orden för att bygga en combo och tjäna bonuspoäng!
                    </p>
                    <div class="action-controls-info">
                        <strong>KONTROLLER:</strong><br/>
                        • Mellanslag / Skärmtryck : Rytm-träff under reveal<br/>
                        • Mellanslag / Skärmtryck : Starta reveal (under tänketid)<br/>
                        • 1, 2, 3, 4 : Betygsätt kort (Igen, Svår, Bra, Enkel) i slutet<br/>
                        • Esc : Avsluta spel
                    </div>
                    <button id="action-btn-start" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">STARTA SPEL</button>
                </div>
            `;
            arena.querySelector('#action-btn-start').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startThinkPhase();
            };
        };

        // --- PHASE 2: THINKING ---
        const startThinkPhase = () => {
            if (currentPhase === 'think') return;
            if (cardIdx >= cards.length) {
                showEndScreen();
                return;
            }
            
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'think';
            updateHUD();
            
            const card = cards[cardIdx];
            arena.innerHTML = `
                <div class="action-card" style="border-color:var(--line-strong);">
                    <div class="action-card-header">FRÅGA</div>
                    <div id="action-question" class="action-text-question"></div>
                    <div class="action-think-timer-container">
                        <div id="action-think-timer-fill" class="action-think-timer-fill"></div>
                    </div>
                    <div style="font-size:0.85rem; color:var(--text-3); font-weight:700;">Tänk ut svaret...</div>
                    <button id="action-btn-reveal" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">VISA SVAR [Space]</button>
                </div>
            `;
            
            const qBox = arena.querySelector('#action-question');
            if (card._jeopardy) {
                qBox.innerHTML = `<div style="font-size: 0.85rem; font-weight: 700; color: var(--accent); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 0.5rem; border-bottom: 1px solid var(--surface-3); padding-bottom: 0.3rem; opacity: 0.8;">SVAR (Fråga eftersöks)</div>` + (typeof safeParse === 'function' ? safeParse(card.front) : card.front);
            } else {
                qBox.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
            }
            renderLatex(qBox);
            
            arena.querySelector('#action-btn-reveal').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startSlamPhase();
            };
            
            // Start shrinking timer bar (6.0 seconds)
            const fill = arena.querySelector('#action-think-timer-fill');
            // Trigger layout reflow to make transition start
            requestAnimationFrame(() => {
                fill.style.transform = 'scaleX(0)';
            });
            
            thinkTimerHandle = setTimeout(() => {
                startSlamPhase();
            }, 6000);
        };

        // --- PHASE 3: SLAMMING (WORD REVEAL WITH RHYTHM RING) ---
        const startSlamPhase = () => {
            if (currentPhase !== 'think') return;
            clearTimeout(thinkTimerHandle);
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'slam';
            updateHUD();
            
            const card = cards[cardIdx];
            
            // Build temporary DOM node to parse card.back and wrap math blocks atomicly
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = typeof safeParse === 'function' ? safeParse(card.back) : card.back;
            renderLatex(tempDiv);
            
            // Helper to recursively collect all text words and KaTeX nodes
            const extractWordNodes = (node, list = []) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (text.trim() === '') return;
                    // Split keeping spaces as delimiters so we keep word blocks
                    const words = text.split(/(\s+)/);
                    words.forEach(w => {
                        if (/\s+/.test(w)) {
                            // ignore whitespace
                        } else if (w.length > 0) {
                            list.push({ type: 'text', text: w });
                        }
                    });
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) {
                        list.push({ type: 'math', html: node.outerHTML });
                    } else {
                        Array.from(node.childNodes).forEach(child => extractWordNodes(child, list));
                    }
                }
                return list;
            };
            
            wordList = extractWordNodes(tempDiv);
            wordIdx = 0;
            
            if (wordList.length === 0) {
                // Fallback if no words to reveal
                wordList = [{ type: 'text', text: 'Klar!' }];
            }
            
            totalWordsProcessed += wordList.length;

            arena.innerHTML = `
                <div class="action-reveal-container">
                    <div id="action-docked-question" class="action-docked-question">
                        Fråga: ${card._jeopardy ? 'SVAR' : ''} ${stripHtmlForOption(card.front)}
                    </div>
                    <div class="action-word-wrapper">
                        <div id="action-active-word" class="action-active-word"></div>
                        <div id="action-timing-ring" class="action-timing-ring"></div>
                    </div>
                    <div id="action-timing-feedback" class="action-timing-feedback"></div>
                    <button id="action-btn-skip" class="btn-skip">Visa hela svaret [Enter]</button>
                </div>
            `;
            
            arena.querySelector('#action-btn-skip').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startReviewPhase();
            };
            
            const activeWordEl = arena.querySelector('#action-active-word');
            const timingRing = arena.querySelector('#action-timing-ring');
            
            const showNextSlam = () => {
                if (currentPhase !== 'slam' || !document.getElementById('cinema-overlay')) return;
                
                // If we finished revealing all words
                if (wordIdx >= wordList.length) {
                    // Check if last word was missed (if user didn't press)
                    if (!isWordPressed && wordIdx > 0) {
                        combo = 0;
                        updateHUD();
                    }
                    startReviewPhase();
                    return;
                }
                
                // Check if previous word was missed (if user didn't press)
                if (wordIdx > 0 && !isWordPressed) {
                    combo = 0;
                    updateHUD();
                }
                
                isWordPressed = false;
                const node = wordList[wordIdx];
                
                // Set word display
                activeWordEl.classList.remove('animating');
                void activeWordEl.offsetWidth; // Trigger layout reflow
                
                if (node.type === 'math') {
                    activeWordEl.innerHTML = node.html;
                    activeWordEl.style.fontSize = '2.0rem'; // Scale down equations to fit inside ring
                } else {
                    activeWordEl.textContent = node.text;
                    // Scale down long words to prevent overflow
                    if (node.text.length > 12) {
                        activeWordEl.style.fontSize = '1.8rem';
                    } else if (node.text.length > 8) {
                        activeWordEl.style.fontSize = '2.4rem';
                    } else {
                        activeWordEl.style.fontSize = ''; // Uses CSS default (3.4rem)
                    }
                }
                activeWordEl.classList.add('animating');
                
                // Configure timing ring shrink
                timingRing.classList.remove('animating');
                void timingRing.offsetWidth; // Trigger layout reflow
                timingRing.classList.add('animating');
                
                // Target hit time is exactly 400ms after rendering this word
                targetRingTime = Date.now() + 400;
                
                // Calculate reveal pacing duration based on word length
                const cleanText = node.type === 'text' ? node.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim() : 'math';
                const hasSentenceEnding = node.type === 'text' && /[.!?]$/.test(node.text.trim());
                
                activeWordDuration = Math.max(500, Math.min(1000, cleanText.length * 60 + 320)) * 1.15;
                if (hasSentenceEnding) {
                    activeWordDuration += 800; // Extra pause for punctuation
                }
                
                // Trigger camera shake/flash automatically on sentence end or long words for ambient feedback
                const isMajorWord = cleanText.length > 7;
                if (hasSentenceEnding || isMajorWord || node.type === 'math') {
                    // Subtle automatic pulse feedback
                    overlay.classList.add('shake-active');
                    setTimeout(() => overlay.classList.remove('shake-active'), 180);
                }
                
                wordIdx++;
                slamTimeoutHandle = setTimeout(showNextSlam, activeWordDuration);
            };
            
            showNextSlam();
        };

        // --- PHASE 4: EVALUATION / REVIEW ---
        const startReviewPhase = () => {
            if (currentPhase !== 'slam') return;
            clearTimeout(slamTimeoutHandle);
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'review';
            updateHUD();
            
            const card = cards[cardIdx];
            
            // Zoom-in final impact flash
            const flash = overlay.querySelector('.cinema-flash');
            flash.classList.add('flash-active');
            overlay.classList.add('shake-active');
            setTimeout(() => {
                flash.classList.remove('flash-active');
                overlay.classList.remove('shake-active');
            }, 180);
            
            arena.innerHTML = `
                <div class="action-card" style="max-width: 650px;">
                    <div class="action-card-header" style="color: var(--accent);">FULLSTÄNDIGT SVAR</div>
                    <div id="action-full-answer" class="action-full-answer-scroll">
                        ${typeof safeParse === 'function' ? safeParse(card.back) : card.back}
                    </div>
                    
                    <div class="action-stats-summary">
                        <span> Hits: ${totalPerfects} Perfect</span>
                        <span> Max Combo: ${maxCombo}</span>
                        <span> Poäng: +${score}</span>
                    </div>
                    
                    <div style="font-size:0.85rem; color:var(--text-3); font-weight:700;">Betygsätt din egen hågkomst av kortet:</div>
                    
                    <div id="action-rating-container" class="action-rating-container"></div>
                </div>
            `;
            
            // Render back images
            const ansScroll = arena.querySelector('#action-full-answer');
            if (typeof renderCardBackImages === 'function') {
                renderCardBackImages(ansScroll, card.backImages);
            }
            renderLatex(ansScroll);
            
            // Append cloned actions
            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'cinema-study-actions';
            clonedActions.classList.remove('hidden');
            
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    btn.blur();
                    const rating = parseInt(btn.getAttribute('data-rating'), 10);
                    submitCardRating(rating);
                });
            });
            
            arena.querySelector('#action-rating-container').appendChild(clonedActions);
        };

        const submitCardRating = (rating) => {
            if (currentPhase !== 'review') return;
            currentPhase = 'rating-submitted';
            if (rating === 1) {
                S.playgroundSessionStats.again++;
            } else {
                S.playgroundSessionStats.correct++;
            }
            
            S.currentStudyIndex = cardIdx;
            processRating(rating);
            
            cardIdx++;
            if (cardIdx >= cards.length) {
                showEndScreen();
            } else {
                startThinkPhase();
            }
        };

        // --- PHASE 5: GAME OVER / SUMMARY ---
        const showEndScreen = () => {
            if (currentPhase === 'end') return;
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'end';
            clearTimeout(thinkTimerHandle);
            clearTimeout(slamTimeoutHandle);
            
            const isNewPB = score > personalBest;
            if (isNewPB) {
                personalBest = score;
                localStorage.setItem(pbKey, score);
            }
            
            S.playgroundSessionStats.correct = score; 

            const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
            const perfectPct = totalWordsProcessed > 0 ? Math.round((totalPerfects / totalWordsProcessed) * 100) : 0;
            
            arena.innerHTML = `
                <div class="action-card" style="border-color: var(--accent-line); background: var(--surface-1);">
                    <h2 class="action-title" style="font-size:var(--t-2xl);">SPEL KLART!</h2>
                    <p style="color: var(--text-2); margin: 0; font-size: 0.95rem;">
                        Du tog dig igenom alla korten i tempo!
                    </p>
                    
                    <div class="sd-stats-grid" style="width:100%; display:grid; gap:0.6rem; margin:1rem 0;">
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:var(--text-2);">Timing Hits (Perfect)</span>
                            <span class="sd-stat-value" style="font-weight:700; color:var(--text-1);"> ${totalPerfects} (${perfectPct}%)</span>
                        </div>
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:var(--text-2);">Max Streak/Combo</span>
                            <span class="sd-stat-value" style="color:var(--accent);"> ${maxCombo}</span>
                        </div>
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:var(--text-2);">Tid spelat</span>
                            <span class="sd-stat-value" style="font-weight:700; color:var(--text-1);">⏱ ${timeSpent}s</span>
                        </div>
                        <div class="sd-stat-row sd-stat-highlight" style="display:flex; justify-content:space-between; border-bottom:1px solid var(--surface-3); padding:0.4rem 0; font-size:1.15rem; font-weight:800;">
                            <span class="sd-stat-label" style="color:var(--rate-2);">Slutpoäng</span>
                            <span class="sd-stat-value" style="color:var(--text-1);">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: var(--accent-soft); border: 1px dashed var(--accent); border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: var(--accent); margin-top:0.4rem;">
                                 NYTT REKORD! 
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="display:flex; justify-content:space-between; opacity: 0.7; padding-top:0.4rem;">
                                <span class="sd-stat-label" style="color:var(--text-3);">Rekord (${pbTitle})</span>
                                <span class="sd-stat-value" style="font-weight:700; color:var(--accent);"> ${personalBest}</span>
                            </div>
                        `}
                    </div>
                    
                    <div class="sd-end-actions" style="display:flex; gap:0.75rem; width:100%;">
                        <button id="action-btn-restart" class="btn primary" style="flex:1; padding:0.8rem; font-weight:700;">Spela igen</button>
                        <button id="action-btn-exit" class="btn secondary" style="flex:1; padding:0.8rem; font-weight:700;">Avsluta</button>
                    </div>
                </div>
            `;
            
            arena.querySelector('#action-btn-restart').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                restartGame();
            };
            arena.querySelector('#action-btn-exit').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                closeGame();
            };
            
            triggerConfetti();
        };

        const restartGame = () => {
            if (currentPhase !== 'end') return;
            currentPhase = 'restarting';
            cleanup();
            
            S.currentStudyCards = fisherYatesShuffle([...cards]);
            score = 0;
            combo = 0;
            maxCombo = 0;
            cardIdx = 0;
            totalPerfects = 0;
            totalHits = 0;
            totalWordsProcessed = 0;
            
            document.addEventListener('keydown', handleGlobalKeydown);
            startThinkPhase();
        };

        startThinkPhase();
    };
