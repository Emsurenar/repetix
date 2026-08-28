import { stripHtml } from '../core/backup.js';
import { S } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';


// --- FRITEXT SESSION OVERLAY ---
export const fritextSessionReveal = () => {
    const cards = S.currentStudyCards;
    let cardIdx = 0;
    let totalScore = 0;
    let totalKeywords = 0;
    let totalMatched = 0;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const extractKeywords = (text) => {
        const stopWords = new Set(['och','i','på','av','en','ett','den','det','de','är','var','som','med','för','till','att','har','kan','ska','inte','om','vid','från','eller','men','denna','dessa','sin','sitt','sina','han','hon','vi','ni','dem','sig','alla','andra','efter','under','över','mellan','utan','bara','mer','så','också','redan','genom','sedan','dock','även','mot','hos','ur','bland','inom','samt','vars','där','här','hur','när','vad','vem','vilken','vilket','vilka']);
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/).filter(w => w.length > 0);
        const keywords = [];
        words.forEach(w => {
            const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]…–—]/g, '').trim();
            if (clean.length >= 3 && !stopWords.has(clean.toLowerCase())) {
                keywords.push({ original: w, lower: clean.toLowerCase(), found: false, score: clean.length });
            }
        });
        keywords.sort((a, b) => b.score - a.score);
        return keywords.slice(0, Math.max(5, Math.ceil(keywords.length * 0.3)));
    };

    const fuzzyMatch = (input, target) => {
        if (input === target) return true;
        if (input.length < 3 || target.length < 3) return input === target;
        if (Math.abs(input.length - target.length) > 2) return false;
        let dist = 0;
        for (let i = 0; i < Math.max(input.length, target.length); i++) {
            if (input[i] !== target[i]) dist++;
            if (dist > 2) return false;
        }
        return true;
    };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];
        const realAnswer = stripHtml(card.back || '');
        const sentences = realAnswer.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
        const wordCount = realAnswer.split(/\s+/).length;
        const hintText = `Cirka ${wordCount} ord, ${Math.max(1, sentences.length)} ${sentences.length === 1 ? 'mening' : 'meningar'}`;

        overlay.innerHTML = `
            <div class="arena">
                <div class="arena-top">
                    <span class="micro">Fritext</span>
                    <span class="arena-meta num">${cardIdx + 1} av ${cards.length}</span>
                </div>
                <div class="arena-body">
                    <p class="micro">Fråga</p>
                    <div id="ft-question" class="arena-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <p class="arena-hint">${hintText}</p>
                    <textarea id="ft-textarea" class="arena-input" placeholder="Skriv ditt svar ur minnet" spellcheck="false"></textarea>
                </div>
                <div class="arena-foot arena-foot--center">
                    <button id="ft-submit" class="btn primary lg">Rätta <span class="kbd">⌘↵</span></button>
                </div>
            </div>
        `;
        renderLatex(overlay.querySelector('#ft-question'));
        const textarea = overlay.querySelector('#ft-textarea');
        setTimeout(() => textarea.focus(), 100);

        let submitted = false;
        const doSubmit = () => {
            if (submitted) return;
            submitted = true;

            const userText = textarea.value.trim();
            const keywords = extractKeywords(realAnswer);
            const userLower = userText.toLowerCase();
            const userWords = userText.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase()).filter(w => w.length > 0);

            let matched = 0;
            keywords.forEach(kw => {
                kw.found = userWords.some(uw => fuzzyMatch(uw, kw.lower)) || userLower.includes(kw.lower);
                if (kw.found) matched++;
            });
            const total = keywords.length || 1;
            const pct = Math.round((matched / total) * 100);
            totalScore += pct;
            totalKeywords += total;
            totalMatched += matched;

            if (pct >= 50) S.playgroundSessionStats.correct++;
            else S.playgroundSessionStats.again++;

            const kwHtml = keywords.map(kw => `<span class="arena-keyword${kw.found ? ' is-found' : ''}">${escapeHtml(kw.original)}</span>`).join('');

            overlay.innerHTML = `
                <div class="arena">
                    <div class="arena-top">
                        <span class="micro">Fritext</span>
                        <span class="arena-meta num">${cardIdx + 1} av ${cards.length}</span>
                    </div>
                    <div class="arena-score-row">
                        <span class="arena-score-n num${pct >= 50 ? ' is-good' : ' is-bad'}">${pct}%</span>
                        <span class="arena-score-l">${matched} av ${total} nyckelbegrepp</span>
                    </div>
                    <div class="arena-keywords">${kwHtml}</div>
                    <div class="arena-body">
                        <p class="micro">Ditt svar</p>
                        <div class="arena-plain">${escapeHtml(userText || '(tomt)')}</div>
                        <p class="micro">Rätt svar</p>
                        <div id="ft-real" class="arena-answer">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                        <p class="arena-hint"><span class="kbd">Space</span> nästa kort</p>
                    </div>
                </div>
            `;
            const realEl = overlay.querySelector('#ft-real');
            renderLatex(realEl);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(realEl, card.backImages);

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showCard();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#ft-submit').onclick = doSubmit;
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitted) { e.preventDefault(); doSubmit(); }
        });
    };

    const showEnd = () => {
        cleanup();
        const avgPct = cards.length > 0 ? Math.round(totalScore / cards.length) : 0;
        overlay.innerHTML = `
            <div class="arena arena--end">
                <p class="micro">Fritext</p>
                <h2 class="arena-end-title">Klart</h2>
                <dl class="arena-stats">
                    <div><dt>Kort</dt><dd class="num">${cards.length}</dd></div>
                    <div><dt>Nyckelbegrepp</dt><dd class="num">${totalMatched} av ${totalKeywords}</dd></div>
                    <div><dt>Snittresultat</dt><dd class="num">${avgPct}%</dd></div>
                </dl>
                <div class="arena-end-actions"><button id="ft-exit" class="btn">Avsluta</button></div>
            </div>
        `;
        overlay.querySelector('#ft-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
