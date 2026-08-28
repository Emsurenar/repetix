import renderMathInElement from 'katex/contrib/auto-render';

// --- LATEX HELPER ---
export const renderLatex = (element) => {
    if (element) {
        renderMathInElement(element, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false
        });
    }
};
