import { stripHtml } from '../core/backup.js';
import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { processRating } from '../ui/study.js';


    export const lucktextReveal = () => {
        const cards = S.currentStudyCards;
        const startTimeSession = Date.now();

        let score = 0;
        let combo = 0;
        let maxCombo = 0;
        let cardIdx = 0;
        let totalCorrectBlanks = 0;
        let totalBlanks = 0;
        let totalPerfectCards = 0;

        const stripHtmlForLucktext = (html) => stripHtml(html).substring(0, 120);

        let pbKey = 'spaced_rep_lucktext_pb_all';
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
                pbKey = `spaced_rep_lucktext_pb_${singleDeckId}`;
                pbTitle = deckObj ? deckObj.title : 'Fokusområde';
            } else {
                pbKey = `spaced_rep_lucktext_pb_focus_${Array.from(deckIds).sort().join('_')}`;
                pbTitle = 'Fokusområde';
            }
        }
        let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

        const STOPWORDS = new Set([
            'och','eller','som','att','den','det','de','en','ett','är','var','har','hade',
            'kan','ska','ville','med','för','från','till','vid','mot','över','under',
            'genom','efter','innan','utan','inte','inom','sedan','bland','samt','dock',
            'även','bara','också','redan','igen','alla','varje',
            'denna','detta','dessa','sin','sitt','sina','hans','hennes','dess','deras',
            'man','sig','oss','dem','dig','mig','hon','han','dom','vad','hur',
            'var','när','där','här','medan','fast','men','dels',
            'the','and','but','for','with','from','this','that','which','have','has',
            'been','were','will','would','could','should','into','about','than','then',
            'also','just','only','very','more','most','some','such','each','both',
            'does','did','being','having','other','blir','blev','vara',
            'finns','bara','mycket','många','andra','efter','hela',
            'a','an','i','is','it','of','on','or','to','be','so','no','do','if','my','up','us'
        ]);

        const scoreWord = (w, idx, totalWords, frontText) => {
            const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim();
            if (clean.length < 3) return -1;
            if (STOPWORDS.has(clean.toLowerCase())) return -1;
            let s = 0;
            if (/\d/.test(clean)) s += 30;
            if (idx > 0 && /^[A-ZÅÄÖ]/.test(clean)) s += 18;
            s += Math.min(clean.length, 14);
            if (/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(clean) && clean.length > 3) s += 10;
            const relPos = idx / Math.max(1, totalWords - 1);
            if (relPos > 0.1 && relPos < 0.9) s += 5;
            if (clean.length <= 3) s -= 5;
            if (frontText && frontText.toLowerCase().includes(clean.toLowerCase())) s += 12;
            if (/[åäöÅÄÖ]/.test(clean)) s += 3;
            if (clean.length >= 8) s += 6;
            return s;
        };

        const selectBlanks = (text, frontText) => {
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const candidates = [];
            words.forEach((w, idx) => {
                const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim();
                const s = scoreWord(w, idx, words.length, frontText);
                if (s > 0) candidates.push({ original: w, clean, index: idx, score: s });
            });

            const progressBonus = Math.floor(cardIdx / 2); // 0,0,1,1,2,2,3,3...
            const targetBlanks = Math.max(2, Math.min(8, Math.round(words.length / 20) + progressBonus));
            candidates.sort((a, b) => b.score - a.score);
            const chosen = [];
            const minGap = Math.max(2, Math.floor(words.length / (targetBlanks + 2)));

            for (const c of candidates) {
                if (chosen.length >= targetBlanks) break;
                if (!chosen.some(ch => Math.abs(ch.index - c.index) < minGap)) chosen.push(c);
            }
            if (chosen.length < Math.min(targetBlanks, candidates.length)) {
                for (const c of candidates) {
                    if (chosen.length >= targetBlanks) break;
                    if (!chosen.some(ch => ch.index === c.index)) chosen.push(c);
                }
            }
            chosen.sort((a, b) => a.index - b.index);
            return { words, chosen };
        };

        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay cinema-overlay--game lucktext-game-overlay';

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-flash"></div>
            <button class="lucktext-close-btn" id="lt-close-btn" title="Avsluta (Esc)">&times;</button>
            <div class="cinema-content" style="width:95%; max-width:800px; height:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding: 12vh 0 10vh; position:relative; z-index:5; align-self:center; margin:0 auto;">
                <div class="arena-top lucktext-hud">
                    <span class="arena-meta num">
                        <span id="lt-score">0 p</span>
                        <span id="lt-combo" class="arena-combo">x0</span>
                    </span>
                    <span class="arena-meta num">
                        <span id="lt-pb">Rekord ${personalBest}</span>
                        <span class="arena-sep" aria-hidden="true"></span>
                        <span id="lt-progress">${cardIdx + 1} av ${cards.length}</span>
                    </span>
                </div>
                <div id="lt-arena" class="lucktext-arena"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        overlay.querySelector('#lt-close-btn').onclick = (e) => { e.stopPropagation(); closeGame(); };

        const arena = overlay.querySelector('#lt-arena');
        const scoreHUD = overlay.querySelector('#lt-score');
        const comboHUD = overlay.querySelector('#lt-combo');
        const progressHUD = overlay.querySelector('#lt-progress');

        const updateHUD = () => {
            scoreHUD.textContent = `${score} p`;
            if (combo >= 2) {
                comboHUD.textContent = `x${combo}`;
                comboHUD.classList.add('is-on');
                comboHUD.classList.add('pulse');
                setTimeout(() => comboHUD.classList.remove('pulse'), 150);
            } else {
                comboHUD.classList.remove('is-on');
            }
            progressHUD.textContent = `${cardIdx + 1} av ${cards.length}`;
        };

        const triggerFlash = () => {
            const flash = overlay.querySelector('.cinema-flash');
            if (flash) {
                flash.classList.add('flash-active');
                setTimeout(() => flash.classList.remove('flash-active'), 120);
            }
        };

        const triggerConfetti = () => {
            const colors = ['var(--accent)', 'var(--accent)', 'var(--accent)', 'var(--accent)', 'var(--accent)'];
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

        let currentPhase = 'intro';
        let memorizeTimerHandle = null;

        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
                return;
            }
            if (e.key === ' ' || e.key === 'Enter') {
                if (currentPhase === 'intro') {
                    e.preventDefault();
                    startMemorizePhase();
                } else if (currentPhase === 'end' && e.key === 'Enter') {
                    e.preventDefault();
                    closeGame();
                }
            }
            if (currentPhase === 'review' && ['1','2','3','4'].includes(e.key)) {
                e.preventDefault();
                submitCardRating(parseInt(e.key, 10));
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        const cleanup = () => {
            clearTimeout(memorizeTimerHandle);
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

        const restartGame = () => {
            if (currentPhase !== 'end') return;
            currentPhase = 'restarting';
            cleanup();

            S.currentStudyCards = fisherYatesShuffle([...cards]);
            score = 0;
            combo = 0;
            maxCombo = 0;
            cardIdx = 0;
            totalCorrectBlanks = 0;
            totalBlanks = 0;
            totalPerfectCards = 0;

            document.addEventListener('keydown', handleGlobalKeydown);
            startMemorizePhase();
        };

        const showIntro = () => {
            currentPhase = 'intro';
            arena.innerHTML = `
                <div class="lucktext-card">
                    <h1 class="lucktext-title">LUCKTEXT</h1>
                    <p class="lucktext-subtitle">Memorera svaret. Fyll i luckorna. Bygg combo.</p>
                    <p class="lucktext-subtitle" style="font-size:0.95rem; color:var(--text-3);">
                        ${cards.length} kort väntar. Du får se svaret, sedan göms nyckelord som du fyller i ur minnet.
                        Rätt svar i rad ger combo-multiplikator!
                    </p>
                    <div class="lucktext-controls-info">
                        <strong>KONTROLLER:</strong><br/>
                        &bull; Enter : Kontrollera svar<br/>
                        &bull; Tab : Nästa lucka<br/>
                        &bull; 1–4 : Betygsätt kort (Igen, Svår, Bra, Enkel)<br/>
                        &bull; Esc : Avsluta
                    </div>
                    <button id="lt-btn-start" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">STARTA</button>
                </div>
            `;
            arena.querySelector('#lt-btn-start').onclick = (e) => {
                e.stopPropagation();
                startMemorizePhase();
            };
        };

        const startMemorizePhase = () => {
            if (currentPhase === 'memorize') return;
            if (cardIdx >= cards.length) { showEndScreen(); return; }
            currentPhase = 'memorize';
            updateHUD();

            const card = cards[cardIdx];
            const backHtml = typeof safeParse === 'function' ? safeParse(card.back) : card.back;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = backHtml;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length;
            const timerDuration = Math.max(5, Math.min(25, Math.round(wordCount * 0.8)));

            arena.innerHTML = `
                <div class="lucktext-card">
                    <div class="lucktext-card-header">FRÅGA</div>
                    <div class="lucktext-text-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <div class="lucktext-card-header" style="color: var(--accent); margin-top: 1rem;">MEMORERA SVARET</div>
                    <div id="lt-memorize-text" class="lucktext-text-memorize">${backHtml}</div>
                    <div class="lucktext-timer-container">
                        <div id="lt-timer-fill" class="lucktext-timer-fill" style="transition: transform ${timerDuration}s linear;"></div>
                    </div>
                    <div class="lucktext-timer-label">${timerDuration}s att memorera</div>
                    <button id="lt-btn-ready" class="btn primary lg lucktext-btn-ready">Jag är redo &mdash; visa luckor</button>
                </div>
            `;

            const memText = arena.querySelector('#lt-memorize-text');
            renderLatex(memText);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(memText, card.backImages);

            const questionDiv = arena.querySelector('.lucktext-text-question');
            renderLatex(questionDiv);

            const textLength = plainText.length;
            if (textLength > 400) memText.style.fontSize = '1.1rem';
            else if (textLength > 200) memText.style.fontSize = '1.35rem';

            const timerFill = arena.querySelector('#lt-timer-fill');
            requestAnimationFrame(() => { timerFill.style.transform = 'scaleX(0)'; });

            arena.querySelector('#lt-btn-ready').onclick = (e) => {
                e.stopPropagation();
                clearTimeout(memorizeTimerHandle);
                startBlankPhase();
            };

            memorizeTimerHandle = setTimeout(() => startBlankPhase(), timerDuration * 1000);
        };

        const startBlankPhase = () => {
            if (currentPhase !== 'memorize') return;
            if (!document.getElementById('cinema-overlay')) return;
            currentPhase = 'blank';

            const card = cards[cardIdx];
            const backHtml = typeof safeParse === 'function' ? safeParse(card.back) : card.back;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = backHtml;
            renderLatex(tempDiv);

            const getNonMathText = (element) => {
                let text = '';
                const traverse = (node) => {
                    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
                    else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) return;
                        Array.from(node.childNodes).forEach(traverse);
                    }
                };
                traverse(element);
                return text;
            };

            const plainText = getNonMathText(tempDiv);
            const frontPlain = stripHtmlForLucktext(card.front);
            const { chosen } = selectBlanks(plainText, frontPlain);

            if (chosen.length === 0) {
                startReviewPhase(0, 0);
                return;
            }

            totalBlanks += chosen.length;

            arena.innerHTML = `
                <div class="lucktext-card">
                    <div class="lucktext-card-header">FRÅGA</div>
                    <div class="lucktext-text-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <div class="lucktext-card-header" style="margin-top: 1rem;">FYLL I LUCKORNA</div>
                    <div id="lt-blank-text" class="lucktext-text-memorize" style="font-size: 1.4rem; font-weight: 400;">${backHtml}</div>
                    <button id="lt-btn-check" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">Kontrollera [Enter]</button>
                </div>
            `;

            const questionDiv = arena.querySelector('.lucktext-text-question');
            renderLatex(questionDiv);

            const blankText = arena.querySelector('#lt-blank-text');
            renderLatex(blankText);

            const textLength = plainText.length;
            if (textLength > 400) blankText.style.fontSize = '1.05rem';
            else if (textLength > 200) blankText.style.fontSize = '1.2rem';

            const insertInputs = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (text.trim() === '') return;
                    const parent = node.parentNode;
                    const wordsList = text.split(/(\s+)/);
                    const fragment = document.createDocumentFragment();
                    wordsList.forEach(w => {
                        if (/^\s+$/.test(w)) {
                            fragment.appendChild(document.createTextNode(w));
                        } else if (w.length > 0) {
                            const cleanW = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim().toLowerCase();
                            const chosenIdx = chosen.findIndex(c => !c._placed && c.clean.toLowerCase() === cleanW);
                            if (chosenIdx !== -1) {
                                chosen[chosenIdx]._placed = true;
                                const hint = chosen[chosenIdx].clean[0];
                                const input = document.createElement('input');
                                input.type = 'text';
                                input.className = 'lucktext-inline-input';
                                input.dataset.idx = String(chosenIdx);
                                input.placeholder = hint + '…';
                                input.autocomplete = 'off';
                                input.spellcheck = false;
                                input.style.width = `${Math.max(4, cleanW.length) * 0.72}em`;
                                input.addEventListener('keydown', (e) => {
                                    if (e.key === 'Tab') {
                                        e.preventDefault();
                                        const allInputs = [...arena.querySelectorAll('.lucktext-inline-input')];
                                        const cur = allInputs.indexOf(input);
                                        const next = allInputs[cur + (e.shiftKey ? -1 : 1)];
                                        if (next) next.focus();
                                    }
                                });
                                fragment.appendChild(input);
                            } else {
                                fragment.appendChild(document.createTextNode(w));
                            }
                        }
                    });
                    parent.replaceChild(fragment, node);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) return;
                    Array.from(node.childNodes).forEach(child => insertInputs(child));
                }
            };

            insertInputs(blankText);
            setTimeout(() => arena.querySelector('.lucktext-inline-input')?.focus(), 50);

            let submitted = false;
            const checkAnswers = () => {
                if (submitted) return;
                submitted = true;

                let correctCount = 0;
                chosen.forEach((item, cIdx) => {
                    const input = arena.querySelector(`.lucktext-inline-input[data-idx="${cIdx}"]`);
                    if (!input) return;
                    const inputVal = input.value.trim().toLowerCase();
                    const correctVal = item.clean.toLowerCase();

                    if (inputVal === correctVal) {
                        correctCount++;
                        combo++;
                        if (combo > maxCombo) maxCombo = combo;
                        const gained = Math.round(50 * (1 + (combo - 1) * 0.15));
                        score += gained;
                        input.classList.add('correct');
                        input.value = item.clean;
                    } else {
                        combo = 0;
                        input.classList.add('wrong');
                        input.value = inputVal ? `${inputVal} → ${item.clean}` : item.clean;
                    }
                    input.disabled = true;
                });

                totalCorrectBlanks += correctCount;
                if (correctCount === chosen.length) totalPerfectCards++;
                updateHUD();

                if (correctCount === chosen.length) triggerFlash();

                startReviewPhase(correctCount, chosen.length);
            };

            arena.querySelector('#lt-btn-check').addEventListener('click', checkAnswers);
            overlay.addEventListener('keydown', function enterHandler(e) {
                if (e.key === 'Enter' && currentPhase === 'blank' && !submitted) {
                    e.preventDefault();
                    checkAnswers();
                    overlay.removeEventListener('keydown', enterHandler);
                }
            });
        };

        const startReviewPhase = (correctCount, blankCount) => {
            if (currentPhase !== 'blank') return;
            currentPhase = 'review';

            const pct = blankCount > 0 ? Math.round((correctCount / blankCount) * 100) : 100;

            let feedbackClass, feedbackText;
            if (pct === 100) { feedbackClass = 'perfect'; feedbackText = `<span style="color:var(--accent); font-weight:800;">PERFEKT! ${correctCount}/${blankCount}</span>`; }
            else if (pct >= 50) { feedbackClass = 'partial'; feedbackText = `<span style="color:var(--accent); font-weight:800;">${correctCount}/${blankCount} rätt (${pct}%)</span>`; }
            else { feedbackClass = 'low'; feedbackText = `<span style="color:var(--danger); font-weight:800;">${correctCount}/${blankCount} rätt (${pct}%)</span>`; }

            const existingCard = arena.querySelector('.lucktext-card');
            if (existingCard) {
                const checkBtn = existingCard.querySelector('#lt-btn-check');
                if (checkBtn) checkBtn.remove();

                const resultDiv = document.createElement('div');
                resultDiv.className = `lucktext-result-feedback ${feedbackClass}`;
                resultDiv.innerHTML = feedbackText;
                existingCard.appendChild(resultDiv);

                const ratingDiv = document.createElement('div');
                ratingDiv.className = 'lucktext-rating-container';
                ratingDiv.innerHTML = '<div class="lucktext-rating-label">Betygsätt din hågkomst:</div>';

                const originalActions = document.getElementById('study-actions');
                const clonedActions = originalActions.cloneNode(true);
                clonedActions.id = 'lt-rating-actions';
                clonedActions.classList.remove('hidden');
                clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        btn.blur();
                        submitCardRating(parseInt(btn.getAttribute('data-rating'), 10));
                    });
                });
                ratingDiv.appendChild(clonedActions);
                existingCard.appendChild(ratingDiv);

                // No scrollIntoView — user hates scrolling
            }
        };

        const submitCardRating = (rating) => {
            if (currentPhase !== 'review') return;
            currentPhase = 'rating-submitted';

            S.currentStudyIndex = cardIdx;
            processRating(rating);
            cardIdx++;

            if (cardIdx >= cards.length) showEndScreen();
            else startMemorizePhase();
        };

        const showEndScreen = () => {
            if (currentPhase === 'end') return;
            currentPhase = 'end';
            clearTimeout(memorizeTimerHandle);

            const isNewPB = score > personalBest;
            if (isNewPB) {
                personalBest = score;
                localStorage.setItem(pbKey, score);
            }

            S.playgroundSessionStats.correct = totalCorrectBlanks;

            const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
            const blankPct = totalBlanks > 0 ? Math.round((totalCorrectBlanks / totalBlanks) * 100) : 0;

            arena.innerHTML = `
                <div class="lucktext-card" style="border-color:var(--accent-line); background: var(--surface-1);">
                    <h2 class="lucktext-title" style="font-size:var(--t-2xl);">KLART!</h2>
                    <p style="color: var(--text-2); margin: 0; font-size: 0.95rem;">
                        ${cards.length} kort avklarade
                    </p>

                    <div style="width:100%; display:grid; gap:0.6rem; margin:1rem 0;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span style="color:var(--text-2);">Luckor rätt</span>
                            <span style="font-weight:700; color:var(--text-1);">${totalCorrectBlanks} / ${totalBlanks} (${blankPct}%)</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span style="color:var(--text-2);">Perfekta kort</span>
                            <span style="font-weight:700; color:var(--accent);">${totalPerfectCards} / ${cards.length}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span style="color:var(--text-2);">Max combo</span>
                            <span style="font-weight:700; color:var(--accent);">x${maxCombo}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:0.4rem;">
                            <span style="color:var(--text-2);">Tid</span>
                            <span style="font-weight:700; color:var(--text-1);">${timeSpent}s</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; padding:0.5rem 0; font-size:1.15rem; font-weight:800; border-bottom:1px solid var(--accent-soft);">
                            <span style="color:var(--accent);">Slutpoäng</span>
                            <span style="color:var(--text-1);">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: var(--accent-soft); border: 1px dashed var(--accent); border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: var(--accent); margin-top:0.4rem;">
                                NYTT REKORD!
                            </div>
                        ` : `
                            <div style="display:flex; justify-content:space-between; opacity: 0.7; padding-top:0.4rem;">
                                <span style="color:var(--text-3);">Rekord (${pbTitle})</span>
                                <span style="font-weight:700; color:var(--accent);">${personalBest}</span>
                            </div>
                        `}
                    </div>

                    <div style="display:flex; gap:0.75rem; width:100%;">
                        <button id="lt-btn-restart" class="btn primary" style="flex:1; padding:0.8rem; font-weight:700;">Spela igen</button>
                        <button id="lt-btn-exit" class="btn secondary" style="flex:1; padding:0.8rem; font-weight:700;">Avsluta</button>
                    </div>
                </div>
            `;

            arena.querySelector('#lt-btn-restart').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                restartGame();
            };
            arena.querySelector('#lt-btn-exit').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                closeGame();
            };

            triggerConfetti();
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.study-actions')) return;
            if (currentPhase === 'intro') startMemorizePhase();
        });

        startMemorizePhase();
    };
