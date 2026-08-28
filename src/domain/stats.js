import { S } from '../core/state.js';


// --- PERSONAL RECORDS & TIMEZONES ---
export const getLocalDateString = (date = new Date()) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().slice(0, 10);
};

export const loadRecords = () => {
    try {
        return JSON.parse(localStorage.getItem('pg_records') || '{}');
    } catch { return {}; }
};
export const saveRecords = (r) => localStorage.setItem('pg_records', JSON.stringify(r));

export const updatePersonalRecords = (cardsAnswered, elapsedSec) => {
    const r = loadRecords();
    const today = getLocalDateString();
    if (!r.dailyCounts) r.dailyCounts = {};

    // Clean old daily counts (keep 90 days)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = getLocalDateString(cutoff);
    for (const key of Object.keys(r.dailyCounts)) {
        if (key < cutoffStr) delete r.dailyCounts[key];
    }

    saveRecords(r);
};

export const getAchievements = (allCards, streak, records) => {
    const totalReviewed = allCards.filter(c => c.lastReviewed).length;
    const mastered = allCards.filter(c => c.interval >= 21).length;
    const totalDecks = S.appData.decks.length;

    const categories = {
        'Studiemilstolpar': [],
        'Streak-rekord': [],
        'Samling & Bibliotek': []
    };

    const add = (category, title, desc, current, target) => {
        const unlocked = current >= target;
        categories[category].push({
            title,
            desc: unlocked ? desc : `${desc} (${current}/${target})`,
            unlocked
        });
    };

    add('Studiemilstolpar', 'Första steget', 'Repeterat ditt första kort', totalReviewed, 1);
    add('Studiemilstolpar', 'Hundralappen', '100 kort repeterade', totalReviewed, 100);
    add('Studiemilstolpar', 'Halvtusen', '500 kort repeterade', totalReviewed, 500);
    add('Studiemilstolpar', 'Tusenlappen', '1000 kort repeterade', totalReviewed, 1000);
    add('Studiemilstolpar', 'Solitt minne', '10 kort i långtidsminnet', mastered, 10);
    add('Studiemilstolpar', 'Kunskapsbank', '50 kort i långtidsminnet', mastered, 50);
    add('Studiemilstolpar', 'Encyklopedi', '200 kort i långtidsminnet', mastered, 200);

    add('Streak-rekord', 'Tredjegången gillt', '3 dagars streak', streak, 3);
    add('Streak-rekord', 'Hel vecka', '7 dagars streak', streak, 7);
    add('Streak-rekord', 'Månadsmaskinen', '30 dagars streak', streak, 30);

    add('Samling & Bibliotek', 'Samlare', '50 kort i biblioteket', allCards.length, 50);
    add('Samling & Bibliotek', 'Bibliotekarie', '200 kort i biblioteket', allCards.length, 200);
    add('Samling & Bibliotek', 'Många järn i elden', '5 kortlekar skapade', totalDecks, 5);

    return categories;
};
