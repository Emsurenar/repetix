/* Tickskalan.
 *
 * Allt som visar mängd i appen ritas med samma tre primitiv: en linje, en
 * prick, en fylld ruta. Tickskalan är kölängden: ett streck per kort, de
 * avklarade i accent, det man står på i bläck, resten i spårets ton.
 *
 * En sammanhängande stapel hade bara kunnat säga "58 %". Strecken säger "sju
 * av nitton", vilket är den fråga man faktiskt ställer sig mitt i ett pass.
 *
 * Över taket blir strecken smalare än mellanrummen och går inte längre att
 * räkna. Då komprimeras skalan i stället: den behåller sin proportion men
 * slutar göra anspråk på att vara räknebar.
 */

const MAX_TICKS = 24;

/**
 * @param {number} total  antal kort i kön
 * @param {number} done   antal avklarade; det (done+1):e strecket blir markören
 * @returns {string} HTML för en <span class="ticks">
 */
export const ticksHtml = (total, done = 0) => {
    if (!Number.isFinite(total) || total <= 0) return '';

    const n = Math.min(Math.floor(total), MAX_TICKS);
    const filled = Math.max(0, Math.min(Math.round((done / total) * n), n));

    let marks = '';
    for (let i = 0; i < n; i += 1) {
        if (i < filled) marks += '<i class="is-on"></i>';
        else if (i === filled) marks += '<i class="is-now"></i>';
        else marks += '<i></i>';
    }
    return `<span class="ticks" aria-hidden="true">${marks}</span>`;
};
