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
    overlay.style.background = 'radial-gradient(ellipse at center, #1b0035 0%, #0d001f 60%, #050010 100%)';

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
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="color:#A855F7;">FRITEXT</span>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(168,85,247,0.6);font-weight:700;">Fråga</div>
                <div id="ft-question" style="font-size:1.2rem;font-weight:600;color:#fff;text-align:center;line-height:1.4;width:100%;padding:0.75rem;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);font-style:italic;">${hintText}</div>
                <textarea id="ft-textarea" placeholder="Skriv ditt svar här..." style="width:100%;min-height:120px;max-height:30vh;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:inherit;font-size:1rem;line-height:1.5;padding:0.75rem;outline:none;resize:vertical;" spellcheck="false"></textarea>
                <button id="ft-submit" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;">Visa svar ⌘↵</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
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

            const kwHtml = keywords.map(kw => `<span style="display:inline-block;padding:0.2rem 0.5rem;border-radius:6px;font-size:0.8rem;font-weight:600;margin:0.15rem;${kw.found ? 'background:rgba(52,168,83,0.2);color:#34A853;border:1px solid rgba(52,168,83,0.3);' : 'background:rgba(234,67,53,0.1);color:rgba(234,67,53,0.7);border:1px solid rgba(234,67,53,0.2);'}">${escapeHtml(kw.original)}</span>`).join('');

            const content = overlay.querySelector('.cinema-content');
            content.innerHTML = `
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="font-size:1.3rem;font-weight:800;color:${pct >= 80 ? '#34A853' : pct >= 50 ? '#FBBC04' : '#EA4335'};">${pct}%</span>
                </div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);">${matched} av ${total} nyckelbegrepp</div>
                <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.1rem;width:100%;">${kwHtml}</div>
                <div style="width:100%;">
                    <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Ditt svar</div>
                    <div style="font-size:0.95rem;color:rgba(255,255,255,0.7);line-height:1.5;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;white-space:pre-wrap;">${escapeHtml(userText || '(tomt)')}</div>
                </div>
                <div style="width:100%;">
                    <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Rätt svar</div>
                    <div id="ft-real" style="font-size:0.95rem;color:#fff;line-height:1.5;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                </div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);font-style:italic;">Klicka eller [Space] → nästa kort</div>
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
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Russo One','Impact',sans-serif;font-size:2.2rem;color:#A855F7;margin:0;">KLART!</h2>
            <div class="sd-stats-grid" style="width:100%;max-width:400px;">
                <div class="sd-stat-row"><span class="sd-stat-label">Kort</span><span class="sd-stat-value">${cards.length}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Nyckelbegrepp</span><span class="sd-stat-value">${totalMatched} / ${totalKeywords}</span></div>
                <div class="sd-stat-row sd-stat-highlight"><span class="sd-stat-label">Snittresultat</span><span class="sd-stat-value">${avgPct}%</span></div>
            </div>
            <div class="sd-end-actions"><button id="ft-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#ft-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};
