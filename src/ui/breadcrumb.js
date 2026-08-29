import { escapeHtml } from '../core/utils.js';

// --- BREADCRUMB ---

/* Smulorna sparas mellan renderingarna: klicket ligger på behållaren och slår
 * upp sin smula på index, precis som sökträffarna i search.js. Handlingen var
 * tidigare en kodsträng i ett onclick, sammansatt av kortlekens id — ett id
 * kommer från en importerad backupfil och kunde alltså skriva om vad strängen
 * gjorde. En sträng som körs som kod går inte att sanera, och den hindrar en
 * CSP med script-src 'self'. */
let smulor = [];
let kopplad = null;

export const updateBreadcrumb = (crumbs) => {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    smulor = crumbs;

    // Lyssnaren sätts en gång per element, inte en gång per rendering.
    if (kopplad !== bc) {
        kopplad = bc;
        bc.addEventListener('click', (event) => {
            const item = event.target.closest('.breadcrumb-item[data-crumb]');
            if (!item) return;
            smulor[Number(item.dataset.crumb)]?.action?.();
        });
    }

    /* En brödsmula med en enda smula säger inget som rubriken under inte redan
     * säger. Klassen styr synligheten från stilmallen, så att vyerna slipper
     * känna till den. */
    bc.classList.toggle('has-trail', crumbs.length > 1);
    bc.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const sep = i < crumbs.length - 1 ? '<svg class="breadcrumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4; margin: 0 4px; vertical-align: middle;"><path d="M9 18l6-6-6-6"/></svg>' : '';
        // Etiketten är en titel användaren skrivit, eller som följde med en
        // importerad fil.
        if (isLast) return `<span class="breadcrumb-item active">${escapeHtml(c.label)}</span>`;
        return `<span class="breadcrumb-item" data-crumb="${i}">${escapeHtml(c.label)}</span>${sep}`;
    }).join('');
};
