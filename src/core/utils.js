
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

export const fetchWithRetry = async (url, options, maxRetries = 3) => {
    let delay = 1000;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && (response.status === 429 || response.status === 503 || response.status === 529 || response.status >= 500)) {
                console.warn(`API overloaded (${response.status}), retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay *= 2; // Exponential backoff
                continue;
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.warn(`Fetch failed (${error.message}), retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
    throw new Error('Overloaded: API:et är överbelastat. Försök igen om en liten stund.');
};
