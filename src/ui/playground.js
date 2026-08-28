import { S } from '../core/state.js';
import { getReviewLog } from '../core/sync.js';
import { currentStreak, dailyCounts, mergeLegacyCounts } from '../domain/history.js';
import { escapeHtml, fisherYatesShuffle } from '../core/utils.js';
import { getAchievements, getLocalDateString, loadRecords, saveRecords, updatePersonalRecords } from '../domain/stats.js';
import { actionReveal } from '../games/action.js';
import { dammigaReveal } from '../games/dammiga.js';
import { dragkampenReveal } from '../games/dragkampen.js';
import { fritextSessionReveal } from '../games/fritext.js';
import { jeopardyReveal } from '../games/jeopardy.js';
import { lucktextReveal } from '../games/lucktext.js';
import { suddenDeathReveal } from '../games/suddendeath.js';
import { washUrl } from './wash.js';
import { transportbandetReveal } from '../games/transportbandet.js';
import { renderLatex } from './latex.js';
import { switchView } from './router.js';
import { renderStudyCard } from './study.js';
import { showToast } from './toast.js';


/* `tona` styr om lägena och aktivitetskartan ska läggas på plats med en
 * förskjuten intoning. Den är på när hallen öppnas och av när vyn ritas om av
 * ett annat skäl — ett ibockat filter får inte spela upp inflyttningen en gång
 * till, för då far åtta kort och tolv veckor förbi varje gång man kryssar i en
 * kortlek. Ett anrop utan argument tonar, så router och navigering behöver inte
 * veta om detta. */
export const renderPlayground = ({ tona = true } = {}) => {
    const container = document.getElementById('playground-content');
    if (!container) return;

    // Save scroll position of the dropdown menu and window to prevent jumping on update
    const oldMenu = document.getElementById('pg-dropdown-menu');
    const oldMenuScrollTop = oldMenu ? oldMenu.scrollTop : 0;
    const oldWindowScrollY = window.scrollY;

    let allCards = S.appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note').map(c => ({...c, originalDeckId: d.id})));

    // Filter cards based on tree checkbox selection
    if (!S.playgroundFilterAll) {
        allCards = allCards.filter(c => {
            const sKey = c.sectionId ? `deck:${c.originalDeckId}:section:${c.sectionId}` : `deck:${c.originalDeckId}:unsorted`;
            return S.playgroundFilterSource.has(sKey);
        });
    }
    const now = Date.now();
    const records = loadRecords();

    // --- Core stats ---
    const totalCards = allCards.length;
    const newCards = allCards.filter(c => c.repetition === 0).length;
    const learningCards = allCards.filter(c => c.repetition > 0 && c.interval < 21).length;
    const masteredCards = allCards.filter(c => c.interval >= 21).length;
    const learningPct = totalCards > 0 ? (learningCards / totalCards * 100) : 0;
    const masteredPct = totalCards > 0 ? (masteredCards / totalCards * 100) : 0;

    const dueNow = allCards.filter(c => c.nextReviewDate <= now).length;
    const todayStr = getLocalDateString();

    // --- Streak ---
    // Raknas ur repetitionsloggen, inte ur card.lastReviewed. Det gamla sattet
    // laste ett falt som skrivs over vid varje ny repetition, sa historiken
    // raderade sig sjalv bakat i tiden: en dag vars kort sedan repeterats om
    // slutade rakna. Aldre dagsrakningar vavs in sa att befintliga anvandare
    // inte tappar sin streak vid uppgraderingen.
    const dagsrakningar = mergeLegacyCounts(dailyCounts(getReviewLog()), records.dailyCounts);
    const streak = currentStreak(dagsrakningar);

    // Persist best streak ever
    if (streak > (records.bestStreak || 0)) {
        records.bestStreak = streak;
        saveRecords(records);
    }

    // --- Extended records ---
    const longestInterval = Math.ceil(Math.max(0, ...allCards.map(c => c.interval || 0)));
    const dailyCountValues = Object.values(records.dailyCounts || {});
    const activeDays = dailyCountValues.filter(v => v > 0).length;
    const totalReviews = dailyCountValues.reduce((s, v) => s + v, 0);
    const avgPerDay = activeDays > 0 ? Math.round(totalReviews / activeDays) : 0;

    // --- Heatmap (12 weeks, aligned to Mon-Sun) ---
    const heatmapDays = 84;
    const heatmapData = [];
    
    // Find the Sunday of the current week to align rows to fixed weekdays
    const nowObj = new Date(now);
    const todayNum = nowObj.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const daysUntilSunday = todayNum === 0 ? 0 : 7 - todayNum;
    
    // Use midday of Sunday to avoid any midnight timezone shifts
    const currentWeekSunday = new Date(nowObj.getFullYear(), nowObj.getMonth(), nowObj.getDate() + daysUntilSunday, 12, 0, 0);
    
    for (let i = 0; i < heatmapDays; i++) {
        const d = new Date(currentWeekSunday.getTime());
        d.setDate(d.getDate() - (heatmapDays - 1 - i));
        
        const dStr = getLocalDateString(d);
        const isFuture = dStr > todayStr;
        const count = isFuture ? 0 : (records.dailyCounts?.[dStr] || 0);
        
        heatmapData.push({
            count: count,
            date: d,
            isFuture: isFuture
        });
    }
    const heatmapMax = Math.max(1, ...heatmapData.map(cell => cell.count));

    // --- Achievements ---
    const achievementCats = getAchievements(allCards, streak, records);



    /* Lägena. Namn, beskrivning och märke kommer ur mockupen; id:t är det
     * appen redan känner. Ordningen är mockupens.
     *
     * Märkena är streckteckningar i samma penna som resten av gränssnittet —
     * en linje, en fylld ruta, en prick. De gamla lägena hade var sin färg och
     * var sitt dekorativa typsnitt, vilket gjorde spelhallen till en annan app
     * än den man just kom ifrån. */
    const modes = [
        {
            id: 'action',
            name: 'Action',
            desc: 'Tidspress och combo. Svara snabbt.',
            min: 1,
            count: Math.min(10, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M3 15L6 5"/><path d="M9 15L12 5"/><path d="M16 15L19 5"/></svg>`,
        },
        {
            id: 'lucktext',
            name: 'Lucktext',
            desc: 'Memorera svaret, fyll i nyckelorden.',
            min: 1,
            count: Math.min(15, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="8" width="4" height="4" fill="currentColor" stroke="none"/><rect x="7.6" y="7.6" width="4.8" height="4.8"/><rect x="14" y="8" width="4" height="4" fill="currentColor" stroke="none"/></svg>`,
        },
        {
            id: 'fritext',
            name: 'Fritext',
            desc: 'Skriv svaret ur minnet.',
            min: 1,
            count: Math.min(10, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 16.5h15"/><path d="M3.5 12.5c1.8-5.5 3.4-6 4.6-1.6c1-4.4 2.4-4.6 3.4-1.2"/><path d="M15.5 5v8.5"/></svg>`,
        },
        {
            id: 'jeopardy',
            name: 'Jeopardy',
            desc: 'Du ser svaret. Gissa frågan.',
            min: 2,
            count: Math.min(15, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="12.6" y="4.5" width="5.4" height="11" fill="currentColor" stroke="none"/><path d="M10.5 6.5L6.5 10L10.5 13.5"/><path d="M2 4.5v11"/></svg>`,
        },
        {
            id: 'dammiga',
            name: 'Dammiga kort',
            desc: 'De tjugo kort du inte rört på längst tid.',
            min: 1,
            count: Math.min(20, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.5" y="6.5" width="10" height="11" opacity="0.45"/><rect x="5" y="4.5" width="10" height="11" opacity="0.72"/><rect x="8.5" y="2.5" width="10" height="11"/></svg>`,
        },
        {
            id: 'suddendeath',
            name: 'Sudden Death',
            desc: 'Tre liv. Ett fel för mycket och det är slut.',
            min: 4,
            count: Math.min(20, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="4" cy="10" r="2.1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="2.1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="2.1"/><path d="M13.4 7.4L18.6 12.6" stroke-width="1.6"/><path d="M18.6 7.4L13.4 12.6" stroke-width="1.6"/></svg>`,
        },
        {
            id: 'transportbandet',
            name: 'Transportbandet',
            desc: 'Sortera fallande kort i rätt mapp.',
            min: 4,
            count: Math.min(20, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.5 16.5h17"/><rect x="3" y="10.5" width="5.5" height="5"/><rect x="11.5" y="10.5" width="5.5" height="5"/><rect x="4.6" y="2" width="4.4" height="4.4" fill="currentColor" stroke="none"/><path d="M6.8 7.2v2.4" stroke-dasharray="1.2 1.2"/></svg>`,
        },
        {
            id: 'dragkampen',
            name: 'Dragkampen',
            desc: 'Sant eller falskt. Dra mätaren till din sida.',
            min: 4,
            count: Math.min(20, totalCards),
            mark: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 10h16"/><path d="M2 6.5v7"/><path d="M18 6.5v7"/><path d="M12.5 4.5v11" stroke-width="2.4"/></svg>`,
        },
    ];

    /* Aktivitetskartan ritas i veckokolumner, inte som ett band av 84 rutor.
     * heatmapData börjar på en måndag och slutar på veckans söndag, så sju i
     * taget blir exakt en vecka per kolumn. */
    const weeks = [];
    for (let i = 0; i < heatmapData.length; i += 7) weeks.push(heatmapData.slice(i, i + 7));

    // Fyra steg, inte en genomskinlighet per tal: en ruta ska gå att placera i
    // en skala med ögat, inte jamforas pixel mot pixel.
    const heatLevel = (count) => {
        if (count <= 0) return '';
        const del = count / heatmapMax;
        if (del > 0.75) return ' is-4';
        if (del > 0.5) return ' is-3';
        if (del > 0.25) return ' is-2';
        return ' is-1';
    };

    const MANADER = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const manadFor = (vecka) => MANADER[vecka[0].date.getMonth()];
    const manadsrad = weeks.length
        ? [manadFor(weeks[0]), manadFor(weeks[Math.floor(weeks.length / 2)]), manadFor(weeks[weeks.length - 1])]
        : [];

    const heatCell = (cell) => {
        const d = cell.date;
        const titel = cell.isFuture
            ? `${d.getDate()}/${d.getMonth() + 1} — kommande`
            : `${d.getDate()}/${d.getMonth() + 1}: ${cell.count} repetitioner`;
        return `<i class="heat-cell${heatLevel(cell.count)}" title="${titel}"></i>`;
    };

    // Prestationerna. Kategori för kategori, låsta i halvton — de visar vad
    // som finns kvar att göra och ska därför inte gömmas.
    const achievementsHtml = Object.entries(achievementCats)
        .map(([kategori, lista]) => `
            <div class="arcade-ach-group">
                <h3 class="label arcade-ach-title">${escapeHtml(kategori)}</h3>
                <div class="arcade-ach-grid">
                    ${lista.map((a) => `
                        <div class="arcade-ach${a.unlocked ? '' : ' is-locked'}">
                            <span class="arcade-ach-name">${escapeHtml(a.title)}</span>
                            <span class="arcade-ach-desc">${escapeHtml(a.desc)}</span>
                        </div>`).join('')}
                </div>
            </div>`)
        .join('');

    const rekord = [
        records.bestDayCount
            ? { n: records.bestDayCount, l: 'kort på en dag' }
            : null,
        (records.bestStreak || streak) > 0
            ? { n: records.bestStreak || streak, l: 'dagars längsta streak' }
            : null,
        longestInterval >= 7 ? { n: longestInterval, l: 'dagars längsta intervall' } : null,
        avgPerDay > 0 ? { n: avgPerDay, l: 'snitt per aktiv dag' } : null,
        totalReviews > 0 ? { n: totalReviews, l: 'repetitioner totalt' } : null,
    ].filter(Boolean);

    const fmt = (n) => n.toLocaleString('sv-SE');

    // --- Render ---
    const html = `
        <div class="view-header">
            <h1 class="arcade-title">Spelhallen</h1>
            <div class="pg-custom-dropdown">
                <button id="pg-dropdown-trigger" type="button" class="btn" aria-expanded="${S.playgroundDropdownOpen}">
                    <span class="arcade-focus-label">Spela från</span>
                    <span id="pg-dropdown-selected-label">${S.playgroundFilterAll ? 'hela biblioteket' : (S.playgroundFilterSource.size === 0 ? 'inget valt' : `${S.playgroundFilterSource.size} val`)}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div id="pg-dropdown-menu" class="pg-tree-menu ${S.playgroundDropdownOpen ? '' : 'hidden'}">
                    <div id="pg-tree-content"></div>
                </div>
            </div>
        </div>

        <div class="arcade-top">
            <div class="arcade-mastery">
                <div class="arcade-stats">
                    <div>
                        <div class="n num">${fmt(newCards)}</div>
                        <div class="l">Nytt</div>
                    </div>
                    <div>
                        <div class="n num">${fmt(learningCards)}</div>
                        <div class="l">Lär</div>
                    </div>
                    <div>
                        <div class="n num is-accent">${fmt(masteredCards)}</div>
                        <div class="l">Mästrat</div>
                    </div>
                </div>
                <div class="progress arcade-bar" aria-hidden="true">
                    <i class="progress-fill" style="width:${masteredPct}%"></i>
                    <i class="progress-fill-soft" style="width:${learningPct}%"></i>
                </div>
                <p class="label arcade-total">${fmt(totalCards)} kort totalt${dueNow > 0 ? ` · ${fmt(dueNow)} förfallna` : ''}</p>
            </div>

            <div class="heat">
                <div class="heat-months">${manadsrad.map((m) => `<span>${m}</span>`).join('')}</div>
                <div class="heat-grid">
                    <div class="heat-days"><span>må</span><span></span><span>on</span><span></span><span>fr</span><span></span><span></span></div>
                    <div class="heat-cols${tona ? ' is-entering' : ''}">
                        ${weeks.map((v, i) => `<div class="heat-col" style="--i:${i}">${v.map(heatCell).join('')}</div>`).join('')}
                    </div>
                </div>
                <div class="heat-legend">
                    <span>mindre</span>
                    <i class="heat-cell"></i><i class="heat-cell is-1"></i><i class="heat-cell is-2"></i><i class="heat-cell is-3"></i><i class="heat-cell is-4"></i>
                    <span>mer</span>
                </div>
            </div>
        </div>

        <div class="arcade-modes${tona ? ' is-entering' : ''}">
            ${modes.map((m, i) => {
                const stangt = m.count < m.min;
                /* Knapp, inte länk. Lägena var <a> utan href: de gick inte att
                 * nå med tangentbord alls, och skärmläsaren läste dem som
                 * text. */
                /* Varje läge bär sin egen utblurrade bild, precis som varje
                 * kortlek gör. Samma läge får alltid samma — hallen ska gå att
                 * navigera på färgminne när man kommer tillbaka till den. */
                const bild = washUrl(`spel:${m.id}`);
                return `<button type="button" class="arcade-mode hero-wash${stangt ? ' is-closed is-quiet' : ''}" data-mode="${m.id}" style="--i:${i};--wash-photo:url('${bild}')" ${stangt ? 'disabled' : ''}>
                    <span class="arcade-mode-mark" aria-hidden="true">${m.mark}</span>
                    <span class="arcade-mode-name">${m.name}</span>
                    <span class="arcade-mode-desc">${stangt ? `Kräver minst ${m.min} kort.` : m.desc}</span>
                </button>`;
            }).join('')}
        </div>

        <section class="arcade-section">
            <h2 class="arcade-heading">Prestationer</h2>
            ${achievementsHtml}
        </section>

        ${rekord.length ? `
        <section class="arcade-section">
            <h2 class="arcade-heading">Rekord</h2>
            <div class="arcade-records">
                ${rekord.map((r) => `
                    <div class="arcade-record">
                        <span class="arcade-record-n num">${fmt(r.n)}</span>
                        <span class="arcade-record-l">${r.l}</span>
                    </div>`).join('')}
            </div>
        </section>` : ''}
    `;

    container.innerHTML = html;
    renderLatex(container);

    container.querySelectorAll('.arcade-mode[data-mode]').forEach((knapp) => {
        knapp.addEventListener('click', () => window.startPlaygroundStudy(knapp.dataset.mode));
    });

    /* Sifferanimeringen ar borttagen. Den raknade upp streaken fran noll vid
     * varje rendering, och den enda kvarvarande [data-target] i vyn ar tradets
     * expandera-pilar — samma selektor hade skrivit NaN i dem. Ett tal som
     * andras nar man tittar bort ar inte lugn precision. */

    // Focus tree dropdown
    const dropdownTrigger = document.getElementById('pg-dropdown-trigger');
    const dropdownMenu = document.getElementById('pg-dropdown-menu');
    const treeContent = document.getElementById('pg-tree-content');

    if (dropdownTrigger && dropdownMenu && treeContent) {
        // Build tree HTML
        const buildTree = () => {
            let html = '';

            // "Hela biblioteket" clear-all row
            html += `<label class="pg-tree-row pg-tree-root">
                <input type="checkbox" data-role="all" ${S.playgroundFilterAll ? 'checked' : ''}>
                <span class="pg-tree-text">Hela biblioteket</span>
            </label>`;

            // Collect leaf keys for a deck
            const getDeckLeaves = (deck) => {
                const leaves = [];
                const sections = deck.sections || [];
                sections.forEach(s => leaves.push(`deck:${deck.id}:section:${s.id}`));
                const hasUnsorted = deck.cards.some(c => c.type !== 'note' && !c.sectionId);
                if (hasUnsorted) leaves.push(`deck:${deck.id}:unsorted`);
                return leaves;
            };

            const renderDeck = (deck, indent) => {
                const leaves = getDeckLeaves(deck);
                if (leaves.length === 0) return '';
                const checkedLeaves = leaves.filter(l => S.playgroundFilterSource.has(l));
                const allChecked = S.playgroundFilterAll || checkedLeaves.length === leaves.length;
                const someChecked = !S.playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < leaves.length;
                const sections = deck.sections || [];
                const hasUnsorted = deck.cards.some(c => c.type !== 'note' && !c.sectionId);
                const hasChildren = sections.length > 0 || hasUnsorted;

                let h = `<div class="pg-tree-node" data-deck-id="${deck.id}">
                    <label class="pg-tree-row pg-tree-level-${indent}">
                        ${hasChildren ? `<span class="pg-tree-toggle" data-target="deck-${deck.id}">${S.playgroundExpandedNodes.has(`deck-${deck.id}`) ? '▼' : '▶'}</span>` : `<span class="pg-tree-toggle-spacer"></span>`}
                        <input type="checkbox" data-role="deck" data-deck-id="${deck.id}" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text">${escapeHtml(deck.title)}</span>
                        <span class="pg-tree-count">${deck.cards.filter(c => c.type !== 'note').length}</span>
                    </label>`;

                if (hasChildren) {
                    const isExpanded = S.playgroundExpandedNodes.has(`deck-${deck.id}`);
                    h += `<div class="pg-tree-children ${isExpanded ? '' : 'hidden'}" id="pg-tree-deck-${deck.id}">`;
                    sections.forEach(s => {
                        const sKey = `deck:${deck.id}:section:${s.id}`;
                        const sCount = deck.cards.filter(c => c.type !== 'note' && c.sectionId === s.id).length;
                        const sChecked = S.playgroundFilterAll || S.playgroundFilterSource.has(sKey);
                        h += `<label class="pg-tree-row pg-tree-level-${indent + 1}">
                            <span class="pg-tree-toggle-spacer"></span>
                            <input type="checkbox" data-role="section" data-key="${sKey}" data-deck-id="${deck.id}" ${sChecked ? 'checked' : ''}>
                            <span class="pg-tree-text">${escapeHtml(s.title)}</span>
                            <span class="pg-tree-count">${sCount}</span>
                        </label>`;
                    });
                    if (hasUnsorted) {
                        const uKey = `deck:${deck.id}:unsorted`;
                        const uCount = deck.cards.filter(c => c.type !== 'note' && !c.sectionId).length;
                        const uChecked = S.playgroundFilterAll || S.playgroundFilterSource.has(uKey);
                        h += `<label class="pg-tree-row pg-tree-level-${indent + 1}">
                            <span class="pg-tree-toggle-spacer"></span>
                            <input type="checkbox" data-role="section" data-key="${uKey}" data-deck-id="${deck.id}" ${uChecked ? 'checked' : ''}>
                            <span class="pg-tree-text pg-tree-unsorted">Osorterade kort</span>
                            <span class="pg-tree-count">${uCount}</span>
                        </label>`;
                    }
                    h += `</div>`;
                }
                h += `</div>`;
                return h;
            };

            // Bookshelves
            S.appData.bookshelves.forEach(shelf => {
                const shelfDecks = S.appData.decks.filter(d => d.bookshelfId === shelf.id);
                if (shelfDecks.length === 0) return;
                const shelfLeaves = shelfDecks.flatMap(getDeckLeaves);
                const checkedLeaves = shelfLeaves.filter(l => S.playgroundFilterSource.has(l));
                const allChecked = S.playgroundFilterAll || checkedLeaves.length === shelfLeaves.length;
                const someChecked = !S.playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < shelfLeaves.length;

                html += `<div class="pg-tree-node" data-shelf-id="${shelf.id}">
                    <label class="pg-tree-row pg-tree-level-0">
                        <span class="pg-tree-toggle" data-target="shelf-${shelf.id}">${S.playgroundExpandedNodes.has(`shelf-${shelf.id}`) ? '▼' : '▶'}</span>
                        <input type="checkbox" data-role="shelf" data-shelf-id="${shelf.id}" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text pg-tree-shelf-text">${escapeHtml(shelf.title)}</span>
                    </label>
                    <div class="pg-tree-children ${S.playgroundExpandedNodes.has(`shelf-${shelf.id}`) ? '' : 'hidden'}" id="pg-tree-shelf-${shelf.id}">
                        ${shelfDecks.map(d => renderDeck(d, 1)).join('')}
                    </div>
                </div>`;
            });

            // "Övriga kortlekar" — decks without bookshelfId
            const looseDecks = S.appData.decks.filter(d => !d.bookshelfId);
            if (looseDecks.length > 0) {
                const shelfLeaves = looseDecks.flatMap(getDeckLeaves);
                const checkedLeaves = shelfLeaves.filter(l => S.playgroundFilterSource.has(l));
                const allChecked = S.playgroundFilterAll || checkedLeaves.length === shelfLeaves.length;
                const someChecked = !S.playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < shelfLeaves.length;

                html += `<div class="pg-tree-node">
                    <label class="pg-tree-row pg-tree-level-0">
                        <span class="pg-tree-toggle" data-target="shelf-loose">${S.playgroundExpandedNodes.has('shelf-loose') ? '▼' : '▶'}</span>
                        <input type="checkbox" data-role="shelf-loose" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text pg-tree-shelf-text">Övriga kortlekar</span>
                    </label>
                    <div class="pg-tree-children ${S.playgroundExpandedNodes.has('shelf-loose') ? '' : 'hidden'}" id="pg-tree-shelf-loose">
                        ${looseDecks.map(d => renderDeck(d, 1)).join('')}
                    </div>
                </div>`;
            }

            treeContent.innerHTML = html;

            // Set indeterminate states
            treeContent.querySelectorAll('[data-indeterminate="true"]').forEach(cb => {
                cb.indeterminate = true;
            });
        };

        buildTree();

        // Collect all possible leaf keys
        const getAllLeaves = () => {
            const leaves = [];
            S.appData.decks.forEach(d => {
                (d.sections || []).forEach(s => leaves.push(`deck:${d.id}:section:${s.id}`));
                if (d.cards.some(c => c.type !== 'note' && !c.sectionId)) leaves.push(`deck:${d.id}:unsorted`);
            });
            return leaves;
        };

        const getDeckLeavesById = (deckId) => {
            const deck = S.appData.decks.find(d => d.id === deckId);
            if (!deck) return [];
            const leaves = [];
            (deck.sections || []).forEach(s => leaves.push(`deck:${deck.id}:section:${s.id}`));
            if (deck.cards.some(c => c.type !== 'note' && !c.sectionId)) leaves.push(`deck:${deck.id}:unsorted`);
            return leaves;
        };

        const getShelfLeaves = (shelfId) => {
            return S.appData.decks.filter(d => d.bookshelfId === shelfId).flatMap(d => getDeckLeavesById(d.id));
        };

        const updateLabel = () => {
            const label = document.getElementById('pg-dropdown-selected-label');
            if (label) label.textContent = S.playgroundFilterAll ? 'Hela biblioteket' : (S.playgroundFilterSource.size === 0 ? 'Inget valt' : `${S.playgroundFilterSource.size} val`);
        };

        // Checkbox change handler with cascade
        treeContent.addEventListener('change', (e) => {
            const cb = e.target;
            if (cb.type !== 'checkbox') return;
            const role = cb.dataset.role;
            const checked = cb.checked;
            const allLeaves = getAllLeaves();

            if (role === 'all') {
                if (checked) {
                    S.playgroundFilterAll = true;
                    S.playgroundFilterSource = new Set();
                } else {
                    S.playgroundFilterAll = false;
                    S.playgroundFilterSource = new Set();
                }
                buildTree();
                updateLabel();
                renderPlayground({ tona: false });
                return;
            }

            // If currently "all" (empty set) and user unchecks something, populate with all leaves first
            if (S.playgroundFilterAll && !checked) {
                S.playgroundFilterAll = false;
                S.playgroundFilterSource = new Set(allLeaves);
            }

            if (role === 'shelf') {
                const leaves = getShelfLeaves(cb.dataset.shelfId);
                leaves.forEach(l => checked ? S.playgroundFilterSource.add(l) : S.playgroundFilterSource.delete(l));
            } else if (role === 'shelf-loose') {
                const looseDecks = S.appData.decks.filter(d => !d.bookshelfId);
                const leaves = looseDecks.flatMap(d => getDeckLeavesById(d.id));
                leaves.forEach(l => checked ? S.playgroundFilterSource.add(l) : S.playgroundFilterSource.delete(l));
            } else if (role === 'deck') {
                const leaves = getDeckLeavesById(cb.dataset.deckId);
                leaves.forEach(l => checked ? S.playgroundFilterSource.add(l) : S.playgroundFilterSource.delete(l));
            } else if (role === 'section') {
                const key = cb.dataset.key;
                checked ? S.playgroundFilterSource.add(key) : S.playgroundFilterSource.delete(key);
            }

            // If all leaves are selected, reset to empty (= all)
            if (S.playgroundFilterSource.size >= allLeaves.length) {
                S.playgroundFilterAll = true;
                S.playgroundFilterSource = new Set();
            }

            buildTree();
            updateLabel();
            renderPlayground({ tona: false });
        });

        // Toggle expand/collapse
        treeContent.addEventListener('click', (e) => {
            const toggle = e.target.closest('.pg-tree-toggle');
            if (!toggle) return;
            e.stopPropagation();
            e.preventDefault(); // Prevent triggering the label click which checks/unchecks the box
            const targetId = toggle.dataset.target;
            const children = document.getElementById(`pg-tree-${targetId}`);
            if (children) {
                const isHidden = children.classList.toggle('hidden');
                toggle.textContent = isHidden ? '▶' : '▼';
                
                // Save state
                if (isHidden) {
                    S.playgroundExpandedNodes.delete(targetId);
                } else {
                    S.playgroundExpandedNodes.add(targetId);
                }
            }
        });

        // Clean up previous event listener if it exists to avoid memory leaks/ghost closings
        if (window.activePlaygroundCloseMenu) {
            document.removeEventListener('click', window.activePlaygroundCloseMenu);
        }

        // Stop propagation inside dropdown menu to prevent triggering document's closeMenu on clicks
        dropdownMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Open/close dropdown
        const closeMenu = (e) => {
            if (!dropdownTrigger.contains(e.target) && !dropdownMenu.contains(e.target)) {
                S.playgroundDropdownOpen = false;
                dropdownMenu.classList.add('hidden');
                const svg = dropdownTrigger.querySelector('svg');
                if (svg) svg.style.transform = 'rotate(0deg)';
                document.removeEventListener('click', closeMenu);
                window.activePlaygroundCloseMenu = null;
            }
        };
        window.activePlaygroundCloseMenu = closeMenu;

        dropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            S.playgroundDropdownOpen = !S.playgroundDropdownOpen;
            if (S.playgroundDropdownOpen) {
                dropdownMenu.classList.remove('hidden');
                document.addEventListener('click', closeMenu);
                window.activePlaygroundCloseMenu = closeMenu;
            } else {
                dropdownMenu.classList.add('hidden');
                document.removeEventListener('click', closeMenu);
                window.activePlaygroundCloseMenu = null;
            }
            const svg = dropdownTrigger.querySelector('svg');
            if (svg) {
                svg.style.transform = S.playgroundDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });

        if (S.playgroundDropdownOpen) {
            document.addEventListener('click', closeMenu);
        }

        // Restore scroll positions to prevent jumping
        dropdownMenu.scrollTop = oldMenuScrollTop;
        window.scrollTo(window.scrollX, oldWindowScrollY);
    }
};

/* Vägen ut ur ett spelläge.
 *
 * Här låg tidigare en generisk resultatvy med en egen textrad per läge. Den
 * är borta: alla åtta lägen bygger numera sin egen slutbild med jämförelse
 * mot personligt rekord, och den generiska visades OVANPÅ den — två
 * sammanfattningar av samma runda, där den andra sa mindre.
 *
 * Den räknade dessutom fel. `S.playgroundSessionStats` bokförs på två
 * ställen samtidigt: `processRating` i study.js skriver varje betyg, och
 * flera lägen skrev därtill sina egna tal i samma fält. Ett läge räknade
 * varje kort dubbelt, ett skrev poängsumman i fältet för antal rätt och
 * påstod "340 kort sorterade", ett skrev aldrig alls och sa "0 av 0 rätt".
 *
 * Objektet finns kvar eftersom study.js skriver till det, men ingenting
 * visar det längre. **Lita inte på dess innehåll** — betydelsen skiljer sig
 * mellan lägen. Ett läge som vill visa tal äger sin egen slutbild.
 *
 * skipResults finns kvar i signaturen för de anropsställen som redan skickar
 * true; den har ingen effekt längre, eftersom alla vägar ut går hit.
 */
export const finishPlaygroundSession = () => {
    S.playgroundMode = null;
    S.isPlaygroundSession = false;
    S.playgroundEscAbort = false;
    S.lastSessionWasPlayground = true;

    // Rensar dagsräkningar äldre än 90 dagar. Argumenten används inte.
    updatePersonalRecords();

    switchView('playground');
    renderPlayground();
};

export function initUiPlayground() {

  S.playgroundMode = null;
  S.playgroundSessionStats = { correct: 0, again: 0, total: 0, startTime: 0 };

  window.startPlaygroundStudy = (mode) => {
      const now = Date.now();
      const safeCreated = (c) => Math.min(parseInt(c.id, 10), now);

      let allCards = S.appData.decks.flatMap(d => {
          return d.cards.filter(c => c.type !== 'note').map(c => ({...c, originalDeckId: d.id}));
      });

      // Apply playground tree-filter
      if (!S.playgroundFilterAll) {
          allCards = allCards.filter(c => {
              const sKey = c.sectionId ? `deck:${c.originalDeckId}:section:${c.sectionId}` : `deck:${c.originalDeckId}:unsorted`;
              return S.playgroundFilterSource.has(sKey);
          });
      }

      if (allCards.length === 0) {
          showToast('Fokusområdet innehåller inga kort att spela med.');
          return;
      }

      let selectedCards = [];

      if (mode === 'dammiga') {
          selectedCards = [...allCards].sort((a, b) => {
              const aTime = a.lastReviewed || safeCreated(a);
              const bTime = b.lastReviewed || safeCreated(b);
              return aTime - bTime;
          }).slice(0, 20);
      } else if (mode === 'jeopardy') {
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 15)
              .map(c => ({ ...c, front: c.back, back: c.front, _jeopardy: true }));
      } else if (mode === 'action') {
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 10);
      } else if (mode === 'lucktext') {
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 10);
      } else if (mode === 'fritext') {
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 10);
      } else if (mode === 'suddendeath') {
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 20);
      } else if (mode === 'transportbandet') {
          const sectionCards = [];
          allCards.forEach(c => {
              if (c.sectionId) {
                  const d = S.appData.decks.find(deck => deck.id === c.originalDeckId);
                  if (d && d.sections) {
                      const sectionObj = d.sections.find(s => s.id === c.sectionId);
                      if (sectionObj) {
                          sectionCards.push({...c, _sectionTitle: sectionObj.title});
                      }
                  }
              }
          });
          if (sectionCards.length < 4) { showToast('Du behöver minst 4 kort med mappar för detta läge.'); return; }
          // Pass the full pool; transportbandetReveal will pick best 4 categories and re-filter
          selectedCards = fisherYatesShuffle(sectionCards);
      } else if (mode === 'dragkampen') {
          if (allCards.length < 4) { showToast('Du behöver minst 4 kort.'); return; }
          selectedCards = fisherYatesShuffle([...allCards]).slice(0, 20);
      }

      if (selectedCards.length > 0) {
          S.playgroundMode = mode;
          S.playgroundSessionStats = { correct: 0, again: 0, total: selectedCards.length, startTime: Date.now() };
          S.currentStudyCards = selectedCards;
          S.currentStudyIndex = 0;
          S.currentDeckId = null;
          S.isPlaygroundSession = true;

          if (mode === 'suddendeath') {
              switchView('study');
              suddenDeathReveal(allCards);
              return;
          }
          if (mode === 'transportbandet') {
              switchView('study');
              transportbandetReveal();
              return;
          }
          if (mode === 'dragkampen') {
              switchView('study');
              dragkampenReveal(allCards);
              return;
          }
          if (mode === 'action') {
              switchView('study');
              actionReveal(allCards);
              return;
          }
          if (mode === 'lucktext') {
              switchView('study');
              lucktextReveal(allCards);
              return;
          }
          if (mode === 'jeopardy') {
              switchView('study');
              jeopardyReveal();
              return;
          }
          if (mode === 'dammiga') {
              switchView('study');
              dammigaReveal();
              return;
          }
          if (mode === 'fritext') {
              switchView('study');
              fritextSessionReveal();
              return;
          }

          switchView('study');

          renderStudyCard();
      }
  };
}
