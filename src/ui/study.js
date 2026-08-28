import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { fisherYatesShuffle } from '../core/utils.js';
import { getLocalDateString, loadRecords, saveRecords } from '../domain/stats.js';
import { RATING, nextReviewAt, schedule, withScheduleDefaults } from '../domain/srs.js';
import { renderDecks } from './deck.js';
import { renderCardBackImages, safeParse } from './images.js';
import { renderLatex } from './latex.js';
import { showConfirmModal } from './modals.js';
import { finishPlaygroundSession } from './playground.js';
import { switchView } from './router.js';
import { showToast } from './toast.js';


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

export const renderStudyCard = () => {
    document.getElementById('cinema-overlay')?.remove();
    if (S.currentStudyIndex >= S.currentStudyCards.length) {
        document.getElementById('study-progress-fill').style.width = '100%';
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

    document.getElementById('study-progress').innerText = `${S.currentStudyIndex + 1} / ${S.currentStudyCards.length}`;
    const progressPercent = S.currentStudyCards.length > 0 ? ((S.currentStudyIndex) / S.currentStudyCards.length) * 100 : 0;
    document.getElementById('study-progress-fill').style.width = `${progressPercent}%`;
    
    const frontTextEl = document.getElementById('study-front-text');
    if (card._jeopardy) {
        frontTextEl.innerHTML = `<div style="font-size: 0.85rem; font-weight: 700; color: var(--primary-color); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; opacity: 0.8;">SVAR (Fråga eftersöks)</div>` + safeParse(card.front);
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

    renderLatex(document.getElementById('study-front-text'));
    renderLatex(backTextEl2);

    // Extract times to present to user
    document.getElementById('time-1').innerText = '< 1m';

    // Time predictions calculations
    const calcNextInterval = (ease, interval, rep, rating) => {
        if (rating === 1) return 0;
        if (rating === 2) return rep === 0 ? 0.5 : interval * 1.2;
        if (rating === 3) return rep === 0 ? 1 : (rep === 1 ? 6 : interval * ease);
        if (rating === 4) return rep === 0 ? 4 : (interval * ease * 1.3);
    };

    const formatInt = (days) => days < 1 ? '< 1d' : Math.round(days) + 'd';

    document.getElementById('time-2').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 2));
    document.getElementById('time-3').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 3));
    document.getElementById('time-4').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 4));

    // Dynamically size the flashcard to fit content
    const flashcardInner = document.getElementById('flashcard-inner');
    const frontFace = document.querySelector('.flashcard-front');
    flashcardInner.classList.remove('flipped');
    // Temporarily make front visible to measure
    requestAnimationFrame(() => {
        const flashcardEl = document.querySelector('.flashcard');
        // Reset minHeight and force reflow so scrollHeight reflects actual content
        flashcardInner.style.minHeight = '0px';
        if (flashcardEl) flashcardEl.style.minHeight = '0px';
        frontFace.style.position = 'static';
        frontFace.offsetHeight; // force reflow
        const frontHeight = frontFace.scrollHeight;
        frontFace.style.position = '';
        const finalHeight = Math.max(200, Math.min(frontHeight, window.innerHeight * 0.7));
        flashcardInner.style.minHeight = finalHeight + 'px';
        if (flashcardEl) flashcardEl.style.minHeight = finalHeight + 'px';
    });

    const ratingBtns = document.querySelectorAll('.btn-rate');
    ratingBtns.forEach(btn => btn.style.display = '');

    // Reset UI to front
    document.getElementById('study-actions').classList.add('hidden');
    document.getElementById('study-flip-action').classList.remove('hidden');
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
        const next = schedule(withScheduleDefaults(card, now), rating);
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
            for (const d of S.appData.decks) {
                const idx = d.cards.findIndex(c => c.id === card.id);
                if (idx > -1) {
                    d.cards[idx] = card;
                    break;
                }
            }
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

            setTimeout(() => {
                flashcardContainer.classList.remove(swipeClass);
                S.currentStudyIndex++;
                renderStudyCard();
            }, 400); // Wait for CSS animation
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
