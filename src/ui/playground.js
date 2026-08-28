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
import { transportbandetReveal } from '../games/transportbandet.js';
import { safeParse } from './images.js';
import { renderLatex } from './latex.js';
import { switchView } from './router.js';
import { renderStudyCard } from './study.js';
import { showToast } from './toast.js';


export const renderPlayground = () => {
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
    const DAY = 1000 * 60 * 60 * 24;
    const records = loadRecords();
    const parseCreated = (c) => Math.min(parseInt(c.id, 10), now);

    // --- Core stats ---
    const totalCards = allCards.length;
    const newCards = allCards.filter(c => c.repetition === 0).length;
    const learningCards = allCards.filter(c => c.repetition > 0 && c.interval < 21).length;
    const masteredCards = allCards.filter(c => c.interval >= 21).length;
    const newPct = totalCards > 0 ? (newCards / totalCards * 100) : 0;
    const learningPct = totalCards > 0 ? (learningCards / totalCards * 100) : 0;
    const masteredPct = totalCards > 0 ? (masteredCards / totalCards * 100) : 0;

    const dueNow = allCards.filter(c => c.nextReviewDate <= now).length;
    const todayStr = getLocalDateString();
    const todayCount = records.dailyCounts?.[todayStr] || 0;
    const totalTodayTasks = todayCount + dueNow;
    const completionPct = totalTodayTasks > 0 ? Math.round((todayCount / totalTodayTasks) * 100) : 100;

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
    const totalReviewed = allCards.filter(c => c.lastReviewed).length;
    const longestInterval = Math.ceil(Math.max(0, ...allCards.map(c => c.interval || 0)));
    const dailyCountValues = Object.values(records.dailyCounts || {});
    const activeDays = dailyCountValues.filter(v => v > 0).length;
    const totalReviews = dailyCountValues.reduce((s, v) => s + v, 0);
    const avgPerDay = activeDays > 0 ? Math.round(totalReviews / activeDays) : 0;

    // --- Hardest card (most lapses, or shortest interval) ---
    let hardestCard = null;
    let worstScore = -1;
    allCards.forEach(c => {
        const score = (c.lapses || 0) * 10 + (c.repetition > 0 ? (1 / Math.max(0.1, c.interval)) : 0);
        if (score > worstScore && c.repetition > 0) { worstScore = score; hardestCard = c; }
    });

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

    // --- Yesterday count for "beat yesterday" ---
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);
    const yesterdayCount = records.dailyCounts?.[yesterdayStr] || 0;

    // --- Insight (deterministic per day, not random) ---
    let insightText = '';
    if (totalCards === 0) {
        insightText = 'Tomt bibliotek. Skapa en kortlek för att börja.';
    } else {
        const seed = new Date().getDate();
        const pool = [];
        if (yesterdayCount > 0) pool.push(`Du repeterade ${yesterdayCount} kort igår.`);
        if (streak > 7) pool.push(`${streak} dagar i rad.`);
        else if (streak > 2) pool.push(`${streak} dagar i rad. Varje dag räknas.`);
        if (dueNow === 0 && totalCards > 5) pool.push('Allt klart för idag.');
        else if (dueNow > 20) pool.push(`${dueNow} kort väntar.`);
        if (masteredCards > totalCards * 0.5) pool.push(`Över hälften av dina kort är mästrade.`);
        if (pool.length > 0) insightText = pool[seed % pool.length];
    }

    // --- Achievements ---
    const achievementCats = getAchievements(allCards, streak, records);

    // --- Mode availability ---
    const reviewedCards = allCards.filter(c => c.repetition > 0);
    const unStudied = allCards.filter(c => !c.lastReviewed || c.repetition <= 1);
    const monthAgo = now - 30 * DAY;
    const timeTravel = allCards.filter(c => { const cr = parseCreated(c); return cr >= monthAgo - 7*DAY && cr <= monthAgo; });

    const modes = [
        {
            id: 'suddendeath',
            title: 'Sudden Death',
            desc: 'Tre hjärtan. Tidtagen flerval. Slå ditt rekord.',
            arrow: 'Kör',
            count: Math.min(20, totalCards),
            min: 4,
            themeClass: 'pg-mode-suddendeath',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
        },
        {
            id: 'transportbandet',
            title: 'Transport-<br>bandet',
            desc: 'Sortera fallande kort i rätt mapp innan de kraschar.',
            arrow: 'Spela',
            count: Math.min(20, totalCards),
            min: 4,
            themeClass: 'pg-mode-transportbandet',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
        },
        {
            id: 'dragkampen',
            title: 'Dragkampen',
            desc: 'Binära val. Dra markören till din sida.',
            arrow: 'Fightas',
            count: Math.min(20, totalCards),
            min: 4,
            themeClass: 'pg-mode-dragkampen',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
        },
        { 
            id: 'jeopardy', 
            title: 'Jeopardy', 
            desc: 'Se svaret — gissa frågan.', 
            arrow: 'Spela', 
            count: Math.min(15, totalCards), 
            min: 2,
            themeClass: 'pg-mode-jeopardy',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        },
        { 
            id: 'dammiga', 
            title: 'Dammiga kort', 
            desc: 'Längst tid utan repetition.', 
            arrow: 'Starta', 
            count: Math.min(20, totalCards), 
            min: 1,
            themeClass: 'pg-mode-dammiga',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 2h14M5 22h14M19 2l-7 7-7-7M5 22l7-7 7 7"/></svg>`
        },
        { 
            id: 'action', 
            title: 'Action-<br>repetition', 
            desc: 'Slammande ord under tidspress. Genuin action.', 
            arrow: 'Kör', 
            count: Math.min(10, totalCards), 
            min: 1,
            themeClass: 'pg-mode-action',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`
        },
        {
            id: 'lucktext',
            title: 'Lucktext',
            desc: 'Memorera svaret, fyll sedan i nyckelorden.',
            arrow: 'Starta',
            count: Math.min(15, totalCards),
            min: 1,
            themeClass: 'pg-mode-lucktext',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="15" y1="12" x2="17" y2="12"/><line x1="7" y1="17" x2="17" y2="17"/></svg>`
        },
        {
            id: 'fritext',
            title: 'Fritext',
            desc: 'Skriv svaret ur minnet. Se hur mycket du kom ihåg.',
            arrow: 'Starta',
            count: Math.min(10, totalCards),
            min: 1,
            themeClass: 'pg-mode-fritext',
            iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`
        },
    ];

    // Build achievements HTML dynamically by category
    let achievementsHtml = '';
    Object.entries(achievementCats).forEach(([catName, list]) => {
        achievementsHtml += `
            <div class="pg-ach-category" style="margin-bottom: 2rem;">
                <h3 style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.25rem; letter-spacing: 0.03em;">${catName}</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.75rem;">
                    ${list.map(a => `
                        <div class="pg-achievement" style="padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--surface-color); ${a.unlocked ? '' : 'opacity: 0.45;'}">
                            <span style="display: block; font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.2rem;">${a.title}</span>
                            <span style="display: block; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.3;">${a.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    // --- Render ---
    let html = `
        <article class="pg-article">
            <header class="pg-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 2.5rem; position: relative;">
                <div>
                    <h1 class="pg-title" style="margin-bottom: 0.25rem;">Spelhallen</h1>
                    ${insightText ? `<p class="pg-insight" style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">${insightText}</p>` : ''}
                </div>
                
                <!-- Focus Tree Dropdown -->
                <div class="pg-custom-dropdown" style="position: relative; z-index: 100;">
                    <button id="pg-dropdown-trigger" class="pg-focus-trigger">
                        <span class="pg-focus-label">Fokusera:</span>
                        <span id="pg-dropdown-selected-label">${S.playgroundFilterAll ? 'Hela biblioteket' : (S.playgroundFilterSource.size === 0 ? 'Inget valt' : `${S.playgroundFilterSource.size} val`)}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity: 0.7; margin-left: 0.25rem; transform: ${S.playgroundDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div id="pg-dropdown-menu" class="pg-tree-menu ${S.playgroundDropdownOpen ? '' : 'hidden'}">
                        <div id="pg-tree-content"></div>
                    </div>
                </div>
            </header>

            <!-- Unified Premium Dashboard Widget -->
            <section class="pg-section" style="margin-bottom: 2.5rem;">
                <div class="pg-dashboard-card">
                    <div class="pg-db-streak">
                        <div class="pg-db-streak-badge ${streak > 0 ? 'active' : ''}">
                            <svg class="pg-flame-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
                            </svg>
                        </div>
                        <div class="pg-db-streak-info">
                            <span class="pg-db-streak-title">Streak</span>
                            <span class="pg-db-streak-val"><span data-target="${streak}">${streak}</span> ${streak === 1 ? 'dag' : 'dagar'}</span>
                        </div>
                    </div>
                    
                    <div class="pg-db-divider"></div>
                    
                    <div class="pg-db-mastery">
                        <div class="pg-db-mastery-header">
                            <span class="pg-db-mastery-title">Inlärningsstatus</span>
                            <span class="pg-db-health-badge" title="Du har repeterat ${todayCount} av dagens ${totalTodayTasks} schemalagda kort.">${completionPct}% avklarat idag</span>
                        </div>
                        <div class="pg-mastery-bar">
                            <div class="pg-mastery-seg pg-mastery-new" style="width:${newPct}%" title="${newCards} ostuderade"></div>
                            <div class="pg-mastery-seg pg-mastery-learning" style="width:${learningPct}%" title="${learningCards} i korttidsminnet"></div>
                            <div class="pg-mastery-seg pg-mastery-mastered" style="width:${masteredPct}%" title="${masteredCards} mästrade"></div>
                        </div>
                        <div class="pg-mastery-legend">
                            <span><span class="pg-dot pg-dot-new"></span>${newCards} Ostuderade</span>
                            <span><span class="pg-dot pg-dot-learning"></span>${learningCards} Korttidsminne</span>
                            <span><span class="pg-dot pg-dot-mastered"></span>${masteredCards} Långtidsminne</span>
                            <span style="margin-left:auto;font-weight:600;">${totalCards} totalt</span>
                        </div>
                    </div>
                </div>
            </section>

            ${hardestCard ? `
            <section class="pg-section">
                <h2 class="pg-heading">Hjärnsläpp</h2>
                <div class="pg-wall-card" onclick="startPlaygroundStudy('suddendeath')" style="cursor:pointer; border: 1px dashed var(--rate-1); background: rgba(234,67,53,0.01);">
                    <div class="pg-wall-front">${safeParse(hardestCard.front)}</div>
                    <div class="pg-wall-action" style="color: var(--rate-1);">Utmana dig i Sudden Death &rarr;</div>
                </div>
            </section>` : ''}

            <section class="pg-section">
                <h2 class="pg-heading">Lägen</h2>
                <div class="pg-modes">
                    ${modes.map((m, idx) => {
                        const disabled = m.count < m.min;
                        return `<a class="pg-mode ${m.themeClass || ''}${disabled ? ' pg-mode-disabled' : ''}" data-mode-idx="${idx}" ${disabled ? '' : `onclick="startPlaygroundStudy('${m.id}')"`}>
                            <div class="pg-mode-header">
                                <span class="pg-mode-icon">${m.iconSvg || ''}</span>
                                <span class="pg-mode-title">${m.title}</span>
                            </div>
                            <p class="pg-mode-desc">${m.desc}</p>
                            <span class="pg-mode-footer">
                                <span class="pg-mode-count">${disabled ? m.min + '+ kort krävs' : m.count + ' kort'}</span>
                                ${disabled ? '' : `<span class="pg-mode-arrow">${m.arrow} &rarr;</span>`}
                            </span>
                        </a>`;
                    }).join('')}
                </div>
            </section>

            <section class="pg-section">
                <h2 class="pg-heading">Aktivitet</h2>
                <div class="pg-heatmap-card">
                    <div style="display: flex; gap: 0.6rem; align-items: flex-start; justify-content: center; width: 100%;">
                        <div class="pg-heatmap-labels" style="display: grid; grid-template-rows: repeat(7, 18px); gap: 4px; font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; line-height: 18px; text-align: right; padding-right: 6px;">
                            <span>Mån</span>
                            <span></span>
                            <span>Ons</span>
                            <span></span>
                            <span>Fre</span>
                            <span></span>
                            <span>Sön</span>
                        </div>
                        <div class="pg-heatmap">
                            ${heatmapData.map((cell) => {
                                const count = cell.count;
                                const opacity = count === 0 ? 0 : Math.max(0.2, count / heatmapMax);
                                const d = cell.date;
                                const label = cell.isFuture 
                                    ? `${d.getDate()}/${d.getMonth()+1} (Kommande)`
                                    : `${d.getDate()}/${d.getMonth()+1}: ${count} repetitioner`;
                                return `<div class="pg-heatmap-cell" ${count === 0 ? '' : `style="background:rgba(26,115,232,${opacity})"`} title="${label}"></div>`;
                            }).join('')}
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.35rem; font-size: 0.75rem; color: var(--text-secondary); align-items: center; justify-content: center; width: 100%; border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.25rem;">
                        <span>Mindre aktiv</span>
                        <div style="width: 10px; height: 10px; background: var(--heatmap-empty, #e2e8f0); border-radius: 2px;"></div>
                        <div style="width: 10px; height: 10px; background: rgba(26,115,232,0.3); border-radius: 2px;"></div>
                        <div style="width: 10px; height: 10px; background: rgba(26,115,232,0.6); border-radius: 2px;"></div>
                        <div style="width: 10px; height: 10px; background: rgba(26,115,232,1); border-radius: 2px;"></div>
                        <span>Mer aktiv</span>
                    </div>
                </div>
            </section>

            <section class="pg-section">
                <h2 class="pg-heading">Prestationer</h2>
                ${achievementsHtml}
            </section>

            ${(records.bestDayCount || totalReviewed > 0) ? `
            <section class="pg-section">
                <h2 class="pg-heading">Rekord</h2>
                <div class="pg-records">
                    ${records.bestDayCount ? `<div class="pg-record">
                        <span class="pg-record-value">${records.bestDayCount}</span>
                        <span class="pg-record-label">kort på en dag</span>
                        ${records.bestDay ? `<span class="pg-record-date">${new Date(records.bestDay).toLocaleDateString('sv-SE', {day: 'numeric', month: 'short'})}</span>` : ''}
                    </div>` : ''}
                    ${(records.bestStreak || streak) > 0 ? `<div class="pg-record">
                        <span class="pg-record-value">${records.bestStreak || streak}</span>
                        <span class="pg-record-label">längsta streak</span>
                        ${streak > 0 && streak < (records.bestStreak || 0) ? `<span class="pg-record-date">Nu: ${streak}d</span>` : ''}
                    </div>` : ''}
                    ${longestInterval >= 7 ? `<div class="pg-record">
                        <span class="pg-record-value">${longestInterval}</span>
                        <span class="pg-record-label">dagars längsta intervall</span>
                    </div>` : ''}
                    ${avgPerDay > 0 ? `<div class="pg-record">
                        <span class="pg-record-value">${avgPerDay}</span>
                        <span class="pg-record-label">snitt per aktiv dag</span>
                    </div>` : ''}
                    ${totalReviews > 0 ? `<div class="pg-record">
                        <span class="pg-record-value">${totalReviews}</span>
                        <span class="pg-record-label">repetitioner totalt</span>
                    </div>` : ''}
                </div>
            </section>` : ''}
        </article>
    `;

    container.innerHTML = html;
    renderLatex(container);

    // Animate numbers
    container.querySelectorAll('[data-target]').forEach(el => {
        const target = parseInt(el.dataset.target);
        if (target <= 0) return;
        el.textContent = '0';
        const duration = 400;
        const start = performance.now();
        const tick = (time) => {
            const progress = Math.min((time - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(target * eased);
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

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
                renderPlayground();
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
            renderPlayground();
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

export const finishPlaygroundSession = (skipResults = false) => {
    const mode = S.playgroundMode;
    S.playgroundMode = null;
    S.isPlaygroundSession = false;
    const shouldSkip = skipResults || S.playgroundEscAbort;
    S.playgroundEscAbort = false;
    S.lastSessionWasPlayground = true;

    if (shouldSkip) {
        switchView('playground');
        renderPlayground();
        return;
    }

    const stats = S.playgroundSessionStats;
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    const answered = stats.correct + stats.again;

    // Update personal records
    updatePersonalRecords(answered, elapsed);

    let resultTitle = '';
    let resultDesc = '';

    if (mode === 'jeopardy') {
        resultTitle = `${stats.correct} av ${answered} rätt`;
        resultDesc = `Du kände igen frågan från svaret ${stats.correct} gånger.`;
    } else if (mode === 'suddendeath') {
        resultTitle = `${stats.correct} poäng`;
        resultDesc = stats.correct > 0 ? 'Grymt kört! Prova att slå det nästa gång.' : 'Kämpa på, övning ger färdighet!';
    } else if (mode === 'transportbandet') {
        resultTitle = `${stats.correct} kort sorterade`;
        resultDesc = `${stats.again > 0 ? `${stats.again} hamnade i fel korg.` : 'Perfekt sortering!'}`;
    } else if (mode === 'lucktext') {
        resultTitle = `${stats.correct} luckor rätt`;
        resultDesc = `${answered} kort avklarade på ${elapsed}s.`;
    } else if (mode === 'dragkampen') {
        const won = stats._dragkampenWon;
        resultTitle = won ? 'Du vann!' : 'Datorn vann...';
        resultDesc = `${stats.correct} rätt av ${answered} bedömningar.`;
    } else if (mode === 'action') {
        resultTitle = `${stats.correct} poäng`;
        resultDesc = `${stats.total} kort avklarade på ${elapsed}s.`;
    } else {
        resultTitle = `${answered} kort klara`;
        resultDesc = `${stats.correct} utan "Igen"${stats.again > 0 ? `, ${stats.again} omtag` : ''}.`;
    }

    // Use the existing complete view but update its text
    const completeView = document.getElementById('view-study-complete');
    completeView.querySelector('h1').textContent = resultTitle;
    completeView.querySelector('p').textContent = resultDesc;
    completeView.querySelector('#btn-complete-back').textContent = 'Tillbaka till Spelhallen';
    switchView('complete');
};

export function initUiPlayground() {

  S.playgroundMode = null;
  S.playgroundSessionStats = { correct: 0, again: 0, total: 0, startTime: 0 };

  window.startPlaygroundStudy = (mode) => {
      const now = Date.now();
      const DAY = 1000 * 60 * 60 * 24;
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
