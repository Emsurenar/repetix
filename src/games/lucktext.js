/* Lucktext — memorera svaret, fyll i nyckelorden.
 *
 * Läget var funktionellt men tamt: man fyllde i alla luckor, tryckte en gång
 * på Kontrollera och fick ett tal. En enda återkoppling per kort, ungefär var
 * trettionde sekund, och combon syntes först efteråt. Ombyggnaden flyttar
 * återkopplingen till varje enskild lucka och lägger in tre saker som gör att
 * man vill spela en gång till:
 *
 *   1. Varje lucka avgörs i samma stund man trycker Enter. Poängen stiger ur
 *      luckan, combon tickar upp i slisten. Belöningen kommer var tredje
 *      sekund i stället för var trettionde.
 *   2. Memoreringen är ett vad. Bonusen står och sjunker medan man läser, och
 *      låses när man säger "Jag kan det". Att lämna tidigt ger mer poäng och
 *      sämre minne — valet är hela spänningen.
 *   3. "Nästan" är en egen utgång. Ett stavfel ger halva poängen och bryter
 *      inte combon. Känslan av att nästan minnas ska belönas, inte straffas
 *      lika hårt som ett tomt fält.
 *
 * Svårigheten stiger i nivåer: fler luckor och längre ord ju längre in i
 * passet man kommer, och något kortare tid att läsa. Nivån står i slisten så
 * att stegringen är något man klättrar i, inte något som bara händer.
 */

import { stripHtml } from '../core/backup.js';
import { S } from '../core/state.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { renderCardBackImages, safeParse } from '../ui/images.js';
import { renderLatex } from '../ui/latex.js';
import { finishPlaygroundSession } from '../ui/playground.js';
import { oppnaSpelyta, stangSpelyta } from './spelyta.js';
import { processRating } from '../ui/study.js';

/* Poängen. Basen står kvar på 50 från den gamla versionen — talen i rekorden
 * som redan ligger i localStorage ska gå att jämföra med de nya. */
const POANG_LUCKA = 50;
const POANG_NASTAN = 25;
const COMBO_STEG = 0.15;
/* Combon är taket för hur mycket ett enda kort kan vara värt. Utan tak blir
 * ett långt pass ojämförbart med ett kort, och rekordet slutar betyda något. */
const COMBO_TAK = 3;
/* Hela den obrukade memoreringstiden är värd femtio procent extra. Mer än så
 * och det lönar sig att gissa i stället för att läsa. */
const TIDSBONUS_TAK = 0.5;
const PERFEKT_BONUS = 25;

const SKILJETECKEN = /[.,/#!$%^&*;:{}=_`~()?"'…–—«»„“”‘’-]/g;

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

const tvattaOrd = (w) => w.replace(SKILJETECKEN, '').trim();

/* Nivån stiger vartannat kort. Varannat vore för brant på en kort kortlek,
 * var tredje märks inte inom ett pass. */
const nivaFor = (kortIndex) => Math.floor(kortIndex / 2) + 1;

/* Fler luckor med nivån — men aldrig så många att svaret blir en gissningslek
 * utan sammanhang kvar att luta sig mot. */
const antalLuckorFor = (ordantal, niva) =>
    Math.max(2, Math.min(8, Math.round(ordantal / 20) + niva - 1));

/* Längre luckor med nivån. Ett fyrbokstavsord gissas ur sammanhanget; ett på
 * åtta måste faktiskt minnas. Taket finns för att inte tömma urvalet på korta
 * svar. */
const minOrdlangdFor = (niva) => Math.min(3 + Math.floor((niva - 1) / 2), 7);

/* Lästiden krymper långsamt. Femton procent kortare vid nivå fyra räcker för
 * att man ska känna sig jagad; golvet finns för att en lucka aldrig ska vara
 * omöjlig att ha hunnit se. */
const memoreringstidFor = (ordantal, niva) => {
    const bas = Math.max(5, Math.min(25, Math.round(ordantal * 0.8)));
    return Math.max(5, Math.round(bas * (1 - (niva - 1) * 0.05)));
};

/* Levenshtein med tak. Bara avståndet 1 eller 2 är intressant, så slingan
 * kunde avbrutits tidigare — men svaren är enstaka ord och matrisen är
 * försumbar bredvid att koden går att läsa. */
const redigeringsavstand = (a, b) => {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let forra = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const rad = [i];
        for (let j = 1; j <= b.length; j++) {
            const kostnad = a[i - 1] === b[j - 1] ? 0 : 1;
            rad[j] = Math.min(rad[j - 1] + 1, forra[j] + 1, forra[j - 1] + kostnad);
        }
        forra = rad;
    }
    return forra[b.length];
};

/* Tre utgångar i stället för två. Toleransen växer med ordlängden: på ett ord
 * med fyra bokstäver är ett tecken fel ett annat ord, på ett med tolv är det
 * ett stavfel.
 *
 * Två former godtas. Ledtråden står som ett eget märke framför fältet, och då
 * är "skriv hela ordet" och "skriv resten av det" samma svar — vilket man
 * väljer får inte avgöra om man hade rätt. Läget krävde tidigare hela ordet,
 * så den som läste den utskrivna bokstaven som given fick fel på ett svar hen
 * kunde. */
const bedomOrd = (skrivet, facit) => {
    const a = tvattaOrd(String(skrivet || '')).toLowerCase();
    const b = tvattaOrd(facit).toLowerCase();
    if (!a) return 'tomt';

    const former = b.length >= 3 ? [b, b.slice(1)] : [b];
    if (former.includes(a)) return 'ratt';

    for (const form of former) {
        const tolerans = form.length >= 8 ? 2 : form.length >= 5 ? 1 : 0;
        if (tolerans > 0 && redigeringsavstand(a, form) <= tolerans) return 'nastan';
    }
    return 'fel';
};

/* Rörelsen äger sin egen längd i CSS, och den som bett systemet om mindre
 * rörelse har noll där. Att läsa ut den i stället för att upprepa ett tal här
 * betyder att märket försvinner direkt för den användaren i stället för att
 * ligga kvar en halv sekund utan att någonsin ha rört sig. */
const rorelseMs = (el, egenskap) => {
    const varde = getComputedStyle(el)[egenskap];
    return (parseFloat(varde) || 0) * 1000;
};

const formateraTid = (sekunder) => {
    const m = Math.floor(sekunder / 60);
    const s = sekunder % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const formateraPoang = (n) => n.toLocaleString('sv-SE');

export const lucktextReveal = () => {
    const cards = S.currentStudyCards;
    /* Kopian är facit för en omstart. Kortlistan växer under passet:
     * processRating lägger tillbaka det man betygsatt "Igen" sist i kön. */
    const ursprungliga = [...cards];
    const startTimeSession = Date.now();

    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let cardIdx = 0;
    let totalCorrectBlanks = 0;
    let totalNastan = 0;
    let totalBlanks = 0;
    let totalPerfectCards = 0;
    let niva = 1;
    /* Låses när man lämnar memoreringen och gäller kortets alla luckor. */
    let tidsbonus = 1;

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
    /* Combon är ett eget rekord. Poängen belönar ett långt pass, combon
     * belönar precision — två olika saker att jaga i samma kortlek. */
    const comboKey = `${pbKey}_combo`;
    let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);
    let comboBest = parseInt(localStorage.getItem(comboKey) || '0', 10);

    const scoreWord = (w, idx, totalWords, frontText) => {
        const clean = tvattaOrd(w);
        if (clean.length < 3) return -1;
        if (STOPWORDS.has(clean.toLowerCase())) return -1;
        let s = 0;
        if (/\d/.test(clean)) s += 30;
        if (idx > 0 && /^[A-ZÅÄÖ]/.test(clean)) s += 18;
        s += Math.min(clean.length, 14);
        if (/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(clean) && clean.length > 3) s += 10;
        const relPos = idx / Math.max(1, totalWords - 1);
        if (relPos > 0.1 && relPos < 0.9) s += 5;
        if (frontText && frontText.toLowerCase().includes(clean.toLowerCase())) s += 12;
        if (/[åäöÅÄÖ]/.test(clean)) s += 3;
        if (clean.length >= 8) s += 6;
        return s;
    };

    const selectBlanks = (text, frontText) => {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const alla = [];
        words.forEach((w, idx) => {
            const clean = tvattaOrd(w);
            const s = scoreWord(w, idx, words.length, frontText);
            if (s > 0) alla.push({ original: w, clean, index: idx, score: s });
        });

        const targetBlanks = antalLuckorFor(words.length, niva);

        /* Nivåns längdkrav får aldrig göra kortet tomt på luckor. Räcker inte
         * de långa orden till släpps kravet, hellre en lätt lucka än ingen. */
        const minLangd = minOrdlangdFor(niva);
        const langa = alla.filter(c => c.clean.length >= minLangd);
        const candidates = langa.length >= targetBlanks ? langa : alla;

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

    /* Vägen ut ligger till vänster i slisten, som i repetitionen. Läget hade
     * ett kryss i skärmens hörn — en annan utgång på ett annat ställe än den
     * man just lärt sig var appens. */
    overlay.innerHTML = `
        <div class="cinema-content lucktext-scen">
            <div class="arena-top lucktext-hud">
                <span class="lucktext-hud-vanster num">
                    <button id="lt-close-btn" class="lucktext-stang" type="button" aria-label="Avsluta (Esc)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <span id="lt-score" class="lucktext-poang">0</span>
                    <span id="lt-combo" class="lucktext-combo">&times;0</span>
                </span>
                <span class="arena-meta num">
                    <span id="lt-niva" class="lucktext-niva">Nivå 1</span>
                    <span class="arena-sep" aria-hidden="true"></span>
                    <span id="lt-pb">Rekord ${formateraPoang(personalBest)}</span>
                    <span class="arena-sep" aria-hidden="true"></span>
                    <span id="lt-progress">1 av ${cards.length}</span>
                </span>
            </div>
            <div id="lt-arena" class="lucktext-arena"></div>
        </div>
    `;

    oppnaSpelyta(overlay);

    const arena = overlay.querySelector('#lt-arena');
    const scoreHUD = overlay.querySelector('#lt-score');
    const comboHUD = overlay.querySelector('#lt-combo');
    const progressHUD = overlay.querySelector('#lt-progress');
    const nivaHUD = overlay.querySelector('#lt-niva');

    overlay.querySelector('#lt-close-btn').onclick = (e) => { e.stopPropagation(); closeGame(); };

    /* En klass som redan sitter startar inte om animeringen. Den måste tas
     * bort, layouten läsas, och klassen läggas på igen. */
    const spelaOm = (el, klass) => {
        if (!el) return;
        el.classList.remove(klass);
        void el.offsetWidth;
        el.classList.add(klass);
        const ms = rorelseMs(el, 'animationDuration');
        setTimeout(() => el.classList.remove(klass), ms);
    };

    const updateHUD = () => {
        scoreHUD.textContent = formateraPoang(score);
        comboHUD.innerHTML = `&times;${combo}`;
        comboHUD.classList.toggle('is-on', combo >= 2);
        comboHUD.classList.toggle('is-het', combo >= 5);
        progressHUD.textContent = `${Math.min(cardIdx + 1, cards.length)} av ${cards.length}`;
        nivaHUD.textContent = `Nivå ${niva}`;
    };

    let currentPhase = 'memorize';
    let memorizeRAF = null;

    const handleGlobalKeydown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }
        if (currentPhase === 'end' && e.key === 'Enter') {
            /* Enter startar om i stället för att avsluta. Den som just sett
             * hur nära rekordet låg ska inte behöva leta efter knappen. */
            e.preventDefault();
            restartGame();
            return;
        }
        if (currentPhase === 'blank' && e.key === 'Enter') {
            /* Fokus kan ha hamnat utanför fälten. Enter tar en tillbaka in i
             * spelet i stället för att inte göra något. */
            const iFalt = document.activeElement?.classList?.contains('lucktext-inline-input');
            if (!iFalt) {
                e.preventDefault();
                arena.querySelector('.lucktext-inline-input')?.focus();
            }
            return;
        }
        if (currentPhase === 'review' && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            submitCardRating(parseInt(e.key, 10));
        }
    };
    document.addEventListener('keydown', handleGlobalKeydown);

    const cleanup = () => {
        cancelAnimationFrame(memorizeRAF);
        document.removeEventListener('keydown', handleGlobalKeydown);
    };

    let isClosed = false;
    const closeGame = () => {
        if (isClosed) return;
        isClosed = true;
        cleanup();
        stangSpelyta(overlay, finishPlaygroundSession);
    };

    const restartGame = () => {
        if (currentPhase !== 'end') return;
        currentPhase = 'omstart';
        cleanup();

        /* Kortlistan blandas om PÅ PLATS. processRating slår upp kortet via
         * S.currentStudyCards[S.currentStudyIndex]; en ny array hade brutit
         * bandet, och betyget hade efter en omstart hamnat på ett annat kort
         * än det man just svarat på. */
        const omblandade = fisherYatesShuffle([...ursprungliga]);
        cards.length = 0;
        omblandade.forEach(k => cards.push(k));

        score = 0;
        combo = 0;
        maxCombo = 0;
        cardIdx = 0;
        totalCorrectBlanks = 0;
        totalNastan = 0;
        totalBlanks = 0;
        totalPerfectCards = 0;
        niva = 1;

        document.addEventListener('keydown', handleGlobalKeydown);
        startMemorizePhase();
    };

    /* ==================================================================
     * MEMORERINGEN — vadet
     * ================================================================== */

    const startMemorizePhase = () => {
        if (cardIdx >= cards.length) { showEndScreen(); return; }
        cancelAnimationFrame(memorizeRAF);
        currentPhase = 'memorize';

        const foraNiva = niva;
        niva = nivaFor(cardIdx);
        updateHUD();
        if (niva > foraNiva) spelaOm(nivaHUD, 'is-ny');

        const card = cards[cardIdx];
        const backHtml = safeParse(card.back);

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = backHtml;
        const plainText = tempDiv.textContent || '';
        const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length;
        const sekunder = memoreringstidFor(wordCount, niva);

        arena.innerHTML = `
            <div class="lucktext-kort">
                <div class="lucktext-rad">
                    <span class="lucktext-etikett">Fråga</span>
                </div>
                <div class="lucktext-fraga">${safeParse(card.front)}</div>

                <div class="lucktext-rad">
                    <span class="lucktext-etikett">Memorera</span>
                    <span id="lt-bonus" class="lucktext-bonus num">Bonus &times;1,5</span>
                </div>
                <div id="lt-memorize-text" class="lucktext-svarstext ${gradKlass(plainText.length)}">${backHtml}</div>

                <div class="progress lucktext-tid"><i id="lt-timer-fill" class="progress-fill"></i></div>

                <button id="lt-btn-ready" type="button" class="btn primary lg lucktext-btn-bred">Jag kan det</button>
            </div>
        `;

        const memText = arena.querySelector('#lt-memorize-text');
        renderLatex(memText);
        renderCardBackImages(memText, card.backImages);
        renderLatex(arena.querySelector('.lucktext-fraga'));

        const timerFill = arena.querySelector('#lt-timer-fill');
        const bonusEl = arena.querySelector('#lt-bonus');
        const tidBar = arena.querySelector('.lucktext-tid');
        const start = performance.now();

        /* Nedräkningen drivs per bildruta i stället för med en CSS-övergång.
         * Den är speltid, inte gränssnittsrörelse: den ska ticka även för den
         * som stängt av animeringar, och bonustalet måste räknas ur samma
         * andel som stapeln visar. */
        const tick = (nu) => {
            const kvar = Math.max(0, 1 - (nu - start) / (sekunder * 1000));
            tidsbonus = 1 + TIDSBONUS_TAK * kvar;
            timerFill.style.transform = `scaleX(${kvar})`;
            bonusEl.textContent = `Bonus ×${tidsbonus.toFixed(1).replace('.', ',')}`;
            tidBar.classList.toggle('is-slut', kvar < 0.2);
            bonusEl.classList.toggle('is-slut', kvar < 0.2);
            if (kvar <= 0) { startBlankPhase(); return; }
            memorizeRAF = requestAnimationFrame(tick);
        };
        memorizeRAF = requestAnimationFrame(tick);

        arena.querySelector('#lt-btn-ready').onclick = (e) => {
            e.stopPropagation();
            startBlankPhase();
        };
    };

    /* Långa svar får en tystare grad i stället för en inline-storlek. Skalan
     * är strikt: tre steg, inga tal här i filen. */
    const gradKlass = (langd) => {
        if (langd > 400) return 'is-lang';
        if (langd > 200) return 'is-medel';
        return '';
    };

    /* ==================================================================
     * LUCKORNA — den täta återkopplingen
     * ================================================================== */

    /* Asynkron enbart för KaTeX skull, se nedan. Båda anroparna struntar i
     * returvärdet. */
    const startBlankPhase = async () => {
        if (currentPhase !== 'memorize') return;
        if (!document.getElementById('cinema-overlay')) return;
        cancelAnimationFrame(memorizeRAF);
        currentPhase = 'blank';

        const card = cards[cardIdx];
        const backHtml = safeParse(card.back);

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = backHtml;
        /* Måste inväntas. Gåendet genom noderna nedan letar efter .katex för
         * att hålla matematik utanför luckorna, och sedan KaTeX hämtas lat
         * finns de noderna inte förrän biblioteket kommit. Utan await blev en
         * renderad formel en lucka man ombads skriva av — men bara på första
         * kortet med matematik, vilket är precis den sortens fel som inte
         * syns förrän någon annan råkar på det. */
        await renderLatex(tempDiv);

        const arMatte = (node) =>
            node.classList &&
            (node.classList.contains('katex') ||
                node.classList.contains('katex-display') ||
                node.classList.contains('math'));

        const getNonMathText = (element) => {
            let text = '';
            const traverse = (node) => {
                if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
                else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (arMatte(node)) return;
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
            /* Ett svar utan ett enda dugligt nyckelord — en siffra, ett namn,
             * en formel. Kortet visas helt och passerar utan poäng i stället
             * för att fastna i en fas det inte kan lämna. */
            arena.innerHTML = `
                <div class="lucktext-kort">
                    <div class="lucktext-rad">
                        <span class="lucktext-etikett">Fråga</span>
                    </div>
                    <div class="lucktext-fraga">${safeParse(card.front)}</div>

                    <div class="lucktext-rad">
                        <span class="lucktext-etikett">Svar</span>
                    </div>
                    <div class="lucktext-svarstext ${gradKlass(plainText.length)}">${backHtml}</div>
                </div>
            `;
            renderLatex(arena.querySelector('.lucktext-fraga'));
            renderLatex(arena.querySelector('.lucktext-svarstext'));
            startReviewPhase([], 0);
            return;
        }

        totalBlanks += chosen.length;

        arena.innerHTML = `
            <div class="lucktext-kort">
                <div class="lucktext-rad">
                    <span class="lucktext-etikett">Fråga</span>
                </div>
                <div class="lucktext-fraga">${safeParse(card.front)}</div>

                <div class="lucktext-rad">
                    <span class="lucktext-etikett">Fyll i</span>
                    <span id="lt-luckraknare" class="lucktext-raknare num" aria-live="polite">0 / ${chosen.length}</span>
                </div>
                <div id="lt-blank-text" class="lucktext-svarstext ${gradKlass(plainText.length)}">${backHtml}</div>

                <div class="progress lucktext-ifyllt"><i id="lt-ifyllt-fill" class="progress-fill"></i></div>

                <button id="lt-btn-check" type="button" class="btn lucktext-btn-bred">Rätta resten</button>
            </div>
        `;

        renderLatex(arena.querySelector('.lucktext-fraga'));
        const blankText = arena.querySelector('#lt-blank-text');
        renderLatex(blankText);

        const raknare = arena.querySelector('#lt-luckraknare');
        const ifylltFill = arena.querySelector('#lt-ifyllt-fill');

        /* Luckorna hittas på ordets text, men samma ord kan förekomma flera
         * gånger i svaret. Utan positionen som utslag hamnar luckan på första
         * förekomsten även när det var den sista som valdes, och meningen
         * framför luckan blir en annan än den man memorerade. */
        let ordraknare = 0;
        const insertInputs = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (text.trim() === '') return;
                const parent = node.parentNode;
                const fragment = document.createDocumentFragment();
                text.split(/(\s+)/).forEach(w => {
                    if (/^\s+$/.test(w)) {
                        fragment.appendChild(document.createTextNode(w));
                        return;
                    }
                    if (w.length === 0) return;
                    const harPlats = ordraknare;
                    ordraknare++;
                    const cleanW = tvattaOrd(w).toLowerCase();
                    let traff = -1;
                    let bastaAvstand = Infinity;
                    chosen.forEach((c, i) => {
                        if (c._placed || c.clean.toLowerCase() !== cleanW) return;
                        const avstand = Math.abs(c.index - harPlats);
                        if (avstand < bastaAvstand) { bastaAvstand = avstand; traff = i; }
                    });
                    if (traff === -1) {
                        fragment.appendChild(document.createTextNode(w));
                        return;
                    }
                    chosen[traff]._placed = true;
                    fragment.appendChild(byggLucka(traff, chosen[traff].clean));
                });
                parent.replaceChild(fragment, node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (arMatte(node)) return;
                Array.from(node.childNodes).forEach(child => insertInputs(child));
            }
        };

        function byggLucka(idx, facit) {
            const lucka = document.createElement('span');
            lucka.className = 'lucktext-lucka';
            lucka.dataset.idx = String(idx);

            /* Första bokstaven är lägets ledtråd, inte en platshållare. Den
             * låg i attributet placeholder och försvann när man började
             * skriva — luckan blev då märkbart svårare än läget var tänkt. */
            const ledtrad = document.createElement('span');
            ledtrad.className = 'lucktext-ledtrad';
            ledtrad.setAttribute('aria-hidden', 'true');
            ledtrad.textContent = facit[0];

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'lucktext-inline-input';
            input.dataset.idx = String(idx);
            input.setAttribute('aria-label', `Lucka ${idx + 1}, börjar på ${facit[0]}`);
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.style.width = `${Math.max(3, facit.length) + 1}ch`;
            input.addEventListener('keydown', (e) => hanteraLuckTangent(e, idx, input));

            lucka.append(ledtrad, input);
            return lucka;
        }

        const oppnaLuckor = () => [...arena.querySelectorAll('.lucktext-inline-input')];

        const fokuseraNasta = (fran) => {
            const kvar = oppnaLuckor();
            if (kvar.length === 0) return;
            const efter = kvar.find(i => Number(i.dataset.idx) > fran);
            (efter || kvar[0]).focus();
        };

        function hanteraLuckTangent(e, idx, input) {
            if (e.key === 'Tab') {
                /* Tab flyttar utan att svara. Att kunna se hela meningen och
                 * fylla i den i valfri ordning är halva minnesarbetet. */
                e.preventDefault();
                const alla = oppnaLuckor();
                const cur = alla.indexOf(input);
                const next = alla[cur + (e.shiftKey ? -1 : 1)];
                (next || alla[e.shiftKey ? alla.length - 1 : 0])?.focus();
                return;
            }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!input.value.trim()) {
                /* Tomt fält är ett uppskov, inte ett svar. Facit tar hand om
                 * det som lämnats kvar — att hoppa över kostar alltså lika
                 * mycket till slut, bara senare. */
                fokuseraNasta(idx);
                return;
            }
            lasLucka(idx, input.value);
            fokuseraNasta(idx);
        }

        let avslutad = false;
        const antalLasta = () => chosen.filter(c => c._last).length;

        const uppdateraRaknare = () => {
            const n = antalLasta();
            raknare.textContent = `${n} / ${chosen.length}`;
            ifylltFill.style.transform = `scaleX(${n / chosen.length})`;
        };

        /* Poängen stiger ur luckan man just fyllde. Ett tal i slisten hade
         * krävt att man tittade bort från meningen; här ligger belöningen
         * exakt där handlingen var. */
        const visaPoangkvitto = (lucka, text, ton) => {
            const kvitto = document.createElement('span');
            kvitto.className = `lucktext-kvitto num is-${ton}`;
            kvitto.setAttribute('aria-hidden', 'true');
            kvitto.textContent = text;
            lucka.appendChild(kvitto);
            setTimeout(() => kvitto.remove(), rorelseMs(kvitto, 'animationDuration'));
        };

        function lasLucka(idx, skrivet) {
            const post = chosen[idx];
            if (!post || post._last) return;
            post._last = true;

            const lucka = arena.querySelector(`.lucktext-lucka[data-idx="${idx}"]`);
            const utfall = bedomOrd(skrivet, post.clean);
            post._utfall = utfall;

            let vunnet = 0;
            if (utfall === 'ratt') {
                combo++;
                if (combo > maxCombo) maxCombo = combo;
                const multiplikator = Math.min(1 + (combo - 1) * COMBO_STEG, COMBO_TAK);
                vunnet = Math.round(POANG_LUCKA * multiplikator * tidsbonus);
                totalCorrectBlanks++;
            } else if (utfall === 'nastan') {
                /* Combon överlever ett stavfel. Att bryta den på ett "nästan"
                 * gör att man slutar chansa, och det är chansningen som är
                 * återkallandet. */
                vunnet = Math.round(POANG_NASTAN * tidsbonus);
                totalNastan++;
            } else {
                if (combo >= 3) spelaOm(comboHUD, 'is-bruten');
                combo = 0;
            }
            score += vunnet;

            if (lucka) {
                lucka.classList.add(`is-${utfall === 'tomt' ? 'fel' : utfall}`);
                lucka.innerHTML = '';
                const ord = document.createElement('span');
                ord.className = 'lucktext-ord';
                ord.textContent = post.clean;
                lucka.appendChild(ord);

                /* Bara när svaret inte gick hem. Ett rätt svar som skrevs utan
                 * ledtrådens bokstav skiljer sig från facit på tecknet, och
                 * hade annars fått sin egen text överstruken bredvid sig. */
                const mitt = utfall === 'ratt' ? '' : tvattaOrd(String(skrivet || ''));
                if (mitt && mitt.toLowerCase() !== post.clean.toLowerCase()) {
                    const eget = document.createElement('span');
                    eget.className = 'lucktext-mitt';
                    eget.textContent = mitt;
                    lucka.appendChild(eget);
                }
                if (vunnet > 0) {
                    visaPoangkvitto(lucka, `+${formateraPoang(vunnet)}`, utfall);
                    spelaOm(scoreHUD, 'is-okad');
                }
            }

            updateHUD();
            uppdateraRaknare();

            if (chosen.every(c => c._last)) avslutaKortet(lucka);
        }

        const avslutaKortet = (sistaLucka) => {
            if (avslutad) return;
            avslutad = true;
            /* Ett andetag så att sista kvittot och det rätta ordet hinner
             * läsas innan betygen lägger sig under kortet. Längden läses ur
             * rörelsen själv och är därmed noll för den som bett om mindre
             * rörelse — då kommer betygen direkt i stället för efter en paus
             * ingen sett någon anledning till. */
            const ord = sistaLucka?.querySelector('.lucktext-ord');
            const kvitto = sistaLucka?.querySelector('.lucktext-kvitto');
            const paus = Math.max(
                ord ? rorelseMs(ord, 'animationDuration') : 0,
                kvitto ? rorelseMs(kvitto, 'animationDuration') : 0
            );
            setTimeout(() => startReviewPhase(chosen, chosen.length), paus);
        };

        arena.querySelector('#lt-btn-check').addEventListener('click', () => {
            /* Knappen rättar det som står kvar — med det som faktiskt står i
             * fälten, inte som tomt. Den som fyller i hela meningen och sedan
             * söker en knapp i stället för att trycka Enter ska få sina svar
             * bedömda, inte nollställda.
             *
             * Att den rättar och inte bara hoppar över är avsiktligt: annars
             * hade det lönat sig att lämna varje osäker lucka tom för att
             * skydda combon, och läget hade haft en vinnande strategi som inte
             * var att minnas. */
            chosen.forEach((c, i) => {
                if (c._last) return;
                const falt = arena.querySelector(`.lucktext-inline-input[data-idx="${i}"]`);
                lasLucka(i, falt ? falt.value : '');
            });
        });

        insertInputs(blankText);
        uppdateraRaknare();
        arena.querySelector('.lucktext-inline-input')?.focus();
    };

    /* ==================================================================
     * FACIT OCH BETYG
     * ================================================================== */

    const startReviewPhase = (chosen, blankCount) => {
        if (currentPhase !== 'blank') return;
        currentPhase = 'review';

        const ratt = chosen.filter(c => c._utfall === 'ratt').length;
        const nastan = chosen.filter(c => c._utfall === 'nastan').length;
        const perfekt = blankCount > 0 && ratt === blankCount;
        if (perfekt) {
            totalPerfectCards++;
            /* Bonusen växer med nivån. Ett perfekt kort på nivå sex är en
             * annan bedrift än på nivå ett, och skillnaden ska synas. */
            score += PERFEKT_BONUS * niva;
            updateHUD();
        }

        const traffar = ratt + nastan;
        let ton = 'svagt';
        if (perfekt) ton = 'perfekt';
        else if (blankCount > 0 && traffar / blankCount >= 0.5) ton = 'delvis';

        let omdome = 'Missat';
        if (perfekt) omdome = 'Perfekt';
        else if (ton === 'delvis') omdome = nastan > 0 ? 'Nästan' : 'Delvis';

        const kort = arena.querySelector('.lucktext-kort');
        if (!kort) return;

        const knapp = kort.querySelector('#lt-btn-check');
        if (knapp) knapp.remove();

        /* Ett kort utan luckor har inget utfall att döma. Raden hoppas över i
         * stället för att säga "Missat 0 / 0" om något man aldrig fick chansen
         * att svara på. */
        if (blankCount > 0) {
            const facit = document.createElement('div');
            facit.className = `lucktext-utfall is-${ton}`;
            facit.innerHTML = `
                <span class="lucktext-utfall-ord">${omdome}</span>
                <span class="lucktext-utfall-tal num">${ratt} / ${blankCount}${nastan > 0 ? ` &middot; ${nastan} nästan` : ''}</span>
            `;
            kort.appendChild(facit);
        }

        const betyg = document.createElement('div');
        betyg.className = 'lucktext-betyg';
        betyg.innerHTML = '<span class="lucktext-etikett">Betyg</span>';

        const original = document.getElementById('study-actions');
        const klon = original.cloneNode(true);
        klon.id = 'lt-rating-actions';
        klon.classList.remove('hidden');
        /* Klonen bär med sig id:na time-1..4 från repetitionsvyn. Två element
         * med samma id gör getElementById till en lottning. */
        klon.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        klon.querySelectorAll('.btn-rate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.blur();
                submitCardRating(parseInt(btn.getAttribute('data-rating'), 10));
            });
        });
        betyg.appendChild(klon);
        kort.appendChild(betyg);
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

    /* ==================================================================
     * SLUTBILDEN — anledningen att trycka en gång till
     * ================================================================== */

    const showEndScreen = () => {
        if (currentPhase === 'end') return;
        currentPhase = 'end';
        cancelAnimationFrame(memorizeRAF);

        const tidigareRekord = personalBest;
        const tidigareCombo = comboBest;
        const nyttRekord = score > personalBest;
        const nyCombo = maxCombo > comboBest;
        if (nyttRekord) {
            personalBest = score;
            localStorage.setItem(pbKey, String(score));
        }
        if (nyCombo) {
            comboBest = maxCombo;
            localStorage.setItem(comboKey, String(maxCombo));
        }

        S.playgroundSessionStats.correct = totalCorrectBlanks;

        const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
        /* Procenten räknas på det som satt exakt, inte på nästan. Ett tal som
         * inte går att räkna fram ur de två som står bredvid det läses som ett
         * fel i tabellen. */
        const blankPct = totalBlanks > 0 ? Math.round((totalCorrectBlanks / totalBlanks) * 100) : 0;
        const spelade = Math.min(cardIdx, cards.length);

        /* Avståndet till rekordet är hela kroken. "38 p från rekordet" är en
         * anledning att trycka igen; ett tal utan jämförelse är det inte. */
        const marginal = score - tidigareRekord;
        let rekordrad;
        if (nyttRekord) {
            rekordrad = tidigareRekord > 0
                ? `${formateraPoang(marginal)} över det gamla rekordet`
                : 'Första rekordet i den här kortleken';
        } else if (marginal === 0) {
            rekordrad = `Jämnt med rekordet ${formateraPoang(tidigareRekord)}`;
        } else {
            rekordrad = `${formateraPoang(-marginal)} från rekordet ${formateraPoang(tidigareRekord)}`;
        }
        const andelAvRekord = tidigareRekord > 0
            ? Math.min(1, score / tidigareRekord)
            : 1;

        arena.innerHTML = `
            <div class="lucktext-kort lucktext-slut">
                <div class="lucktext-rad">
                    <span class="lucktext-etikett">${nyttRekord ? 'Nytt rekord' : 'Klart'}</span>
                    <span class="lucktext-raknare">${pbTitle}</span>
                </div>

                <div class="lucktext-slutpoang">
                    <span class="lucktext-slutpoang-tal num">${formateraPoang(score)}</span>
                    <span class="lucktext-slutpoang-mot">${rekordrad}</span>
                </div>
                <div class="progress lucktext-rekordlinje ${nyttRekord ? 'is-slaget' : ''}">
                    <i class="progress-fill" style="width:${(andelAvRekord * 100).toFixed(1)}%"></i>
                </div>

                <dl class="lucktext-tabell">
                    <div class="lucktext-tabellrad">
                        <dt>Luckor</dt>
                        <dd class="num">${totalCorrectBlanks} / ${totalBlanks} rätt${totalNastan > 0 ? ` &middot; ${totalNastan} nästan` : ''} &middot; ${blankPct}%</dd>
                    </div>
                    <div class="lucktext-tabellrad">
                        <dt>Perfekta kort</dt>
                        <dd class="num">${totalPerfectCards} / ${spelade}</dd>
                    </div>
                    <div class="lucktext-tabellrad${nyCombo ? ' is-rekord' : ''}">
                        <dt>Längsta combo</dt>
                        <dd class="num">&times;${maxCombo}${nyCombo ? ' &middot; nytt' : ` &middot; rekord &times;${tidigareCombo}`}</dd>
                    </div>
                    <div class="lucktext-tabellrad">
                        <dt>Nivå</dt>
                        <dd class="num">${niva} &middot; ${formateraTid(timeSpent)}</dd>
                    </div>
                </dl>

                <div class="lucktext-slutknappar">
                    <button id="lt-btn-restart" type="button" class="btn primary lg">Spela igen</button>
                    <button id="lt-btn-exit" type="button" class="btn lg">Avsluta</button>
                </div>
            </div>
        `;

        arena.querySelector('#lt-btn-restart').onclick = (e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            restartGame();
        };
        arena.querySelector('#lt-btn-exit').onclick = (e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            closeGame();
        };
    };

    startMemorizePhase();
};
