import { S } from '../core/state.js';
import { renderLatex } from '../ui/latex.js';
import { processRating, renderStudyCard } from '../ui/study.js';
import { showToast } from '../ui/toast.js';


    export const fritextReveal = () => {
        const card = S.currentStudyCards[S.currentStudyIndex];
        if (!card) return;

        const studyBack = document.getElementById('study-back-text');
        const studyFront = document.getElementById('study-front-text');
        const realAnswer = studyBack.innerText.trim();
        const questionHtml = studyFront.innerHTML;

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
            'does','did','being','having','other','blir','blev','vara'
        ]);

        const extractKeywords = (text) => {
            const words = text.split(/\s+/);
            const keywords = [];
            const seen = new Set();
            words.forEach(w => {
                const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim();
                if (clean.length < 2) return;
                const lower = clean.toLowerCase();
                if (STOPWORDS.has(lower) || seen.has(lower)) return;
                seen.add(lower);

                let score = clean.length;
                if (/\d/.test(clean)) score += 20;
                if (/^[A-ZÅÄÖ]/.test(clean)) score += 10;
                if (clean.length >= 6) score += 5;
                keywords.push({ word: clean, lower, score });
            });
            keywords.sort((a, b) => b.score - a.score);
            return keywords;
        };

        const fuzzyMatch = (input, target) => {
            if (input === target) return true;
            if (input.length < 3 || target.length < 3) return input === target;
            if (Math.abs(input.length - target.length) > 2) return false;
            let dist = 0;
            const maxLen = Math.max(input.length, target.length);
            for (let i = 0; i < maxLen; i++) {
                if (input[i] !== target[i]) dist++;
                if (dist > 2) return false;
            }
            return true;
        };

        const sentences = realAnswer.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
        const wordCount = realAnswer.split(/\s+/).length;
        const hintText = `Cirka ${wordCount} ord, ${Math.max(1, sentences.length)} ${sentences.length === 1 ? 'mening' : 'meningar'}`;

        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay';
        overlay.style.background = 'rgba(10, 10, 10, 0.99)';

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:800px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;">
                <div style="font-size:0.85rem;font-weight:700;color:var(--primary-color);letter-spacing:0.05em;text-transform:uppercase;">FRITEXT: SKRIV UR MINNET</div>
                <div id="fritext-question" style="font-size:1.2rem;color:#ccc;text-align:center;line-height:1.5;padding:0.75rem 1rem;background:rgba(255,255,255,0.04);border-radius:var(--radius-md);width:100%;max-height:15vh;overflow-y:auto;"></div>
                <div id="fritext-phase-write" style="width:100%;display:flex;flex-direction:column;gap:1rem;align-items:center;">
                    <div style="font-size:0.8rem;color:rgba(255,255,255,0.35);font-style:italic;">${hintText}</div>
                    <textarea id="fritext-textarea" placeholder="Skriv ditt svar här..." style="width:100%;min-height:180px;max-height:40vh;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-md);color:#fff;font-family:inherit;font-size:1rem;line-height:1.6;padding:1rem;outline:none;resize:vertical;" spellcheck="false"></textarea>
                    <button id="btn-fritext-submit" class="btn primary" style="width:100%;max-width:400px;padding:0.8rem;">Visa svar</button>
                </div>
                <div id="fritext-phase-compare" class="hidden" style="width:100%;display:flex;flex-direction:column;gap:1.25rem;">
                    <div style="display:flex;gap:0.5rem;align-items:center;justify-content:center;">
                        <span id="fritext-score" style="font-size:1.5rem;font-weight:700;color:var(--primary-color);"></span>
                        <span id="fritext-score-label" style="font-size:0.9rem;color:rgba(255,255,255,0.6);"></span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div>
                            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Ditt svar</div>
                            <div id="fritext-user-answer" style="font-size:0.95rem;color:rgba(255,255,255,0.7);line-height:1.6;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-md);max-height:30vh;overflow-y:auto;white-space:pre-wrap;"></div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Rätt svar</div>
                            <div id="fritext-real-answer" style="font-size:0.95rem;color:#fff;line-height:1.6;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-md);max-height:30vh;overflow-y:auto;"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="cinema-actions" class="cinema-actions"></div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        const closeOverlay = () => {
            document.removeEventListener('keydown', handleGlobalKeydown);
            overlay.remove();
        };

        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeOverlay();
                // Reset card UI to front if they abort
                document.getElementById('study-actions').classList.add('hidden');
                document.getElementById('study-flip-action').classList.remove('hidden');
                const inner = document.getElementById('flashcard-inner');
                if (inner) inner.classList.remove('flipped');
                return;
            }
            if (submitted && ['1','2','3','4'].includes(e.key)) {
                e.preventDefault();
                processRating(parseInt(e.key, 10));
                closeOverlay();
                renderStudyCard();
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        const qEl = overlay.querySelector('#fritext-question');
        qEl.innerHTML = questionHtml;
        renderLatex(qEl);

        const textarea = overlay.querySelector('#fritext-textarea');
        setTimeout(() => textarea.focus(), 100);

        const submitBtn = overlay.querySelector('#btn-fritext-submit');
        let submitted = false;

        const doSubmit = () => {
            if (submitted) return;
            submitted = true;

            const userText = textarea.value.trim();
            const keywords = extractKeywords(realAnswer);
            const userLower = userText.toLowerCase();
            const userWords = userText.split(/\s+/).map(w =>
                w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase()
            ).filter(w => w.length > 0);

            let matched = 0;
            keywords.forEach(kw => {
                kw.found = userWords.some(uw => fuzzyMatch(uw, kw.lower)) || userLower.includes(kw.lower);
                if (kw.found) matched++;
            });

            const total = keywords.length || 1;
            const pct = Math.round((matched / total) * 100);

            overlay.querySelector('#fritext-phase-write').classList.add('hidden');
            overlay.querySelector('#fritext-phase-compare').classList.remove('hidden');

            const scoreEl = overlay.querySelector('#fritext-score');
            scoreEl.textContent = `${pct}%`;
            scoreEl.style.color = pct >= 80 ? '#34A853' : pct >= 50 ? '#FBBC04' : '#EA4335';
            overlay.querySelector('#fritext-score-label').textContent = `${matched} av ${total} nyckelbegrepp`;

            const userAnswerEl = overlay.querySelector('#fritext-user-answer');
            userAnswerEl.textContent = userText || '(tomt)';

            const realAnswerEl = overlay.querySelector('#fritext-real-answer');
            const realHtml = studyBack.innerHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = realHtml;

            const highlightTextNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (!text.trim()) return;
                    const parent = node.parentNode;
                    const parts = text.split(/(\s+)/);
                    const fragment = document.createDocumentFragment();
                    parts.forEach(part => {
                        if (/^\s+$/.test(part)) {
                            fragment.appendChild(document.createTextNode(part));
                            return;
                        }
                        const clean = part.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase();
                        const kw = keywords.find(k => k.lower === clean);
                        if (kw) {
                            const span = document.createElement('span');
                            span.textContent = part;
                            if (kw.found) {
                                span.style.cssText = 'color:#85e8a5;font-weight:600;';
                            } else {
                                span.style.cssText = 'color:#ff8f8f;text-decoration:underline;text-decoration-style:wavy;text-underline-offset:3px;';
                            }
                            fragment.appendChild(span);
                        } else {
                            fragment.appendChild(document.createTextNode(part));
                        }
                    });
                    parent.replaceChild(fragment, node);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display'))) return;
                    Array.from(node.childNodes).forEach(highlightTextNode);
                }
            };
            highlightTextNode(tempDiv);
            realAnswerEl.innerHTML = tempDiv.innerHTML;
            renderLatex(realAnswerEl);

            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'cinema-study-actions';
            clonedActions.classList.remove('hidden');
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    processRating(parseInt(btn.getAttribute('data-rating')));
                    closeOverlay();
                    renderStudyCard();
                });
            });
            const cinemaActions = overlay.querySelector('#cinema-actions');
            cinemaActions.appendChild(clonedActions);
            cinemaActions.classList.add('visible');

            showToast(pct >= 80 ? 'Starkt! Du kom ihåg det mesta.' : pct >= 50 ? 'Halvvägs där. Läs igenom det du missade.' : 'Repetera detta kort extra.');
        };

        submitBtn.addEventListener('click', doSubmit);
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitted) {
                e.preventDefault();
                doSubmit();
            }
        });
    };
