
// --- BREADCRUMB ---
/* En brödsmula med en enda smula säger inget som rubriken under inte redan
 * säger. Klassen styr synligheten från stilmallen, så att vyerna slipper
 * känna till den. */
export const updateBreadcrumb = (crumbs) => {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    bc.classList.toggle('has-trail', crumbs.length > 1);
    bc.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const sep = i < crumbs.length - 1 ? '<svg class="breadcrumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4; margin: 0 4px; vertical-align: middle;"><path d="M9 18l6-6-6-6"/></svg>' : '';
        if (isLast) return `<span class="breadcrumb-item active">${c.label}</span>`;
        return `<span class="breadcrumb-item" onclick="${c.action}">${c.label}</span>${sep}`;
    }).join('');
};
