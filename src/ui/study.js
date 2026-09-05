import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { getLocalDateString, loadRecords, saveRecords } from '../domain/stats.js';
import {
    RATING,
    nextReviewAt,
    previewInterval,
    schedule,
    withScheduleDefaults,
} from '../domain/srs.js';
import { reviewRow, stripTransientFields } from '../domain/model.js';
import { recordReview } from '../core/sync.js';
import { getUserId } from '../core/supabase.js';
import { renderDecks } from './deck.js';
import { renderCardBackImages, safeParse } from './images.js';
import { renderLatex } from './latex.js';
import { showConfirmModal } from './modals.js';
import { finishPlaygroundSession } from './playground.js';
import { switchView } from './router.js';
import { ticksHtml } from './ticks.js';
import { showToast } from './toast.js';


/* Hur länge elementets övergång faktiskt varar, i millisekunder.
 *
 * Frågas av elementet självt i stället för att skrivas ned här. En siffra i JS
 * vet inte om någon ändrat en token, och framför allt inte om användaren bett
 * systemet om mindre rörelse — då är övergången noll lång och all väntan är
 * ren fördröjning.
 */
const transitionMs = (el) => {
    const toMs = (value) => {
        const n = parseFloat(value);
        if (!Number.isFinite(n)) return 0;
        return value.trim().endsWith('ms') ? n : n * 1000;
    };

    const style = getComputedStyle(el);
    const durations = style.transitionDuration.split(',');
    const delays = style.transitionDelay.split(',');

    return durations.reduce((longest, duration, i) => {
        const total = toMs(duration) + toMs(delays[i % delays.length] || '0s');
        return Math.max(longest, total);
    }, 0);
};

/* En bildruta. Inte en designlängd — bara marginalen på skyddsnätet nedan, så
 * att timern inte kan hinna före själva övergången. */
const FRAME_MS = 20;

/* Väntar in kortets utgång innan nästa kort ritas.
 *
 * Här låg tidigare en gissad siffra på båda ställena kortet lämnar skärmen:
 * 400 ms i betygsättningen och 300 i hoppa över, mot en övergång som varar
 * 220. Gissningen kunde varken bli rätt eller följa med när rörelsen ändrades.
 *
 * Timern finns kvar som skyddsnät, inte som taktgivare: kortet kan ligga i en
 * dold vy — spellägena betygsätter mot ett kort ingen ser — och då kommer
 * transitionend aldrig, hur länge man än väntar.
 */
export const afterCardExit = (el, done) => {
    const span = transitionMs(el);
    if (span <= 0) {
        done();
        return;
    }

    let net = 0;
    let finished = false;

    function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(net);
        el.removeEventListener('transitionend', onEnd);
        done();
    }

    function onEnd(event) {
        // Barnens övergångar bubblar hit och betyder inget för kortets utgång.
        if (event.target === el) finish();
    }

    el.addEventListener('transitionend', onEnd);
    net = setTimeout(finish, span + FRAME_MS);
};

// --- STUDY LOGIC ---
export const startStudy = (forceAll = false) => {
    S.isPlaygroundSession = false;
    S.lastSessionWasPlayground = false;
    S.playgroundMode = null;
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck || deck.cards.length === 0) return;

    if (forceAll) {
        S.currentStudyCards = deck.cards.filter(c => c.type !== 'note');
    } else {
        S.currentStudyCards = deck.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now());
    }

    if (S.currentStudyCards.length === 0 && !forceAll) {
        showToast("Inga kort att repetera just nu!");
        return;
    }

    // Shuffle the cards to study
    fisherYatesShuffle(S.currentStudyCards);

    S.currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

export const startGlobalStudy = () => {
    S.isPlaygroundSession = false;
    S.lastSessionWasPlayground = false;
    S.playgroundMode = null;
    const allDueCards = S.appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now()));
    if (allDueCards.length === 0) {
        showToast('Inga kort att repetera just nu!');
        return;
    }
    S.currentDeckId = null;
    S.currentStudyCards = allDueCards;
    fisherYatesShuffle(S.currentStudyCards);
    S.currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

export const startBookshelfStudy = (bookshelfId) => {
    S.isPlaygroundSession = false;
    S.lastSessionWasPlayground = false;
    // Collect all due cards from decks belonging to this bookshelf
    const dueCards = S.appData.decks
        .filter(d => d.bookshelfId === bookshelfId)
        .flatMap(d => d.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now()));
        
    if (dueCards.length === 0) {
        showToast('Inga kort att repetera i denna bokhylla just nu!');
        return;
    }
    
    S.currentDeckId = null;
    S.currentStudyCards = dueCards;
    fisherYatesShuffle(S.currentStudyCards);
    S.currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

export const startSectionStudy = (sectionId, forceAll = false) => {
    S.isPlaygroundSession = false;
    S.lastSessionWasPlayground = false;
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;
    
    let sectionCards = deck.cards.filter(c => c.type !== 'note' && c.sectionId === sectionId);
    if (!forceAll) {
        sectionCards = sectionCards.filter(c => c.nextReviewDate <= Date.now());
    }
    
    if (sectionCards.length === 0) {
        showToast('Inga kort att repetera i denna mapp just nu!');
        return;
    }
    
    S.currentStudyCards = sectionCards;
    fisherYatesShuffle(S.currentStudyCards);
    S.currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

/* Målar om tickskalan utan att byta ut den.
 *
 * Ritas raden om vid varje kort byter strecken färg i ett hopp: ett nyskapat
 * element börjar i sitt slutläge och har ingenting att tona ifrån. Genom att
 * behålla samma <i> mellan korten och bara byta klass får CSS en väg att gå.
 *
 * Raden byggs om först när antalet streck ändrats — då är det en annan skala
 * och inte samma skala i ett nytt läge.
 */
const paintTicks = (host, total, done) => {
    const next = document.createElement('template');
    next.innerHTML = ticksHtml(total, done);

    const fresh = next.content.querySelectorAll('i');
    const current = host.querySelectorAll('i');

    if (current.length !== fresh.length) {
        host.replaceChildren(next.content);
        return;
    }

    current.forEach((mark, i) => {
        mark.className = fresh[i].className;
    });
};

/* Toppslisten: kortlek, mapp och kölängd.
 *
 * Kortleken slås upp ur kortet och inte ur S.currentDeckId, eftersom ett
 * globalt pass eller en hel bokhylla inte har någon aktuell kortlek — då är
 * fältet null och slisten hade stått tom just när den behövs som mest.
 */
const renderStudyContext = (card) => {
    const total = S.currentStudyCards.length;
    const done = S.currentStudyIndex;

    const deck = S.appData.decks.find((d) => d.cards.some((c) => c.id === card.id));
    const section = card.sectionId ? deck?.sections?.find((sec) => sec.id === card.sectionId) : null;

    const deckEl = document.getElementById('study-ctx-deck');
    const sectionEl = document.getElementById('study-ctx-section');
    if (deckEl) deckEl.textContent = deck?.title || 'Repetition';
    // Mappen är en precisering av kortleken, inte ett eget led. Punkten hör
    // därför ihop med mappnamnet och försvinner med det.
    if (sectionEl) sectionEl.textContent = section ? ` · ${section.title}` : '';

    const progressEl = document.getElementById('study-progress');
    if (progressEl) progressEl.textContent = `${done + 1} av ${total}`;

    const ticksEl = document.getElementById('study-ticks');
    if (ticksEl) paintTicks(ticksEl, total, done);
};

export const renderStudyCard = () => {
    document.getElementById('cinema-overlay')?.remove();
    if (S.currentStudyIndex >= S.currentStudyCards.length) {
        if (S.isPlaygroundSession) {
            finishPlaygroundSession();
        } else {
            const cv = document.getElementById('view-study-complete');
            cv.querySelector('h1').textContent = 'Bra jobbat!';
            cv.querySelector('p').textContent = 'Du har repeterat alla schemalagda kort.';
            cv.querySelector('#btn-complete-back').textContent = 'Tillbaka till kortleken';
            switchView('complete');
            renderDecks();
        }
        return;
    }

    const card = S.currentStudyCards[S.currentStudyIndex];

    // Reset AI Assistant state
    document.getElementById('study-ai-chat').classList.add('hidden');
    document.getElementById('study-ai-chat').innerHTML = '';
    document.getElementById('input-study-ai').value = '';
    document.getElementById('study-ai-loading').classList.add('hidden');

    renderStudyContext(card);
    
    const frontTextEl = document.getElementById('study-front-text');
    if (card._jeopardy) {
        // Etiketten bar sina stilar i markupen mot tokens som inte finns:
        // den ritades i standardfärg utan linje. Nu en klass i study.css.
        frontTextEl.innerHTML = `<div class="study-jeopardy-etikett">Svar — fråga eftersöks</div>` + safeParse(card.front);
    } else {
        frontTextEl.innerHTML = safeParse(card.front);
    }
    document.getElementById('study-back-text').innerHTML = safeParse(card.back);
    
    // Render back images
    const backTextEl = document.getElementById('study-back-text');
    renderCardBackImages(backTextEl, card.backImages);
    
    // Apply long-form styling if needed
    const backTextEl2 = document.getElementById('study-back-text');
    if (card.isLongForm) {
        backTextEl2.classList.add('long-form-content');
    } else {
        backTextEl2.classList.remove('long-form-content');
    }

    /* Fordjupningen. Doljs helt nar den saknas — ett tomt falt under svaret
     * ser ut som nagot som inte laddat klart. */
    const descEl = document.getElementById('study-description');
    if (card.description) {
        descEl.innerHTML = safeParse(card.description);
        descEl.hidden = false;
        renderLatex(descEl);
    } else {
        descEl.innerHTML = '';
        descEl.hidden = true;
    }

    renderLatex(document.getElementById('study-front-text'));
    renderLatex(backTextEl2);

    // Extract times to present to user
    document.getElementById('time-1').innerText = '< 1m';

    // Forhandsvisningen fragar samma funktion som faktiskt schemalagger, i
    // stallet for en egen kopia av formeln. Kopian rakande med den gamla
    // ease-faktorn, medan Svart och Latt andrar ease i samma steg — knapparna
    // visade darfor andra siffror an korten fick.
    const formatInt = (days) => (days < 1 ? '< 1d' : Math.round(days) + 'd');
    const tillstand = withScheduleDefaults(card);

    document.getElementById('time-2').innerText = formatInt(previewInterval(tillstand, RATING.HARD));
    document.getElementById('time-3').innerText = formatInt(previewInterval(tillstand, RATING.GOOD));
    document.getElementById('time-4').innerText = formatInt(previewInterval(tillstand, RATING.EASY));

    /* Kortet mattes tidigare upp i en requestAnimationFrame och fick en
     * minsta hojd i pixlar, sa att det inte skulle hoppa nar baksidan vandes
     * fram. Betygsraden ar sedan dess forankrad i vyns nederkant och kan inte
     * hoppa; det enda matningen gav var ett dott falt mellan svaret och
     * knapparna. Kortet far nu vara sa hogt som dess innehall. */
    const flashcardInner = document.getElementById('flashcard-inner');
    flashcardInner.classList.remove('flipped');

    const ratingBtns = document.querySelectorAll('.btn-rate');
    ratingBtns.forEach(btn => btn.style.display = '');

    // Reset UI to front
    document.getElementById('study-actions').classList.add('hidden');
    document.getElementById('study-flip-action').classList.remove('hidden');

    /* Kortet ska komma in, inte bytas ut på plats.
     *
     * Klassen tas bort och läggs på igen med en påtvingad omflödning emellan.
     * Utan läsningen av offsetWidth ser webbläsaren aldrig att klassen varit
     * borta — båda ändringarna hamnar i samma stilberäkning — och animationen
     * startar aldrig om.
     *
     * Riktningsklasserna städas i samma veva. Ett avbrutet pass kunde annars
     * lämna kvar en swipe-klass, och nästa kort ritades osynligt. */
    const flashcard = document.getElementById('active-flashcard');
    if (flashcard) {
        flashcard.classList.remove(
            'swipe-up', 'swipe-down', 'swipe-left', 'swipe-right', 'is-entering'
        );
        void flashcard.offsetWidth;
        flashcard.classList.add('is-entering');
    }
};

export const processRating = (rating) => {
    try {
        const card = S.currentStudyCards[S.currentStudyIndex];
        if (!card) { console.error('No card at index', S.currentStudyIndex); return; }

        if (S.isPlaygroundSession && S.playgroundSessionStats) {
            if (rating === 1) S.playgroundSessionStats.again++;
            else S.playgroundSessionStats.correct++;
        }

        // Schemaläggningen ligger i domain/srs.js — ren funktion, testad separat.
        // withScheduleDefaults skyddar mot gammal eller importerad data där
        // fälten saknas; utan det ger räkningen NaN som sedan sparas till disk.
        const now = Date.now();
        const before = withScheduleDefaults(card, now);
        const next = schedule(before, rating);
        card.repetition = next.repetition;
        card.interval = next.interval;
        card.easeFactor = next.easeFactor;
        card.nextReviewDate = nextReviewAt(next, rating, now);
        card.lastReviewed = now;
        if (rating === RATING.AGAIN) {
            card.lapses = (card.lapses || 0) + 1;
            // Kortet läggs tillbaka sist i sessionen så det kommer igen direkt.
            S.currentStudyCards.push(card);
        }

        // Update main deck references and save (skip for jeopardy — cards are swapped copies)
        if (!card._jeopardy) {
            let ownerDeckId = null;
            for (const d of S.appData.decks) {
                const idx = d.cards.findIndex(c => c.id === card.id);
                if (idx > -1) {
                    // Spellägena arbetar på ytliga kopior som bär transienta fält
                    // som originalDeckId och _sectionTitle. Utan tvätten här
                    // hamnar de permanent i sparad data.
                    d.cards[idx] = stripTransientFields(card);
                    ownerDeckId = d.id;
                    break;
                }
            }

            // Repetitionsloggen. Append-only, så att streak och heatmap kan
            // härledas ur faktisk historik i stället för ur card.lastReviewed,
            // som skrivs över vid varje ny repetition.
            void recordReview(
                reviewRow({
                    card,
                    deckId: ownerDeckId,
                    userId: getUserId(),
                    rating,
                    before,
                    after: next,
                    mode: S.isPlaygroundSession ? (S.playgroundMode ?? 'playground') : 'study',
                    at: now,
                })
            );
            // Log review to daily counts
            const r = loadRecords();
            const todayStr = getLocalDateString();
            if (!r.dailyCounts) r.dailyCounts = {};
            r.dailyCounts[todayStr] = (r.dailyCounts[todayStr] || 0) + 1;
            if (!r.bestDayCount || r.dailyCounts[todayStr] > r.bestDayCount) {
                r.bestDay = todayStr;
                r.bestDayCount = r.dailyCounts[todayStr];
            }
            saveRecords(r);

            saveData();
        }

        const flashcardContainer = document.querySelector('.flashcard');
        const hasOverlay = document.getElementById('cinema-overlay') !== null;
        if (flashcardContainer && !hasOverlay) {
            let swipeClass = '';
            if (rating === 1) swipeClass = 'swipe-down';
            else if (rating === 2) swipeClass = 'swipe-left';
            else if (rating === 3) swipeClass = 'swipe-up';
            else if (rating === 4) swipeClass = 'swipe-right';
            
            flashcardContainer.classList.add(swipeClass);

            afterCardExit(flashcardContainer, () => {
                flashcardContainer.classList.remove(swipeClass);
                S.currentStudyIndex++;
                renderStudyCard();
            });
        } else {
            S.currentStudyIndex++;
        }
    } catch (err) {
        console.error('processRating error:', err);
        alert('Fel vid betygsättning: ' + err.message);
    }
};

export const deleteCurrentStudyCard = async () => {
    const card = S.currentStudyCards[S.currentStudyIndex];
    if (!card) return;

    if (await showConfirmModal('Radera kort', 'Är du säker på att du vill radera detta kort permanent?', 'Radera', true)) {
        // Remove from master data
        for (const d of S.appData.decks) {
            const idx = d.cards.findIndex(c => c.id === card.id);
            if (idx > -1) {
                d.cards.splice(idx, 1);
                break;
            }
        }
        
        // Remove from current session (all instances, including duplicates from 'Again')
        S.currentStudyCards = S.currentStudyCards.filter(c => c.id !== card.id);
        // Adjust index since we rebuilt the array
        // currentStudyIndex now points at the next card (or end)
        
        saveData();
        showToast('Kortet har raderats');
        
        // Render next card (the card that was after this one is now at currentStudyIndex)
        // If we were at the last card, renderStudyCard will handle session completion.
        renderStudyCard();
    }
};
