
// --- UTILS ---
export const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

export const fisherYatesShuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// fetchWithRetry bodde här tidigare. Den fanns bara för Anthropic-anropen, och
// omförsöken sitter numera i src/ai/call.js där de kan ta hänsyn till
// felkoden och leverantörens Retry-After.
