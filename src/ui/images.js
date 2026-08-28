import { marked } from 'marked';
import { S } from '../core/state.js';


export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

export const renderImagePreviews = (containerEl, imagesArr, onDelete) => {
    containerEl.innerHTML = '';
    imagesArr.forEach((dataUrl, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'image-preview-thumb';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Bild ' + (idx + 1);
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'thumb-delete';
        delBtn.innerHTML = '';
        delBtn.title = 'Ta bort bild';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onDelete(idx);
        });
        thumb.appendChild(img);
        thumb.appendChild(delBtn);
        containerEl.appendChild(thumb);
    });
};

export const renderCardBackImages = (parentEl, images) => {
    // Remove any existing image block
    const existing = parentEl.querySelector('.card-back-images');
    if (existing) existing.remove();
    if (!images || images.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'card-back-images';
    images.forEach(dataUrl => {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Kortbild';
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(dataUrl);
        });
        wrapper.appendChild(img);
    });
    parentEl.appendChild(wrapper);
};

const openLightbox = (src) => {
    const lb = document.createElement('div');
    lb.className = 'image-lightbox';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Förstoring';
    lb.appendChild(img);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
};

// Protect LaTeX blocks from Marked.js mangling backslashes
export const safeParse = (text) => {
    const placeholders = [];
    // Protect $$...$$ blocks first (display math)
    let safe = text.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Protect $...$ blocks (inline math)
    safe = safe.replace(/\$([^\$]+?)\$/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Protect \[...\] and \(...\) blocks
    safe = safe.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    safe = safe.replace(/\\\([\s\S]*?\\\)/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Run Marked on the safe text
    let html = marked.parse(safe);
    // Restore LaTeX blocks
    placeholders.forEach((original, i) => {
        html = html.replace(`%%LATEX_${i}%%`, original);
    });
    return html;
};

export const fixLatexInCards = (cards) => {
    return cards.map(c => ({
        ...c,
        front: c.front.replace(/\\\\([a-zA-Z])/g, '\\$1'),
        back: c.back.replace(/\\\\([a-zA-Z])/g, '\\$1')
    }));
};

export function initUiImages() {

  // --- IMAGE HELPERS ---

  // Global temp storage for images being added/edited
  S.addCardImages = []; // Array of base64 data URLs for the Add Card form
  S.editCardImages = []; // Array of base64 data URLs for the Edit Card modal
}
