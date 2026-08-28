// Default Data Structure
let appData = {
    decks: [], // Array of { id, title, cards: [], bookshelfId: string|null }
    notebooks: [], // Array of { id, title, notes: [], bookshelfId: string|null }
    bookshelves: []
};

// --- DATA-SAFETY FLAGS ---
// Set when the stored data existed but failed to parse: blocks saveData so a
// corrupt-but-maybe-recoverable payload is never silently overwritten.
let dataLoadBlocked = false;
// One-shot escape hatch used by confirmWipe() to allow an intentional full wipe.
let allowWipeOnce = false;
// Guards against opening the wipe-confirm modal repeatedly while it is already open.
let wipeConfirmInProgress = false;

// --- GENERIC MODAL HELPERS ---
const showConfirmModal = (title, message, okLabel = 'OK', destructive = false) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').textContent = message;
        const okBtn = document.getElementById('btn-confirm-ok');
        okBtn.textContent = okLabel;
        if (destructive) {
            okBtn.style.background = '#A62626';
            okBtn.style.borderColor = '#A62626';
        } else {
            okBtn.style.background = '';
            okBtn.style.borderColor = '';
        }
        modal.classList.remove('hidden');

        const cleanup = (result) => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            document.getElementById('btn-confirm-cancel').removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        okBtn.addEventListener('click', onOk);
        document.getElementById('btn-confirm-cancel').addEventListener('click', onCancel);
    });
};

const showPromptModal = (title, defaultValue = '') => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-prompt');
        document.getElementById('prompt-modal-title').textContent = title;
        const input = document.getElementById('prompt-modal-input');
        input.value = defaultValue;
        modal.classList.remove('hidden');
        setTimeout(() => { input.focus(); input.select(); }, 50);

        const cleanup = (result) => {
            modal.classList.add('hidden');
            form.removeEventListener('submit', onSubmit);
            document.getElementById('btn-prompt-cancel').removeEventListener('click', onCancel);
            resolve(result);
        };
        const form = document.getElementById('form-prompt-modal');
        const onSubmit = (e) => { e.preventDefault(); cleanup(input.value.trim()); };
        const onCancel = () => cleanup(null);
        form.addEventListener('submit', onSubmit);
        document.getElementById('btn-prompt-cancel').addEventListener('click', onCancel);
    });
};

// --- UTILS ---
const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

const fisherYatesShuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const fetchWithRetry = async (url, options, maxRetries = 3) => {
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

// --- DATA & STORAGE ---
const loadData = () => {
    const saved = localStorage.getItem('noji_clone_data');
    if (saved) {
        let parseFailed = false;
        try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                appData = parsed;
            } else {
                parseFailed = true;
            }
        } catch (e) {
            console.error("Failed to parse app data", e);
            parseFailed = true;
        }

        // SAFETY: the stored data existed but is unreadable. Preserve the raw
        // bytes under a timestamped key (so it can still be recovered by hand or
        // via Import) and block all saves so we never overwrite it with an empty
        // default state. Bail out before the migrations, which assume a valid shape.
        if (parseFailed) {
            try {
                localStorage.setItem('noji_clone_data_corrupt_' + Date.now(), saved);
            } catch (e) { /* out of quota — nothing more we can do safely */ }
            dataLoadBlocked = true;
            if (typeof showToast === 'function') {
                showToast('Kunde inte läsa sparad data — den har säkrats. Sparning är pausad tills du importerar en backup.');
            }
            return;
        }

        // Migration to include decks, notebooks and bookshelves
        if (!appData.decks) appData.decks = [];
        if (!appData.notebooks) appData.notebooks = [];
        if (!appData.bookshelves) appData.bookshelves = [];
        
        // Ensure all decks and notebooks have arrays and bookshelfId
        appData.decks.forEach(d => {
            if (!d.cards) d.cards = [];
            if (d.bookshelfId === undefined) d.bookshelfId = null;
            if (!d.sections) d.sections = [];
            if (!d.color) d.color = '#4F46E5';
            d.cards.forEach(c => {
                if (c.sectionId === undefined) c.sectionId = null;
            });
        });
        appData.notebooks.forEach(n => { 
            if (!n.notes) n.notes = []; 
            if (n.bookshelfId === undefined) n.bookshelfId = null;
        });
    } else {
        // Initial dummy deck if empty
        appData.decks.push({
            id: Date.now().toString(),
            title: 'Svenska Glosor',
            bookshelfId: null,
            color: '#4F46E5',
            sections: [],
            cards: [
                createCard('Vad är huvudstaden i Sverige?', 'Stockholm'),
                createCard('Hur säger man "God Morgon"?', 'God morgon')
            ]
        });
        saveData();
    }
};

// Would writing `appData` right now destroy a non-empty store? Used by the save
// guards below. "Empty" means no decks and no notebooks at all — the full-wipe
// case — so deleting a single deck's last card is never blocked.
const wouldWipeStoredData = () => {
    if (!isEffectivelyEmpty(appData)) return false;
    const existing = localStorage.getItem('noji_clone_data');
    if (!existing) return false;
    try { return !isEffectivelyEmpty(JSON.parse(existing)); }
    catch (e) { return true; } // existing is unparseable — treat as content, don't clobber
};

let saveTimeout = null;
const saveData = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        // Never overwrite a payload we failed to load.
        if (dataLoadBlocked) {
            console.warn('saveData blocked: previous load failed to parse');
            return;
        }
        // Never silently replace a non-empty store with an empty one; ask first.
        if (!allowWipeOnce && wouldWipeStoredData()) {
            if (!wipeConfirmInProgress) confirmWipe();
            return;
        }
        allowWipeOnce = false;
        try {
            localStorage.setItem('noji_clone_data', JSON.stringify(appData));
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.error('localStorage quota exceeded:', e);
                showToast('Varning: Lagringsutrymmet är fullt. Överväg att ta bort bilder eller exportera data.');
            } else {
                throw e;
            }
        }
    }, 50);
};

// Invoked when a save would wipe everything. Confirms via the app's own modal
// (never a native dialog), then either allows the wipe once or restores the UI
// from the still-intact storage.
const confirmWipe = async () => {
    wipeConfirmInProgress = true;
    const ok = await showConfirmModal(
        'Radera allt innehåll?',
        'Detta skulle ta bort alla kortlekar och anteckningar. Är du säker?',
        'Ja, radera allt',
        true
    );
    wipeConfirmInProgress = false;
    if (ok) {
        allowWipeOnce = true;
        saveData();
    } else {
        loadData();
        renderDecks();
        renderSidebar();
        showToast('Radering avbruten — inget togs bort.');
    }
};

// Synchronously save any pending data changes when exiting the page. The same
// guards apply — a background bug must not wipe good data on unload (no modal is
// possible here, so we simply skip the destructive write).
window.addEventListener('beforeunload', () => {
    if (dataLoadBlocked) return;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        if (wouldWipeStoredData()) return;
        try {
            localStorage.setItem('noji_clone_data', JSON.stringify(appData));
        } catch (e) {}
    }
});

// --- BACKUP / DATA SAFETY ---
// Everything the app persists lives under these three keys. A backup file
// captures the raw stored strings verbatim so a restore is byte-for-byte.
const BACKUP_KEYS = ['noji_clone_data', 'noji_dagens_mapp', 'pg_records'];
const BACKUP_APP_ID = 'noji-spaced-rep';
const BACKUP_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// Count real flashcards (notes excluded) in an appData-shaped object.
const countCards = (data) => {
    try {
        return (data.decks || []).reduce(
            (n, d) => n + (d.cards || []).filter(c => c && c.type !== 'note').length,
            0
        );
    } catch (e) { return 0; }
};

// "Empty" = no decks and no notebooks. Used to detect a catastrophic wipe.
const isEffectivelyEmpty = (data) => {
    try {
        return (!data.decks || data.decks.length === 0) &&
               (!data.notebooks || data.notebooks.length === 0);
    } catch (e) { return true; }
};

const pad2 = (n) => String(n).padStart(2, '0');
const backupFilename = () => {
    const d = new Date();
    return `spaced-repetition-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
};

const buildBackupObject = () => {
    const data = {};
    BACKUP_KEYS.forEach(k => {
        const v = localStorage.getItem(k);
        if (v !== null) data[k] = v;
    });
    return {
        app: BACKUP_APP_ID,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        cardCount: countCards(appData),
        data
    };
};

const downloadJson = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
};

// A cheap fingerprint of what's persisted, so auto-backup only fires when the
// data actually changed since the last backup.
const backupSignature = () => {
    let totalLen = 0;
    BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v) totalLen += v.length; });
    return `${countCards(appData)}:${totalLen}`;
};

const markBackupDone = () => {
    try {
        localStorage.setItem('noji_backup_last_at', String(Date.now()));
        localStorage.setItem('noji_backup_last_sig', backupSignature());
    } catch (e) { /* ignore */ }
};

const exportBackup = (opts = {}) => {
    try {
        downloadJson(buildBackupObject(), backupFilename());
        markBackupDone();
        if (!opts.silent) showToast('Backup exporterad ✔');
        return true;
    } catch (e) {
        console.error('Export failed', e);
        showToast('Kunde inte exportera backup.');
        return false;
    }
};

// Download a fresh backup automatically if the data changed AND it's been at
// least a day since the last one. Skipped when there's nothing to protect or a
// load failed. A file on disk is the only backup that survives clearing site data.
const maybeAutoBackup = () => {
    try {
        if (dataLoadBlocked || isEffectivelyEmpty(appData)) return;
        const lastAt = parseInt(localStorage.getItem('noji_backup_last_at') || '0', 10);
        const lastSig = localStorage.getItem('noji_backup_last_sig') || '';
        const changed = backupSignature() !== lastSig;
        const stale = (Date.now() - lastAt) >= DAY_MS;
        if (changed && stale) {
            if (exportBackup({ silent: true })) {
                showToast('Automatisk backup nedladdad ✔');
            }
        }
    } catch (e) { console.error('auto-backup failed', e); }
};

const renderBackupStatus = () => {
    const el = document.getElementById('backup-status');
    if (!el) return;
    const lastAt = parseInt(localStorage.getItem('noji_backup_last_at') || '0', 10);
    if (!lastAt) {
        el.textContent = 'Ingen backup ännu — klicka Exportera för en säkerhetskopia.';
        return;
    }
    const days = Math.floor((Date.now() - lastAt) / DAY_MS);
    const label = days <= 0 ? 'idag' : (days === 1 ? 'igår' : `${days} dagar sedan`);
    el.textContent = `Senaste backup: ${label}`;
};

// Restore from a user-picked backup file. Accepts our wrapper format or a raw
// noji_clone_data export. Always downloads the current state first, confirms via
// the app modal, then replaces all three keys.
const importBackupFromFile = async (file) => {
    let text;
    try { text = await file.text(); }
    catch (e) { showToast('Kunde inte läsa filen.'); return; }

    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { showToast('Ogiltig backup-fil (inte JSON).'); return; }

    let data = null;
    if (obj && obj.data && typeof obj.data === 'object' && obj.data.noji_clone_data) {
        data = obj.data;                                   // our wrapper format
    } else if (obj && Array.isArray(obj.decks)) {
        data = { noji_clone_data: JSON.stringify(obj) };   // raw appData export
    }
    if (!data || !data.noji_clone_data) {
        showToast('Filen ser inte ut som en giltig backup.');
        return;
    }

    let parsed;
    try { parsed = JSON.parse(data.noji_clone_data); }
    catch (e) { showToast('Backup-datan är trasig.'); return; }
    if (!parsed || !Array.isArray(parsed.decks)) {
        showToast('Backup saknar kortlekar.');
        return;
    }

    const incomingCards = countCards(parsed);
    const currentCards = countCards(appData);
    const ok = await showConfirmModal(
        'Importera backup',
        `Nuvarande: ${currentCards} kort → Import: ${incomingCards} kort. Detta ersätter allt nuvarande innehåll. En säkerhetskopia av nuvarande data laddas ner först.`,
        'Ersätt allt',
        true
    );
    if (!ok) return;

    exportBackup({ silent: true });                        // safety net for current data

    try {
        BACKUP_KEYS.forEach(k => {
            if (data[k] !== undefined && data[k] !== null) localStorage.setItem(k, data[k]);
        });
    } catch (e) {
        console.error('Import write failed', e);
        showToast('Kunde inte spara importerad data (lagringsfel).');
        return;
    }

    dataLoadBlocked = false;
    loadData();
    renderDecks();
    renderSidebar();
    markBackupDone();
    renderBackupStatus();
    showToast(`Import klar — ${countCards(appData)} kort återställda ✔`);
};

// Fast regex-based HTML tag stripping
const stripHtml = (html) => {
    if (!html) return '';
    let cleaned = html.replace(/<span class="katex">.*?<\/span>/g, '');
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    return cleaned
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
};

const createCard = (front, back, isLongForm = false, backImages = [], sectionId = null) => {
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        front,
        back,
        isLongForm,
        backImages: backImages || [],
        sectionId: sectionId || null,
        repetition: 0,
        interval: 0,
        easeFactor: 2.5,
        nextReviewDate: Date.now() // ready to review immediately
    };
};

const createNoteCard = (content, sectionId = null) => {
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        type: 'note',
        content,
        sectionId: sectionId || null,
    };
};

const createNote = (content) => {
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        content,
        createdAt: Date.now()
    };
};

// --- LATEX HELPER ---
const renderLatex = (element) => {
    if (window.renderMathInElement && element) {
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

// --- IMAGE HELPERS ---

// Global temp storage for images being added/edited
let addCardImages = []; // Array of base64 data URLs for the Add Card form
let editCardImages = []; // Array of base64 data URLs for the Edit Card modal

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

const renderImagePreviews = (containerEl, imagesArr, onDelete) => {
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

const renderCardBackImages = (parentEl, images) => {
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
const safeParse = (text) => {
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

const fixLatexInCards = (cards) => {
    return cards.map(c => ({
        ...c,
        front: c.front.replace(/\\\\([a-zA-Z])/g, '\\$1'),
        back: c.back.replace(/\\\\([a-zA-Z])/g, '\\$1')
    }));
};


// ===== MODAL EVENT LISTENERS =====

let currentColorEditItem = null;
const openColorModal = (deck) => {
    currentColorEditItem = deck;
    document.querySelectorAll('#change-color-picker .color-dot').forEach(dot => {
        dot.classList.toggle('selected', dot.dataset.color === deck.color);
    });
    document.getElementById('modal-change-color').classList.remove('hidden');
};

document.getElementById('btn-cancel-change-color')?.addEventListener('click', () => {
    document.getElementById('modal-change-color').classList.add('hidden');
});

document.getElementById('btn-save-change-color')?.addEventListener('click', () => {
    if (currentColorEditItem) {
        const selectedDot = document.querySelector('#change-color-picker .color-dot.selected');
        if (selectedDot) {
            currentColorEditItem.color = selectedDot.dataset.color;
            saveData();
            renderLibrary();
            renderSidebar();
        }
    }
    document.getElementById('modal-change-color').classList.add('hidden');
});

document.querySelectorAll('#change-color-picker .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
        document.querySelectorAll('#change-color-picker .color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
    });
});

const renderSidebar = () => {
    const tree = document.getElementById('sidebar-tree');
    if (!tree) return;
    const filter = (document.getElementById('sidebar-search')?.value || '').toLowerCase();
    let html = '';

    // "Hem" / "Bibliotek" Item
    html += `<div class="sidebar-item ${currentViewName === 'library' && !currentBookshelfFilterId ? 'active' : ''}" onclick="filterBookshelf(null)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.75rem;opacity:0.7"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <span style="flex:1; font-weight: 500;">Hem</span>
    </div>`;

    // "Spelhallen" Item
    html += `<div class="sidebar-item ${currentViewName === 'playground' ? 'active' : ''}" onclick="openPlayground()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.75rem;opacity:0.7"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
        <span style="flex:1; font-weight: 500;">Spelhallen</span>
    </div>`;

    if (appData.bookshelves.length > 0) {
        html += `<div class="sidebar-section-label" style="margin-top:1.5rem;">Bokhyllor</div>`;
        appData.bookshelves.forEach((shelf, idx) => {
            if (filter && !shelf.title.toLowerCase().includes(filter)) return;
            html += `<div class="sidebar-item sidebar-shelf-item ${currentBookshelfFilterId === shelf.id && currentViewName === 'library' ? 'active' : ''}" draggable="false" data-shelf-idx="${idx}" data-shelf-id="${shelf.id}" onclick="filterBookshelf('${shelf.id}')">
                <span class="sidebar-drag-handle" title="Dra för att flytta" onclick="event.stopPropagation()">⠿</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(shelf.title)}</span>
            </div>`;
        });
    }

    tree.innerHTML = html;

    // Wire up drag-and-drop for shelf items
    const shelfItems = tree.querySelectorAll('.sidebar-shelf-item');
    let dragSrcIdx = null;

    shelfItems.forEach(el => {
        // Toggle draggable property on mousedown, only allowing drag when using the grab handle
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('sidebar-drag-handle')) {
                el.draggable = true;
            } else {
                el.draggable = false;
            }
        });

        el.addEventListener('dragstart', (e) => {
            dragSrcIdx = parseInt(el.dataset.shelfIdx);
            el.classList.add('sidebar-dragging');
            document.body.classList.add('dragging-shelf');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIdx);
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('sidebar-dragging');
            document.body.classList.remove('dragging-shelf');
            shelfItems.forEach(s => s.classList.remove('drag-over-top', 'drag-over-bottom'));
            dragSrcIdx = null;
            el.draggable = false;
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const rect = el.getBoundingClientRect();
            const relativeY = e.clientY - rect.top;
            const insertAfter = relativeY > rect.height / 2;

            shelfItems.forEach(s => s.classList.remove('drag-over-top', 'drag-over-bottom'));
            if (insertAfter) {
                el.classList.add('drag-over-bottom');
            } else {
                el.classList.add('drag-over-top');
            }
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over-top', 'drag-over-bottom');
            
            const targetIdx = parseInt(el.dataset.shelfIdx);
            if (dragSrcIdx === null) return;
            
            const rect = el.getBoundingClientRect();
            const relativeY = e.clientY - rect.top;
            const insertAfter = relativeY > rect.height / 2;

            if (dragSrcIdx === targetIdx) return;

            // Remove the moved bookshelf
            const [moved] = appData.bookshelves.splice(dragSrcIdx, 1);
            
            // Adjust the target index according to the drop position and array splicing shift
            let newTargetIdx = targetIdx;
            if (dragSrcIdx < targetIdx) {
                newTargetIdx = insertAfter ? targetIdx : targetIdx - 1;
            } else {
                newTargetIdx = insertAfter ? targetIdx + 1 : targetIdx;
            }

            appData.bookshelves.splice(newTargetIdx, 0, moved);
            saveData();
            renderSidebar();
            renderLibrary();
        });
    });
};

window.openBookshelfMenu = (id) => {
    const shelf = appData.bookshelves.find(s => s.id === id);
    if (shelf) openColorModal(shelf);
};

window.filterBookshelf = (id) => {
    currentBookshelfFilterId = id;
    if (currentViewName !== 'library') {
        switchView('library');
    }
    renderLibrary();
    renderSidebar();
};

// --- BREADCRUMB ---
const updateBreadcrumb = (crumbs) => {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    bc.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const sep = i < crumbs.length - 1 ? '<svg class="breadcrumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4; margin: 0 4px; vertical-align: middle;"><path d="M9 18l6-6-6-6"/></svg>' : '';
        if (isLast) return `<span class="breadcrumb-item active">${c.label}</span>`;
        return `<span class="breadcrumb-item" onclick="${c.action}">${c.label}</span>${sep}`;
    }).join('');
};

// --- GLOBAL APP STATE ---
let currentDeckId = null;
let currentSectionId = null;
let currentNotebookId = null;
let currentNoteId = null; // for editing
let currentViewName = 'library';
let currentBookshelfFilterId = null;
let currentStudyCards = [];
let currentStudyIndex = 0;
let isPlaygroundSession = false;
let playgroundEscAbort = false;
let lastSessionWasPlayground = false;
let draggedDeckIndex = null;
let playgroundFilterSource = new Set(); // stores 'deck:<id>:section:<id>' or 'deck:<id>:unsorted'
let playgroundFilterAll = true; // true = whole library selected
let playgroundExpandedNodes = new Set();
let playgroundDropdownOpen = false;

// --- DOM ELEMENTS ---
const views = {
    library: document.getElementById('view-library'),
    deck: document.getElementById('view-deck'),
    addCard: document.getElementById('view-add-card'),
    notebook: document.getElementById('view-notebook'),
    addNote: document.getElementById('view-add-note'),
    study: document.getElementById('view-study'),
    complete: document.getElementById('view-study-complete'),
    playground: document.getElementById('view-playground')
};

const deckList = document.getElementById('deck-list');
const cardList = document.getElementById('card-list');

// --- ROUTING / VIEW LOGIC ---
const switchView = (viewName, sectionId = null) => {
    currentViewName = viewName;
    Object.values(views).forEach(v => v.classList.add('hidden'));

    setTimeout(() => {
        views[viewName].classList.remove('hidden');
    }, 10);
    window.scrollTo(0, 0);

    // Update breadcrumb
    const lib = { label: 'Bibliotek', action: "renderLibrary();switchView('library');renderSidebar();" };
    if (viewName === 'library') {
        updateBreadcrumb([{ label: 'Bibliotek' }]);
    } else if (viewName === 'deck') {
        const deck = appData.decks.find(d => d.id === currentDeckId);
        const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
        if (section) {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: `openDeck('${currentDeckId}')` }, { label: section.title }]);
        } else {
            updateBreadcrumb([lib, { label: deck?.title || 'Kortlek' }]);
        }
    } else if (viewName === 'addCard') {
        const deck = appData.decks.find(d => d.id === currentDeckId);
        updateBreadcrumb([lib, { label: deck?.title || 'Kortlek', action: `openDeck('${currentDeckId}')` }, { label: 'Nytt kort' }]);
    } else if (viewName === 'notebook') {
        const nb = appData.notebooks.find(n => n.id === currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock' }]);
    } else if (viewName === 'addNote') {
        const nb = appData.notebooks.find(n => n.id === currentNotebookId);
        updateBreadcrumb([lib, { label: nb?.title || 'Anteckningsblock', action: `openNotebook('${currentNotebookId}')` }, { label: 'Anteckning' }]);
    } else if (viewName === 'study') {
        const deck = appData.decks.find(d => d.id === currentDeckId);
        updateBreadcrumb([lib, { label: deck?.title || 'Repetition', action: currentDeckId ? `openDeck('${currentDeckId}')` : '' }, { label: 'Repetition' }]);
    } else if (viewName === 'complete') {
        updateBreadcrumb([lib, { label: 'Klart!' }]);
    } else if (viewName === 'playground') {
        updateBreadcrumb([lib, { label: 'Spelhallen' }]);
        // Ensure playground content is rendered even if called without openPlayground()
        setTimeout(() => renderPlayground(), 15);
    }

    renderSidebar();
};

window.openPlayground = () => {
    isPlaygroundSession = false;
    playgroundFilterSource = new Set();
    playgroundFilterAll = true;
    playgroundExpandedNodes = new Set();
    playgroundDropdownOpen = false;
    switchView('playground');
    renderPlayground();
};

// --- PERSONAL RECORDS & TIMEZONES ---
const getLocalDateString = (date = new Date()) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().slice(0, 10);
};

const loadRecords = () => {
    try {
        return JSON.parse(localStorage.getItem('pg_records') || '{}');
    } catch { return {}; }
};
const saveRecords = (r) => localStorage.setItem('pg_records', JSON.stringify(r));

const updatePersonalRecords = (cardsAnswered, elapsedSec) => {
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

const getAchievements = (allCards, streak, records) => {
    const totalReviewed = allCards.filter(c => c.lastReviewed).length;
    const mastered = allCards.filter(c => c.interval >= 21).length;
    const totalDecks = appData.decks.length;

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

const renderPlayground = () => {
    const container = document.getElementById('playground-content');
    if (!container) return;

    // Save scroll position of the dropdown menu and window to prevent jumping on update
    const oldMenu = document.getElementById('pg-dropdown-menu');
    const oldMenuScrollTop = oldMenu ? oldMenu.scrollTop : 0;
    const oldWindowScrollY = window.scrollY;

    let allCards = appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note').map(c => ({...c, originalDeckId: d.id})));

    // Filter cards based on tree checkbox selection
    if (!playgroundFilterAll) {
        allCards = allCards.filter(c => {
            const sKey = c.sectionId ? `deck:${c.originalDeckId}:section:${c.sectionId}` : `deck:${c.originalDeckId}:unsorted`;
            return playgroundFilterSource.has(sKey);
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
    let streak = 0;
    const reviewDates = new Set();
    allCards.forEach(c => {
        if (c.lastReviewed) {
            const d = new Date(c.lastReviewed);
            reviewDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
        }
    });
    const todayKey = `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}`;
    let checkDate = new Date();
    if (!reviewDates.has(todayKey)) checkDate.setDate(checkDate.getDate() - 1);
    while (true) {
        const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
        if (reviewDates.has(key)) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
        else break;
    }

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
                        <span id="pg-dropdown-selected-label">${playgroundFilterAll ? 'Hela biblioteket' : (playgroundFilterSource.size === 0 ? 'Inget valt' : `${playgroundFilterSource.size} val`)}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity: 0.7; margin-left: 0.25rem; transform: ${playgroundDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div id="pg-dropdown-menu" class="pg-tree-menu ${playgroundDropdownOpen ? '' : 'hidden'}">
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
                <input type="checkbox" data-role="all" ${playgroundFilterAll ? 'checked' : ''}>
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
                const checkedLeaves = leaves.filter(l => playgroundFilterSource.has(l));
                const allChecked = playgroundFilterAll || checkedLeaves.length === leaves.length;
                const someChecked = !playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < leaves.length;
                const sections = deck.sections || [];
                const hasUnsorted = deck.cards.some(c => c.type !== 'note' && !c.sectionId);
                const hasChildren = sections.length > 0 || hasUnsorted;

                let h = `<div class="pg-tree-node" data-deck-id="${deck.id}">
                    <label class="pg-tree-row pg-tree-level-${indent}">
                        ${hasChildren ? `<span class="pg-tree-toggle" data-target="deck-${deck.id}">${playgroundExpandedNodes.has(`deck-${deck.id}`) ? '▼' : '▶'}</span>` : `<span class="pg-tree-toggle-spacer"></span>`}
                        <input type="checkbox" data-role="deck" data-deck-id="${deck.id}" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text">${escapeHtml(deck.title)}</span>
                        <span class="pg-tree-count">${deck.cards.filter(c => c.type !== 'note').length}</span>
                    </label>`;

                if (hasChildren) {
                    const isExpanded = playgroundExpandedNodes.has(`deck-${deck.id}`);
                    h += `<div class="pg-tree-children ${isExpanded ? '' : 'hidden'}" id="pg-tree-deck-${deck.id}">`;
                    sections.forEach(s => {
                        const sKey = `deck:${deck.id}:section:${s.id}`;
                        const sCount = deck.cards.filter(c => c.type !== 'note' && c.sectionId === s.id).length;
                        const sChecked = playgroundFilterAll || playgroundFilterSource.has(sKey);
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
                        const uChecked = playgroundFilterAll || playgroundFilterSource.has(uKey);
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
            appData.bookshelves.forEach(shelf => {
                const shelfDecks = appData.decks.filter(d => d.bookshelfId === shelf.id);
                if (shelfDecks.length === 0) return;
                const shelfLeaves = shelfDecks.flatMap(getDeckLeaves);
                const checkedLeaves = shelfLeaves.filter(l => playgroundFilterSource.has(l));
                const allChecked = playgroundFilterAll || checkedLeaves.length === shelfLeaves.length;
                const someChecked = !playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < shelfLeaves.length;

                html += `<div class="pg-tree-node" data-shelf-id="${shelf.id}">
                    <label class="pg-tree-row pg-tree-level-0">
                        <span class="pg-tree-toggle" data-target="shelf-${shelf.id}">${playgroundExpandedNodes.has(`shelf-${shelf.id}`) ? '▼' : '▶'}</span>
                        <input type="checkbox" data-role="shelf" data-shelf-id="${shelf.id}" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text pg-tree-shelf-text">${escapeHtml(shelf.title)}</span>
                    </label>
                    <div class="pg-tree-children ${playgroundExpandedNodes.has(`shelf-${shelf.id}`) ? '' : 'hidden'}" id="pg-tree-shelf-${shelf.id}">
                        ${shelfDecks.map(d => renderDeck(d, 1)).join('')}
                    </div>
                </div>`;
            });

            // "Övriga kortlekar" — decks without bookshelfId
            const looseDecks = appData.decks.filter(d => !d.bookshelfId);
            if (looseDecks.length > 0) {
                const shelfLeaves = looseDecks.flatMap(getDeckLeaves);
                const checkedLeaves = shelfLeaves.filter(l => playgroundFilterSource.has(l));
                const allChecked = playgroundFilterAll || checkedLeaves.length === shelfLeaves.length;
                const someChecked = !playgroundFilterAll && checkedLeaves.length > 0 && checkedLeaves.length < shelfLeaves.length;

                html += `<div class="pg-tree-node">
                    <label class="pg-tree-row pg-tree-level-0">
                        <span class="pg-tree-toggle" data-target="shelf-loose">${playgroundExpandedNodes.has('shelf-loose') ? '▼' : '▶'}</span>
                        <input type="checkbox" data-role="shelf-loose" ${allChecked ? 'checked' : ''} ${someChecked && !allChecked ? 'data-indeterminate="true"' : ''}>
                        <span class="pg-tree-text pg-tree-shelf-text">Övriga kortlekar</span>
                    </label>
                    <div class="pg-tree-children ${playgroundExpandedNodes.has('shelf-loose') ? '' : 'hidden'}" id="pg-tree-shelf-loose">
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
            appData.decks.forEach(d => {
                (d.sections || []).forEach(s => leaves.push(`deck:${d.id}:section:${s.id}`));
                if (d.cards.some(c => c.type !== 'note' && !c.sectionId)) leaves.push(`deck:${d.id}:unsorted`);
            });
            return leaves;
        };

        const getDeckLeavesById = (deckId) => {
            const deck = appData.decks.find(d => d.id === deckId);
            if (!deck) return [];
            const leaves = [];
            (deck.sections || []).forEach(s => leaves.push(`deck:${deck.id}:section:${s.id}`));
            if (deck.cards.some(c => c.type !== 'note' && !c.sectionId)) leaves.push(`deck:${deck.id}:unsorted`);
            return leaves;
        };

        const getShelfLeaves = (shelfId) => {
            return appData.decks.filter(d => d.bookshelfId === shelfId).flatMap(d => getDeckLeavesById(d.id));
        };

        const updateLabel = () => {
            const label = document.getElementById('pg-dropdown-selected-label');
            if (label) label.textContent = playgroundFilterAll ? 'Hela biblioteket' : (playgroundFilterSource.size === 0 ? 'Inget valt' : `${playgroundFilterSource.size} val`);
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
                    playgroundFilterAll = true;
                    playgroundFilterSource = new Set();
                } else {
                    playgroundFilterAll = false;
                    playgroundFilterSource = new Set();
                }
                buildTree();
                updateLabel();
                renderPlayground();
                return;
            }

            // If currently "all" (empty set) and user unchecks something, populate with all leaves first
            if (playgroundFilterAll && !checked) {
                playgroundFilterAll = false;
                playgroundFilterSource = new Set(allLeaves);
            }

            if (role === 'shelf') {
                const leaves = getShelfLeaves(cb.dataset.shelfId);
                leaves.forEach(l => checked ? playgroundFilterSource.add(l) : playgroundFilterSource.delete(l));
            } else if (role === 'shelf-loose') {
                const looseDecks = appData.decks.filter(d => !d.bookshelfId);
                const leaves = looseDecks.flatMap(d => getDeckLeavesById(d.id));
                leaves.forEach(l => checked ? playgroundFilterSource.add(l) : playgroundFilterSource.delete(l));
            } else if (role === 'deck') {
                const leaves = getDeckLeavesById(cb.dataset.deckId);
                leaves.forEach(l => checked ? playgroundFilterSource.add(l) : playgroundFilterSource.delete(l));
            } else if (role === 'section') {
                const key = cb.dataset.key;
                checked ? playgroundFilterSource.add(key) : playgroundFilterSource.delete(key);
            }

            // If all leaves are selected, reset to empty (= all)
            if (playgroundFilterSource.size >= allLeaves.length) {
                playgroundFilterAll = true;
                playgroundFilterSource = new Set();
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
                    playgroundExpandedNodes.delete(targetId);
                } else {
                    playgroundExpandedNodes.add(targetId);
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
                playgroundDropdownOpen = false;
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
            playgroundDropdownOpen = !playgroundDropdownOpen;
            if (playgroundDropdownOpen) {
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
                svg.style.transform = playgroundDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });

        if (playgroundDropdownOpen) {
            document.addEventListener('click', closeMenu);
        }

        // Restore scroll positions to prevent jumping
        dropdownMenu.scrollTop = oldMenuScrollTop;
        window.scrollTo(window.scrollX, oldWindowScrollY);
    }
};

let playgroundMode = null;
let playgroundSessionStats = { correct: 0, again: 0, total: 0, startTime: 0 };

window.startPlaygroundStudy = (mode) => {
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    const safeCreated = (c) => Math.min(parseInt(c.id, 10), now);

    let allCards = appData.decks.flatMap(d => {
        return d.cards.filter(c => c.type !== 'note').map(c => ({...c, originalDeckId: d.id}));
    });

    // Apply playground tree-filter
    if (!playgroundFilterAll) {
        allCards = allCards.filter(c => {
            const sKey = c.sectionId ? `deck:${c.originalDeckId}:section:${c.sectionId}` : `deck:${c.originalDeckId}:unsorted`;
            return playgroundFilterSource.has(sKey);
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
                const d = appData.decks.find(deck => deck.id === c.originalDeckId);
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
        playgroundMode = mode;
        playgroundSessionStats = { correct: 0, again: 0, total: selectedCards.length, startTime: Date.now() };
        currentStudyCards = selectedCards;
        currentStudyIndex = 0;
        currentDeckId = null;
        isPlaygroundSession = true;

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

const finishPlaygroundSession = (skipResults = false) => {
    const mode = playgroundMode;
    playgroundMode = null;
    isPlaygroundSession = false;
    const shouldSkip = skipResults || playgroundEscAbort;
    playgroundEscAbort = false;
    lastSessionWasPlayground = true;

    if (shouldSkip) {
        switchView('playground');
        renderPlayground();
        return;
    }

    const stats = playgroundSessionStats;
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

// --- NOTIFICATION ---
const showToast = (message) => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

// --- RENDERING ---
let draggedItemId = null;
let draggedItemType = null;
let draggedCardId = null;
let currentBookshelfToDelete = null;

let librarySearchFilter = '';

const itemMatchesFilter = (item, type, flt) => {
    if (!flt) return true;
    if (item.title.toLowerCase().includes(flt)) return true;
    if (type === 'deck' && item.cards) {
        return item.cards.some(c => 
            (c.front && c.front.toLowerCase().includes(flt)) || 
            (c.back && c.back.toLowerCase().includes(flt))
        );
    }
    if (type === 'notebook' && item.notes) {
        return item.notes.some(n => 
            n.content && n.content.toLowerCase().includes(flt)
        );
    }
    return false;
};

const renderLibrary = () => {
    renderDagensMapp();
    deckList.innerHTML = '';
    const filter = librarySearchFilter.toLowerCase();
    
    // Add dragover/drop on deckList for dropping items outside bookshelves
    deckList.ondragover = (e) => e.preventDefault();
    deckList.ondrop = (e) => {
        e.preventDefault();
        // Check if we dropped on a deck card or bookshelf container
        const closestContainer = e.target.closest('.bookshelf-items');
        if (!closestContainer && draggedItemId !== null && draggedItemType !== null) {
            if (draggedItemType === 'deck') {
                const item = appData.decks.find(d => d.id === draggedItemId);
                if (item) item.bookshelfId = null;
            } else if (draggedItemType === 'notebook') {
                const item = appData.notebooks.find(n => n.id === draggedItemId);
                if (item) item.bookshelfId = null;
            }
            saveData();
            renderLibrary();
        }
    };

    if (appData.decks.length === 0 && appData.notebooks.length === 0 && appData.bookshelves.length === 0) {
        deckList.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="11" x2="13" y2="11"/></svg>
            </div>
            <h3>Inga kortlekar eller anteckningsblock än</h3>
            <p>Tryck "Ny" ovan för att skapa din första kortlek och börja lära dig.</p>
        </div>`;
        return;
    }

    // Helper to render deck or notebook
    const isDeckFullyReviewed = (deck) => {
        const deckCards = deck.cards.filter(c => c.type !== 'note');
        return deckCards.length > 0 && deckCards.every(c => c.nextReviewDate > Date.now());
    };

    const renderItem = (item, type) => {
        const itemEl = document.createElement('div');
        const done = type === 'deck' && isDeckFullyReviewed(item);
        itemEl.className = `deck-card ${type === 'notebook' ? 'notebook' : ''} ${done ? 'deck-done' : ''}`;
        itemEl.draggable = true;
        itemEl.dataset.id = item.id;
        itemEl.dataset.type = type;

        if (type === 'deck') {
            const deckCards = item.cards.filter(c => c.type !== 'note');
            const total = deckCards.length;
            const dueCards = deckCards.filter(c => c.nextReviewDate <= Date.now()).length;
            const doneCards = total - dueCards;
            const reviewedPct = total > 0 ? Math.round((doneCards / total) * 100) : 0;
            
            let itemColor = '#4F46E5';
            if (item.bookshelfId) {
                const shelf = appData.bookshelves.find(s => s.id === item.bookshelfId);
                if (shelf && shelf.color) itemColor = shelf.color;
            } else if (item.color) { // Legacy fallback
                itemColor = item.color;
            }
            itemEl.style.setProperty('--deck-color', itemColor);

            itemEl.innerHTML = `
                <div class="deck-header">
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-item-rename">Byt namn</button>
                            <button class="btn-item-move">Flytta till bokhylla</button>
                            <button class="btn-item-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
                <div class="deck-title">${escapeHtml(item.title)}</div>
                <div class="deck-progress">
                    <div class="deck-progress-track">
                        <div class="deck-progress-fill" style="width: ${reviewedPct}%"></div>
                    </div>
                </div>
            `;
            itemEl.onclick = () => openDeck(item.id);
        } else if (type === 'notebook') {
            const total = item.notes.length;
            
            let itemColor = '#FF6D01';
            if (item.bookshelfId) {
                const shelf = appData.bookshelves.find(s => s.id === item.bookshelfId);
                if (shelf && shelf.color) itemColor = shelf.color;
            } else if (item.color) {
                itemColor = item.color;
            }
            itemEl.style.setProperty('--deck-color', itemColor);

            itemEl.innerHTML = `
                <div class="deck-header">
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-item-rename">Byt namn</button>
                            <button class="btn-item-move">Flytta till bokhylla</button>
                            <button class="btn-item-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
                <div class="deck-title">${escapeHtml(item.title)}</div>
                <div class="deck-meta">
                    <span>${total} anteckningar totalt</span>
                </div>
            `;
            itemEl.onclick = () => openNotebook(item.id);
        }


        itemEl.querySelector('.btn-item-rename')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const newName = await showPromptModal(`Nytt namn för ${type === 'deck' ? 'kortleken' : 'anteckningsblocket'}:`, item.title);
            if (newName && newName.trim()) {
                item.title = newName.trim();
                saveData();
                renderLibrary();
                renderSidebar();
            }
        });

        itemEl.querySelector('.btn-item-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openColorModal(item);
        });

        itemEl.querySelector('.btn-item-move').addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveItemModal(item, type);
        });

        itemEl.querySelector('.btn-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmMsg = type === 'deck'
                ? `Är du säker på att du vill radera kortleken "${item.title}" och alla dess kort?`
                : `Är du säker på att du vill radera anteckningsblocket "${item.title}" och alla dess anteckningar?`;

            if (await showConfirmModal('Radera', confirmMsg, 'Radera', true)) {
                if (type === 'deck') {
                    appData.decks = appData.decks.filter(d => d.id !== item.id);
                } else {
                    appData.notebooks = appData.notebooks.filter(n => n.id !== item.id);
                }
                saveData();
                renderLibrary();
                showToast(type === 'deck' ? 'Kortleken har raderats' : 'Anteckningsblocket har raderats');
            }
        });

        itemEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            itemEl.classList.add('dragging');
            draggedItemId = item.id;
            draggedItemType = type;
            draggedSourceContainer = itemEl.closest('.bookshelf-container');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', type);
        });

        itemEl.addEventListener('dragend', (e) => {
            e.stopPropagation();
            itemEl.classList.remove('dragging');
            draggedItemId = null;
            draggedItemType = null;
            draggedSourceContainer = null;
        });

        itemEl.addEventListener('dragover', (e) => e.preventDefault());
        itemEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            itemEl.classList.remove('drag-over');
            
            if (draggedItemId !== null && draggedItemType !== null) {
                const sourceList = draggedItemType === 'deck' ? appData.decks : appData.notebooks;
                const targetBookshelfId = item.bookshelfId;
                
                const draggedItem = sourceList.find(i => i.id === draggedItemId);
                if (draggedItem) {
                    draggedItem.bookshelfId = targetBookshelfId;
                    
                    if (draggedItemType === type && draggedItemId !== item.id) {
                        const originalIndex = sourceList.findIndex(i => i.id === draggedItemId);
                        const targetIndex = sourceList.findIndex(i => i.id === item.id);
                        if (originalIndex !== -1 && targetIndex !== -1) {
                            const [removed] = sourceList.splice(originalIndex, 1);
                            const newTargetIndex = targetIndex > originalIndex ? targetIndex - 1 : targetIndex;
                            sourceList.splice(newTargetIndex, 0, removed);
                        }
                    }
                }
                
                saveData();
                renderLibrary();
            }
        });
        
        return itemEl;
    };

    // Render Bookshelves
    let shelvesToRender = appData.bookshelves;
    if (currentBookshelfFilterId) {
        shelvesToRender = appData.bookshelves.filter(s => s.id === currentBookshelfFilterId);
        
        // Render a back to all button
        const backBtn = document.createElement('div');
        backBtn.innerHTML = `<button class="btn-action-chip" style="margin-bottom: 1.5rem;" onclick="filterBookshelf(null)">← Visa alla</button>`;
        deckList.appendChild(backBtn);
    }

    const isBookshelfFullyReviewed = (shelf) => {
        const shelfDecks = appData.decks.filter(d => d.bookshelfId === shelf.id);
        return shelfDecks.length > 0 && shelfDecks.every(d => isDeckFullyReviewed(d));
    };

    shelvesToRender = [...shelvesToRender].sort((a, b) => {
        const aDone = isBookshelfFullyReviewed(a);
        const bDone = isBookshelfFullyReviewed(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return 0;
    });

    shelvesToRender.forEach((shelf, shelfIndex) => {
        const shelfDone = isBookshelfFullyReviewed(shelf);
        const shelfEl = document.createElement('div');
        shelfEl.className = `bookshelf-container ${shelfDone ? 'bookshelf-done' : ''}`;
        shelfEl.style.gridColumn = "1 / -1";
        shelfEl.style.marginBottom = "1rem";
        
        if (shelf.color) {
            shelfEl.style.setProperty('--bookshelf-color', shelf.color);
        }

        shelfEl.innerHTML = `
            <div class="bookshelf-header" style="${shelf.color ? `border-bottom: 2px solid ${shelf.color};` : ''}">
                <div style="flex: 1; display: flex; align-items: center; gap: 1rem; cursor: pointer;" onclick="startBookshelfStudy('${shelf.id}')" title="Klicka för att repetera alla kortlekar i bokhyllan">
                    <h3>${escapeHtml(shelf.title)}</h3>
                    <button class="btn-action-chip btn-bookshelf-study">Repetera alla</button>
                </div>
                <div class="card-menu-container">
                    <button class="btn-bookshelf-menu-toggle btn-card-menu-toggle">⋮</button>
                    <div class="card-menu-dropdown">
                        <button class="btn-bookshelf-rename">Byt namn</button>
                        <button class="btn-bookshelf-color">Ändra färg</button>
                        <button class="btn-bookshelf-delete">Ta bort</button>
                    </div>
                </div>
            </div>
            <div class="bookshelf-items bookshelf-grid"></div>
        `;

        const itemsContainer = shelfEl.querySelector('.bookshelf-items');
        
        shelfEl.querySelector('.btn-bookshelf-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openColorModal(shelf);
        });
        
        itemsContainer.addEventListener('dragover', (e) => e.preventDefault());
        itemsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Don't trigger deckList root drop
            if (draggedItemId !== null && draggedItemType !== null) {
                if (draggedItemType === 'deck') {
                    const item = appData.decks.find(d => d.id === draggedItemId);
                    if (item) item.bookshelfId = shelf.id;
                } else if (draggedItemType === 'notebook') {
                    const item = appData.notebooks.find(n => n.id === draggedItemId);
                    if (item) item.bookshelfId = shelf.id;
                }
                saveData();
                renderLibrary();
            }
        });

        // Add items to this bookshelf, sorted by latest addition
        const shelfItems = [];
        const getLastUpdated = (item) => {
            let max = parseInt(item.id, 10) || 0;
            if (item.cards) {
                item.cards.forEach(c => {
                    const time = parseInt(c.id, 10) || 0;
                    if (time > max) max = time;
                });
            } else if (item.notes) {
                item.notes.forEach(n => {
                    const time = parseInt(n.id, 10) || 0;
                    if (time > max) max = time;
                });
            }
            return max;
        };

        const shelfTitleMatches = shelf.title.toLowerCase().includes(filter);
        appData.decks.forEach((deck, index) => {
            if (deck.bookshelfId === shelf.id && (shelfTitleMatches || itemMatchesFilter(deck, 'deck', filter))) {
                shelfItems.push({ element: renderItem(deck, 'deck', index), updated: getLastUpdated(deck), done: isDeckFullyReviewed(deck) });
            }
        });
        appData.notebooks.forEach((notebook, index) => {
            if (notebook.bookshelfId === shelf.id && (shelfTitleMatches || itemMatchesFilter(notebook, 'notebook', filter))) {
                shelfItems.push({ element: renderItem(notebook, 'notebook', index), updated: getLastUpdated(notebook), done: false });
            }
        });

        shelfItems.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.updated - a.updated;
        });
        shelfItems.forEach(item => itemsContainer.appendChild(item.element));

        if(itemsContainer.children.length === 0) {
            itemsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); font-size: 0.9rem; margin-top: 1rem;">Dra och släpp kortlekar eller anteckningsblock här</div>';
        }

        shelfEl.querySelector('.btn-bookshelf-rename').addEventListener('click', async (e) => {
            e.stopPropagation();
            const newTitle = await showPromptModal('Nytt namn för bokhyllan:', shelf.title);
            if (newTitle && newTitle.trim() !== '') {
                shelf.title = newTitle.trim();
                saveData();
                renderLibrary();
                renderSidebar();
                showToast('Bokhyllan har bytt namn');
            }
        });

        shelfEl.querySelector('.btn-bookshelf-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            currentBookshelfToDelete = shelf.id;
            document.getElementById('modal-delete-bookshelf').classList.remove('hidden');
        });

        if (!filter || shelfTitleMatches || shelfItems.length > 0) {
            deckList.appendChild(shelfEl);
        }
    });

    // Root items (No bookshelfId)
    if (!currentBookshelfFilterId) {
        const rootItems = [];
        const getLastUpdated = (item) => {
            let max = parseInt(item.id, 10) || 0;
            if (item.cards) {
                item.cards.forEach(c => {
                    const time = parseInt(c.id, 10) || 0;
                    if (time > max) max = time;
                });
            } else if (item.notes) {
                item.notes.forEach(n => {
                    const time = parseInt(n.id, 10) || 0;
                    if (time > max) max = time;
                });
            }
            return max;
        };

        appData.decks.forEach((deck, index) => {
            if (!deck.bookshelfId && itemMatchesFilter(deck, 'deck', filter)) {
                rootItems.push({ element: renderItem(deck, 'deck', index), updated: getLastUpdated(deck), done: isDeckFullyReviewed(deck) });
            }
        });
        appData.notebooks.forEach((notebook, index) => {
            if (!notebook.bookshelfId && itemMatchesFilter(notebook, 'notebook', filter)) {
                rootItems.push({ element: renderItem(notebook, 'notebook', index), updated: getLastUpdated(notebook), done: false });
            }
        });

        rootItems.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.updated - a.updated;
        });
        rootItems.forEach(item => deckList.appendChild(item.element));
    }

    // Update global study button
    const allDueCards = appData.decks.flatMap(d => d.cards.filter(c => c.nextReviewDate <= Date.now()));
    const globalBtn = document.getElementById('btn-study-all');
    const globalLabel = document.getElementById('btn-study-all-label');
    if (allDueCards.length > 0) {
        globalBtn.classList.remove('hidden');
        globalLabel.innerText = `Repetera`;
    } else {
        globalBtn.classList.add('hidden');
    }

    renderSidebar();
};

// --- DAGENS MAPP (DAILY RECOMMENDATION) ---
const getDagensMapp = () => {
    const todayStr = getLocalDateString();
    
    // Read from localStorage
    let stored = null;
    try {
        const saved = localStorage.getItem('noji_dagens_mapp');
        if (saved) {
            stored = JSON.parse(saved);
        }
    } catch (e) {
        console.error("Failed to parse dagens mapp", e);
    }
    
    // Check if stored is still valid (date matches today and deck + section still exist)
    if (stored && stored.date === todayStr) {
        const deck = appData.decks.find(d => d.id === stored.deckId);
        const section = deck ? (deck.sections || []).find(s => s.id === stored.sectionId) : null;
        if (deck && section) {
            return {
                deckId: deck.id,
                deckTitle: deck.title,
                sectionId: section.id,
                sectionTitle: section.title
            };
        }
    }
    
    // Re-roll or select new one
    // Collect all sections
    const allSections = [];
    appData.decks.forEach(deck => {
        if (deck.sections && deck.sections.length > 0) {
            deck.sections.forEach(sec => {
                allSections.push({
                    deckId: deck.id,
                    deckTitle: deck.title,
                    sectionId: sec.id,
                    sectionTitle: sec.title
                });
            });
        }
    });
    
    if (allSections.length === 0) {
        return null;
    }
    
    // Choose one at random
    const randomIndex = Math.floor(Math.random() * allSections.length);
    const chosen = allSections[randomIndex];
    
    // Save to localStorage
    const newState = {
        date: todayStr,
        deckId: chosen.deckId,
        sectionId: chosen.sectionId
    };
    try {
        localStorage.setItem('noji_dagens_mapp', JSON.stringify(newState));
    } catch (e) {
        console.error("Failed to save dagens mapp", e);
    }
    
    return chosen;
};

const renderDagensMapp = () => {
    const container = document.getElementById('dagens-mapp-container');
    if (!container) return;
    
    // If search filter is active, bookshelf filter is active, or library is empty, hide
    const isSearchActive = librarySearchFilter && librarySearchFilter.trim() !== '';
    const isLibraryEmpty = appData.decks.length === 0 && appData.notebooks.length === 0 && appData.bookshelves.length === 0;
    if (isSearchActive || currentBookshelfFilterId || isLibraryEmpty) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    const dagens = getDagensMapp();
    if (!dagens) {
        // No sections created yet - show encouragement CTA
        container.innerHTML = `
            <div class="dagens-mapp-banner empty">
                <div class="dagens-mapp-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4.5px; vertical-align: middle;"><path d="M9 18h6m-3-15a7 7 0 0 0-7 7c0 2.3 1.2 4.3 3 5.3V18h8v-2.7c1.8-1 3-3 3-5.3a7 7 0 0 0-7-7z"/></svg>
                    Dagens Mapp
                </div>
                <div class="dagens-mapp-content">
                    <div class="dagens-mapp-info">
                        <h3 class="dagens-mapp-name" style="font-size: 1.15rem; margin-bottom: 0.25rem;">Organisera dina kort i mappar!</h3>
                        <p class="dagens-mapp-deck-name" style="max-width: 600px; font-weight: normal; line-height: 1.45; color: var(--text-secondary);">
                            Dela in dina flashcards i mappar för att få en personlig rekommenderad mapp att repetera varje dag. 
                            Du kan enkelt skapa mappar i dina kortlekar, eller använda AI-sortering för att strukturera dem direkt.
                        </p>
                    </div>
                    <div class="dagens-mapp-actions">
                        <button class="btn-dagens-action secondary" onclick="if(appData.decks.length > 0) { openDeck(appData.decks[0].id); } else { showToast('Skapa en kortlek först!'); }">Kolla dina kortlekar</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    // If a section is selected, get stats
    const deck = appData.decks.find(d => d.id === dagens.deckId);
    if (!deck) return; // safety check
    
    const sectionCards = deck.cards.filter(c => c.type !== 'note' && c.sectionId === dagens.sectionId);
    const totalCards = sectionCards.length;
    const dueCards = sectionCards.filter(c => c.nextReviewDate <= Date.now()).length;
    
    // Choose colour
    let itemColor = '#4F46E5';
    if (deck.bookshelfId) {
        const shelf = appData.bookshelves.find(s => s.id === deck.bookshelfId);
        if (shelf && shelf.color) itemColor = shelf.color;
    } else if (deck.color) {
        itemColor = deck.color;
    }
    
    if (dueCards === 0) {
        container.innerHTML = `
            <div class="dagens-mapp-banner completed" style="padding: 1rem 1.25rem; margin-bottom: 1.5rem; gap: 0.5rem;">
                <div class="dagens-mapp-content" style="gap: 1rem;">
                    <div class="dagens-mapp-info" style="flex-direction: row; align-items: center; gap: 0.75rem;">
                        <span class="dagens-mapp-icon completed" style="width: 32px; height: 32px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        </span>
                        <div class="dagens-mapp-titles">
                            <h3 class="dagens-mapp-name completed" style="font-size: 1.05rem; font-weight: 700; margin: 0;">Klar med dagens rekommendation</h3>
                            <p class="dagens-mapp-deck-name completed" style="font-size: 0.8rem; margin: 0; opacity: 0.8;">Mapp: ${escapeHtml(dagens.sectionTitle)}</p>
                        </div>
                    </div>
                    <div class="dagens-mapp-actions" style="margin-top: 0;">
                        <button class="btn-dagens-action secondary completed" style="padding: 0.45rem 1rem; font-size: 0.8rem; border-color: rgba(16, 185, 129, 0.2); color: #047857;" onclick="openDeck('${dagens.deckId}', '${dagens.sectionId}')">Öppna mappen</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="dagens-mapp-banner" style="border-left-color: ${itemColor}; --primary-color: ${itemColor};">
            <div class="dagens-mapp-badge" style="background-color: ${itemColor}15; color: ${itemColor};">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4.5px; vertical-align: middle;"><path d="M9 18h6m-3-15a7 7 0 0 0-7 7c0 2.3 1.2 4.3 3 5.3V18h8v-2.7c1.8-1 3-3 3-5.3a7 7 0 0 0-7-7z"/></svg>
                Dagens rekommendation
            </div>
            <div class="dagens-mapp-content">
                <div class="dagens-mapp-info">
                    <div class="dagens-mapp-title-row">
                        <span class="dagens-mapp-icon" style="background-color: ${itemColor}15; color: ${itemColor};">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        </span>
                        <div class="dagens-mapp-titles">
                            <h3 class="dagens-mapp-name">${escapeHtml(dagens.sectionTitle)}</h3>
                            <p class="dagens-mapp-deck-name">Kortlek: ${escapeHtml(dagens.deckTitle)}</p>
                        </div>
                    </div>
                    <div class="dagens-mapp-stats">
                        <span class="stat-badge">${totalCards} kort totalt</span>
                        <span class="stat-badge due">${dueCards} att repetera idag</span>
                    </div>
                </div>
                <div class="dagens-mapp-actions">
                    <button class="btn-dagens-action secondary" onclick="openDeck('${dagens.deckId}', '${dagens.sectionId}')">Gå till mappen</button>
                    <button class="btn-dagens-action primary" style="background-color: ${itemColor};" onclick="studyDagensMapp('${dagens.deckId}', '${dagens.sectionId}')">Börja repetera</button>
                </div>
            </div>
        </div>
    `;
};

const studyDagensMapp = (deckId, sectionId) => {
    currentDeckId = deckId;
    startSectionStudy(sectionId, false);
};

// Update existing renderDecks calls to renderLibrary
const renderDecks = renderLibrary;

const openDeck = (id, sectionId = null) => {
    currentDeckId = id;
    currentSectionId = sectionId;
    const deck = appData.decks.find(d => d.id === id);
    const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
    document.getElementById('current-deck-title').innerText = section ? `${deck.title} › ${section.title}` : deck.title;

    let displayCards = deck.cards;
    if (sectionId) {
        displayCards = deck.cards.filter(c => c.sectionId === sectionId);
    }

    const dueCount = displayCards.filter(c => c.nextReviewDate <= Date.now()).length;
    const heroStatus = document.getElementById('deck-hero-status');
    
    let itemColor = '#4F46E5';
    if (deck.bookshelfId) {
        const shelf = appData.bookshelves.find(s => s.id === deck.bookshelfId);
        if (shelf && shelf.color) itemColor = shelf.color;
    } else if (deck.color) {
        itemColor = deck.color;
    }
    
    heroStatus.style.setProperty('--deck-color', itemColor);

    if (displayCards.length === 0) {
        heroStatus.className = 'deck-hero-status asleep';
        heroStatus.innerHTML = `
            <div class="hero-status-number">0</div>
            <div class="hero-status-text">Inga kort i denna lek ännu.</div>
        `;
        heroStatus.dataset.action = '';
    } else if (dueCount === 0) {
        heroStatus.className = 'deck-hero-status done';
        heroStatus.innerHTML = `
            <div class="hero-done-check">✓</div>
            <div class="hero-status-text">Allt klart för idag</div>
            <div class="hero-done-link">Träna ändå →</div>
        `;
        heroStatus.dataset.action = 'study-early';
    } else {
        heroStatus.className = 'deck-hero-status active';
        heroStatus.innerHTML = `
            <div class="hero-status-number">${dueCount}</div>
            <div class="hero-status-text">kort väntar på dig. Börja repetera →</div>
        `;
        heroStatus.dataset.action = 'study';
    }

    document.getElementById('btn-study').onclick = (e) => {
        e.preventDefault();
        const action = heroStatus.dataset.action;
        if (!action) return;
        const isEarly = action === 'study-early';
        if (sectionId) startSectionStudy(sectionId, isEarly);
        else startStudy(isEarly);
    };

    renderCards(displayCards);
    switchView('deck', sectionId);

    // Show AI insight boxes (click-to-generate, not auto)
    const insightsContainer = document.getElementById('deck-ai-insights');
    const deckCards = deck.cards.filter(c => c.type !== 'note');
    if (!sectionId && deckCards.length >= 2) {
        insightsContainer.classList.remove('hidden');
        // Restore cached summary if available, otherwise show placeholder
        const cached = deckSummaryCache[id];
        const summaryText = document.getElementById('deck-ai-summary-text');
        const summaryBox = document.getElementById('deck-ai-summary');
        if (cached && cached.summaryHtml && Math.abs(deckCards.length - cached.cardCount) < SUMMARY_REGEN_THRESHOLD) {
            summaryText.innerHTML = cached.summaryHtml;
            renderLatex(summaryText);
            summaryBox.classList.add('deck-ai-loaded');
            summaryBox.onclick = null;
        } else {
            summaryText.innerHTML = '<span class="deck-ai-placeholder">Klicka för att generera</span>';
            summaryBox.classList.remove('deck-ai-loaded');
            summaryBox.onclick = () => generateDeckSummary();
        }
        // Suggestion always starts as placeholder
        const suggestionContent = document.getElementById('deck-ai-suggestion-content');
        const suggestionBox = document.getElementById('deck-ai-suggestion');
        suggestionContent.innerHTML = '<span class="deck-ai-placeholder">Klicka för att generera</span>';
        suggestionBox.classList.remove('deck-ai-loaded');
        suggestionBox.onclick = () => generateDeckSuggestion();
    } else {
        insightsContainer.classList.add('hidden');
    }
};

const renderCardItem = (card, deck) => {
    const isDue = card.nextReviewDate <= Date.now();
    const listItem = document.createElement('div');
    listItem.id = 'card-' + card.id;
    listItem.className = 'list-item';
    listItem.style.cursor = 'pointer';
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="question" style="font-size: 1.05rem; padding: 0.35rem 0;">${safeParse(card.front)}</div>
            <div class="answer">${safeParse(card.back)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;" class="list-item-right">
            ${isDue ? '<div title="Ska repeteras" style="width:10px; height:10px; border-radius:50%; background:var(--rate-1); border:none; flex-shrink:0;"></div>' : '<div title="Väntar" style="width:10px; height:10px; border-radius:50%; background:var(--border-color); border:none; flex-shrink:0;"></div>'}
            <div class="card-menu-container">
                <button class="btn-card-menu-toggle">⋮</button>
                <div class="card-menu-dropdown">
                    <button class="btn-study-card">Repetera direkt</button>
                    <button class="btn-edit-card">Redigera</button>
                    <button class="btn-move-card">Flytta</button>
                    <button class="btn-delete-card">Ta bort</button>
                </div>
            </div>
        </div>
    `;

    listItem.addEventListener('click', (e) => {
        if (e.target.closest('.card-menu-container')) return;
        if (listItem.classList.contains('expanded')) {
            listItem.classList.remove('expanded');
        } else {
            document.querySelectorAll('.list-item.expanded').forEach(el => el.classList.remove('expanded'));
            listItem.classList.add('expanded');
        }
    });
    listItem.addEventListener('dblclick', () => openCardModal(card));
    
    // Drag and Drop listeners
    listItem.addEventListener('dragstart', (e) => {
        draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id); // Explicit data transfer
        e.stopPropagation();
    });
    
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        draggedCardId = null;
    });

    const dropdown = listItem.querySelector('.card-menu-dropdown');

    listItem.querySelector('.btn-study-card').addEventListener('click', (e) => {
        e.stopPropagation();
        currentStudyCards = [card];
        currentStudyIndex = 0;
        renderStudyCard();
        switchView('study');
    });
    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera kort', 'Är du säker på att du vill radera detta kort?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(deck.cards);
        }
    });

    listItem.querySelector('.btn-edit-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditCardModal(card);
    });

    listItem.querySelector('.btn-move-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveCardModal(card);
    });

    renderLatex(listItem);
    return listItem;
};

const renderNoteCardItem = (card, deck) => {
    const listItem = document.createElement('div');
    listItem.id = 'card-' + card.id;
    listItem.className = 'list-item note-card-item';
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="note-card-icon"></div>
            <div class="note-card-text">${safeParse(card.content)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;" class="list-item-right">
            <div class="card-menu-container">
                <button class="btn-card-menu-toggle">⋮</button>
                <div class="card-menu-dropdown">
                    <button class="btn-edit-note-card">Redigera</button>
                    <button class="btn-delete-card">Ta bort</button>
                </div>
            </div>
        </div>
    `;

    listItem.addEventListener('dragstart', (e) => {
        draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id);
        e.stopPropagation();
    });
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        draggedCardId = null;
    });

    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera anteckning', 'Är du säker på att du vill radera denna anteckning?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(deck.cards);
        }
    });

    listItem.querySelector('.btn-edit-note-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteCardModal(card);
    });

    renderLatex(listItem);
    return listItem;
};

const renderCards = (cards) => {
    cardList.innerHTML = '';
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;

    if (cards.length === 0 && deck.sections.length === 0) {
        cardList.innerHTML = `<div class="empty-state" style="padding: 2rem;">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
            </div>
            <h3>Denna kortlek är tom</h3>
            <p>Börja med att lägga till ett nytt kort i verktygsmenyn ovan.</p>
        </div>`;
        return;
    }

    // Render Root Section (cards without sectionId)
    const rootCards = deck.cards.filter(c => !c.sectionId);
    if (rootCards.length > 0 || deck.sections.length > 0) {
        const rootContainer = document.createElement('div');
        rootContainer.className = 'section-container root-section';
        rootContainer.innerHTML = `<div class="section-items list-container"></div>`;
        const itemsList = rootContainer.querySelector('.section-items');
        
        // Root Drop Zone logic
        rootContainer.addEventListener('dragover', (e) => e.preventDefault());
        
        rootContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            rootContainer.classList.add('dragging-over');
        });
        
        rootContainer.addEventListener('dragleave', () => {
            rootContainer.classList.remove('dragging-over');
        });

        rootContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            rootContainer.classList.remove('dragging-over');
            const cardId = e.dataTransfer.getData('cardId') || draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = null;
                    saveData();
                    renderCards(deck.cards);
                }
            }
        });

        rootCards.forEach(card => {
            itemsList.appendChild(card.type === 'note' ? renderNoteCardItem(card, deck) : renderCardItem(card, deck));
        });
        cardList.appendChild(rootContainer);
    }

    // Render Sections
    deck.sections.forEach(section => {
        const cardsInSection = deck.cards.filter(c => c.sectionId === section.id);
        const dueInSection = cardsInSection.filter(c => c.nextReviewDate <= Date.now() && c.type !== 'note').length;
        
        let dotColor = 'transparent';
        let dotTitle = 'Inga kort väntar';
        if (dueInSection > 0) {
            if (dueInSection < 5) dotColor = 'var(--rate-2)'; // yellow
            else if (dueInSection < 15) dotColor = '#f29900'; // orange
            else dotColor = 'var(--rate-1)'; // red
            dotTitle = `${dueInSection} kort väntar. Klicka för att repetera.`;
        }

        const sectionEl = document.createElement('div');
        sectionEl.id = 'section-' + section.id;
        sectionEl.className = 'section-container collapsed';
        sectionEl.innerHTML = `
            <div class="section-header">
                <div class="section-header-left" title="Klicka för att fälla ut/in">
                    <svg class="section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    <span>${escapeHtml(section.title)}</span>
                    ${dueInSection > 0 ? `<button onclick="event.stopPropagation(); startSectionStudy('${section.id}', false);" title="${dotTitle}" style="width:10px; height:10px; border-radius:50%; background:${dotColor}; border:none; padding:0; margin-left:0.5rem; cursor:pointer; flex-shrink:0;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'"></button>` : ''}
                </div>
                <div class="section-tools">
                    <button class="btn-section-add btn-section-add-card" title="Lägg till kort i ${escapeHtml(section.title)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <div class="card-menu-container">
                        <button class="btn-card-menu-toggle">⋮</button>
                        <div class="card-menu-dropdown">
                            <button class="btn-section-rename">Byt namn</button>
                            <button class="btn-section-move">Flytta</button>
                            <button class="btn-section-delete">Ta bort</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="section-items list-container"></div>
        `;

        const sectionHeader = sectionEl.querySelector('.section-header');
        const sectionItems = sectionEl.querySelector('.section-items');

        const addCardBtn = sectionEl.querySelector('.btn-section-add-card');
        addCardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });
        
        if (cardsInSection.length === 0) {
            sectionItems.innerHTML = '<div style="padding: 1rem 1.5rem; color: var(--text-secondary); font-size: 0.85rem; font-style: italic;">Inga kort ännu</div>';
        } else {
            cardsInSection.forEach(card => {
                sectionItems.appendChild(card.type === 'note' ? renderNoteCardItem(card, deck) : renderCardItem(card, deck));
            });
        }

        // Fix: Using a counter for dragenter/leave to prevent flicker when dragging over child elements
        let sectionDragCounter = 0;

        sectionHeader.addEventListener('dragenter', (e) => {
            e.preventDefault();
            sectionDragCounter++;
            if (sectionDragCounter === 1) {
                sectionHeader.classList.add('drag-over');
            }
        });
        sectionHeader.addEventListener('dragover', (e) => e.preventDefault());
        sectionHeader.addEventListener('dragleave', () => {
            sectionDragCounter--;
            if (sectionDragCounter === 0) {
                sectionHeader.classList.remove('drag-over');
            }
        });

        sectionEl.addEventListener('drop', (e) => {
            e.preventDefault();
            sectionHeader.classList.remove('drag-over');
            const cardId = e.dataTransfer.getData('cardId') || draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = section.id;
                    saveData();
                    renderCards(deck.cards);
                }
            }
        });

        // Collapse toggle
        sectionEl.querySelector('.section-header-left').addEventListener('click', (e) => {
            sectionEl.classList.toggle('collapsed');
        });

        // Double-click header to study section
        sectionEl.querySelector('.section-header-left').addEventListener('dblclick', (e) => {
            startSectionStudy(section.id);
        });

        sectionEl.querySelector('.btn-section-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openSectionModal(section);
        });

        sectionEl.querySelector('.btn-section-move').addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveSectionModal(section.id);
        });

        sectionEl.querySelector('.btn-section-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSection(section.id);
        });

        sectionEl.querySelector('.section-header').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });

        cardList.appendChild(sectionEl);
    });
};

const openNotebook = (id) => {
    currentNotebookId = id;
    const notebook = appData.notebooks.find(n => n.id === id);
    document.getElementById('current-notebook-title').innerText = notebook.title;
    renderNotes(notebook.notes);
    switchView('notebook');
};

const renderNotes = (notes) => {
    const noteList = document.getElementById('note-list');
    noteList.innerHTML = '';

    if (notes.length === 0) {
        noteList.innerHTML = `<div class="empty-state" style="padding: 2rem;">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </div>
            <h3>Inga anteckningar än</h3>
            <p>Klicka "Lägg till anteckning" för att börja skriva.</p>
        </div>`;
        return;
    }

    [...notes].reverse().forEach(note => {
        const noteEl = document.createElement('div');
        noteEl.className = 'note-item';
        noteEl.innerHTML = `
            <div class="note-content-summary">${safeParse(note.content)}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="card-menu-container">
                    <button class="btn-card-menu-toggle">⋮</button>
                    <div class="card-menu-dropdown">
                        <button class="btn-edit-note">Redigera</button>
                        <button class="btn-delete-note">Ta bort</button>
                    </div>
                </div>
            </div>
        `;

        noteEl.onclick = () => {
            currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Visa anteckning';
            switchView('addNote');
        };

        noteEl.querySelector('.btn-delete-note').onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirmModal('Radera anteckning', 'Vill du verkligen radera denna anteckning?', 'Radera', true)) {
                const notebook = appData.notebooks.find(n => n.id === currentNotebookId);
                notebook.notes = notebook.notes.filter(n => n.id !== note.id);
                saveData();
                renderNotes(notebook.notes);
            }
        };

        noteEl.querySelector('.btn-edit-note').onclick = (e) => {
            e.stopPropagation();
            currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Redigera anteckning';
            switchView('addNote');
        };

        noteList.appendChild(noteEl);
        renderLatex(noteEl);
    });
};

// --- STUDY LOGIC ---
const startStudy = (forceAll = false) => {
    isPlaygroundSession = false;
    lastSessionWasPlayground = false;
    playgroundMode = null;
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck || deck.cards.length === 0) return;

    if (forceAll) {
        currentStudyCards = deck.cards.filter(c => c.type !== 'note');
    } else {
        currentStudyCards = deck.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now());
    }

    if (currentStudyCards.length === 0 && !forceAll) {
        showToast("Inga kort att repetera just nu!");
        return;
    }

    // Shuffle the cards to study
    fisherYatesShuffle(currentStudyCards);

    currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

const startGlobalStudy = () => {
    isPlaygroundSession = false;
    lastSessionWasPlayground = false;
    playgroundMode = null;
    const allDueCards = appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now()));
    if (allDueCards.length === 0) {
        showToast('Inga kort att repetera just nu!');
        return;
    }
    currentDeckId = null;
    currentStudyCards = allDueCards;
    fisherYatesShuffle(currentStudyCards);
    currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

const startBookshelfStudy = (bookshelfId) => {
    isPlaygroundSession = false;
    lastSessionWasPlayground = false;
    // Collect all due cards from decks belonging to this bookshelf
    const dueCards = appData.decks
        .filter(d => d.bookshelfId === bookshelfId)
        .flatMap(d => d.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now()));
        
    if (dueCards.length === 0) {
        showToast('Inga kort att repetera i denna bokhylla just nu!');
        return;
    }
    
    currentDeckId = null;
    currentStudyCards = dueCards;
    fisherYatesShuffle(currentStudyCards);
    currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

const startSectionStudy = (sectionId, forceAll = false) => {
    isPlaygroundSession = false;
    lastSessionWasPlayground = false;
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;
    
    let sectionCards = deck.cards.filter(c => c.type !== 'note' && c.sectionId === sectionId);
    if (!forceAll) {
        sectionCards = sectionCards.filter(c => c.nextReviewDate <= Date.now());
    }
    
    if (sectionCards.length === 0) {
        showToast('Inga kort att repetera i denna mapp just nu!');
        return;
    }
    
    currentStudyCards = sectionCards;
    fisherYatesShuffle(currentStudyCards);
    currentStudyIndex = 0;
    renderStudyCard();
    switchView('study');
};

const renderStudyCard = () => {
    document.getElementById('cinema-overlay')?.remove();
    if (currentStudyIndex >= currentStudyCards.length) {
        document.getElementById('study-progress-fill').style.width = '100%';
        if (isPlaygroundSession) {
            finishPlaygroundSession();
        } else {
            const cv = document.getElementById('view-study-complete');
            cv.querySelector('h1').textContent = 'Bra jobbat!';
            cv.querySelector('p').textContent = 'Du har repeterat alla schemalagda kort.';
            cv.querySelector('#btn-complete-back').textContent = 'Tillbaka till kortleken';
            switchView('complete');
            renderDecks();
        }
        return;
    }

    const card = currentStudyCards[currentStudyIndex];

    // Reset AI Assistant state
    document.getElementById('study-ai-chat').classList.add('hidden');
    document.getElementById('study-ai-chat').innerHTML = '';
    document.getElementById('input-study-ai').value = '';
    document.getElementById('study-ai-loading').classList.add('hidden');

    document.getElementById('study-progress').innerText = `${currentStudyIndex + 1} / ${currentStudyCards.length}`;
    const progressPercent = currentStudyCards.length > 0 ? ((currentStudyIndex) / currentStudyCards.length) * 100 : 0;
    document.getElementById('study-progress-fill').style.width = `${progressPercent}%`;
    
    const frontTextEl = document.getElementById('study-front-text');
    if (card._jeopardy) {
        frontTextEl.innerHTML = `<div style="font-size: 0.85rem; font-weight: 700; color: var(--primary-color); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; opacity: 0.8;">SVAR (Fråga eftersöks)</div>` + safeParse(card.front);
    } else {
        frontTextEl.innerHTML = safeParse(card.front);
    }
    document.getElementById('study-back-text').innerHTML = safeParse(card.back);
    
    // Render back images
    const backTextEl = document.getElementById('study-back-text');
    renderCardBackImages(backTextEl, card.backImages);
    
    // Apply long-form styling if needed
    const backTextEl2 = document.getElementById('study-back-text');
    if (card.isLongForm) {
        backTextEl2.classList.add('long-form-content');
    } else {
        backTextEl2.classList.remove('long-form-content');
    }

    renderLatex(document.getElementById('study-front-text'));
    renderLatex(backTextEl2);

    // Extract times to present to user
    document.getElementById('time-1').innerText = '< 1m';

    // Time predictions calculations
    const calcNextInterval = (ease, interval, rep, rating) => {
        if (rating === 1) return 0;
        if (rating === 2) return rep === 0 ? 0.5 : interval * 1.2;
        if (rating === 3) return rep === 0 ? 1 : (rep === 1 ? 6 : interval * ease);
        if (rating === 4) return rep === 0 ? 4 : (interval * ease * 1.3);
    };

    const formatInt = (days) => days < 1 ? '< 1d' : Math.round(days) + 'd';

    document.getElementById('time-2').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 2));
    document.getElementById('time-3').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 3));
    document.getElementById('time-4').innerText = formatInt(calcNextInterval(card.easeFactor, card.interval, card.repetition, 4));

    // Dynamically size the flashcard to fit content
    const flashcardInner = document.getElementById('flashcard-inner');
    const frontFace = document.querySelector('.flashcard-front');
    flashcardInner.classList.remove('flipped');
    // Temporarily make front visible to measure
    requestAnimationFrame(() => {
        const flashcardEl = document.querySelector('.flashcard');
        // Reset minHeight and force reflow so scrollHeight reflects actual content
        flashcardInner.style.minHeight = '0px';
        if (flashcardEl) flashcardEl.style.minHeight = '0px';
        frontFace.style.position = 'static';
        frontFace.offsetHeight; // force reflow
        const frontHeight = frontFace.scrollHeight;
        frontFace.style.position = '';
        const finalHeight = Math.max(200, Math.min(frontHeight, window.innerHeight * 0.7));
        flashcardInner.style.minHeight = finalHeight + 'px';
        if (flashcardEl) flashcardEl.style.minHeight = finalHeight + 'px';
    });

    const ratingBtns = document.querySelectorAll('.btn-rate');
    ratingBtns.forEach(btn => btn.style.display = '');

    // Reset UI to front
    document.getElementById('study-actions').classList.add('hidden');
    document.getElementById('study-flip-action').classList.remove('hidden');
};

const processRating = (rating) => {
    try {
        const card = currentStudyCards[currentStudyIndex];
        if (!card) { console.error('No card at index', currentStudyIndex); return; }

        if (isPlaygroundSession && playgroundSessionStats) {
            if (rating === 1) playgroundSessionStats.again++;
            else playgroundSessionStats.correct++;
        }

        // SuperMemo-2 Simple Algorithm Update
        if (rating === 1) { // Again
            card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
            card.repetition = 0;
            card.interval = 0;
        } else {
            if (rating === 2) { // Hard
                card.easeFactor = Math.max(1.3, card.easeFactor - 0.15);
                card.interval = card.repetition === 0 ? 0.5 : card.interval * 1.2;
                card.repetition += 1;
            } else if (rating === 3) { // Good
                card.interval = card.repetition === 0 ? 1 : (card.repetition === 1 ? 6 : card.interval * card.easeFactor);
                card.repetition += 1;
            } else if (rating === 4) { // Easy
                card.easeFactor += 0.15;
                card.interval = card.repetition === 0 ? 4 : (card.interval * card.easeFactor * 1.3);
                card.repetition += 1;
            }
        }

        card.easeFactor = Math.max(1.3, card.easeFactor);
        card.lastReviewed = Date.now();
        if (rating === 1) card.lapses = (card.lapses || 0) + 1;

        // Set next review date
        if (rating === 1) {
            card.nextReviewDate = Date.now() + 60000;
            currentStudyCards.push(card);
        } else {
            const daysInMillis = card.interval * 24 * 60 * 60 * 1000;
            card.nextReviewDate = Date.now() + daysInMillis;
        }

        // Update main deck references and save (skip for jeopardy — cards are swapped copies)
        if (!card._jeopardy) {
            for (const d of appData.decks) {
                const idx = d.cards.findIndex(c => c.id === card.id);
                if (idx > -1) {
                    d.cards[idx] = card;
                    break;
                }
            }
            // Log review to daily counts
            const r = loadRecords();
            const todayStr = getLocalDateString();
            if (!r.dailyCounts) r.dailyCounts = {};
            r.dailyCounts[todayStr] = (r.dailyCounts[todayStr] || 0) + 1;
            if (!r.bestDayCount || r.dailyCounts[todayStr] > r.bestDayCount) {
                r.bestDay = todayStr;
                r.bestDayCount = r.dailyCounts[todayStr];
            }
            saveRecords(r);

            saveData();
        }

        const flashcardContainer = document.querySelector('.flashcard');
        const hasOverlay = document.getElementById('cinema-overlay') !== null;
        if (flashcardContainer && !hasOverlay) {
            let swipeClass = '';
            if (rating === 1) swipeClass = 'swipe-down';
            else if (rating === 2) swipeClass = 'swipe-left';
            else if (rating === 3) swipeClass = 'swipe-up';
            else if (rating === 4) swipeClass = 'swipe-right';
            
            flashcardContainer.classList.add(swipeClass);

            setTimeout(() => {
                flashcardContainer.classList.remove(swipeClass);
                currentStudyIndex++;
                renderStudyCard();
            }, 400); // Wait for CSS animation
        } else {
            currentStudyIndex++;
        }
    } catch (err) {
        console.error('processRating error:', err);
        alert('Fel vid betygsättning: ' + err.message);
    }
};

const deleteCurrentStudyCard = async () => {
    const card = currentStudyCards[currentStudyIndex];
    if (!card) return;

    if (await showConfirmModal('Radera kort', 'Är du säker på att du vill radera detta kort permanent?', 'Radera', true)) {
        // Remove from master data
        for (const d of appData.decks) {
            const idx = d.cards.findIndex(c => c.id === card.id);
            if (idx > -1) {
                d.cards.splice(idx, 1);
                break;
            }
        }
        
        // Remove from current session (all instances, including duplicates from 'Again')
        currentStudyCards = currentStudyCards.filter(c => c.id !== card.id);
        // Adjust index since we rebuilt the array
        // currentStudyIndex now points at the next card (or end)
        
        saveData();
        showToast('Kortet har raderats');
        
        // Render next card (the card that was after this one is now at currentStudyIndex)
        // If we were at the last card, renderStudyCard will handle session completion.
        renderStudyCard();
    }
};


// --- AI LOGIC ---
let currentAiCard = null;
let currentAiResponseRaw = null;
let proposedTopicCards = [];
let currentTopicRawInput = "";
let proposedDiaryCards = [];
let aiGeneratorOptions = {
    sourceType: 'topic',
    quantity: 10,
    difficulty: 'intermediate',
    focus: 'mixed',
    sectionId: ''
};

const openCardModal = (card) => {
    currentAiCard = card;
    currentAiResponseRaw = null;
    document.getElementById('detail-front-text').innerHTML = safeParse(card.front);
    const backEl = document.getElementById('detail-back-text');
    backEl.innerHTML = safeParse(card.back);
    renderCardBackImages(backEl, card.backImages);
    renderLatex(document.getElementById('detail-front-text'));
    renderLatex(backEl);
    document.getElementById('ai-explanation-container').classList.add('hidden');
    document.getElementById('test-question-actions').classList.add('hidden');
    document.getElementById('ai-text').innerText = '';
    document.getElementById('ai-loading').classList.add('hidden');
    document.getElementById('btn-explain-ai').style.display = 'flex';
    document.getElementById('btn-test-ai').style.display = 'flex';
    document.getElementById('modal-card-details').classList.remove('hidden');
};

let currentEditCard = null;
let currentMoveCard = null;

const renderMoveTargets = (filterText = '') => {
    const container = document.getElementById('move-targets-list');
    const confirmBtn = document.getElementById('btn-confirm-move-card');
    container.innerHTML = '';
    
    confirmBtn.disabled = true;
    document.getElementById('selected-move-target').value = '';

    const lowerFilter = filterText.toLowerCase();

    appData.decks.forEach(deck => {
        const deckVisible = deck.title.toLowerCase().includes(lowerFilter);
        
        // Deck Root Item
        if (deckVisible || (deck.sections && deck.sections.some(s => s.title.toLowerCase().includes(lowerFilter)))) {
            const deckItem = document.createElement('div');
            deckItem.className = 'move-target-item';
            const isCurrent = currentMoveCard && deck.id === currentDeckId && !currentMoveCard.sectionId;
            if (isCurrent) deckItem.classList.add('disabled');
            
            deckItem.innerHTML = `
                <div class="move-target-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="move-target-info">
                    <span class="move-target-name">${deck.title}${isCurrent ? ' (Här)' : ''}</span>
                    <span class="move-target-type">Kortlek</span>
                </div>
            `;
            
            if (!isCurrent) {
                deckItem.onclick = () => {
                    document.querySelectorAll('.move-target-item').forEach(el => el.classList.remove('selected'));
                    deckItem.classList.add('selected');
                    document.getElementById('selected-move-target').value = `${deck.id}:root`;
                    confirmBtn.disabled = false;
                };
            }
            container.appendChild(deckItem);
        }

        // Section Items
        if (deck.sections) {
            deck.sections.forEach(section => {
                if (section.title.toLowerCase().includes(lowerFilter) || deck.title.toLowerCase().includes(lowerFilter)) {
                    const secItem = document.createElement('div');
                    secItem.className = 'move-target-item section';
                    const isCurrent = currentMoveCard && deck.id === currentDeckId && currentMoveCard.sectionId === section.id;
                    if (isCurrent) secItem.classList.add('disabled');

                    secItem.innerHTML = `
                        <div class="move-target-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                        </div>
                        <div class="move-target-info">
                            <span class="move-target-name">${escapeHtml(section.title)}${isCurrent ? ' (Här)' : ''}</span>
                            <span class="move-target-type">${escapeHtml(deck.title)} &rsaquo; Mapp</span>
                        </div>
                    `;

                    if (!isCurrent) {
                        secItem.onclick = () => {
                            document.querySelectorAll('.move-target-item').forEach(el => el.classList.remove('selected'));
                            secItem.classList.add('selected');
                            document.getElementById('selected-move-target').value = `${deck.id}:${section.id}`;
                            confirmBtn.disabled = false;
                        };
                    }
                    container.appendChild(secItem);
                }
            });
        }
    });

    if (container.children.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary); opacity: 0.6;">Inga matchningar hittades</div>';
    }
};

const openMoveCardModal = (card) => {
    currentMoveCard = card;
    document.getElementById('input-move-search').value = '';
    renderMoveTargets();
    document.getElementById('modal-move-card').classList.remove('hidden');
    setTimeout(() => document.getElementById('input-move-search').focus(), 100);
};

let currentMoveSectionId = null;

const openMoveSectionModal = (sectionId) => {
    currentMoveSectionId = sectionId;
    const select = document.getElementById('select-move-section-deck');
    if (!select) return;
    select.innerHTML = '';

    appData.decks.forEach(deck => {
        if (deck.id === currentDeckId) return; // Cannot move to current deck
        const option = document.createElement('option');
        option.value = deck.id;
        option.innerText = deck.title;
        select.appendChild(option);
    });

    if (select.children.length === 0) {
        alert("Det finns inga andra kortlekar att flytta till.");
        return;
    }

    document.getElementById('modal-move-section').classList.remove('hidden');
};

let currentMoveItem = null;
let currentMoveItemType = null;

const openMoveItemModal = (item, type) => {
    currentMoveItem = item;
    currentMoveItemType = type;
    const select = document.getElementById('select-move-bookshelf');
    select.innerHTML = '';
    
    // Default option to remove from bookshelf
    const defaultOption = document.createElement('option');
    defaultOption.value = 'root';
    defaultOption.innerText = 'Ingen bokhylla (Huvudvyn)';
    select.appendChild(defaultOption);

    appData.bookshelves.forEach(shelf => {
        const option = document.createElement('option');
        option.value = shelf.id;
        option.innerText = shelf.title;
        if (item.bookshelfId === shelf.id) option.selected = true;
        select.appendChild(option);
    });
    
    document.getElementById('modal-move-item').classList.remove('hidden');
};

let currentSectionToEdit = null;
let preselectSectionId = null;

const openSectionModal = (section = null) => {
    currentSectionToEdit = section;
    const modal = document.getElementById('modal-new-section');
    const title = document.getElementById('section-modal-title');
    const input = document.getElementById('new-section-name');
    
    if (section) {
        title.innerText = 'Redigera mapp';
        input.value = section.title;
    } else {
        title.innerText = 'Ny mapp';
        input.value = '';
    }
    
    modal.classList.remove('hidden');
    input.focus();
};

const closeSectionModal = () => {
    document.getElementById('modal-new-section').classList.add('hidden');
    currentSectionToEdit = null;
};

const deleteSection = async (sectionId) => {
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;

    const section = deck.sections.find(s => s.id === sectionId);
    if (!section) return;

    const cardsInSection = deck.cards.filter(c => c.sectionId === sectionId);

    if (cardsInSection.length > 0) {
        const deleteCards = await showConfirmModal(
            'Radera mapp',
            `Denna mapp innehåller ${cardsInSection.length} kort. Vill du radera även korten?`,
            'Radera allt',
            true
        );

        if (deleteCards) {
            deck.cards = deck.cards.filter(c => c.sectionId !== sectionId);
            showToast('Mappen raderad tillsammans med dess kort');
        } else {
            cardsInSection.forEach(c => c.sectionId = null);
            showToast('Mappen raderad, korten flyttades ut');
        }
    } else {
        showToast('Mappen raderad');
    }

    deck.sections = deck.sections.filter(s => s.id !== sectionId);
    saveData();
    renderCards(deck.cards);
};

let currentNoteCard = null;

const openNoteCardModal = (card = null) => {
    currentNoteCard = card;
    document.getElementById('note-card-modal-title').textContent = card ? 'Redigera anteckning' : 'Lägg till anteckning';
    document.getElementById('note-card-content').value = card ? (card.content || '') : '';
    document.getElementById('modal-note-card').classList.remove('hidden');
};


const openEditCardModal = (card) => {
    currentEditCard = card;
    document.getElementById('edit-card-front').value = card.front;
    document.getElementById('edit-card-back').value = card.back;
    document.getElementById('edit-card-longform').checked = card.isLongForm || false;
    // Load existing images into temp array
    editCardImages = card.backImages ? [...card.backImages] : [];
    const refreshEditPreviews = (idx) => {
        if (typeof idx === 'number') editCardImages.splice(idx, 1);
        renderImagePreviews(
            document.getElementById('edit-card-back-image-preview'),
            editCardImages,
            refreshEditPreviews
        );
    };
    refreshEditPreviews();
    document.getElementById('modal-edit-card').classList.remove('hidden');
};

const getApiKey = async () => {
    try {
        const res = await fetch('.env');
        if (!res.ok) return null;
        const text = await res.text();
        const match = text.match(/ANTHROPIC_API_KEY=(.*)/);
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
};

// --- AI CONTEXT HELPER ---
const buildDeckContext = (deckId) => {
    const deck = deckId ? appData.decks.find(d => d.id === deckId) : null;
    if (!deck || !deck.cards || deck.cards.length === 0) return '';

    const cards = deck.cards.filter(c => c.type !== 'note');
    if (cards.length === 0) return '';

    const sampleSize = Math.min(8, cards.length);
    const samples = cards.slice(-sampleSize);
    const sampleStr = samples.map(c => `F: ${c.front} | S: ${c.back}`).join('\n');

    const sections = (deck.sections || []).map(s => s.title);
    const sectionStr = sections.length > 0 ? `\nMappar i kortleken: ${sections.join(', ')}` : '';

    return `\n\n--- Kontext om kortleken "${deck.title}" (${cards.length} kort) ---\nHär är ett urval av befintliga kort som visar nivå och stil:\n${sampleStr}${sectionStr}\n---`;
};

// --- DECK AI INSIGHTS ---
let deckInsightsAbort = null;

// Cache: { deckId: { cardCount, sectionCount, summaryHtml, timestamp } }
const deckSummaryCache = {};
const SUMMARY_REGEN_THRESHOLD = 3; // regenerate after this many card changes

const buildDeckCardList = (deck) => {
    const cards = deck.cards.filter(c => c.type !== 'note');
    const sections = (deck.sections || []).map(s => s.title);
    const cardList = cards.map(c => {
        const sec = c.sectionId ? (deck.sections || []).find(s => s.id === c.sectionId) : null;
        return `F: ${c.front} | S: ${c.back}${sec ? ` [${sec.title}]` : ''}`;
    }).join('\n');
    const sectionInfo = sections.length > 0 ? `\nMappar: ${sections.join(', ')}` : '';
    return { cards, sections, cardList, sectionInfo };
};

const renderSuggestionCard = (card, container) => {
    container.innerHTML = `
        <div class="deck-ai-suggestion-card">
            <div class="deck-ai-suggestion-front">${safeParse(card.front)}</div>
            <div class="deck-ai-suggestion-back">${safeParse(card.back)}</div>
            ${card.reasoning ? `<div style="font-size:0.75rem;color:var(--text-secondary);opacity:0.7;font-style:italic;margin-top:0.15rem;">${escapeHtml(card.reasoning)}</div>` : ''}
            <div class="deck-ai-suggestion-actions">
                <button class="btn btn-add-suggestion" onclick="addSuggestedCard(this)">+ Lägg till</button>
                <button class="btn btn-skip-suggestion" onclick="refreshSuggestedCard()">↻ Nytt förslag</button>
            </div>
        </div>
    `;
    renderLatex(container);
    container._pendingCard = card;
};

const fetchSuggestion = async (apiKey, deck, info, signal) => {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 400,
            system: `Du är en expert på spaced repetition och pedagogik. Du får en komplett lista med flashcards. Din uppgift: identifiera det kort som saknas mest i kortleken — den fråga som borde finnas men inte gör det. Tänk på:
- Vilka koncept testas men kopplingen mellan dem saknas?
- Finns det viktiga förkunskaper eller konsekvenser som aldrig frågas om?
- Vilka vanliga tentafrågor eller tillämpningar saknas?
- Var finns den största kunskapsluckan givet den nivå korten visar?

Kortet ska vara så träffsäkert att användaren tänker "Såklart ska jag ha den frågan!".

VIKTIGT: Föreslå INTE ett kort som liknar något som redan finns. Var originell och hitta en ny vinkel.

Svara med ENBART ett rent JSON-objekt: {"front": "fråga", "back": "svar", "reasoning": "En mening om varför just detta kort saknas"}
Ingen markdown, inget brus. Skriv kortet på samma språk som de befintliga korten.`,
            messages: [{
                role: 'user',
                content: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`
            }]
        })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (raw.startsWith('```')) raw = raw.replace(/^```/, '').replace(/```$/, '').trim();
    const card = JSON.parse(raw);
    if (!card || !card.front || !card.back) throw new Error('Invalid card format');
    return card;
};

window.generateDeckSummary = async () => {
    const summaryText = document.getElementById('deck-ai-summary-text');
    const summaryBox = document.getElementById('deck-ai-summary');
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;

    summaryText.innerHTML = '<div class="ai-shimmer"></div>';
    summaryBox.onclick = null;

    const apiKey = await getApiKey();
    if (!apiKey) { summaryText.innerHTML = '<span class="deck-ai-placeholder">Ingen API-nyckel.</span>'; return; }

    const info = buildDeckCardList(deck);

    try {
        const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 400,
                system: `Du sammanfattar flashcard-kortlekar med precision och skärpa. Du får hela kortlistan. Skriv en kort, sofistikerad sammanfattning (2-4 meningar) som gör två saker:

1. Fånga kärnan: Vad handlar kortleken egentligen om, på en nivå djupare än titeln antyder?
2. Identifiera luckor: Nämn specifikt 1-2 ämnen/koncept som logiskt borde finnas med givet resten av materialet, men som saknas.

Tonen ska vara som en kunnig kollega som snabbt ger dig läget — inte en AI som analyserar. Skriv på svenska. Ingen inledning, gå rakt på sak.`,
                messages: [{
                    role: 'user',
                    content: `Kortlek: "${deck.title}" (${info.cards.length} kort)${info.sectionInfo}\n\n${info.cardList}`
                }]
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const html = safeParse(data.content[0].text.trim());
        summaryText.innerHTML = html;
        renderLatex(summaryText);
        summaryBox.classList.add('deck-ai-loaded');
        deckSummaryCache[currentDeckId] = { cardCount: info.cards.length, sectionCount: info.sections.length, summaryHtml: html, timestamp: Date.now() };
    } catch (e) {
        console.error('AI summary error:', e);
        summaryText.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda sammanfattning.</span>';
        summaryBox.onclick = () => generateDeckSummary();
    }
};

window.generateDeckSuggestion = async () => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    const suggestionBox = document.getElementById('deck-ai-suggestion');
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;

    suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';
    suggestionBox.onclick = null;

    const apiKey = await getApiKey();
    if (!apiKey) { suggestionContent.innerHTML = '<span class="deck-ai-placeholder">Ingen API-nyckel.</span>'; return; }

    const info = buildDeckCardList(deck);

    try {
        const card = await fetchSuggestion(apiKey, deck, info);
        renderSuggestionCard(card, suggestionContent);
        suggestionBox.classList.add('deck-ai-loaded');
    } catch (e) {
        console.error('AI suggestion error:', e);
        suggestionContent.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda förslag.</span>';
        suggestionBox.onclick = () => generateDeckSuggestion();
    }
};

window.addSuggestedCard = (btnEl) => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    const card = suggestionContent._pendingCard;
    if (!card) return;

    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (!deck) return;

    deck.cards.push(createCard(card.front, card.back, false, [], null));
    saveData();
    openDeck(currentDeckId, currentSectionId);
    showToast('Kort tillagt!');
};

window.refreshSuggestedCard = () => {
    const suggestionContent = document.getElementById('deck-ai-suggestion-content');
    suggestionContent.innerHTML = '<div class="ai-shimmer"></div>';

    (async () => {
        const apiKey = await getApiKey();
        if (!apiKey) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (!deck) return;
        const info = buildDeckCardList(deck);
        try {
            const card = await fetchSuggestion(apiKey, deck, info);
            renderSuggestionCard(card, suggestionContent);
        } catch (e) {
            console.error('AI suggestion refresh error:', e);
            suggestionContent.innerHTML = '<span style="color:var(--text-secondary);font-size:0.82rem;opacity:0.6;">Kunde inte ladda förslag.</span>';
        }
    })();
};

const fetchExplanation = async (apiKey, card) => {
    document.getElementById('btn-explain-ai').style.display = 'none';
    document.getElementById('btn-test-ai').style.display = 'none';
    document.getElementById('ai-explanation-container').classList.remove('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-text').innerText = '';

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 600,
                system: 'Du är en hjälpsam och pedagogisk lärare. Ge en kort, koncis förklaring eller minnesregel (max 300 ord totalt) för följande flashcard-fråga och svar. Målet är att hjälpa eleven förstå eller minnas svaret bättre. Eleven är däremot en vuxen person som förväntar sig rigorositet. Anpassa din förklaring efter den nivå och stil som framgår av kontexten.',
                messages: [{
                    role: 'user',
                    content: `Fråga: ${card.front}\nSvar: ${card.back}${buildDeckContext(currentDeckId)}`
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();

        document.getElementById('ai-loading').classList.add('hidden');

        const aiTextElement = document.getElementById('ai-text');
        // Render Markdown so newlines and formatting works
        aiTextElement.innerHTML = safeParse(data.content[0].text);

        // Auto-render LaTeX using KaTeX
        renderLatex(aiTextElement);

    } catch (e) {
        console.error("Anthropic API Error:", e);
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('ai-text').innerText = `Kunde inte hämta förklaring: ${e.message}`;
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};

const fetchTestQuestion = async (apiKey, card, modifier = null) => {
    document.getElementById('btn-explain-ai').style.display = 'none';
    document.getElementById('btn-test-ai').style.display = 'none';
    document.getElementById('test-question-actions').classList.add('hidden');
    document.getElementById('ai-explanation-container').classList.remove('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-text').innerText = '';

    const deckCtx = buildDeckContext(currentDeckId);
    let userContent = `Skapa en tentafråga som DIREKT testar och tillämpar detta flashcard:\nKort-fråga: ${card.front}\nKort-svar: ${card.back}${deckCtx}`;

    if (modifier && currentAiResponseRaw) {
        if (modifier === 'easier') {
            userContent = `Din tidigare provfråga var:\n${currentAiResponseRaw}\n\nGör nu en NY provfråga på exakt samma koncept för detta flashcard, men gör den Tydligt LÄTTARE att förstå eller räkna ut.`;
        } else if (modifier === 'harder') {
            userContent = `Din tidigare provfråga var:\n${currentAiResponseRaw}\n\nGör nu en NY provfråga på exakt samma koncept för detta flashcard, men gör den Tydligt SVÅRARE och mer komplex.`;
        } else if (modifier === 'similar') {
            userContent = `Din tidigare provfråga var:\n${currentAiResponseRaw}\n\nGör nu en helt NY, LIKNANDE provfråga (samma svårighetsgrad) på exakt samma koncept för detta flashcard. Ange andra siffror eller scenarion.`;
        }
    }

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 600,
                system: 'Du är en sträng men pedagogisk examinator. Din uppgift är att testa elevens förståelse baserat PÅ EXAKT DEN information som finns på flashcardet.\nDu ska skapa EN (1) specifik tentafråga som direkt prövar kunskapen i flashcardet.\nMålet är att se om eleven verkligen kan tillämpa konceptet på kortet. Om kortet handlar om matematik, gör en passande räkneuppgift. Handlar det om något annat, gör en tillämpad faktafråga.\n\nFORMAT:\nSkriv först ut provfrågan.\nSkriv därefter, under rubriken "Lösning:", det korrekta svaret och en förklaring. Formatera all eventuell matematik med LaTeX.',
                messages: [{
                    role: 'user',
                    content: userContent
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        currentAiResponseRaw = data.content[0].text;

        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('test-question-actions').classList.remove('hidden');

        const aiTextElement = document.getElementById('ai-text');
        aiTextElement.innerHTML = safeParse(currentAiResponseRaw);

        renderLatex(aiTextElement);

    } catch (e) {
        console.error("Anthropic API Error:", e);
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('ai-text').innerText = `Kunde inte hämta provfråga: ${e.message}`;
        document.getElementById('btn-explain-ai').style.display = 'flex';
        document.getElementById('btn-test-ai').style.display = 'flex';
    }
};

const renderProposedCards = () => {
    const container = document.getElementById('topic-cards-list');
    if (!container) return;
    container.innerHTML = '';

    // Update summary count
    document.getElementById('topic-summary-count').innerText = `${proposedTopicCards.length} kort skapade. Anpassa eller välj vilka du vill behålla.`;
    
    proposedTopicCards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'ai-generated-card-item';
        div.setAttribute('data-index', index);
        div.innerHTML = `
            <div style="display:flex; align-items:center; padding-top:2px;">
                <input type="checkbox" class="ai-card-select-checkbox" data-index="${index}" checked style="width:16px; height:16px; accent-color:#7C3AED; cursor:pointer;">
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:0.5rem;">
                <div class="ai-card-field-group">
                    <span style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:var(--text-secondary); display:block; margin-bottom:2px;">Framsida (Fråga)</span>
                    <textarea class="ai-card-front-input" rows="2" data-index="${index}" style="width:100%; font-family:inherit; font-size:0.85rem; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:8px; resize:vertical; outline:none; transition:border-color 0.15s; background:#fafafa;">${card.front}</textarea>
                </div>
                <div class="ai-card-field-group">
                    <span style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:var(--text-secondary); display:block; margin-bottom:2px;">Baksida (Svar)</span>
                    <textarea class="ai-card-back-input" rows="2" data-index="${index}" style="width:100%; font-family:inherit; font-size:0.85rem; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:8px; resize:vertical; outline:none; transition:border-color 0.15s; background:#fafafa;">${card.back}</textarea>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end;">
                <button type="button" class="btn-ai-card-delete" data-index="${index}" style="background:none; border:none; padding:6px; cursor:pointer; color:var(--rate-1); display:flex; align-items:center; justify-content:center; opacity:0.6; transition:opacity 0.2s;" title="Ta bort">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
                <button type="button" class="btn-ai-card-regenerate" data-index="${index}" style="background:none; border:none; padding:6px; cursor:pointer; color:#7C3AED; display:flex; align-items:center; justify-content:center; opacity:0.6; transition:opacity 0.2s;" title="Generera om detta kort">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                </button>
            </div>
        `;
        container.appendChild(div);
    });

    // Listen to changes to save textarea inputs back to the array immediately
    container.querySelectorAll('.ai-card-front-input').forEach(ta => {
        ta.addEventListener('input', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            proposedTopicCards[idx].front = e.currentTarget.value;
        });
    });

    container.querySelectorAll('.ai-card-back-input').forEach(ta => {
        ta.addEventListener('input', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            proposedTopicCards[idx].back = e.currentTarget.value;
        });
    });

    // Checkbox toggle changes
    container.querySelectorAll('.ai-card-select-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSaveCountBadge();
        });
    });

    // Individual delete
    container.querySelectorAll('.btn-ai-card-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            proposedTopicCards.splice(idx, 1);
            renderProposedCards();
            updateSaveCountBadge();
        });
    });

    // Individual regenerate
    container.querySelectorAll('.btn-ai-card-regenerate').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            regenerateSingleCard(idx);
        });
    });

    updateSaveCountBadge();

    // Show/hide topic preview step
    if (proposedTopicCards.length === 0) {
        document.getElementById('topic-preview-step').classList.add('hidden');
        document.getElementById('topic-setup-step').classList.remove('hidden');
    }
};

const updateSaveCountBadge = () => {
    const checkedCount = document.querySelectorAll('.ai-card-select-checkbox:checked').length;
    const saveBtn = document.getElementById('btn-save-count');
    if (saveBtn) saveBtn.innerText = checkedCount;
};
window.updateSaveCountBadge = updateSaveCountBadge;

const regenerateSingleCard = async (index) => {
    const container = document.getElementById('topic-cards-list');
    const cardEl = container.querySelector(`.ai-generated-card-item[data-index="${index}"]`);
    if (!cardEl) return;

    // Show loading spinner placeholder in this card
    cardEl.style.opacity = '0.7';
    const fieldsDiv = cardEl.querySelector('div[style*="flex:1"]');
    const oldHTML = fieldsDiv.innerHTML;
    fieldsDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; color:#7C3AED; font-size:0.85rem; padding:1.5rem 0;">
            <div class="wizard-spinner" style="width:20px; height:20px; border-width:2.5px;"></div>
            <span>Ersätter med nytt kort...</span>
        </div>
    `;
    const actionButtons = cardEl.querySelectorAll('button');
    actionButtons.forEach(btn => btn.style.display = 'none');

    const apiKey = await getApiKey();
    if (!apiKey) {
        alert("Hittade ingen API-nyckel.");
        renderProposedCards();
        return;
    }

    // Build blacklist of existing proposed questions to avoid duplication
    const blacklist = proposedTopicCards
        .map((c, i) => i !== index ? `- ${c.front}` : "")
        .filter(q => q !== "")
        .join('\n');

    let deckContext = "";
    const deck = appData.decks.find(d => d.id === currentDeckId);
    if (deck && deck.cards.length > 0) {
        deckContext = deck.cards.map(c => `- ${c.front}`).join('\n');
        const sampleSize = Math.min(5, deck.cards.length);
        const samples = deck.cards.slice(-sampleSize).map(c => `F: ${c.front} | S: ${c.back}`).join('\n');
        deckContext += `\n\nFör att förstå nivå och stil, här är några fullständiga kort:\n${samples}`;
    }

    const difficultyPrompt = aiGeneratorOptions.difficulty === 'beginner' 
        ? 'Fokusera på grundläggande definitioner och enkla förklaringar (Nybörjarnivå).'
        : aiGeneratorOptions.difficulty === 'advanced'
        ? 'Fokusera på djupgående detaljer, bevis eller formler. Använd LaTeX (Avancerad nivå).'
        : 'Fokusera på mellannivå (Medelnivå).';

    const focusPrompt = aiGeneratorOptions.focus === 'definitions'
        ? 'Fokusera på begrepp och deras definitioner.'
        : aiGeneratorOptions.focus === 'practical'
        ? 'Fokusera på praktisk tillämpning, scenarier, problem eller kodexempel.'
        : aiGeneratorOptions.focus === 'details'
        ? 'Fokusera på exakta fakta och parametrar.'
        : 'Skapa ett välbalanserat kort.';

    const systemInstructions = 'Du är en pedagogisk expert. Skapa ett flashcard i JSON-format. Svara med ENBART ett städat JSON-objekt: {"front": "fråga", "back": "svar"}. Ingen markdown, inget brus. Om matematik ingår, använd LaTeX med $ eller $$.';

    const userInstructions = `Skapa ett helt nytt flashcard baserat på ämnet/texten "${currentTopicRawInput}".
${difficultyPrompt}
${focusPrompt}

Kortet får ABSOLUT INTE vara likt eller duplicera följande frågor:
${blacklist}
${deckContext}

Svara med ett enda JSON-objekt.`;

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 1000,
                system: systemInstructions,
                messages: [{ role: 'user', content: userInstructions }]
            })
        });

        if (!response.ok) throw new Error("HTTP " + response.status);

        const data = await response.json();
        let rawContent = data.content[0].text.trim();

        if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();

        const newCard = JSON.parse(rawContent);
        if (newCard && newCard.front && newCard.back) {
            proposedTopicCards[index] = { front: newCard.front, back: newCard.back };
        }
        renderProposedCards();
    } catch (e) {
        console.error("Regenerate card error:", e);
        showToast("Kunde inte generera nytt kort: " + e.message);
        renderProposedCards();
    }
};
window.regenerateSingleCard = regenerateSingleCard;

const fetchCardsByTopic = async (apiKey, topic, modifier = null, deck = null) => {
    // Show Loading step, hide others
    document.getElementById('topic-setup-step').classList.add('hidden');
    document.getElementById('topic-preview-step').classList.add('hidden');
    document.getElementById('topic-loading-step').classList.remove('hidden');
    
    // Set loading message based on source type
    const loadingTitle = document.getElementById('topic-loading-title');
    const loadingText = document.getElementById('topic-loading-text');
    if (aiGeneratorOptions.sourceType === 'text') {
        loadingTitle.innerText = "Analyserar dina anteckningar...";
        loadingText.innerText = "AI läser igenom din text och formulerar pedagogiska kort...";
    } else {
        loadingTitle.innerText = "AI skapar dina kort...";
        loadingText.innerText = "Funderar och strukturerar frågor på ämnet...";
    }

    const qty = aiGeneratorOptions.quantity || 'auto';
    const isAuto = qty === 'auto';
    const qtyPhrase = isAuto ? 'ett lämpligt antal (mellan 5 och 20 stycken, anpassat för att täcka allt väsentligt material utan att skapa redundans)' : `exakt ${qty}`;
    
    // 1. Gather existing questions to prevent duplicates
    let contextSnippet = "";
    if (deck && deck.cards.length > 0) {
        const existingFronts = deck.cards.map(c => `- ${c.front}`).join('\n');
        const sampleCards = deck.cards.slice(-3).map(c => `F: ${c.front} | S: ${c.back}`).join('\n');
        contextSnippet = `\n\nFöljande frågor finns redan i denna kortlek, du får ABSOLUT INTE skapa dubbletter av dessa eller frågor som är mycket lika dem:\n${existingFronts}\n\nFör att du ska förstå svårighetsgrad och tonaliteten, här är några fullständiga exempel på existerande kort:\n${sampleCards}\n\nDin uppgift är att skapa ${isAuto ? 'ett lämpligt antal' : qty} HELT UNIKA och NYA kort som kompletterar de befintliga!`;
    }

    // 2. Build instructions based on settings
    let sourceInstruction = "";
    if (aiGeneratorOptions.sourceType === 'text') {
        sourceInstruction = `Du MÅSTE utgå strikt ifrån följande text/anteckningar som källmaterial. Hämta all information och fakta från denna text:\n\n"""\n${topic}\n"""`;
    } else {
        sourceInstruction = `Generera kort baserat på följande ämne/nyckelord: "${topic}".`;
    }

    let difficultyPrompt = "Fokusera på medelnivå (Medelnivå).";
    if (aiGeneratorOptions.difficulty === 'beginner') {
        difficultyPrompt = "Fokusera på grundläggande definitioner, enkla förklaringar och kärnkoncept. Förklara pedagogiskt och undvik onödig jargong (Nybörjarnivå).";
    } else if (aiGeneratorOptions.difficulty === 'advanced') {
        difficultyPrompt = "Fokusera på djupgående detaljer, teoretisk bakgrund, formler, ekvationer eller kantfall. Använd LaTeX för all matematik och formler (Avancerad nivå).";
    }

    let focusPrompt = "Skapa en bra blandning av begreppsdefinitioner, faktakort och praktiska tillämpningsfrågor.";
    if (aiGeneratorOptions.focus === 'definitions') {
        focusPrompt = "Korten ska fokusera strikt på nyckelbegrepp och deras definitioner. Framsidan ska innehålla begreppet eller en fråga om vad det betyder, baksidan ska innehålla den exakta definitionen och en kort förklaring.";
    } else if (aiGeneratorOptions.focus === 'practical') {
        focusPrompt = "Korten ska fokusera på praktisk tillämpning, kodexempel, scenarier eller problemlösning. Ställ praktiska frågor, visa hur man gör i praktiken.";
    } else if (aiGeneratorOptions.focus === 'details') {
        focusPrompt = "Korten ska fokusera på exakta detaljer, fakta, datum, formler eller parametrar som kräver utantillkunskap.";
    }

    let instructions = `Du ska generera ${qtyPhrase} högkvalitativa flashcards.
${sourceInstruction}

Inställningar för inlärning:
- Svårighetsgrad: ${difficultyPrompt}
- Pedagogiskt fokus: ${focusPrompt}

Korten ska vara pedagogiska, extremt korrekta och anpassade för effektiv spaced repetition-inlärning.
${contextSnippet}`;

    // 3. Handle modifiers (Easier, Harder, Practical adjustments)
    if (modifier && proposedTopicCards.length > 0) {
        let prevCardsStr = proposedTopicCards.map(c => `F: ${c.front}\nS: ${c.back}`).join('\n\n');
        if (modifier === 'easier') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men gör dem TYDLIGT LÄTTARE, mer grundläggande och enklare att förstå.`;
        } else if (modifier === 'harder') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men gör dem TYDLIGT SVÅRARE, mer detaljerade, avancerade och utmanande.`;
        } else if (modifier === 'practical') {
            instructions = `Din förra lista med kort var:\n${prevCardsStr}\n\nGenerera nu ${isAuto ? 'ett lämpligt antal' : qty} helt nya kort baserat på samma källa men inrikta dem betydligt mer på praktiska exempel, scenarier, tillämpning eller kod.`;
        }
    }

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 3500,
                system: `Du är en pedagogisk expert. Din uppgift är att skapa flashcards.\n\nDu MÅSTE svara med ENBART en ren JSON-array, utan markdown-block, utan extra text. Formatet MÅSTE vara extremt strikt: [{"front": "fråga 1", "back": "svar 1"}].\nVIKTIGT: Eventuell matematik MÅSTE formateras med LaTeX. Eftersom du utvinner i JSON kan backslash försvinna. Använd därför konsekvent DUBBLA dollartecken $$ för block eller ENKLA dollartecken $ för inline formatering. Använd aldrig backslash-parenteser i din JSON.`,
                messages: [{
                    role: 'user',
                    content: instructions
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        let rawContent = data.content[0].text.trim();

        if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();

        proposedTopicCards = fixLatexInCards(JSON.parse(rawContent));
        if (!Array.isArray(proposedTopicCards)) throw new Error("Format returnerat var ej en städad Array.");

        // Transitions: Hide Loading step, show Preview step
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-preview-step').classList.remove('hidden');
        
        // Reset select all button label
        document.getElementById('btn-toggle-select-all').innerText = "Avmarkera alla";

        renderProposedCards();

    } catch (e) {
        console.error("AI Topic Error:", e);
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-setup-step').classList.remove('hidden');
        alert("Gick inte att generera kort. Fel: " + e.message);
    }
};

const fetchStudyAi = async (apiKey, card, question) => {
    document.getElementById('study-ai-loading').classList.remove('hidden');
    document.getElementById('study-ai-chat').classList.add('hidden');

    const instructions = `Du agerar som en hjälpsam tutor/lärare under en flashcard-repetition. Eleven har precis sett detta flashcard:\n\nFråga: ${card.front}\nSvar: ${card.back}\n\nEleven ställer nu följande fråga om kortet: "${question}"\n\nBesvara frågan direkt, kärnfullt och pedagogiskt. Använd LaTeX för eventuell matematik.${buildDeckContext(currentDeckId)}`;

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 600,
                system: 'Du är en tutor. Svara kort och pedagogiskt på elevens fråga utifrån flashcard-kontexten. Håll dig till ämnet. Inga långdragna introduktioner, svara rakt på sak!',
                messages: [{ role: 'user', content: instructions }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();

        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');

        const chatElement = document.getElementById('study-ai-chat');
        chatElement.innerHTML = `<strong>AI:</strong><br/>` + safeParse(data.content[0].text.trim());
        renderLatex(chatElement);

    } catch (e) {
        console.error("AI Study Tutor Error:", e);
        document.getElementById('study-ai-loading').classList.add('hidden');
        document.getElementById('study-ai-chat').classList.remove('hidden');
        document.getElementById('study-ai-chat').innerText = `Kunde inte hämta svar. Fel: ${e.message}`;
    }
};

let pendingAiSort = null;

const fetchAiSort = async (apiKey, deck) => {
    const unsortedCards = deck.cards.filter(c => !c.sectionId && c.type !== 'note');
    if (unsortedCards.length === 0) {
        showToast('Inga osorterade kort att sortera.');
        return;
    }

    const modal = document.getElementById('modal-ai-sort');
    const loading = document.getElementById('ai-sort-loading');
    const preview = document.getElementById('ai-sort-preview');
    const actions = document.getElementById('ai-sort-actions');
    const status = document.getElementById('ai-sort-status');

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    preview.classList.add('hidden');
    actions.classList.add('hidden');
    status.textContent = `Analyserar ${unsortedCards.length} osorterade kort...`;

    const existingSections = (deck.sections || []).map(s => s.title);
    const cardSummaries = unsortedCards.map(c => ({ id: c.id, front: c.front, back: c.back }));

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 4000,
                system: `Du är en expert på att organisera flashcards i logiska mappar/kategorier. Analysera korten noggrant och gruppera dem i mappar baserat på ämne, tema, eller logisk koppling.\n\nBefintliga mappar i kortleken: ${existingSections.length > 0 ? JSON.stringify(existingSections) : '(inga mappar finns ännu)'}\n\nRegler:\n- Använd befintliga mappar om de passar. Matcha exakt på namn.\n- Skapa nya mappar med tydliga, koncisa namn när inget befintligt passar.\n- Varje kort MÅSTE tilldelas exakt en mapp.\n- Tänk djupt på den bästa grupperingen. Kort som hör ihop tematiskt ska hamna i samma mapp.\n- Undvik att skapa för många mappar. Sikta på meningsfulla grupperingar.\n- Mapp-namn ska vara korta och beskrivande.\n\nSvara med ENBART en ren JSON-array:\n[{"cardId": "...", "section": "mappnamn"}]`,
                messages: [{
                    role: 'user',
                    content: `Här är korten att sortera:\n${JSON.stringify(cardSummaries)}`
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        let rawContent = data.content[0].text.trim();
        
        // Extract only the JSON array block robustly (ignores preambles and markdown block wraps)
        const arrayStart = rawContent.indexOf('[');
        const arrayEnd = rawContent.lastIndexOf(']');
        if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
            rawContent = rawContent.slice(arrayStart, arrayEnd + 1);
        } else {
            if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
            else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();
        }

        const sortResult = JSON.parse(rawContent);
        if (!Array.isArray(sortResult)) throw new Error("AI returnerade inte en array.");

        const sectionGroups = {};
        sortResult.forEach(item => {
            if (!sectionGroups[item.section]) sectionGroups[item.section] = [];
            const card = unsortedCards.find(c => c.id === item.cardId);
            if (card) sectionGroups[item.section].push(card);
        });

        pendingAiSort = { deck, sectionGroups };

        loading.classList.add('hidden');
        preview.classList.remove('hidden');
        actions.classList.remove('hidden');
        status.textContent = `${unsortedCards.length} kort sorterade i ${Object.keys(sectionGroups).length} mappar. Granska och godkänn:`;

        preview.innerHTML = '';
        Object.entries(sectionGroups).forEach(([sectionName, cards]) => {
            const isExisting = existingSections.includes(sectionName);
            const groupEl = document.createElement('div');
            groupEl.style.cssText = 'margin-bottom: 1rem;';
            groupEl.innerHTML = `
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    ${escapeHtml(sectionName)}
                    ${!isExisting ? '<span style="font-size: 0.75rem; color: var(--primary-color); font-weight: 500; background: var(--primary-light); padding: 0.1rem 0.5rem; border-radius: 999px;">Ny mapp</span>' : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25rem; padding-left: 1.5rem;">
                    ${cards.map(c => `<div style="font-size: 0.85rem; color: var(--text-secondary); padding: 0.3rem 0; border-bottom: 1px solid var(--border-color);">${safeParse(c.front)}</div>`).join('')}
                </div>
            `;
            preview.appendChild(groupEl);
        });

    } catch (e) {
        console.error("AI Sort Error:", e);
        loading.classList.add('hidden');
        status.textContent = `Fel: ${e.message}`;
    }
};

const applyAiSort = () => {
    if (!pendingAiSort) return;
    const { deck, sectionGroups } = pendingAiSort;

    Object.entries(sectionGroups).forEach(([sectionName, cards]) => {
        let section = (deck.sections || []).find(s => s.title === sectionName);
        if (!section) {
            section = { id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5), title: sectionName };
            if (!deck.sections) deck.sections = [];
            deck.sections.push(section);
        }
        cards.forEach(c => {
            const original = deck.cards.find(oc => oc.id === c.id);
            if (original) original.sectionId = section.id;
        });
    });

    saveData();
    pendingAiSort = null;
    document.getElementById('modal-ai-sort').classList.add('hidden');
    openDeck(currentDeckId);
    showToast('Sortering tillämpad!');
};

const fetchDiaryCards = async (apiKey, diaryText) => {
    document.getElementById('diary-loading').classList.remove('hidden');
    document.getElementById('diary-cards-container').classList.add('hidden');
    document.getElementById('diary-actions-container').classList.add('hidden');
    document.getElementById('btn-close-diary-top').classList.add('hidden');

    const deckInfo = appData.decks.map(d => {
        const sectionNames = (d.sections || []).map(s => s.title);
        const bookshelf = d.bookshelfId ? appData.bookshelves.find(s => s.id === d.bookshelfId) : null;
        return { name: d.title, bookshelf: bookshelf ? bookshelf.title : null, sections: sectionNames };
    });
    const deckListStr = deckInfo.length > 0 ? JSON.stringify(deckInfo) : '(inga lekar finns ännu)';
    const bookshelfNames = appData.bookshelves.map(s => s.title);
    const bookshelfStr = bookshelfNames.length > 0 ? bookshelfNames.join(', ') : '(inga bokhyllor finns ännu)';

    try {
        const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 4000,
                system: `Du är en pedagogisk expert. Användaren skriver fritt om vad de lärt sig idag. Din uppgift är att extrahera nyckelinsikter och skapa flashcards.\n\nDu MÅSTE svara med ENBART en ren JSON-array, utan markdown-block. Formatet MÅSTE vara:\n[{"front": "fråga", "back": "svar", "suggestedDeck": "Namn på föreslagen kortlek", "suggestedBookshelf": "Namn på bokhylla eller null", "suggestedSection": "Namn på mapp i kortleken eller null"}]\n\nAnvändarens befintliga kortlekar med bokhyllor och mappar: ${deckListStr}\nBefintliga bokhyllor: [${bookshelfStr}]\n\nRegler:\n- Om en lärdom passar i en befintlig kortlek, använd det exakta namnet.\n- Om ingen kortlek passar, föreslå ett nytt namn.\n- Föreslå vilken bokhylla kortleken ska tillhöra (befintlig eller ny). Använd null om osäker.\n- Föreslå vilken mapp (section) i kortleken kortet ska placeras i. Använd befintliga mappnamn om de passar, annars föreslå ett nytt namn. Använd null om ingen mapp behövs.\nVIKTIGT: Matematik formateras med LaTeX via dollartecken ($). Använd aldrig backslash-parenteser.\nAnpassa antalet kort efter innehållet, vanligtvis 3–15 kort.`,
                messages: [{
                    role: 'user',
                    content: `Här är mina lärdomar från idag:\n\n${diaryText}`
                }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const data = await response.json();
        let rawContent = data.content[0].text.trim();
        if (rawContent.startsWith("```json")) rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (rawContent.startsWith("```")) rawContent = rawContent.replace(/^```/, "").replace(/```$/, "").trim();

        proposedDiaryCards = fixLatexInCards(JSON.parse(rawContent));
        if (!Array.isArray(proposedDiaryCards)) throw new Error("AI returnerade inte en array.");

        document.getElementById('diary-loading').classList.add('hidden');
        document.getElementById('diary-cards-container').classList.remove('hidden');
        document.getElementById('diary-actions-container').classList.remove('hidden');
        renderDiaryCards();

    } catch (e) {
        console.error("AI Diary Error:", e);
        document.getElementById('diary-loading').classList.add('hidden');
        document.getElementById('btn-close-diary-top').classList.remove('hidden');
        alert("Gick inte att analysera. Fel: " + e.message);
    }
};

const renderDiaryCards = () => {
    const container = document.getElementById('diary-cards-container');
    container.innerHTML = '';
    const deckNames = appData.decks.map(d => d.title);
    const bookshelfNames = appData.bookshelves.map(s => s.title);

    proposedDiaryCards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'preview-card';
        div.style.flexDirection = 'column';
        div.style.gap = '0.5rem';

        const optionsHtml = deckNames.map(name =>
            `<option value="${name}" ${name === card.suggestedDeck ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasMatch = deckNames.includes(card.suggestedDeck);

        const bookshelfOptionsHtml = bookshelfNames.map(name =>
            `<option value="${name}" ${name === card.suggestedBookshelf ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasBookshelfMatch = bookshelfNames.includes(card.suggestedBookshelf);

        const selectedDeck = appData.decks.find(d => d.title === card.suggestedDeck);
        const sectionNames = selectedDeck ? (selectedDeck.sections || []).map(s => s.title) : [];
        const sectionOptionsHtml = sectionNames.map(name =>
            `<option value="${name}" ${name === card.suggestedSection ? 'selected' : ''}>${name}</option>`
        ).join('');
        const hasSectionMatch = sectionNames.includes(card.suggestedSection);

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                <div class="preview-card-content">
                    <div class="preview-card-front">${safeParse(card.front)}</div>
                    <div class="preview-card-back">${safeParse(card.back)}</div>
                </div>
                <button type="button" class="preview-card-remove" data-index="${index}" title="Ta bort"></button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.4rem; width: 100%; margin-top: 0.25rem;">
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">Kortlek:</span>
                    <select class="diary-deck-select" data-index="${index}" style="flex: 1; min-width: 0; padding: 0.4rem 0.6rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-family: inherit; font-size: 0.85rem; outline: none; background: var(--bg-color);">
                        ${!hasMatch ? `<option value="__new__:${card.suggestedDeck}" selected>Ny: ${card.suggestedDeck}</option>` : ''}
                        ${optionsHtml}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">Bokhylla:</span>
                    <select class="diary-bookshelf-select" data-index="${index}" style="flex: 1; min-width: 0; padding: 0.4rem 0.6rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-family: inherit; font-size: 0.85rem; outline: none; background: var(--bg-color);">
                        <option value="">Ingen</option>
                        ${card.suggestedBookshelf && !hasBookshelfMatch ? `<option value="__new__:${card.suggestedBookshelf}" selected>Ny: ${card.suggestedBookshelf}</option>` : ''}
                        ${bookshelfOptionsHtml}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">Mapp:</span>
                    <select class="diary-section-select" data-index="${index}" style="flex: 1; min-width: 0; padding: 0.4rem 0.6rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-family: inherit; font-size: 0.85rem; outline: none; background: var(--bg-color);">
                        <option value="">Ingen</option>
                        ${card.suggestedSection && !hasSectionMatch ? `<option value="__new__:${card.suggestedSection}" selected>Ny: ${card.suggestedSection}</option>` : ''}
                        ${sectionOptionsHtml}
                    </select>
                </div>
            </div>
        `;
        container.appendChild(div);
        renderLatex(div);
    });

    container.querySelectorAll('.preview-card-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            proposedDiaryCards.splice(idx, 1);
            renderDiaryCards();
        });
    });

    container.querySelectorAll('.diary-deck-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            
            // Sync all current inputs back to proposedDiaryCards array first
            container.querySelectorAll('.diary-deck-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                proposedDiaryCards[i].suggestedDeck = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });
            container.querySelectorAll('.diary-bookshelf-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                proposedDiaryCards[i].suggestedBookshelf = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });
            container.querySelectorAll('.diary-section-select').forEach(s => {
                const i = parseInt(s.getAttribute('data-index'), 10);
                proposedDiaryCards[i].suggestedSection = s.value.startsWith('__new__:') ? s.value.replace('__new__:', '') : s.value;
            });

            // Reset this card's section since the deck changed
            proposedDiaryCards[idx].suggestedSection = null;
            renderDiaryCards();
        });
    });

    container.querySelectorAll('.diary-bookshelf-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            proposedDiaryCards[idx].suggestedBookshelf = sel.value.startsWith('__new__:') ? sel.value.replace('__new__:', '') : sel.value;
        });
    });

    container.querySelectorAll('.diary-section-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(sel.getAttribute('data-index'), 10);
            proposedDiaryCards[idx].suggestedSection = sel.value.startsWith('__new__:') ? sel.value.replace('__new__:', '') : sel.value;
        });
    });

    if (proposedDiaryCards.length === 0) {
        document.getElementById('diary-actions-container').classList.add('hidden');
        document.getElementById('btn-close-diary-top').classList.remove('hidden');
    }
};

    // Logic was moved to the bottom of the file for reliability

    const handleBackgroundBack = () => {
        switch(currentViewName) {
            case 'deck':
            case 'notebook':
                switchView('library');
                break;
            case 'addCard':
                switchView('deck');
                break;
            case 'addNote':
                switchView('notebook');
                break;
            case 'study':
            case 'complete':
                switchView('deck');
                break;
        }
    };

    // Navigation
    document.getElementById('nav-library')?.addEventListener('click', () => {
        switchView('library');
        renderLibrary();
        
    });
    document.getElementById('btn-back-library').addEventListener('click', () => {
        renderLibrary();
        
        switchView('library');
    });
    document.getElementById('btn-back-library-notebook').addEventListener('click', () => {
        renderLibrary();
        
        switchView('library');
    });
    document.getElementById('btn-back-deck').addEventListener('click', () => openDeck(currentDeckId));
    document.getElementById('btn-back-notebook').addEventListener('click', () => openNotebook(currentNotebookId));

    document.getElementById('btn-complete-back').addEventListener('click', () => {
        if (isPlaygroundSession || lastSessionWasPlayground) {
            lastSessionWasPlayground = false;
            switchView('playground');
            renderPlayground();
        } else if (currentDeckId) {
            openDeck(currentDeckId);
        } else {
            renderLibrary();
            switchView('library');
        }
    });

    document.getElementById('btn-delete-card-study').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCurrentStudyCard();
    });

    document.getElementById('btn-end-study').addEventListener('click', () => {
        if (isPlaygroundSession || lastSessionWasPlayground) {
            lastSessionWasPlayground = false;
            isPlaygroundSession = false;
            switchView('playground');
            renderPlayground();
        } else if (currentDeckId) {
            openDeck(currentDeckId);
        } else {
            renderLibrary();
            switchView('library');
        }
    });

    document.getElementById('btn-study-all').addEventListener('click', () => {
        startGlobalStudy();
    });

    // Delete Deck / Notebook
    document.getElementById('btn-delete-deck').addEventListener('click', async () => {
        if (await showConfirmModal('Radera kortlek', 'Är du säker på att du vill ta bort hela kortleken? Detta kan inte ångras.', 'Radera', true)) {
            appData.decks = appData.decks.filter(d => d.id !== currentDeckId);
            saveData();
            currentDeckId = null;
            renderLibrary();
            switchView('library');
            showToast('Kortlek borttagen');
        }
    });

    document.getElementById('btn-delete-notebook').addEventListener('click', async () => {
        if (await showConfirmModal('Radera anteckningsblock', 'Är du säker på att du vill ta bort hela anteckningsblocket? Detta kan inte ångras.', 'Radera', true)) {
            appData.notebooks = appData.notebooks.filter(n => n.id !== currentNotebookId);
            saveData();
            currentNotebookId = null;
            renderLibrary();
            switchView('library');
            showToast('Anteckningsblock borttaget');
        }
    });

    // Modals bindings
    document.getElementById('btn-close-card-modal').addEventListener('click', () => {
        document.getElementById('modal-card-details').classList.add('hidden');
    });

    document.getElementById('btn-explain-ai').addEventListener('click', async () => {
        const apiKey = await getApiKey();
        if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
            alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
            return;
        }
        fetchExplanation(apiKey, currentAiCard);
    });

    document.getElementById('btn-test-ai').addEventListener('click', async () => {
        const apiKey = await getApiKey();
        if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
            alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
            return;
        }
        fetchTestQuestion(apiKey, currentAiCard, null);
    });

    const handleModifierClick = async (modifier) => {
        const apiKey = await getApiKey();
        if (apiKey) fetchTestQuestion(apiKey, currentAiCard, modifier);
    };

    document.getElementById('btn-test-easier').addEventListener('click', () => handleModifierClick('easier'));
    document.getElementById('btn-test-similar').addEventListener('click', () => handleModifierClick('similar'));
    document.getElementById('btn-test-harder').addEventListener('click', () => handleModifierClick('harder'));

    // Topic Generator Handlers
    document.getElementById('btn-ai-sort')?.addEventListener('click', async () => {
        if (!currentDeckId) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (!deck) return;
        const apiKey = await getApiKey();
        if (apiKey) fetchAiSort(apiKey, deck);
    });

    document.getElementById('btn-cancel-ai-sort')?.addEventListener('click', () => {
        pendingAiSort = null;
        document.getElementById('modal-ai-sort').classList.add('hidden');
    });

    document.getElementById('btn-apply-ai-sort')?.addEventListener('click', () => {
        applyAiSort();
    });

    document.getElementById('btn-open-topic-generator').addEventListener('click', () => {
        if (!currentDeckId) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (!deck) return;

        proposedTopicCards = [];
        currentTopicRawInput = "";
        
        // Reset inputs
        document.getElementById('input-topic-name').value = '';
        document.getElementById('input-source-text').value = '';
        document.getElementById('input-new-section-name').value = '';
        document.getElementById('new-section-name-container').classList.add('hidden');
        
        // Reset Options
        aiGeneratorOptions = {
            sourceType: 'topic',
            quantity: 'auto',
            difficulty: 'intermediate',
            focus: 'mixed',
            sectionId: ''
        };

        // Reset toggles in DOM
        document.getElementById('toggle-source-topic').classList.add('active');
        document.getElementById('toggle-source-text').classList.remove('active');
        document.getElementById('topic-input-container').classList.remove('hidden');
        document.getElementById('text-input-container').classList.add('hidden');

        // Reset option buttons in DOM
        document.querySelectorAll('.btn-option-qty').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-qty') === 'auto');
        });
        document.querySelectorAll('.btn-option-diff').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-diff') === 'intermediate');
        });
        document.getElementById('select-topic-focus').value = 'mixed';

        // Load folder dropdown
        const sectionSelect = document.getElementById('select-topic-section');
        sectionSelect.innerHTML = '<option value="">Ingen mapp (Huvudnivå)</option>';
        if (deck.sections && deck.sections.length > 0) {
            deck.sections.forEach(sec => {
                const opt = document.createElement('option');
                opt.value = sec.id;
                opt.innerText = sec.title;
                sectionSelect.appendChild(opt);
            });
        }
        const optNew = document.createElement('option');
        optNew.value = '__new__';
        optNew.innerText = '+ Skapa ny mapp...';
        sectionSelect.appendChild(optNew);
        sectionSelect.value = '';

        // Show/hide steps
        document.getElementById('topic-setup-step').classList.remove('hidden');
        document.getElementById('topic-loading-step').classList.add('hidden');
        document.getElementById('topic-preview-step').classList.add('hidden');
        document.getElementById('modal-topic-generator').classList.remove('hidden');
    });

    // Toggle Source Handlers
    document.getElementById('toggle-source-topic').addEventListener('click', () => {
        document.getElementById('toggle-source-topic').classList.add('active');
        document.getElementById('toggle-source-text').classList.remove('active');
        document.getElementById('topic-input-container').classList.remove('hidden');
        document.getElementById('text-input-container').classList.add('hidden');
        aiGeneratorOptions.sourceType = 'topic';
    });

    document.getElementById('toggle-source-text').addEventListener('click', () => {
        document.getElementById('toggle-source-text').classList.add('active');
        document.getElementById('toggle-source-topic').classList.remove('active');
        document.getElementById('text-input-container').classList.remove('hidden');
        document.getElementById('topic-input-container').classList.add('hidden');
        aiGeneratorOptions.sourceType = 'text';
    });

    // Qty and Diff Options Handlers
    document.querySelectorAll('.btn-option-qty').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-option-qty').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const qtyVal = e.currentTarget.getAttribute('data-qty');
            aiGeneratorOptions.quantity = qtyVal === 'auto' ? 'auto' : parseInt(qtyVal, 10);
        });
    });

    document.querySelectorAll('.btn-option-diff').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-option-diff').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            aiGeneratorOptions.difficulty = e.currentTarget.getAttribute('data-diff');
        });
    });

    // Focus handler
    document.getElementById('select-topic-focus').addEventListener('change', (e) => {
        aiGeneratorOptions.focus = e.target.value;
    });

    // Section handler
    document.getElementById('select-topic-section').addEventListener('change', (e) => {
        aiGeneratorOptions.sectionId = e.target.value;
        if (e.target.value === '__new__') {
            document.getElementById('new-section-name-container').classList.remove('hidden');
        } else {
            document.getElementById('new-section-name-container').classList.add('hidden');
        }
    });

    // Cancel / Close Handlers
    const closeTopicModal = () => document.getElementById('modal-topic-generator').classList.add('hidden');
    document.getElementById('btn-close-topic-modal-top').addEventListener('click', closeTopicModal);
    document.getElementById('btn-close-topic-modal').addEventListener('click', closeTopicModal);
    
    document.getElementById('btn-topic-preview-back').addEventListener('click', () => {
        document.getElementById('topic-setup-step').classList.remove('hidden');
        document.getElementById('topic-preview-step').classList.add('hidden');
        document.getElementById('topic-loading-step').classList.add('hidden');
    });

    // Submit Wizard Handler
    document.getElementById('btn-submit-topic-wizard').addEventListener('click', async () => {
        let inputVal = "";
        if (aiGeneratorOptions.sourceType === 'topic') {
            inputVal = document.getElementById('input-topic-name').value.trim();
            if (!inputVal) {
                showToast("Fyll i ett ämne eller koncept!");
                return;
            }
        } else {
            inputVal = document.getElementById('input-source-text').value.trim();
            if (!inputVal) {
                showToast("Klistra in anteckningar eller text först!");
                return;
            }
        }

        currentTopicRawInput = inputVal;
        const apiKey = await getApiKey();
        if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
            alert('Kunde inte hitta en giltig API-nyckel. Vänligen öppna .env-filen i projektmappen och klistra in din Anthropic (Claude) API-nyckel där, ladda sedan om sidan.');
            return;
        }
        const deck = appData.decks.find(d => d.id === currentDeckId);
        fetchCardsByTopic(apiKey, inputVal, null, deck);
    });

    // Modifiers Handlers
    document.getElementById('btn-topic-modifier-easier').addEventListener('click', async () => {
        const apiKey = await getApiKey();
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (apiKey) fetchCardsByTopic(apiKey, currentTopicRawInput, 'easier', deck);
    });

    document.getElementById('btn-topic-modifier-harder').addEventListener('click', async () => {
        const apiKey = await getApiKey();
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (apiKey) fetchCardsByTopic(apiKey, currentTopicRawInput, 'harder', deck);
    });

    document.getElementById('btn-topic-modifier-practical').addEventListener('click', async () => {
        const apiKey = await getApiKey();
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (apiKey) fetchCardsByTopic(apiKey, currentTopicRawInput, 'practical', deck);
    });

    // Toggle Select All
    document.getElementById('btn-toggle-select-all').addEventListener('click', (e) => {
        const checkboxes = document.querySelectorAll('.ai-card-select-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
        });
        e.currentTarget.innerText = allChecked ? "Välj alla" : "Avmarkera alla";
        updateSaveCountBadge();
    });

    // Save cards logic
    document.getElementById('btn-save-topic-cards-new').addEventListener('click', () => {
        if (!currentDeckId || proposedTopicCards.length === 0) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (!deck) return;

        // Gather all checked items and edited inputs
        const items = document.querySelectorAll('.ai-generated-card-item');
        const cardsToSave = [];
        
        items.forEach(item => {
            const idx = parseInt(item.getAttribute('data-index'));
            const cb = item.querySelector('.ai-card-select-checkbox');
            if (cb && cb.checked) {
                const front = item.querySelector('.ai-card-front-input').value.trim();
                const back = item.querySelector('.ai-card-back-input').value.trim();
                if (front && back) {
                    cardsToSave.push({ front, back });
                }
            }
        });

        if (cardsToSave.length === 0) {
            showToast("Inga kort valda att spara!");
            return;
        }

        // Handle target section folder
        let sectionId = null;
        if (aiGeneratorOptions.sectionId === '__new__') {
            const newSecName = document.getElementById('input-new-section-name').value.trim();
            if (!newSecName) {
                showToast("Fyll i ett namn för den nya mappen!");
                return;
            }
            if (!deck.sections) deck.sections = [];
            let existingSection = deck.sections.find(s => s.title.toLowerCase() === newSecName.toLowerCase());
            if (existingSection) {
                sectionId = existingSection.id;
            } else {
                const newSec = { id: Date.now().toString() + '_sec_gen', title: newSecName };
                deck.sections.push(newSec);
                sectionId = newSec.id;
            }
        } else if (aiGeneratorOptions.sectionId) {
            sectionId = aiGeneratorOptions.sectionId;
        }

        cardsToSave.forEach(c => {
            deck.cards.push(createCard(c.front, c.back, false, [], sectionId));
        });

        saveData();
        renderCards(deck.cards);
        showToast(`${cardsToSave.length} kort sparades!`);
        closeTopicModal();
    });

    // Diary Handlers
    const closeDiaryModal = () => document.getElementById('modal-diary').classList.add('hidden');
    document.getElementById('btn-open-diary').addEventListener('click', () => {
        proposedDiaryCards = [];
        document.getElementById('input-diary-text').value = '';
        document.getElementById('diary-cards-container').innerHTML = '';
        document.getElementById('diary-cards-container').classList.add('hidden');
        document.getElementById('diary-actions-container').classList.add('hidden');
        document.getElementById('diary-loading').classList.add('hidden');
        document.getElementById('btn-close-diary-top').classList.remove('hidden');
        document.getElementById('modal-diary').classList.remove('hidden');
    });
    document.getElementById('btn-close-diary-top').addEventListener('click', closeDiaryModal);
    document.getElementById('btn-close-diary').addEventListener('click', closeDiaryModal);

    document.getElementById('form-diary').addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = document.getElementById('input-diary-text').value.trim();
        if (!text) return;
        const apiKey = await getApiKey();
        if (apiKey) fetchDiaryCards(apiKey, text);
    });

    document.getElementById('btn-save-diary-cards').addEventListener('click', () => {
        if (proposedDiaryCards.length === 0) return;
        const deckSelects = document.querySelectorAll('.diary-deck-select');
        const bookshelfSelects = document.querySelectorAll('.diary-bookshelf-select');
        const sectionSelects = document.querySelectorAll('.diary-section-select');
        let savedCount = 0;

        deckSelects.forEach((sel, i) => {
            const card = proposedDiaryCards[i];
            if (!card) return;
            let deckTarget;

            let deckName = sel.value;
            if (deckName.startsWith('__new__:')) {
                deckName = deckName.replace('__new__:', '');
            }
            deckTarget = appData.decks.find(d => d.title === deckName);
            if (!deckTarget && sel.value.startsWith('__new__:')) {
                deckTarget = { id: Date.now().toString() + '_' + i, title: deckName, cards: [], bookshelfId: null, color: '#4F46E5', sections: [] };
                appData.decks.push(deckTarget);
            }

            if (!deckTarget) return;

            const bookshelfSel = bookshelfSelects[i];
            if (bookshelfSel && bookshelfSel.value) {
                let shelfName = bookshelfSel.value;
                if (shelfName.startsWith('__new__:')) {
                    shelfName = shelfName.replace('__new__:', '');
                }
                let shelf = appData.bookshelves.find(s => s.title === shelfName);
                if (!shelf && bookshelfSel.value.startsWith('__new__:')) {
                    shelf = { id: Date.now().toString() + '_shelf_' + i, title: shelfName, color: null };
                    appData.bookshelves.push(shelf);
                }
                if (shelf) {
                    deckTarget.bookshelfId = shelf.id;
                }
            }

            let sectionId = null;
            const sectionSel = sectionSelects[i];
            if (sectionSel && sectionSel.value) {
                let secName = sectionSel.value;
                if (secName.startsWith('__new__:')) {
                    secName = secName.replace('__new__:', '');
                }
                if (!deckTarget.sections) deckTarget.sections = [];
                let existingSection = deckTarget.sections.find(s => s.title === secName);
                if (!existingSection && sectionSel.value.startsWith('__new__:')) {
                    existingSection = { id: Date.now().toString() + '_sec_' + i, title: secName };
                    deckTarget.sections.push(existingSection);
                }
                if (existingSection) {
                    sectionId = existingSection.id;
                }
            }

            deckTarget.cards.push(createCard(card.front, card.back, false, [], sectionId));
            savedCount++;
        });

        saveData();
        renderLibrary();
        showToast(`${savedCount} kort sparades i sina kortlekar!`);
        closeDiaryModal();
    });

    // creation modal handlers
    const modalCreateOptions = document.getElementById('modal-create-options');
    document.getElementById('btn-create-item')?.addEventListener('click', () => {
        modalCreateOptions.classList.remove('hidden');
    });
    document.getElementById('btn-create-item-top')?.addEventListener('click', () => {
        modalCreateOptions.classList.remove('hidden');
    });

    document.getElementById('btn-cancel-create-options')?.addEventListener('click', () => {
        modalCreateOptions.classList.add('hidden');
    });

    document.getElementById('option-create-deck')?.addEventListener('click', () => {
        modalCreateOptions.classList.add('hidden');
        currentCreationType = 'deck';
        modalDeck.querySelector('h2').innerText = 'Ny kortlek';
        modalDeck.classList.remove('hidden');
    });

    document.getElementById('option-create-notebook')?.addEventListener('click', () => {
        modalCreateOptions.classList.add('hidden');
        currentCreationType = 'notebook';
        modalDeck.querySelector('h2').innerText = 'Nytt anteckningsblock';
        modalDeck.classList.remove('hidden');
    });

    document.getElementById('option-create-bookshelf')?.addEventListener('click', () => {
        modalCreateOptions.classList.add('hidden');
        document.getElementById('modal-new-bookshelf').classList.remove('hidden');
    });

    // Deck & Notebook Creation
    const modalDeck = document.getElementById('modal-new-deck');
    let currentCreationType = 'deck'; // 'deck' or 'notebook'

    document.getElementById('btn-cancel-deck').addEventListener('click', () => {
        modalDeck.classList.add('hidden');
        document.getElementById('new-deck-name').value = '';
    });

    // Color picker logic
    document.querySelectorAll('#deck-color-picker .color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('#deck-color-picker .color-dot').forEach(d => d.classList.remove('selected'));
            dot.classList.add('selected');
        });
    });

    document.getElementById('form-new-deck').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('new-deck-name').value.trim();
        const selectedColor = document.querySelector('#deck-color-picker .color-dot.selected')?.dataset.color || '#4F46E5';
        if (name) {
            if (currentCreationType === 'deck') {
                const newDeck = { id: Date.now().toString(), title: name, cards: [], bookshelfId: null, color: selectedColor, sections: [] };
                appData.decks.push(newDeck);
                showToast('Kortlek skapad!');
            } else {
                const newNotebook = { id: Date.now().toString(), title: name, notes: [], bookshelfId: null };
                appData.notebooks.push(newNotebook);
                showToast('Anteckningsblock skapat!');
            }
            saveData();
            renderLibrary();
            modalDeck.classList.add('hidden');
            document.getElementById('new-deck-name').value = '';
        }
    });

    // Bookshelf Creation
    document.getElementById('btn-cancel-bookshelf')?.addEventListener('click', () => {
        document.getElementById('modal-new-bookshelf').classList.add('hidden');
        document.getElementById('new-bookshelf-name').value = '';
    });

    document.getElementById('form-new-bookshelf')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('new-bookshelf-name').value.trim();
        if (name) {
            const newBookshelf = { id: Date.now().toString(), title: name };
            if (!appData.bookshelves) appData.bookshelves = [];
            appData.bookshelves.push(newBookshelf);
            saveData();
            renderLibrary();
            document.getElementById('modal-new-bookshelf').classList.add('hidden');
            document.getElementById('new-bookshelf-name').value = '';
            showToast('Bokhylla skapad!');
        }
    });

    // Bookshelf Deletion
    document.getElementById('btn-cancel-delete-bookshelf')?.addEventListener('click', () => {
        document.getElementById('modal-delete-bookshelf').classList.add('hidden');
        currentBookshelfToDelete = null;
    });

    document.getElementById('btn-delete-bookshelf-keep')?.addEventListener('click', () => {
        if (!currentBookshelfToDelete) return;
        // Move items to root
        appData.decks.forEach(d => { if (d.bookshelfId === currentBookshelfToDelete) d.bookshelfId = null; });
        appData.notebooks.forEach(n => { if (n.bookshelfId === currentBookshelfToDelete) n.bookshelfId = null; });
        // Delete bookshelf
        appData.bookshelves = appData.bookshelves.filter(b => b.id !== currentBookshelfToDelete);
        saveData();
        renderLibrary();
        document.getElementById('modal-delete-bookshelf').classList.add('hidden');
        currentBookshelfToDelete = null;
        showToast('Bokhylla raderad, allt innehåll behölls.');
    });

    document.getElementById('btn-delete-bookshelf-delete')?.addEventListener('click', () => {
        if (!currentBookshelfToDelete) return;
        // Delete items
        appData.decks = appData.decks.filter(d => d.bookshelfId !== currentBookshelfToDelete);
        appData.notebooks = appData.notebooks.filter(n => n.bookshelfId !== currentBookshelfToDelete);
        // Delete bookshelf
        appData.bookshelves = appData.bookshelves.filter(b => b.id !== currentBookshelfToDelete);
        saveData();
        renderLibrary();
        document.getElementById('modal-delete-bookshelf').classList.add('hidden');
        currentBookshelfToDelete = null;
        showToast('Bokhylla och allt dess innehåll raderat.');
    });

    // Card Actions
    document.getElementById('btn-cancel-edit-card').addEventListener('click', () => {
        document.getElementById('modal-edit-card').classList.add('hidden');
    });

    document.getElementById('btn-cancel-move-card')?.addEventListener('click', () => {
        document.getElementById('modal-move-card').classList.add('hidden');
        currentMoveCard = null;
    });

    document.getElementById('input-move-search')?.addEventListener('input', (e) => {
        renderMoveTargets(e.target.value);
    });

    document.getElementById('btn-confirm-move-card')?.addEventListener('click', () => {
        const selection = document.getElementById('selected-move-target').value;
        if (!selection || !currentMoveCard) return;

        const [targetDeckId, targetSectionId] = selection.split(':');
        
        const currentDeck = appData.decks.find(d => d.id === currentDeckId);
        const targetDeck = appData.decks.find(d => d.id === targetDeckId);
        
        if (currentDeck && targetDeck) {
            // Remove from current deck
            currentDeck.cards = currentDeck.cards.filter(c => c.id !== currentMoveCard.id);
            
            // Set new properties
            currentMoveCard.sectionId = (targetSectionId === 'root') ? null : targetSectionId;
            
            // Add to target deck
            targetDeck.cards.push(currentMoveCard);
            
            saveData();
            renderCards(currentDeck.cards);
            document.getElementById('modal-move-card').classList.add('hidden');
            currentMoveCard = null;
            showToast("Kortet flyttades!");
            renderLibrary();
            
            // If moved to current deck (different folder), stay in view
            if (targetDeckId === currentDeckId) {
                renderCards(currentDeck.cards);
            }
        }
    });

    document.getElementById('btn-cancel-move-item')?.addEventListener('click', () => {
        document.getElementById('modal-move-item').classList.add('hidden');
        currentMoveItem = null;
        currentMoveItemType = null;
    });

    document.getElementById('form-move-item')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentMoveItem) return;
        
        let targetBookshelfId = document.getElementById('select-move-bookshelf').value;
        if (targetBookshelfId === 'root') targetBookshelfId = null;

        let sourceList = currentMoveItemType === 'deck' ? appData.decks : appData.notebooks;
        let itemRef = sourceList.find(i => i.id === currentMoveItem.id);
        if (itemRef) {
            itemRef.bookshelfId = targetBookshelfId;
            saveData();
            renderLibrary();
            document.getElementById('modal-move-item').classList.add('hidden');
            currentMoveItem = null;
            currentMoveItemType = null;
            showToast("Objektet flyttades!");
        }
    });

    document.getElementById('btn-cancel-move-section')?.addEventListener('click', () => {
        document.getElementById('modal-move-section').classList.add('hidden');
        currentMoveSectionId = null;
    });

    document.getElementById('form-move-section')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentMoveSectionId || !currentDeckId) return;

        const targetDeckId = document.getElementById('select-move-section-deck').value;
        const sourceDeck = appData.decks.find(d => d.id === currentDeckId);
        const targetDeck = appData.decks.find(d => d.id === targetDeckId);

        if (sourceDeck && targetDeck) {
            const sectionIdx = sourceDeck.sections.findIndex(s => s.id === currentMoveSectionId);
            if (sectionIdx > -1) {
                const section = sourceDeck.sections[sectionIdx];
                
                // 1. Move section object
                sourceDeck.sections.splice(sectionIdx, 1);
                if (!targetDeck.sections) targetDeck.sections = [];
                targetDeck.sections.push(section);

                // 2. Move cards belonging to section
                const cardsToMove = sourceDeck.cards.filter(c => c.sectionId === currentMoveSectionId);
                sourceDeck.cards = sourceDeck.cards.filter(c => c.sectionId !== currentMoveSectionId);
                targetDeck.cards.push(...cardsToMove);

                saveData();
                renderLibrary();
                renderSidebar();
                openDeck(currentDeckId);
                document.getElementById('modal-move-section').classList.add('hidden');
                currentMoveSectionId = null;
                showToast("Mappen flyttades!");
            }
        }
    });

    document.getElementById('form-edit-card').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentEditCard || !currentDeckId) return;

        const newFront = document.getElementById('edit-card-front').value.trim();
        const newBack = document.getElementById('edit-card-back').value.trim();
        const isLongForm = document.getElementById('edit-card-longform').checked;

        if (newFront && newBack) {
            const deck = appData.decks.find(d => d.id === currentDeckId);
            const cardProxy = deck.cards.find(c => c.id === currentEditCard.id);
            if (cardProxy) {
                cardProxy.front = newFront;
                cardProxy.back = newBack;
                cardProxy.isLongForm = isLongForm;
                cardProxy.backImages = [...editCardImages];
                saveData();
                renderCards(deck.cards);
                openDeck(currentDeckId);
                showToast('Kort uppdaterat!');
            }
            document.getElementById('modal-edit-card').classList.add('hidden');
            editCardImages = [];
        }
    });

    document.getElementById('btn-add-note-card').addEventListener('click', (e) => {
        e.stopPropagation();
        currentNoteCard = null;
        const modal = document.getElementById('modal-note-card');
        document.getElementById('note-card-modal-title').textContent = 'Lägg till anteckning';
        document.getElementById('note-card-content').value = '';
        modal.classList.remove('hidden');
    });

    document.getElementById('btn-cancel-note-card').addEventListener('click', () => {
        document.getElementById('modal-note-card').classList.add('hidden');
    });

    document.getElementById('form-note-card').addEventListener('submit', (e) => {
        e.preventDefault();
        const content = document.getElementById('note-card-content').value.trim();
        if (!content || !currentDeckId) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (currentNoteCard) {
            const cardProxy = deck.cards.find(c => c.id === currentNoteCard.id);
            if (cardProxy) cardProxy.content = content;
            showToast('Anteckning uppdaterad!');
        } else {
            deck.cards.push(createNoteCard(content));
            showToast('Anteckning tillagd!');
        }
        saveData();
        renderCards(deck.cards);
        document.getElementById('modal-note-card').classList.add('hidden');
        currentNoteCard = null;
    });

    // document.getElementById('btn-add-card').addEventListener('click', () => switchView('addCard'));
    document.getElementById('form-add-card').addEventListener('submit', (e) => {
        e.preventDefault();
        const front = document.getElementById('card-front').value.trim();
        const back = document.getElementById('card-back').value.trim();
        const isLongForm = document.getElementById('card-longform').checked;
        const selectedSectionId = document.getElementById('card-section-select').value || null;
        if (front && back && currentDeckId) {
            const deck = appData.decks.find(d => d.id === currentDeckId);
            
            let finalSectionId = selectedSectionId;
            if (selectedSectionId && selectedSectionId.startsWith('__new__:')) {
                const newSecName = selectedSectionId.substring(8).trim();
                if (!deck.sections) deck.sections = [];
                let existingSection = deck.sections.find(s => s.title.toLowerCase() === newSecName.toLowerCase());
                if (existingSection) {
                    finalSectionId = existingSection.id;
                } else {
                    const newSec = { id: Date.now().toString(), title: newSecName };
                    deck.sections.push(newSec);
                    finalSectionId = newSec.id;
                }
            }

            deck.cards.push(createCard(front, back, isLongForm, [...addCardImages], finalSectionId));
            saveData();

            populateAddCardSections(deck);

            document.getElementById('card-front').value = '';
            document.getElementById('card-back').value = '';
            document.getElementById('card-longform').checked = false;
            addCardImages = [];
            renderImagePreviews(document.getElementById('card-back-image-preview'), addCardImages, () => {});
            showToast('Kort sparat!');
            document.getElementById('card-front').focus();
        }
    });

    // --- Image upload button wiring ---

    // Helper to wire up an upload button → file input → preview
    const wireImageUpload = (btnId, inputId, previewId, imagesRef, getArr, setArr) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;

        btn.addEventListener('click', () => input.click());

        input.addEventListener('change', async () => {
            const files = Array.from(input.files);
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                try {
                    const dataUrl = await fileToDataUrl(file);
                    getArr().push(dataUrl);
                } catch {}  
            }
            input.value = '';
            const container = document.getElementById(previewId);
            renderImagePreviews(container, getArr(), (idx) => {
                getArr().splice(idx, 1);
                renderImagePreviews(container, getArr(), arguments.callee);
            });
        });
    };

    // Wire Add Card image upload
    document.getElementById('btn-add-card-image').addEventListener('click', () => {
        document.getElementById('card-back-image-input').click();
    });
    document.getElementById('card-back-image-input').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            try { addCardImages.push(await fileToDataUrl(file)); } catch {}
        }
        e.target.value = '';
        const previewRefresh = (idx) => {
            addCardImages.splice(idx, 1);
            renderImagePreviews(document.getElementById('card-back-image-preview'), addCardImages, previewRefresh);
        };
        renderImagePreviews(document.getElementById('card-back-image-preview'), addCardImages, previewRefresh);
    });

    // Wire Edit Card image upload
    document.getElementById('btn-edit-card-image').addEventListener('click', () => {
        document.getElementById('edit-card-back-image-input').click();
    });
    document.getElementById('edit-card-back-image-input').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            try { editCardImages.push(await fileToDataUrl(file)); } catch {}
        }
        e.target.value = '';
        const previewRefresh = (idx) => {
            editCardImages.splice(idx, 1);
            renderImagePreviews(document.getElementById('edit-card-back-image-preview'), editCardImages, previewRefresh);
        };
        renderImagePreviews(document.getElementById('edit-card-back-image-preview'), editCardImages, previewRefresh);
    });

    const populateAddCardSections = (deck, selectedVal = null) => {
        const sectionSelect = document.getElementById('card-section-select');
        if (!sectionSelect) return;
        sectionSelect.innerHTML = '<option value="">Ingen mapp</option>';
        if (deck) {
            const sections = deck.sections || [];
            sections.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.title;
                sectionSelect.appendChild(opt);
            });
            if (selectedVal && selectedVal.startsWith('__new__:')) {
                const newTitle = selectedVal.substring(8);
                const opt = document.createElement('option');
                opt.value = selectedVal;
                opt.textContent = ` Skapa ny: "${newTitle}"`;
                sectionSelect.appendChild(opt);
            }
            document.getElementById('card-section-group').style.display = '';
        } else {
            document.getElementById('card-section-group').style.display = 'none';
        }
        if (selectedVal) {
            sectionSelect.value = selectedVal;
        }
    };

    // Reset addCardImages and populate section dropdown when navigating to Add Card view
    document.getElementById('btn-add-card').addEventListener('click', () => {
        switchView('addCard');
        addCardImages = [];
        renderImagePreviews(document.getElementById('card-back-image-preview'), addCardImages, () => {});
        const deck = appData.decks.find(d => d.id === currentDeckId);
        
        let initialSelectVal = null;
        if (preselectSectionId) {
            initialSelectVal = preselectSectionId;
            preselectSectionId = null;
        } else if (currentSectionId) {
            initialSelectVal = currentSectionId;
        }
        populateAddCardSections(deck, initialSelectVal);
    }, true);

    // --- Section (mapp) create/rename modal ---
    document.getElementById('btn-add-section').addEventListener('click', () => {
        openSectionModal();
    });

    document.getElementById('btn-cancel-section').addEventListener('click', () => {
        closeSectionModal();
    });

    document.getElementById('form-new-section').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('new-section-name').value.trim();
        if (!name) return;
        const deck = appData.decks.find(d => d.id === currentDeckId);
        if (!deck) return;
        if (!deck.sections) deck.sections = [];

        if (currentSectionToEdit) {
            currentSectionToEdit.title = name;
        } else {
            const newSection = { id: Date.now().toString() + '_sec', title: name };
            deck.sections.push(newSection);
        }
        saveData();
        closeSectionModal();
        openDeck(currentDeckId, currentSectionId);
    });

    const runAutoFolder = async (questionText) => {
        const apiKey = await getApiKey();
        if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') return;

        const btnAuto = document.getElementById('btn-auto-folder');
        btnAuto.disabled = true;
        btnAuto.innerHTML = 'Auto ';

        try {
            const deck = appData.decks.find(d => d.id === currentDeckId);
            const existingSections = (deck.sections || []).map(s => ({ id: s.id, title: s.title }));

            const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 200,
                    system: `Du är en expert på att organisera flashcards i mappar/kategorier. Analysera flashcard-frågan och välj den mest passande mappen från listan över befintliga mappar. Om ingen av de befintliga mapparna passar (eller om listan är tom), föreslå en helt ny passande mapp med ett kort, koncist och beskrivande namn (skrivet på samma språk som frågan, oftast svenska eller engelska).\n\nBefintliga mappar:\n${JSON.stringify(existingSections)}\n\nRegler för svar:\n- Om en befintlig mapp passar bra (tematiskt relaterad till frågan), välj den och svara med denna exakta JSON:\n{\n  "action": "existing",\n  "folderId": "id_på_mappen",\n  "folderTitle": "namn_på_mappen"\n}\n- Om ingen av de befintliga mapparna passar bra, eller om inga mappar finns, föreslå en ny och svara med denna exakta JSON:\n{\n  "action": "new",\n  "folderTitle": "Föreslaget Mappnamn"\n}\n\nSvara ENBART med den råa JSON-koden. Ingen introduktion, inga förklaringar, ingen markdown-kodblock.`,
                    messages: [{
                        role: 'user',
                        content: `Fråga: "${questionText}"`
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            const data = await response.json();
            let rawContent = data.content[0].text.trim();
            const jsonStart = rawContent.indexOf('{');
            const jsonEnd = rawContent.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                rawContent = rawContent.slice(jsonStart, jsonEnd + 1);
            }

            const result = JSON.parse(rawContent);
            if (result.action === 'existing') {
                const foundSec = deck.sections.find(s => s.id === result.folderId);
                if (foundSec) {
                    populateAddCardSections(deck, foundSec.id);
                    showToast(`Valde mappen "${foundSec.title}"!`);
                } else {
                    const foundSecByTitle = deck.sections.find(s => s.title.toLowerCase() === result.folderTitle.toLowerCase());
                    if (foundSecByTitle) {
                        populateAddCardSections(deck, foundSecByTitle.id);
                        showToast(`Valde mappen "${foundSecByTitle.title}"!`);
                    } else {
                        populateAddCardSections(deck, `__new__:${result.folderTitle}`);
                        showToast(`Föreslog ny mapp: "${result.folderTitle}"`);
                    }
                }
            } else if (result.action === 'new') {
                populateAddCardSections(deck, `__new__:${result.folderTitle}`);
                showToast(`Föreslog ny mapp: "${result.folderTitle}"`);
            } else {
                showToast('Kunde inte kategorisera automatiskt.');
            }
        } catch (e) {
            console.error(e);
            showToast('Ett fel uppstod vid automatisk kategorisering.');
        } finally {
            btnAuto.disabled = false;
            btnAuto.innerHTML = 'Auto ';
        }
    };

    document.getElementById('btn-auto-folder').addEventListener('click', async () => {
        const questionText = document.getElementById('card-front').value.trim();
        if (!questionText) {
            showToast('Skriv en fråga först!');
            document.getElementById('card-front').focus();
            return;
        }
        runAutoFolder(questionText);
    });

    // Note Actions
    document.getElementById('btn-add-note').addEventListener('click', () => {
        currentNoteId = null;
        document.getElementById('note-content').value = '';
        document.getElementById('note-form-title').innerText = 'Lägg till anteckning';
        switchView('addNote');
    });

    document.getElementById('form-add-note').addEventListener('submit', (e) => {
        e.preventDefault();
        const content = document.getElementById('note-content').value.trim();
        if (content && currentNotebookId) {
            const notebook = appData.notebooks.find(n => n.id === currentNotebookId);
            if (currentNoteId) {
                // Update
                const note = notebook.notes.find(n => n.id === currentNoteId);
                note.content = content;
                showToast('Anteckning uppdaterad!');
            } else {
                // Create
                notebook.notes.push(createNote(content));
                showToast('Anteckning sparad!');
            }
            saveData();
            openNotebook(currentNotebookId);
        }
    });

    document.getElementById('btn-generate-answer').addEventListener('click', async () => {
        const frontText = document.getElementById('card-front').value.trim();
        if (!frontText) {
            showToast('Skriv en fråga på framsidan först!');
            return;
        }

        const apiKey = await getApiKey();
        if (!apiKey || apiKey === 'klistra_in_din_nyckel_här_utan_citattecken') {
            alert('Kunde inte hitta en giltig API-nyckel i .env för att generera ett svar.');
            return;
        }

        const btn = document.getElementById('btn-generate-answer');
        const backField = document.getElementById('card-back');
        const isLongFormInAdd = document.getElementById('card-longform')?.checked || false;
        const isLongFormInEdit = document.getElementById('edit-card-longform')?.checked || false;
        const isLongForm = isLongFormInAdd || isLongFormInEdit;

        btn.disabled = true;
        btn.innerText = 'Laddar...';

        const maxTokens = isLongForm ? 1500 : 300;
        const promptInstruction = isLongForm 
            ? "Din uppgift är att besvara flashcards med ett djupgående och detaljerat svar (långformat). Använd rubriker, listor och styckeindelningar för att göra informationen lättläst. Glöm inte LaTeX för matematik."
            : "Din uppgift är att besvara flashcards med max 50 ord. MYCKET VIKTIGT: Du får absolut inte hitta på information eller gissa (hallucinera inte). Om du inte är 100% säker på sanningen, ska du bara svara: \"Jag vet inte\". Formatera ALL matematik med LaTeX via dollartecken, t.ex. $\\frac{1}{2}$ eller $\\sin(x)$.";

        try {
            const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: maxTokens,
                    system: `Du är en expert på fakta och lärande. ${promptInstruction}`,
                    messages: [{
                        role: 'user',
                        content: `Här är frågan: ${frontText}\nOm du är helt säker på svaret, ge det till mig${isLongForm ? ' i detalj' : ' kort'}. Om du är osäker, svara exakt "Jag vet inte".${buildDeckContext(currentDeckId)}`
                    }]
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `HTTP error ${response.status}`);
            }
            const data = await response.json();

            backField.value = data.content[0].text.trim();
            showToast('Svar genererat!');

            // Auto-categorize into folder
            runAutoFolder(frontText);

        } catch (e) {
            console.error("Anthropic API Error:", e);
            showToast(`Ett fel uppstod: ${e.message}`);
        } finally {
            btn.disabled = false;
            btn.innerText = ' Generera svar';
        }
    });

    // Study Session
    // btn-study event listener is now dynamically attached inside openDeck

    document.getElementById('form-study-ai').addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputObj = document.getElementById('input-study-ai');
        const question = inputObj.value.trim();
        if (!question) return;

        const apiKey = await getApiKey();
        if (!apiKey) {
            alert('En API-nyckel krävs. Lägg till din nyckel i .env först.');
            return;
        }

        const card = currentStudyCards[currentStudyIndex];
        if (card) fetchStudyAi(apiKey, card, question);
    });

    // Attach to the actual div for click-to-flip
    const flashcardDiv = document.getElementById('active-flashcard');
    const flipBtn = document.getElementById('btn-flip');

    const flipCard = () => {
        if (document.getElementById('study-flip-action').classList.contains('hidden')) return;

        document.getElementById('flashcard-inner').classList.add('flipped');
        document.getElementById('study-flip-action').classList.add('hidden');

        requestAnimationFrame(() => {
            const backFace = document.querySelector('.flashcard-back');
            const inner = document.getElementById('flashcard-inner');
            const flashcardEl = document.querySelector('.flashcard');

            // Reset minHeight and force reflow so scrollHeight reflects actual content
            if (inner) inner.style.minHeight = '0px';
            if (flashcardEl) flashcardEl.style.minHeight = '0px';
            backFace.style.position = 'static';
            backFace.offsetHeight; // force reflow
            const backHeight = backFace.scrollHeight;
            backFace.style.position = '';
            const finalHeight = Math.max(200, backHeight);

            if (inner) inner.style.minHeight = finalHeight + 'px';
            if (flashcardEl) flashcardEl.style.minHeight = finalHeight + 'px';
        });

        if (playgroundMode === 'action') {
            actionReveal();
        } else if (playgroundMode === 'fritext') {
            fritextReveal();
        } else {
            document.getElementById('study-actions').classList.remove('hidden');
        }
    };

    const actionReveal = (allCards) => {
        const cards = currentStudyCards;
        const startTimeSession = Date.now();
        
        let score = 0;
        let combo = 0;
        let maxCombo = 0;
        let cardIdx = 0;
        
        // Stats for session summary
        let totalPerfects = 0;
        let totalHits = 0;
        let totalWordsProcessed = 0;
        
        const stripHtmlForOption = (html) => stripHtml(html).substring(0, 120);
        
        // Personal best tracking
        let pbKey = 'spaced_rep_action_pb_all';
        let pbTitle = 'Hela biblioteket';
        if (playgroundFilterSource && playgroundFilterSource.size > 0) {
            const deckIds = new Set();
            playgroundFilterSource.forEach(val => {
                const match = val.match(/^deck:([^:]+)/);
                if (match) deckIds.add(match[1]);
            });
            if (deckIds.size === 1) {
                const singleDeckId = Array.from(deckIds)[0];
                const deckObj = appData.decks.find(d => d.id === singleDeckId);
                pbKey = `spaced_rep_action_pb_${singleDeckId}`;
                pbTitle = deckObj ? deckObj.title : 'Fokusområde';
            } else {
                pbKey = `spaced_rep_action_pb_focus_${Array.from(deckIds).sort().join('_')}`;
                pbTitle = 'Fokusområde';
            }
        }
        let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);
        
        // Create full screen cinema overlay
        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay action-game-overlay';
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-particles"></div>
            <div class="cinema-flash"></div>
            <div class="cinema-content" id="action-game-container" style="width:95%; max-width:800px; height:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding: 12vh 0 10vh; position:relative; z-index:5;">
                <!-- HUD -->
                <div class="action-hud" style="border-radius: var(--radius-md); box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
                    <div class="action-hud-left">
                        <span id="action-score" class="action-hud-val">Poäng: 0</span>
                        <span id="action-combo" class="action-hud-combo" style="opacity:0;"> 0</span>
                    </div>
                    <div class="action-hud-right">
                        <span id="action-pb" class="action-hud-pb"> Rekord: ${personalBest}</span>
                        <span id="action-progress" class="action-hud-progress">Kort ${cardIdx + 1} / ${cards.length}</span>
                    </div>
                </div>
                
                <!-- Main Arena -->
                <div id="action-arena" class="action-arena"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        
        // Spawn glowing embers in background
        const particlesContainer = overlay.querySelector('.cinema-particles');
        const spawnEmber = () => {
            if (!document.getElementById('cinema-overlay')) return;
            const ember = document.createElement('div');
            ember.className = 'action-ember';
            ember.style.left = Math.random() * 100 + 'vw';
            const size = 3 + Math.random() * 8;
            ember.style.width = size + 'px';
            ember.style.height = size + 'px';
            const drift = -80 + Math.random() * 160;
            ember.style.setProperty('--drift', drift + 'px');
            ember.style.animationDuration = (3 + Math.random() * 4) + 's';
            particlesContainer.appendChild(ember);
            setTimeout(() => ember.remove(), 7000);
            
            // Spawn next after delay
            setTimeout(spawnEmber, 350);
        };
        spawnEmber();

        // Helper to trigger confetti
        const triggerConfetti = () => {
            const colors = ['#FF7300', '#FF3C00', '#FFB700', '#FFA200', '#FF4500'];
            for (let j = 0; j < 60; j++) {
                const confetti = document.createElement('div');
                confetti.className = 'sd-confetti';
                confetti.style.left = `${Math.random() * 100}vw`;
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
                confetti.style.animationDelay = `${Math.random() * 2}s`;
                confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
                overlay.appendChild(confetti);
                setTimeout(() => confetti.remove(), 4000);
            }
        };

        // Helper to spawn hit sparks
        const spawnSparks = (x, y, count = 15) => {
            for (let j = 0; j < count; j++) {
                const spark = document.createElement('div');
                spark.className = 'action-spark';
                spark.style.left = x + 'px';
                spark.style.top = y + 'px';
                spark.style.background = 'radial-gradient(circle, #ffaa00, #ff5500)';
                const tx = (Math.random() - 0.5) * 160;
                const ty = (Math.random() - 0.5) * 160;
                spark.style.setProperty('--tx', tx + 'px');
                spark.style.setProperty('--ty', ty + 'px');
                overlay.appendChild(spark);
                setTimeout(() => spark.remove(), 500);
            }
        };

        // UI state variables
        let currentPhase = 'intro'; // 'intro', 'think', 'slam', 'review', 'end'
        let thinkTimerHandle = null;
        let slamTimeoutHandle = null;
        let rhythmIntervalHandle = null;
        let targetRingTime = 0;
        let isWordPressed = false;
        let activeWordDuration = 0;
        let wordList = [];
        let wordIdx = 0;
        
        const arena = overlay.querySelector('#action-arena');
        const scoreHUD = overlay.querySelector('#action-score');
        const comboHUD = overlay.querySelector('#action-combo');
        const progressHUD = overlay.querySelector('#action-progress');

        const updateHUD = () => {
            scoreHUD.textContent = `Poäng: ${score}`;
            if (combo >= 2) {
                comboHUD.textContent = ` ${combo}`;
                comboHUD.style.opacity = '1';
                comboHUD.classList.add('pulse');
                setTimeout(() => comboHUD.classList.remove('pulse'), 150);
            } else {
                comboHUD.style.opacity = '0';
            }
            progressHUD.textContent = `Kort ${cardIdx + 1} / ${cards.length}`;
        };

        const cleanup = () => {
            clearTimeout(thinkTimerHandle);
            clearTimeout(slamTimeoutHandle);
            clearInterval(rhythmIntervalHandle);
            document.removeEventListener('keydown', handleGlobalKeydown);
        };

        let isClosed = false;
        const closeGame = () => {
            if (isClosed) return;
            isClosed = true;
            cleanup();
            overlay.remove();
            finishPlaygroundSession();
        };

        // --- KEYDOWN DISPATCHER ---
        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
                return;
            }

            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (currentPhase === 'intro') {
                    startThinkPhase();
                } else if (currentPhase === 'think') {
                    startSlamPhase();
                } else if (currentPhase === 'slam') {
                    if (e.key === ' ') {
                        triggerRhythmHit();
                    } else if (e.key === 'Enter') {
                        startReviewPhase();
                    }
                } else if (currentPhase === 'end') {
                    if (e.key === 'Enter') {
                        restartGame();
                    }
                }
            } else if (currentPhase === 'review') {
                if (['1', '2', '3', '4'].includes(e.key)) {
                    e.preventDefault();
                    const rating = parseInt(e.key, 10);
                    submitCardRating(rating);
                }
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        // --- MOUSE CLICK ON GAME CONTAINER FOR MOBILE TIMING ---
        overlay.addEventListener('mousedown', (e) => {
            // Don't intercept clicks on buttons/inputs
            if (e.target.closest('button') || e.target.closest('.study-actions')) return;
            
            if (currentPhase === 'intro') {
                startThinkPhase();
            } else if (currentPhase === 'think') {
                startSlamPhase();
            } else if (currentPhase === 'slam') {
                triggerRhythmHit();
            }
        });

        // --- RHYTHM INTERACTION (HIT LOGIC) ---
        const triggerRhythmHit = () => {
            if (isWordPressed || currentPhase !== 'slam' || wordList.length === 0) return;
            isWordPressed = true;
            
            const now = Date.now();
            const diff = Math.abs(now - targetRingTime);
            
            const feedbackContainer = overlay.querySelector('#action-timing-feedback');
            if (!feedbackContainer) return;
            feedbackContainer.innerHTML = '';
            
            // Get center coordinates of word wrapper to spawn sparks
            const wordWrapper = overlay.querySelector('.action-word-wrapper');
            const rect = wordWrapper ? wordWrapper.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            if (diff <= 80) {
                // PERFECT
                totalPerfects++;
                totalHits++;
                combo++;
                if (combo > maxCombo) maxCombo = combo;
                
                const gained = Math.round(50 * (1 + combo * 0.1));
                score += gained;
                
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt perfect';
                msg.textContent = `PERFECT! +${gained}`;
                feedbackContainer.appendChild(msg);
                
                spawnSparks(cx, cy, 20);
                
                // Shockwave flash
                const flash = overlay.querySelector('.cinema-flash');
                flash.classList.add('flash-active');
                overlay.classList.add('shake-active');
                setTimeout(() => {
                    flash.classList.remove('flash-active');
                    overlay.classList.remove('shake-active');
                }, 100);
            } else if (diff <= 160) {
                // GREAT
                totalHits++;
                combo++;
                if (combo > maxCombo) maxCombo = combo;
                
                const gained = Math.round(30 * (1 + combo * 0.1));
                score += gained;
                
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt great';
                msg.textContent = `GREAT! +${gained}`;
                feedbackContainer.appendChild(msg);
                
                spawnSparks(cx, cy, 10);
            } else {
                // MISS
                combo = 0;
                const msg = document.createElement('div');
                msg.className = 'action-feedback-txt miss';
                msg.textContent = 'MISS! (FÖR TIDIG/SEN)';
                feedbackContainer.appendChild(msg);
            }
            updateHUD();
        };

        // --- PHASE 1: INTRO ---
        const showIntro = () => {
            currentPhase = 'intro';
            arena.innerHTML = `
                <div class="action-card">
                    <h1 class="action-title">ACTIONREPETITION</h1>
                    <p class="action-subtitle">Slammande ord under tidspress. Genuin action.</p>
                    <p class="action-subtitle" style="font-size:0.95rem; color:rgba(255,255,255,0.6);">
                        Klicka på <strong>Mellanslag</strong> eller tryck på skärmen i perfekt timing när ringen möter orden för att bygga en combo och tjäna bonuspoäng!
                    </p>
                    <div class="action-controls-info">
                        <strong>KONTROLLER:</strong><br/>
                        • Mellanslag / Skärmtryck : Rytm-träff under reveal<br/>
                        • Mellanslag / Skärmtryck : Starta reveal (under tänketid)<br/>
                        • 1, 2, 3, 4 : Betygsätt kort (Igen, Svår, Bra, Enkel) i slutet<br/>
                        • Esc : Avsluta spel
                    </div>
                    <button id="action-btn-start" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">STARTA SPEL</button>
                </div>
            `;
            arena.querySelector('#action-btn-start').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startThinkPhase();
            };
        };

        // --- PHASE 2: THINKING ---
        const startThinkPhase = () => {
            if (currentPhase === 'think') return;
            if (cardIdx >= cards.length) {
                showEndScreen();
                return;
            }
            
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'think';
            updateHUD();
            
            const card = cards[cardIdx];
            arena.innerHTML = `
                <div class="action-card" style="border-color: rgba(249, 115, 22, 0.45);">
                    <div class="action-card-header">FRÅGA</div>
                    <div id="action-question" class="action-text-question"></div>
                    <div class="action-think-timer-container">
                        <div id="action-think-timer-fill" class="action-think-timer-fill"></div>
                    </div>
                    <div style="font-size:0.85rem; color:rgba(255,255,255,0.45); font-weight:700;">Tänk ut svaret...</div>
                    <button id="action-btn-reveal" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">VISA SVAR [Space]</button>
                </div>
            `;
            
            const qBox = arena.querySelector('#action-question');
            if (card._jeopardy) {
                qBox.innerHTML = `<div style="font-size: 0.85rem; font-weight: 700; color: #F97316; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 0.5rem; border-bottom: 1px solid rgba(249,115,22,0.2); padding-bottom: 0.3rem; opacity: 0.8;">SVAR (Fråga eftersöks)</div>` + (typeof safeParse === 'function' ? safeParse(card.front) : card.front);
            } else {
                qBox.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
            }
            renderLatex(qBox);
            
            arena.querySelector('#action-btn-reveal').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startSlamPhase();
            };
            
            // Start shrinking timer bar (6.0 seconds)
            const fill = arena.querySelector('#action-think-timer-fill');
            // Trigger layout reflow to make transition start
            requestAnimationFrame(() => {
                fill.style.transform = 'scaleX(0)';
            });
            
            thinkTimerHandle = setTimeout(() => {
                startSlamPhase();
            }, 6000);
        };

        // --- PHASE 3: SLAMMING (WORD REVEAL WITH RHYTHM RING) ---
        const startSlamPhase = () => {
            if (currentPhase !== 'think') return;
            clearTimeout(thinkTimerHandle);
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'slam';
            updateHUD();
            
            const card = cards[cardIdx];
            
            // Build temporary DOM node to parse card.back and wrap math blocks atomicly
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = typeof safeParse === 'function' ? safeParse(card.back) : card.back;
            renderLatex(tempDiv);
            
            // Helper to recursively collect all text words and KaTeX nodes
            const extractWordNodes = (node, list = []) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (text.trim() === '') return;
                    // Split keeping spaces as delimiters so we keep word blocks
                    const words = text.split(/(\s+)/);
                    words.forEach(w => {
                        if (/\s+/.test(w)) {
                            // ignore whitespace
                        } else if (w.length > 0) {
                            list.push({ type: 'text', text: w });
                        }
                    });
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) {
                        list.push({ type: 'math', html: node.outerHTML });
                    } else {
                        Array.from(node.childNodes).forEach(child => extractWordNodes(child, list));
                    }
                }
                return list;
            };
            
            wordList = extractWordNodes(tempDiv);
            wordIdx = 0;
            
            if (wordList.length === 0) {
                // Fallback if no words to reveal
                wordList = [{ type: 'text', text: 'Klar!' }];
            }
            
            totalWordsProcessed += wordList.length;

            arena.innerHTML = `
                <div class="action-reveal-container">
                    <div id="action-docked-question" class="action-docked-question">
                        Fråga: ${card._jeopardy ? 'SVAR' : ''} ${stripHtmlForOption(card.front)}
                    </div>
                    <div class="action-word-wrapper">
                        <div id="action-active-word" class="action-active-word"></div>
                        <div id="action-timing-ring" class="action-timing-ring"></div>
                    </div>
                    <div id="action-timing-feedback" class="action-timing-feedback"></div>
                    <button id="action-btn-skip" class="btn-skip">Visa hela svaret [Enter]</button>
                </div>
            `;
            
            arena.querySelector('#action-btn-skip').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                startReviewPhase();
            };
            
            const activeWordEl = arena.querySelector('#action-active-word');
            const timingRing = arena.querySelector('#action-timing-ring');
            
            const showNextSlam = () => {
                if (currentPhase !== 'slam' || !document.getElementById('cinema-overlay')) return;
                
                // If we finished revealing all words
                if (wordIdx >= wordList.length) {
                    // Check if last word was missed (if user didn't press)
                    if (!isWordPressed && wordIdx > 0) {
                        combo = 0;
                        updateHUD();
                    }
                    startReviewPhase();
                    return;
                }
                
                // Check if previous word was missed (if user didn't press)
                if (wordIdx > 0 && !isWordPressed) {
                    combo = 0;
                    updateHUD();
                }
                
                isWordPressed = false;
                const node = wordList[wordIdx];
                
                // Set word display
                activeWordEl.classList.remove('animating');
                void activeWordEl.offsetWidth; // Trigger layout reflow
                
                if (node.type === 'math') {
                    activeWordEl.innerHTML = node.html;
                    activeWordEl.style.fontSize = '2.0rem'; // Scale down equations to fit inside ring
                } else {
                    activeWordEl.textContent = node.text;
                    // Scale down long words to prevent overflow
                    if (node.text.length > 12) {
                        activeWordEl.style.fontSize = '1.8rem';
                    } else if (node.text.length > 8) {
                        activeWordEl.style.fontSize = '2.4rem';
                    } else {
                        activeWordEl.style.fontSize = ''; // Uses CSS default (3.4rem)
                    }
                }
                activeWordEl.classList.add('animating');
                
                // Configure timing ring shrink
                timingRing.classList.remove('animating');
                void timingRing.offsetWidth; // Trigger layout reflow
                timingRing.classList.add('animating');
                
                // Target hit time is exactly 400ms after rendering this word
                targetRingTime = Date.now() + 400;
                
                // Calculate reveal pacing duration based on word length
                const cleanText = node.type === 'text' ? node.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim() : 'math';
                const hasSentenceEnding = node.type === 'text' && /[.!?]$/.test(node.text.trim());
                
                activeWordDuration = Math.max(500, Math.min(1000, cleanText.length * 60 + 320)) * 1.15;
                if (hasSentenceEnding) {
                    activeWordDuration += 800; // Extra pause for punctuation
                }
                
                // Trigger camera shake/flash automatically on sentence end or long words for ambient feedback
                const isMajorWord = cleanText.length > 7;
                if (hasSentenceEnding || isMajorWord || node.type === 'math') {
                    // Subtle automatic pulse feedback
                    overlay.classList.add('shake-active');
                    setTimeout(() => overlay.classList.remove('shake-active'), 180);
                }
                
                wordIdx++;
                slamTimeoutHandle = setTimeout(showNextSlam, activeWordDuration);
            };
            
            showNextSlam();
        };

        // --- PHASE 4: EVALUATION / REVIEW ---
        const startReviewPhase = () => {
            if (currentPhase !== 'slam') return;
            clearTimeout(slamTimeoutHandle);
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'review';
            updateHUD();
            
            const card = cards[cardIdx];
            
            // Zoom-in final impact flash
            const flash = overlay.querySelector('.cinema-flash');
            flash.classList.add('flash-active');
            overlay.classList.add('shake-active');
            setTimeout(() => {
                flash.classList.remove('flash-active');
                overlay.classList.remove('shake-active');
            }, 180);
            
            arena.innerHTML = `
                <div class="action-card" style="max-width: 650px;">
                    <div class="action-card-header" style="color: #34A853;">FULLSTÄNDIGT SVAR</div>
                    <div id="action-full-answer" class="action-full-answer-scroll">
                        ${typeof safeParse === 'function' ? safeParse(card.back) : card.back}
                    </div>
                    
                    <div class="action-stats-summary">
                        <span> Hits: ${totalPerfects} Perfect</span>
                        <span> Max Combo: ${maxCombo}</span>
                        <span> Poäng: +${score}</span>
                    </div>
                    
                    <div style="font-size:0.85rem; color:rgba(255,255,255,0.45); font-weight:700;">Betygsätt din egen hågkomst av kortet:</div>
                    
                    <div id="action-rating-container" class="action-rating-container"></div>
                </div>
            `;
            
            // Render back images
            const ansScroll = arena.querySelector('#action-full-answer');
            if (typeof renderCardBackImages === 'function') {
                renderCardBackImages(ansScroll, card.backImages);
            }
            renderLatex(ansScroll);
            
            // Append cloned actions
            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'cinema-study-actions';
            clonedActions.classList.remove('hidden');
            
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    btn.blur();
                    const rating = parseInt(btn.getAttribute('data-rating'), 10);
                    submitCardRating(rating);
                });
            });
            
            arena.querySelector('#action-rating-container').appendChild(clonedActions);
        };

        const submitCardRating = (rating) => {
            if (currentPhase !== 'review') return;
            currentPhase = 'rating-submitted';
            if (rating === 1) {
                playgroundSessionStats.again++;
            } else {
                playgroundSessionStats.correct++;
            }
            
            currentStudyIndex = cardIdx;
            processRating(rating);
            
            cardIdx++;
            if (cardIdx >= cards.length) {
                showEndScreen();
            } else {
                startThinkPhase();
            }
        };

        // --- PHASE 5: GAME OVER / SUMMARY ---
        const showEndScreen = () => {
            if (currentPhase === 'end') return;
            if (document.activeElement) document.activeElement.blur();
            currentPhase = 'end';
            clearTimeout(thinkTimerHandle);
            clearTimeout(slamTimeoutHandle);
            
            const isNewPB = score > personalBest;
            if (isNewPB) {
                personalBest = score;
                localStorage.setItem(pbKey, score);
            }
            
            playgroundSessionStats.correct = score; 

            const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
            const perfectPct = totalWordsProcessed > 0 ? Math.round((totalPerfects / totalWordsProcessed) * 100) : 0;
            
            arena.innerHTML = `
                <div class="action-card" style="border-color: #FF7300; background: rgba(20,5,0,0.85);">
                    <h2 class="action-title" style="font-size:3.4rem;">SPEL KLART!</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        Du tog dig igenom alla korten i tempo!
                    </p>
                    
                    <div class="sd-stats-grid" style="width:100%; display:grid; gap:0.6rem; margin:1rem 0;">
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:rgba(255,255,255,0.6);">Timing Hits (Perfect)</span>
                            <span class="sd-stat-value" style="font-weight:700; color:#fff;"> ${totalPerfects} (${perfectPct}%)</span>
                        </div>
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:rgba(255,255,255,0.6);">Max Streak/Combo</span>
                            <span class="sd-stat-value" style="font-weight:700; color:#F59E0B;"> ${maxCombo}</span>
                        </div>
                        <div class="sd-stat-row" style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span class="sd-stat-label" style="color:rgba(255,255,255,0.6);">Tid spelat</span>
                            <span class="sd-stat-value" style="font-weight:700; color:#fff;">⏱ ${timeSpent}s</span>
                        </div>
                        <div class="sd-stat-row sd-stat-highlight" style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(249,115,22,0.3); padding:0.4rem 0; font-size:1.15rem; font-weight:800;">
                            <span class="sd-stat-label" style="color:#F97316;">Slutpoäng</span>
                            <span class="sd-stat-value" style="color:#fff;">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: rgba(255,215,0,0.15); border: 1px dashed #FFD700; border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #FFD700; text-shadow: 0 0 4px rgba(255,215,0,0.2); margin-top:0.4rem;">
                                 NYTT REKORD! 
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="display:flex; justify-content:space-between; opacity: 0.7; padding-top:0.4rem;">
                                <span class="sd-stat-label" style="color:rgba(255,255,255,0.5);">Rekord (${pbTitle})</span>
                                <span class="sd-stat-value" style="font-weight:700; color:#FFD700;"> ${personalBest}</span>
                            </div>
                        `}
                    </div>
                    
                    <div class="sd-end-actions" style="display:flex; gap:0.75rem; width:100%;">
                        <button id="action-btn-restart" class="btn primary" style="flex:1; padding:0.8rem; font-weight:700;">Spela igen</button>
                        <button id="action-btn-exit" class="btn secondary" style="flex:1; padding:0.8rem; font-weight:700;">Avsluta</button>
                    </div>
                </div>
            `;
            
            arena.querySelector('#action-btn-restart').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                restartGame();
            };
            arena.querySelector('#action-btn-exit').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                closeGame();
            };
            
            triggerConfetti();
        };

        const restartGame = () => {
            if (currentPhase !== 'end') return;
            currentPhase = 'restarting';
            cleanup();
            
            currentStudyCards = fisherYatesShuffle([...cards]);
            score = 0;
            combo = 0;
            maxCombo = 0;
            cardIdx = 0;
            totalPerfects = 0;
            totalHits = 0;
            totalWordsProcessed = 0;
            
            document.addEventListener('keydown', handleGlobalKeydown);
            startThinkPhase();
        };

        startThinkPhase();
    };

    const lucktextReveal = () => {
        const cards = currentStudyCards;
        const startTimeSession = Date.now();

        let score = 0;
        let combo = 0;
        let maxCombo = 0;
        let cardIdx = 0;
        let totalCorrectBlanks = 0;
        let totalBlanks = 0;
        let totalPerfectCards = 0;

        const stripHtmlForLucktext = (html) => stripHtml(html).substring(0, 120);

        let pbKey = 'spaced_rep_lucktext_pb_all';
        let pbTitle = 'Hela biblioteket';
        if (playgroundFilterSource && playgroundFilterSource.size > 0) {
            const deckIds = new Set();
            playgroundFilterSource.forEach(val => {
                const match = val.match(/^deck:([^:]+)/);
                if (match) deckIds.add(match[1]);
            });
            if (deckIds.size === 1) {
                const singleDeckId = Array.from(deckIds)[0];
                const deckObj = appData.decks.find(d => d.id === singleDeckId);
                pbKey = `spaced_rep_lucktext_pb_${singleDeckId}`;
                pbTitle = deckObj ? deckObj.title : 'Fokusområde';
            } else {
                pbKey = `spaced_rep_lucktext_pb_focus_${Array.from(deckIds).sort().join('_')}`;
                pbTitle = 'Fokusområde';
            }
        }
        let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

        const STOPWORDS = new Set([
            'och','eller','som','att','den','det','de','en','ett','är','var','har','hade',
            'kan','ska','ville','med','för','från','till','vid','mot','över','under',
            'genom','efter','innan','utan','inte','inom','sedan','bland','samt','dock',
            'även','bara','också','redan','igen','alla','varje',
            'denna','detta','dessa','sin','sitt','sina','hans','hennes','dess','deras',
            'man','sig','oss','dem','dig','mig','hon','han','dom','vad','hur',
            'var','när','där','här','medan','fast','men','dels',
            'the','and','but','for','with','from','this','that','which','have','has',
            'been','were','will','would','could','should','into','about','than','then',
            'also','just','only','very','more','most','some','such','each','both',
            'does','did','being','having','other','blir','blev','vara',
            'finns','bara','mycket','många','andra','efter','hela',
            'a','an','i','is','it','of','on','or','to','be','so','no','do','if','my','up','us'
        ]);

        const scoreWord = (w, idx, totalWords, frontText) => {
            const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim();
            if (clean.length < 3) return -1;
            if (STOPWORDS.has(clean.toLowerCase())) return -1;
            let s = 0;
            if (/\d/.test(clean)) s += 30;
            if (idx > 0 && /^[A-ZÅÄÖ]/.test(clean)) s += 18;
            s += Math.min(clean.length, 14);
            if (/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(clean) && clean.length > 3) s += 10;
            const relPos = idx / Math.max(1, totalWords - 1);
            if (relPos > 0.1 && relPos < 0.9) s += 5;
            if (clean.length <= 3) s -= 5;
            if (frontText && frontText.toLowerCase().includes(clean.toLowerCase())) s += 12;
            if (/[åäöÅÄÖ]/.test(clean)) s += 3;
            if (clean.length >= 8) s += 6;
            return s;
        };

        const selectBlanks = (text, frontText) => {
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const candidates = [];
            words.forEach((w, idx) => {
                const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim();
                const s = scoreWord(w, idx, words.length, frontText);
                if (s > 0) candidates.push({ original: w, clean, index: idx, score: s });
            });

            const progressBonus = Math.floor(cardIdx / 2); // 0,0,1,1,2,2,3,3...
            const targetBlanks = Math.max(2, Math.min(8, Math.round(words.length / 20) + progressBonus));
            candidates.sort((a, b) => b.score - a.score);
            const chosen = [];
            const minGap = Math.max(2, Math.floor(words.length / (targetBlanks + 2)));

            for (const c of candidates) {
                if (chosen.length >= targetBlanks) break;
                if (!chosen.some(ch => Math.abs(ch.index - c.index) < minGap)) chosen.push(c);
            }
            if (chosen.length < Math.min(targetBlanks, candidates.length)) {
                for (const c of candidates) {
                    if (chosen.length >= targetBlanks) break;
                    if (!chosen.some(ch => ch.index === c.index)) chosen.push(c);
                }
            }
            chosen.sort((a, b) => a.index - b.index);
            return { words, chosen };
        };

        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay cinema-overlay--game lucktext-game-overlay';

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-flash"></div>
            <button class="lucktext-close-btn" id="lt-close-btn" title="Avsluta (Esc)">&times;</button>
            <div class="cinema-content" style="width:95%; max-width:800px; height:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding: 12vh 0 10vh; position:relative; z-index:5; align-self:center; margin:0 auto;">
                <div class="lucktext-hud">
                    <div class="lucktext-hud-left">
                        <span id="lt-score" class="lucktext-hud-val">0 p</span>
                        <span id="lt-combo" class="lucktext-hud-combo" style="opacity:0;">x0</span>
                    </div>
                    <div class="lucktext-hud-right">
                        <span id="lt-pb" class="lucktext-hud-pb">Rekord: ${personalBest}</span>
                        <span id="lt-progress" class="lucktext-hud-progress">${cardIdx + 1} / ${cards.length}</span>
                    </div>
                </div>
                <div id="lt-arena" class="lucktext-arena"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        overlay.querySelector('#lt-close-btn').onclick = (e) => { e.stopPropagation(); closeGame(); };

        const arena = overlay.querySelector('#lt-arena');
        const scoreHUD = overlay.querySelector('#lt-score');
        const comboHUD = overlay.querySelector('#lt-combo');
        const progressHUD = overlay.querySelector('#lt-progress');

        const updateHUD = () => {
            scoreHUD.textContent = `${score} p`;
            if (combo >= 2) {
                comboHUD.textContent = `x${combo}`;
                comboHUD.style.opacity = '1';
                comboHUD.classList.add('pulse');
                setTimeout(() => comboHUD.classList.remove('pulse'), 150);
            } else {
                comboHUD.style.opacity = '0';
            }
            progressHUD.textContent = `${cardIdx + 1} / ${cards.length}`;
        };

        const triggerFlash = () => {
            const flash = overlay.querySelector('.cinema-flash');
            if (flash) {
                flash.classList.add('flash-active');
                setTimeout(() => flash.classList.remove('flash-active'), 120);
            }
        };

        const triggerConfetti = () => {
            const colors = ['#8B5CF6', '#A78BFA', '#7C3AED', '#C4B5FD', '#DDD6FE'];
            for (let j = 0; j < 60; j++) {
                const confetti = document.createElement('div');
                confetti.className = 'sd-confetti';
                confetti.style.left = `${Math.random() * 100}vw`;
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
                confetti.style.animationDelay = `${Math.random() * 2}s`;
                confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
                overlay.appendChild(confetti);
                setTimeout(() => confetti.remove(), 4000);
            }
        };

        let currentPhase = 'intro';
        let memorizeTimerHandle = null;

        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
                return;
            }
            if (e.key === ' ' || e.key === 'Enter') {
                if (currentPhase === 'intro') {
                    e.preventDefault();
                    startMemorizePhase();
                } else if (currentPhase === 'end' && e.key === 'Enter') {
                    e.preventDefault();
                    closeGame();
                }
            }
            if (currentPhase === 'review' && ['1','2','3','4'].includes(e.key)) {
                e.preventDefault();
                submitCardRating(parseInt(e.key, 10));
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        const cleanup = () => {
            clearTimeout(memorizeTimerHandle);
            document.removeEventListener('keydown', handleGlobalKeydown);
        };

        let isClosed = false;
        const closeGame = () => {
            if (isClosed) return;
            isClosed = true;
            cleanup();
            overlay.remove();
            finishPlaygroundSession();
        };

        const restartGame = () => {
            if (currentPhase !== 'end') return;
            currentPhase = 'restarting';
            cleanup();

            currentStudyCards = fisherYatesShuffle([...cards]);
            score = 0;
            combo = 0;
            maxCombo = 0;
            cardIdx = 0;
            totalCorrectBlanks = 0;
            totalBlanks = 0;
            totalPerfectCards = 0;

            document.addEventListener('keydown', handleGlobalKeydown);
            startMemorizePhase();
        };

        const showIntro = () => {
            currentPhase = 'intro';
            arena.innerHTML = `
                <div class="lucktext-card">
                    <h1 class="lucktext-title">LUCKTEXT</h1>
                    <p class="lucktext-subtitle">Memorera svaret. Fyll i luckorna. Bygg combo.</p>
                    <p class="lucktext-subtitle" style="font-size:0.95rem; color:rgba(255,255,255,0.5);">
                        ${cards.length} kort väntar. Du får se svaret, sedan göms nyckelord som du fyller i ur minnet.
                        Rätt svar i rad ger combo-multiplikator!
                    </p>
                    <div class="lucktext-controls-info">
                        <strong>KONTROLLER:</strong><br/>
                        &bull; Enter : Kontrollera svar<br/>
                        &bull; Tab : Nästa lucka<br/>
                        &bull; 1–4 : Betygsätt kort (Igen, Svår, Bra, Enkel)<br/>
                        &bull; Esc : Avsluta
                    </div>
                    <button id="lt-btn-start" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">STARTA</button>
                </div>
            `;
            arena.querySelector('#lt-btn-start').onclick = (e) => {
                e.stopPropagation();
                startMemorizePhase();
            };
        };

        const startMemorizePhase = () => {
            if (currentPhase === 'memorize') return;
            if (cardIdx >= cards.length) { showEndScreen(); return; }
            currentPhase = 'memorize';
            updateHUD();

            const card = cards[cardIdx];
            const backHtml = typeof safeParse === 'function' ? safeParse(card.back) : card.back;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = backHtml;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length;
            const timerDuration = Math.max(5, Math.min(25, Math.round(wordCount * 0.8)));

            arena.innerHTML = `
                <div class="lucktext-card">
                    <div class="lucktext-card-header">FRÅGA</div>
                    <div class="lucktext-text-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <div class="lucktext-card-header" style="color: #34A853; margin-top: 1rem;">MEMORERA SVARET</div>
                    <div id="lt-memorize-text" class="lucktext-text-memorize">${backHtml}</div>
                    <div class="lucktext-timer-container">
                        <div id="lt-timer-fill" class="lucktext-timer-fill" style="transition: transform ${timerDuration}s linear;"></div>
                    </div>
                    <div class="lucktext-timer-label">${timerDuration}s att memorera</div>
                    <button id="lt-btn-ready" class="lucktext-btn-ready">Jag är redo &mdash; visa luckor</button>
                </div>
            `;

            const memText = arena.querySelector('#lt-memorize-text');
            renderLatex(memText);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(memText, card.backImages);

            const questionDiv = arena.querySelector('.lucktext-text-question');
            renderLatex(questionDiv);

            const textLength = plainText.length;
            if (textLength > 400) memText.style.fontSize = '1.1rem';
            else if (textLength > 200) memText.style.fontSize = '1.35rem';

            const timerFill = arena.querySelector('#lt-timer-fill');
            requestAnimationFrame(() => { timerFill.style.transform = 'scaleX(0)'; });

            arena.querySelector('#lt-btn-ready').onclick = (e) => {
                e.stopPropagation();
                clearTimeout(memorizeTimerHandle);
                startBlankPhase();
            };

            memorizeTimerHandle = setTimeout(() => startBlankPhase(), timerDuration * 1000);
        };

        const startBlankPhase = () => {
            if (currentPhase !== 'memorize') return;
            if (!document.getElementById('cinema-overlay')) return;
            currentPhase = 'blank';

            const card = cards[cardIdx];
            const backHtml = typeof safeParse === 'function' ? safeParse(card.back) : card.back;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = backHtml;
            renderLatex(tempDiv);

            const getNonMathText = (element) => {
                let text = '';
                const traverse = (node) => {
                    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
                    else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) return;
                        Array.from(node.childNodes).forEach(traverse);
                    }
                };
                traverse(element);
                return text;
            };

            const plainText = getNonMathText(tempDiv);
            const frontPlain = stripHtmlForLucktext(card.front);
            const { chosen } = selectBlanks(plainText, frontPlain);

            if (chosen.length === 0) {
                startReviewPhase(0, 0);
                return;
            }

            totalBlanks += chosen.length;

            arena.innerHTML = `
                <div class="lucktext-card">
                    <div class="lucktext-card-header">FRÅGA</div>
                    <div class="lucktext-text-question">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                    <div class="lucktext-card-header" style="margin-top: 1rem;">FYLL I LUCKORNA</div>
                    <div id="lt-blank-text" class="lucktext-text-memorize" style="font-size: 1.4rem; font-weight: 400;">${backHtml}</div>
                    <button id="lt-btn-check" class="btn primary" style="padding:0.8rem; font-weight:700; width:100%;">Kontrollera [Enter]</button>
                </div>
            `;

            const questionDiv = arena.querySelector('.lucktext-text-question');
            renderLatex(questionDiv);

            const blankText = arena.querySelector('#lt-blank-text');
            renderLatex(blankText);

            const textLength = plainText.length;
            if (textLength > 400) blankText.style.fontSize = '1.05rem';
            else if (textLength > 200) blankText.style.fontSize = '1.2rem';

            const insertInputs = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (text.trim() === '') return;
                    const parent = node.parentNode;
                    const wordsList = text.split(/(\s+)/);
                    const fragment = document.createDocumentFragment();
                    wordsList.forEach(w => {
                        if (/^\s+$/.test(w)) {
                            fragment.appendChild(document.createTextNode(w));
                        } else if (w.length > 0) {
                            const cleanW = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""''…:;–—]/g, '').trim().toLowerCase();
                            const chosenIdx = chosen.findIndex(c => !c._placed && c.clean.toLowerCase() === cleanW);
                            if (chosenIdx !== -1) {
                                chosen[chosenIdx]._placed = true;
                                const hint = chosen[chosenIdx].clean[0];
                                const input = document.createElement('input');
                                input.type = 'text';
                                input.className = 'lucktext-inline-input';
                                input.dataset.idx = String(chosenIdx);
                                input.placeholder = hint + '…';
                                input.autocomplete = 'off';
                                input.spellcheck = false;
                                input.style.width = `${Math.max(4, cleanW.length) * 0.72}em`;
                                input.addEventListener('keydown', (e) => {
                                    if (e.key === 'Tab') {
                                        e.preventDefault();
                                        const allInputs = [...arena.querySelectorAll('.lucktext-inline-input')];
                                        const cur = allInputs.indexOf(input);
                                        const next = allInputs[cur + (e.shiftKey ? -1 : 1)];
                                        if (next) next.focus();
                                    }
                                });
                                fragment.appendChild(input);
                            } else {
                                fragment.appendChild(document.createTextNode(w));
                            }
                        }
                    });
                    parent.replaceChild(fragment, node);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display') || node.classList.contains('math'))) return;
                    Array.from(node.childNodes).forEach(child => insertInputs(child));
                }
            };

            insertInputs(blankText);
            setTimeout(() => arena.querySelector('.lucktext-inline-input')?.focus(), 50);

            let submitted = false;
            const checkAnswers = () => {
                if (submitted) return;
                submitted = true;

                let correctCount = 0;
                chosen.forEach((item, cIdx) => {
                    const input = arena.querySelector(`.lucktext-inline-input[data-idx="${cIdx}"]`);
                    if (!input) return;
                    const inputVal = input.value.trim().toLowerCase();
                    const correctVal = item.clean.toLowerCase();

                    if (inputVal === correctVal) {
                        correctCount++;
                        combo++;
                        if (combo > maxCombo) maxCombo = combo;
                        const gained = Math.round(50 * (1 + (combo - 1) * 0.15));
                        score += gained;
                        input.classList.add('correct');
                        input.value = item.clean;
                    } else {
                        combo = 0;
                        input.classList.add('wrong');
                        input.value = inputVal ? `${inputVal} → ${item.clean}` : item.clean;
                    }
                    input.disabled = true;
                });

                totalCorrectBlanks += correctCount;
                if (correctCount === chosen.length) totalPerfectCards++;
                updateHUD();

                if (correctCount === chosen.length) triggerFlash();

                startReviewPhase(correctCount, chosen.length);
            };

            arena.querySelector('#lt-btn-check').addEventListener('click', checkAnswers);
            overlay.addEventListener('keydown', function enterHandler(e) {
                if (e.key === 'Enter' && currentPhase === 'blank' && !submitted) {
                    e.preventDefault();
                    checkAnswers();
                    overlay.removeEventListener('keydown', enterHandler);
                }
            });
        };

        const startReviewPhase = (correctCount, blankCount) => {
            if (currentPhase !== 'blank') return;
            currentPhase = 'review';

            const pct = blankCount > 0 ? Math.round((correctCount / blankCount) * 100) : 100;

            let feedbackClass, feedbackText;
            if (pct === 100) { feedbackClass = 'perfect'; feedbackText = `<span style="color:#34A853; font-weight:800;">PERFEKT! ${correctCount}/${blankCount}</span>`; }
            else if (pct >= 50) { feedbackClass = 'partial'; feedbackText = `<span style="color:#FBBC04; font-weight:800;">${correctCount}/${blankCount} rätt (${pct}%)</span>`; }
            else { feedbackClass = 'low'; feedbackText = `<span style="color:#EA4335; font-weight:800;">${correctCount}/${blankCount} rätt (${pct}%)</span>`; }

            const existingCard = arena.querySelector('.lucktext-card');
            if (existingCard) {
                const checkBtn = existingCard.querySelector('#lt-btn-check');
                if (checkBtn) checkBtn.remove();

                const resultDiv = document.createElement('div');
                resultDiv.className = `lucktext-result-feedback ${feedbackClass}`;
                resultDiv.innerHTML = feedbackText;
                existingCard.appendChild(resultDiv);

                const ratingDiv = document.createElement('div');
                ratingDiv.className = 'lucktext-rating-container';
                ratingDiv.innerHTML = '<div class="lucktext-rating-label">Betygsätt din hågkomst:</div>';

                const originalActions = document.getElementById('study-actions');
                const clonedActions = originalActions.cloneNode(true);
                clonedActions.id = 'lt-rating-actions';
                clonedActions.classList.remove('hidden');
                clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        btn.blur();
                        submitCardRating(parseInt(btn.getAttribute('data-rating'), 10));
                    });
                });
                ratingDiv.appendChild(clonedActions);
                existingCard.appendChild(ratingDiv);

                // No scrollIntoView — user hates scrolling
            }
        };

        const submitCardRating = (rating) => {
            if (currentPhase !== 'review') return;
            currentPhase = 'rating-submitted';

            currentStudyIndex = cardIdx;
            processRating(rating);
            cardIdx++;

            if (cardIdx >= cards.length) showEndScreen();
            else startMemorizePhase();
        };

        const showEndScreen = () => {
            if (currentPhase === 'end') return;
            currentPhase = 'end';
            clearTimeout(memorizeTimerHandle);

            const isNewPB = score > personalBest;
            if (isNewPB) {
                personalBest = score;
                localStorage.setItem(pbKey, score);
            }

            playgroundSessionStats.correct = totalCorrectBlanks;

            const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
            const blankPct = totalBlanks > 0 ? Math.round((totalCorrectBlanks / totalBlanks) * 100) : 0;

            arena.innerHTML = `
                <div class="lucktext-card" style="border-color: rgba(139, 92, 246, 0.5); background: rgba(15, 10, 30, 0.9);">
                    <h2 class="lucktext-title" style="font-size:3rem;">KLART!</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        ${cards.length} kort avklarade
                    </p>

                    <div style="width:100%; display:grid; gap:0.6rem; margin:1rem 0;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span style="color:rgba(255,255,255,0.6);">Luckor rätt</span>
                            <span style="font-weight:700; color:#fff;">${totalCorrectBlanks} / ${totalBlanks} (${blankPct}%)</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span style="color:rgba(255,255,255,0.6);">Perfekta kort</span>
                            <span style="font-weight:700; color:#34A853;">${totalPerfectCards} / ${cards.length}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span style="color:rgba(255,255,255,0.6);">Max combo</span>
                            <span style="font-weight:700; color:#8B5CF6;">x${maxCombo}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem;">
                            <span style="color:rgba(255,255,255,0.6);">Tid</span>
                            <span style="font-weight:700; color:#fff;">${timeSpent}s</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; padding:0.5rem 0; font-size:1.15rem; font-weight:800; border-bottom:1px solid rgba(139,92,246,0.3);">
                            <span style="color:#8B5CF6;">Slutpoäng</span>
                            <span style="color:#fff;">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: rgba(139,92,246,0.15); border: 1px dashed #8B5CF6; border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #A78BFA; text-shadow: 0 0 4px rgba(139,92,246,0.3); margin-top:0.4rem;">
                                NYTT REKORD!
                            </div>
                        ` : `
                            <div style="display:flex; justify-content:space-between; opacity: 0.7; padding-top:0.4rem;">
                                <span style="color:rgba(255,255,255,0.5);">Rekord (${pbTitle})</span>
                                <span style="font-weight:700; color:#8B5CF6;">${personalBest}</span>
                            </div>
                        `}
                    </div>

                    <div style="display:flex; gap:0.75rem; width:100%;">
                        <button id="lt-btn-restart" class="btn primary" style="flex:1; padding:0.8rem; font-weight:700;">Spela igen</button>
                        <button id="lt-btn-exit" class="btn secondary" style="flex:1; padding:0.8rem; font-weight:700;">Avsluta</button>
                    </div>
                </div>
            `;

            arena.querySelector('#lt-btn-restart').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                restartGame();
            };
            arena.querySelector('#lt-btn-exit').onclick = (e) => {
                e.stopPropagation();
                if (e.currentTarget) e.currentTarget.blur();
                closeGame();
            };

            triggerConfetti();
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.study-actions')) return;
            if (currentPhase === 'intro') startMemorizePhase();
        });

        startMemorizePhase();
    };

    const fritextReveal = () => {
        const card = currentStudyCards[currentStudyIndex];
        if (!card) return;

        const studyBack = document.getElementById('study-back-text');
        const studyFront = document.getElementById('study-front-text');
        const realAnswer = studyBack.innerText.trim();
        const questionHtml = studyFront.innerHTML;

        const STOPWORDS = new Set([
            'och','eller','som','att','den','det','de','en','ett','är','var','har','hade',
            'kan','ska','ville','med','för','från','till','vid','mot','över','under',
            'genom','efter','innan','utan','inte','inom','sedan','bland','samt','dock',
            'även','bara','också','redan','igen','alla','varje',
            'denna','detta','dessa','sin','sitt','sina','hans','hennes','dess','deras',
            'man','sig','oss','dem','dig','mig','hon','han','dom','vad','hur',
            'var','när','där','här','medan','fast','men','dels',
            'the','and','but','for','with','from','this','that','which','have','has',
            'been','were','will','would','could','should','into','about','than','then',
            'also','just','only','very','more','most','some','such','each','both',
            'does','did','being','having','other','blir','blev','vara'
        ]);

        const extractKeywords = (text) => {
            const words = text.split(/\s+/);
            const keywords = [];
            const seen = new Set();
            words.forEach(w => {
                const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim();
                if (clean.length < 2) return;
                const lower = clean.toLowerCase();
                if (STOPWORDS.has(lower) || seen.has(lower)) return;
                seen.add(lower);

                let score = clean.length;
                if (/\d/.test(clean)) score += 20;
                if (/^[A-ZÅÄÖ]/.test(clean)) score += 10;
                if (clean.length >= 6) score += 5;
                keywords.push({ word: clean, lower, score });
            });
            keywords.sort((a, b) => b.score - a.score);
            return keywords;
        };

        const fuzzyMatch = (input, target) => {
            if (input === target) return true;
            if (input.length < 3 || target.length < 3) return input === target;
            if (Math.abs(input.length - target.length) > 2) return false;
            let dist = 0;
            const maxLen = Math.max(input.length, target.length);
            for (let i = 0; i < maxLen; i++) {
                if (input[i] !== target[i]) dist++;
                if (dist > 2) return false;
            }
            return true;
        };

        const sentences = realAnswer.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
        const wordCount = realAnswer.split(/\s+/).length;
        const hintText = `Cirka ${wordCount} ord, ${Math.max(1, sentences.length)} ${sentences.length === 1 ? 'mening' : 'meningar'}`;

        const overlay = document.createElement('div');
        overlay.id = 'cinema-overlay';
        overlay.className = 'cinema-overlay';
        overlay.style.background = 'rgba(10, 10, 10, 0.99)';

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:800px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;">
                <div style="font-size:0.85rem;font-weight:700;color:var(--primary-color);letter-spacing:0.05em;text-transform:uppercase;">FRITEXT: SKRIV UR MINNET</div>
                <div id="fritext-question" style="font-size:1.2rem;color:#ccc;text-align:center;line-height:1.5;padding:0.75rem 1rem;background:rgba(255,255,255,0.04);border-radius:var(--radius-md);width:100%;max-height:15vh;overflow-y:auto;"></div>
                <div id="fritext-phase-write" style="width:100%;display:flex;flex-direction:column;gap:1rem;align-items:center;">
                    <div style="font-size:0.8rem;color:rgba(255,255,255,0.35);font-style:italic;">${hintText}</div>
                    <textarea id="fritext-textarea" placeholder="Skriv ditt svar här..." style="width:100%;min-height:180px;max-height:40vh;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-md);color:#fff;font-family:inherit;font-size:1rem;line-height:1.6;padding:1rem;outline:none;resize:vertical;" spellcheck="false"></textarea>
                    <button id="btn-fritext-submit" class="btn primary" style="width:100%;max-width:400px;padding:0.8rem;">Visa svar</button>
                </div>
                <div id="fritext-phase-compare" class="hidden" style="width:100%;display:flex;flex-direction:column;gap:1.25rem;">
                    <div style="display:flex;gap:0.5rem;align-items:center;justify-content:center;">
                        <span id="fritext-score" style="font-size:1.5rem;font-weight:700;color:var(--primary-color);"></span>
                        <span id="fritext-score-label" style="font-size:0.9rem;color:rgba(255,255,255,0.6);"></span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div>
                            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Ditt svar</div>
                            <div id="fritext-user-answer" style="font-size:0.95rem;color:rgba(255,255,255,0.7);line-height:1.6;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-md);max-height:30vh;overflow-y:auto;white-space:pre-wrap;"></div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Rätt svar</div>
                            <div id="fritext-real-answer" style="font-size:0.95rem;color:#fff;line-height:1.6;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:var(--radius-md);max-height:30vh;overflow-y:auto;"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="cinema-actions" class="cinema-actions"></div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        const closeOverlay = () => {
            document.removeEventListener('keydown', handleGlobalKeydown);
            overlay.remove();
        };

        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeOverlay();
                // Reset card UI to front if they abort
                document.getElementById('study-actions').classList.add('hidden');
                document.getElementById('study-flip-action').classList.remove('hidden');
                const inner = document.getElementById('flashcard-inner');
                if (inner) inner.classList.remove('flipped');
                return;
            }
            if (submitted && ['1','2','3','4'].includes(e.key)) {
                e.preventDefault();
                processRating(parseInt(e.key, 10));
                closeOverlay();
                renderStudyCard();
            }
        };
        document.addEventListener('keydown', handleGlobalKeydown);

        const qEl = overlay.querySelector('#fritext-question');
        qEl.innerHTML = questionHtml;
        renderLatex(qEl);

        const textarea = overlay.querySelector('#fritext-textarea');
        setTimeout(() => textarea.focus(), 100);

        const submitBtn = overlay.querySelector('#btn-fritext-submit');
        let submitted = false;

        const doSubmit = () => {
            if (submitted) return;
            submitted = true;

            const userText = textarea.value.trim();
            const keywords = extractKeywords(realAnswer);
            const userLower = userText.toLowerCase();
            const userWords = userText.split(/\s+/).map(w =>
                w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase()
            ).filter(w => w.length > 0);

            let matched = 0;
            keywords.forEach(kw => {
                kw.found = userWords.some(uw => fuzzyMatch(uw, kw.lower)) || userLower.includes(kw.lower);
                if (kw.found) matched++;
            });

            const total = keywords.length || 1;
            const pct = Math.round((matched / total) * 100);

            overlay.querySelector('#fritext-phase-write').classList.add('hidden');
            overlay.querySelector('#fritext-phase-compare').classList.remove('hidden');

            const scoreEl = overlay.querySelector('#fritext-score');
            scoreEl.textContent = `${pct}%`;
            scoreEl.style.color = pct >= 80 ? '#34A853' : pct >= 50 ? '#FBBC04' : '#EA4335';
            overlay.querySelector('#fritext-score-label').textContent = `${matched} av ${total} nyckelbegrepp`;

            const userAnswerEl = overlay.querySelector('#fritext-user-answer');
            userAnswerEl.textContent = userText || '(tomt)';

            const realAnswerEl = overlay.querySelector('#fritext-real-answer');
            const realHtml = studyBack.innerHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = realHtml;

            const highlightTextNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (!text.trim()) return;
                    const parent = node.parentNode;
                    const parts = text.split(/(\s+)/);
                    const fragment = document.createDocumentFragment();
                    parts.forEach(part => {
                        if (/^\s+$/.test(part)) {
                            fragment.appendChild(document.createTextNode(part));
                            return;
                        }
                        const clean = part.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase();
                        const kw = keywords.find(k => k.lower === clean);
                        if (kw) {
                            const span = document.createElement('span');
                            span.textContent = part;
                            if (kw.found) {
                                span.style.cssText = 'color:#85e8a5;font-weight:600;';
                            } else {
                                span.style.cssText = 'color:#ff8f8f;text-decoration:underline;text-decoration-style:wavy;text-underline-offset:3px;';
                            }
                            fragment.appendChild(span);
                        } else {
                            fragment.appendChild(document.createTextNode(part));
                        }
                    });
                    parent.replaceChild(fragment, node);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display'))) return;
                    Array.from(node.childNodes).forEach(highlightTextNode);
                }
            };
            highlightTextNode(tempDiv);
            realAnswerEl.innerHTML = tempDiv.innerHTML;
            renderLatex(realAnswerEl);

            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'cinema-study-actions';
            clonedActions.classList.remove('hidden');
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    processRating(parseInt(btn.getAttribute('data-rating')));
                    closeOverlay();
                    renderStudyCard();
                });
            });
            const cinemaActions = overlay.querySelector('#cinema-actions');
            cinemaActions.appendChild(clonedActions);
            cinemaActions.classList.add('visible');

            showToast(pct >= 80 ? 'Starkt! Du kom ihåg det mesta.' : pct >= 50 ? 'Halvvägs där. Läs igenom det du missade.' : 'Repetera detta kort extra.');
        };

        submitBtn.addEventListener('click', doSubmit);
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitted) {
                e.preventDefault();
                doSubmit();
            }
        });
    };

    if (flashcardDiv) flashcardDiv.addEventListener('click', flipCard);
    if (flipBtn) flipBtn.addEventListener('click', flipCard);

    const skipBtn = document.getElementById('btn-skip');
    if (skipBtn) {
        skipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const flashcardContainer = document.querySelector('.flashcard');
            flashcardContainer.classList.add('swipe-left');
            setTimeout(() => {
                flashcardContainer.classList.remove('swipe-left');
                currentStudyIndex++;
                renderStudyCard();
            }, 300);
        });
    }

    // Rating Buttons
    document.querySelectorAll('.btn-rate').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rating = parseInt(btn.getAttribute('data-rating'));
            processRating(rating);
        });
    });

    // Keyboard shortcuts for study: Space/Enter to flip, 1-4 to rate
    document.addEventListener('keydown', (e) => {
        if (currentViewName !== 'study') return;
        if (playgroundMode) return; // Ignore standard study keyboard shortcuts when in a playground mode game
        // Don't intercept if user is typing in the AI input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if ((e.key === ' ' || e.key === 'Enter') && !document.getElementById('study-flip-action').classList.contains('hidden')) {
            e.preventDefault();
            flipCard();
        } else if (e.key === 's' && !document.getElementById('study-flip-action').classList.contains('hidden')) {
            e.preventDefault();
            document.getElementById('btn-skip')?.click();
        } else if (['1','2','3','4'].includes(e.key) && !document.getElementById('study-actions').classList.contains('hidden')) {
            e.preventDefault();
            processRating(parseInt(e.key));
        }
    });

// --- FRITEXT SESSION OVERLAY ---
const fritextSessionReveal = () => {
    const cards = currentStudyCards;
    let cardIdx = 0;
    let totalScore = 0;
    let totalKeywords = 0;
    let totalMatched = 0;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'radial-gradient(ellipse at center, #1b0035 0%, #0d001f 60%, #050010 100%)';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const extractKeywords = (text) => {
        const stopWords = new Set(['och','i','på','av','en','ett','den','det','de','är','var','som','med','för','till','att','har','kan','ska','inte','om','vid','från','eller','men','denna','dessa','sin','sitt','sina','han','hon','vi','ni','dem','sig','alla','andra','efter','under','över','mellan','utan','bara','mer','så','också','redan','genom','sedan','dock','även','mot','hos','ur','bland','inom','samt','vars','där','här','hur','när','vad','vem','vilken','vilket','vilka']);
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/).filter(w => w.length > 0);
        const keywords = [];
        words.forEach(w => {
            const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]…–—]/g, '').trim();
            if (clean.length >= 3 && !stopWords.has(clean.toLowerCase())) {
                keywords.push({ original: w, lower: clean.toLowerCase(), found: false, score: clean.length });
            }
        });
        keywords.sort((a, b) => b.score - a.score);
        return keywords.slice(0, Math.max(5, Math.ceil(keywords.length * 0.3)));
    };

    const fuzzyMatch = (input, target) => {
        if (input === target) return true;
        if (input.length < 3 || target.length < 3) return input === target;
        if (Math.abs(input.length - target.length) > 2) return false;
        let dist = 0;
        for (let i = 0; i < Math.max(input.length, target.length); i++) {
            if (input[i] !== target[i]) dist++;
            if (dist > 2) return false;
        }
        return true;
    };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];
        const realAnswer = stripHtml(card.back || '');
        const sentences = realAnswer.split(/[.!?\n]+/).filter(s => s.trim().length > 5);
        const wordCount = realAnswer.split(/\s+/).length;
        const hintText = `Cirka ${wordCount} ord, ${Math.max(1, sentences.length)} ${sentences.length === 1 ? 'mening' : 'meningar'}`;

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="color:#A855F7;">FRITEXT</span>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(168,85,247,0.6);font-weight:700;">Fråga</div>
                <div id="ft-question" style="font-size:1.2rem;font-weight:600;color:#fff;text-align:center;line-height:1.4;width:100%;padding:0.75rem;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);font-style:italic;">${hintText}</div>
                <textarea id="ft-textarea" placeholder="Skriv ditt svar här..." style="width:100%;min-height:120px;max-height:30vh;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:inherit;font-size:1rem;line-height:1.5;padding:0.75rem;outline:none;resize:vertical;" spellcheck="false"></textarea>
                <button id="ft-submit" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;">Visa svar ⌘↵</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        renderLatex(overlay.querySelector('#ft-question'));
        const textarea = overlay.querySelector('#ft-textarea');
        setTimeout(() => textarea.focus(), 100);

        let submitted = false;
        const doSubmit = () => {
            if (submitted) return;
            submitted = true;

            const userText = textarea.value.trim();
            const keywords = extractKeywords(realAnswer);
            const userLower = userText.toLowerCase();
            const userWords = userText.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"""'':\[\]]/g, '').trim().toLowerCase()).filter(w => w.length > 0);

            let matched = 0;
            keywords.forEach(kw => {
                kw.found = userWords.some(uw => fuzzyMatch(uw, kw.lower)) || userLower.includes(kw.lower);
                if (kw.found) matched++;
            });
            const total = keywords.length || 1;
            const pct = Math.round((matched / total) * 100);
            totalScore += pct;
            totalKeywords += total;
            totalMatched += matched;

            if (pct >= 50) playgroundSessionStats.correct++;
            else playgroundSessionStats.again++;

            const kwHtml = keywords.map(kw => `<span style="display:inline-block;padding:0.2rem 0.5rem;border-radius:6px;font-size:0.8rem;font-weight:600;margin:0.15rem;${kw.found ? 'background:rgba(52,168,83,0.2);color:#34A853;border:1px solid rgba(52,168,83,0.3);' : 'background:rgba(234,67,53,0.1);color:rgba(234,67,53,0.7);border:1px solid rgba(234,67,53,0.2);'}">${escapeHtml(kw.original)}</span>`).join('');

            const content = overlay.querySelector('.cinema-content');
            content.innerHTML = `
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="font-size:1.3rem;font-weight:800;color:${pct >= 80 ? '#34A853' : pct >= 50 ? '#FBBC04' : '#EA4335'};">${pct}%</span>
                </div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);">${matched} av ${total} nyckelbegrepp</div>
                <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.1rem;width:100%;">${kwHtml}</div>
                <div style="width:100%;">
                    <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Ditt svar</div>
                    <div style="font-size:0.95rem;color:rgba(255,255,255,0.7);line-height:1.5;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;white-space:pre-wrap;">${escapeHtml(userText || '(tomt)')}</div>
                </div>
                <div style="width:100%;">
                    <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Rätt svar</div>
                    <div id="ft-real" style="font-size:0.95rem;color:#fff;line-height:1.5;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                </div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);font-style:italic;">Klicka eller [Space] → nästa kort</div>
            `;
            const realEl = overlay.querySelector('#ft-real');
            renderLatex(realEl);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(realEl, card.backImages);

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showCard();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#ft-submit').onclick = doSubmit;
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitted) { e.preventDefault(); doSubmit(); }
        });
    };

    const showEnd = () => {
        cleanup();
        const avgPct = cards.length > 0 ? Math.round(totalScore / cards.length) : 0;
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Russo One','Impact',sans-serif;font-size:2.2rem;color:#A855F7;margin:0;">KLART!</h2>
            <div class="sd-stats-grid" style="width:100%;max-width:400px;">
                <div class="sd-stat-row"><span class="sd-stat-label">Kort</span><span class="sd-stat-value">${cards.length}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Nyckelbegrepp</span><span class="sd-stat-value">${totalMatched} / ${totalKeywords}</span></div>
                <div class="sd-stat-row sd-stat-highlight"><span class="sd-stat-label">Snittresultat</span><span class="sd-stat-value">${avgPct}%</span></div>
            </div>
            <div class="sd-end-actions"><button id="ft-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#ft-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};

// --- JEOPARDY OVERLAY ---
const jeopardyReveal = () => {
    const cards = currentStudyCards;
    let cardIdx = 0;

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'radial-gradient(ellipse at center, #001050 0%, #000820 60%, #000510 100%)';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.25rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>${cardIdx + 1} / ${cards.length}</span>
                    <span style="color:#FBBC04;">JEOPARDY</span>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(251,188,4,0.6);font-weight:700;">Svaret är:</div>
                <div id="jp-answer" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.5;width:100%;padding:1.25rem;background:rgba(251,188,4,0.06);border:1px solid rgba(251,188,4,0.2);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size:0.85rem;color:rgba(255,255,255,0.35);font-style:italic;">Vad är frågan? Tänk efter, klicka sedan för att avslöja.</div>
                <button id="jp-reveal-btn" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;">Visa frågan [Space]</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        const ansEl = overlay.querySelector('#jp-answer');
        renderLatex(ansEl);
        if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages);

        const revealQuestion = () => {
            const btn = overlay.querySelector('#jp-reveal-btn');
            if (!btn) return;
            btn.remove();
            const hint = overlay.querySelector('.cinema-content div[style*="font-style:italic"]');
            if (hint) hint.remove();

            const qDiv = document.createElement('div');
            qDiv.style.cssText = 'width:100%;text-align:center;';
            qDiv.innerHTML = `
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(52,168,83,0.7);font-weight:700;margin-bottom:0.5rem;">Frågan var:</div>
                <div id="jp-question" style="font-size:1.2rem;color:#fff;line-height:1.5;padding:1rem;background:rgba(52,168,83,0.06);border:1px solid rgba(52,168,83,0.2);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);margin-top:0.75rem;font-style:italic;">[Space] nästa kort</div>
            `;
            overlay.querySelector('.cinema-content').appendChild(qDiv);
            renderLatex(qDiv);

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                if (e.target && e.target.closest && e.target.closest('button')) return;
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showCard();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#jp-reveal-btn').onclick = revealQuestion;
        const revealKH = (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', revealKH); revealQuestion(); }
        };
        document.addEventListener('keydown', revealKH);
    };

    const showEnd = () => {
        cleanup();
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Bebas Neue','Impact',sans-serif;font-size:2.5rem;color:#FBBC04;margin:0;">KLART!</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;">${cards.length} kort omvänt repeterade.</p>
            <div class="sd-end-actions"><button id="jp-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#jp-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};

// --- DAMMIGA KORT OVERLAY ---
const dammigaReveal = () => {
    const cards = currentStudyCards;
    let cardIdx = 0;
    const now = Date.now();

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'radial-gradient(ellipse at center, #1a1200 0%, #100c00 60%, #0a0800 100%)';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => { document.removeEventListener('keydown', globalKH); };
    const closeGame = () => { cleanup(); overlay.remove(); finishPlaygroundSession(); };

    const timeSince = (ts) => {
        if (!ts) return 'Aldrig repeterad';
        const days = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
        if (days === 0) return 'Idag';
        if (days === 1) return '1 dag sedan';
        if (days < 30) return `${days} dagar sedan`;
        const months = Math.floor(days / 30);
        return months === 1 ? '1 månad sedan' : `${months} månader sedan`;
    };

    const showCard = () => {
        if (cardIdx >= cards.length) { showEnd(); return; }
        const card = cards[cardIdx];

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;">
                <div style="display:flex;justify-content:space-between;width:100%;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                    <span>Uppfriskat ${cardIdx} / ${cards.length}</span>
                    <span style="color:#C5A059;">Senast: ${timeSince(card.lastReviewed)}</span>
                </div>
                <div style="width:100%;height:4px;background:rgba(197,160,89,0.15);border-radius:2px;overflow:hidden;">
                    <div style="width:${(cardIdx / cards.length) * 100}%;height:100%;background:#C5A059;border-radius:2px;transition:width 0.3s ease;"></div>
                </div>
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(197,160,89,0.6);font-weight:700;">Fråga</div>
                <div id="dm-question" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.5;width:100%;padding:1rem;background:rgba(197,160,89,0.05);border:1px solid rgba(197,160,89,0.15);border-radius:12px;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <button id="dm-flip-btn" class="btn primary" style="width:100%;max-width:300px;padding:0.75rem;border-radius:10px;font-weight:700;background:#C5A059;border-color:#C5A059;">Visa svar [Space]</button>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        renderLatex(overlay.querySelector('#dm-question'));

        const flipToAnswer = () => {
            const btn = overlay.querySelector('#dm-flip-btn');
            if (!btn) return;
            btn.remove();

            const content = overlay.querySelector('.cinema-content');
            const ansDiv = document.createElement('div');
            ansDiv.style.cssText = 'width:100%;text-align:center;';
            ansDiv.innerHTML = `
                <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:rgba(52,168,83,0.7);font-weight:700;margin-bottom:0.5rem;">Svar</div>
                <div id="dm-answer" style="font-size:1.1rem;color:#fff;line-height:1.5;padding:1rem;background:rgba(52,168,83,0.06);border:1px solid rgba(52,168,83,0.15);border-radius:12px;text-align:left;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
            `;
            content.appendChild(ansDiv);
            const ansEl = ansDiv.querySelector('#dm-answer');
            renderLatex(ansEl);
            if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages);

            // Rating buttons
            const ratingDiv = document.createElement('div');
            ratingDiv.id = 'dm-rating';
            const originalActions = document.getElementById('study-actions');
            const clonedActions = originalActions.cloneNode(true);
            clonedActions.id = 'dm-study-actions';
            clonedActions.classList.remove('hidden');
            clonedActions.querySelectorAll('.btn-rate').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const rating = parseInt(btn.getAttribute('data-rating'), 10);
                    currentStudyIndex = cardIdx;
                    processRating(rating);
                    if (rating === 1) playgroundSessionStats.again++;
                    else playgroundSessionStats.correct++;
                    cardIdx++;
                    showCard();
                });
            });
            ratingDiv.appendChild(clonedActions);
            content.appendChild(ratingDiv);

            // Keyboard rating
            const rateKH = (e) => {
                if (['1','2','3','4'].includes(e.key)) {
                    e.preventDefault();
                    document.removeEventListener('keydown', rateKH);
                    const rating = parseInt(e.key, 10);
                    currentStudyIndex = cardIdx;
                    processRating(rating);
                    if (rating === 1) playgroundSessionStats.again++;
                    else playgroundSessionStats.correct++;
                    cardIdx++;
                    showCard();
                }
            };
            document.addEventListener('keydown', rateKH);
        };

        overlay.querySelector('#dm-flip-btn').onclick = flipToAnswer;
        const flipKH = (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', flipKH); flipToAnswer(); }
        };
        document.addEventListener('keydown', flipKH);
    };

    const showEnd = () => {
        cleanup();
        overlay.querySelector('.cinema-content').innerHTML = `
            <h2 style="font-family:'Special Elite',Georgia,serif;font-size:2.2rem;color:#C5A059;margin:0;">Alla kort uppfriskas!</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;">${cards.length} bortglömda kort repeterade.</p>
            <div class="sd-end-actions"><button id="dm-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button></div>
        `;
        overlay.querySelector('#dm-exit').onclick = closeGame;
        const endKH = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); } };
        document.addEventListener('keydown', endKH);
    };

    const globalKH = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeGame(); } };
    document.addEventListener('keydown', globalKH);
    showCard();
};

// --- SUDDEN DEATH OVERLAY ---
const suddenDeathReveal = (allCards) => {
    const cards = currentStudyCards;
    const startTimeSession = Date.now();
    
    // Score & gamification state
    let score = 0;
    let streak = 0;
    let maxStreak = 0;
    let lives = 3;
    let cardIdx = 0;
    let correctCount = 0;
    let gameOverActive = false;
    let isIntro = true;
    let answered = false;
    let mistakes = [];
    let speedBonusCount = 0;
    let lateSaveCount = 0;
    
    // Auto-advance skip hook
    let advanceTimeout = null;

    // Timer handles
    let timerHandle = null;
    let timerRAF = null;

    // Visual key feedback handlers (declared here so cleanup() can reference them)
    let pressKeyHandler = null;
    let releaseKeyHandler = null;

    // Determine highscore key & title based on playground focus filter
    let pbKey = 'spaced_rep_sd_pb_all';
    let pbTitle = 'Hela biblioteket';
    if (playgroundFilterSource && playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        playgroundFilterSource.forEach(val => {
            const match = val.match(/^deck:([^:]+)/);
            if (match) deckIds.add(match[1]);
        });
        if (deckIds.size === 1) {
            const singleDeckId = Array.from(deckIds)[0];
            const deckObj = appData.decks.find(d => d.id === singleDeckId);
            pbKey = `spaced_rep_sd_pb_${singleDeckId}`;
            pbTitle = deckObj ? deckObj.title : 'Fokusområde';
        } else {
            pbKey = `spaced_rep_sd_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitle = 'Fokusområde';
        }
    }
    
    let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

    // Create container overlay
    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay pg-mode-suddendeath';
    overlay.style.background = 'radial-gradient(circle at center, #160214 0%, #06000d 80%, #000000 100%)';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '9999';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const cleanup = () => {
        clearTimeout(timerHandle);
        clearTimeout(advanceTimeout);
        cancelAnimationFrame(timerRAF);
        document.removeEventListener('keydown', keyHandler);
        document.removeEventListener('keydown', pressKeyHandler);
        document.removeEventListener('keyup', releaseKeyHandler);
        overlay.classList.remove('sd-urgent-pulse');
    };

    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const showFloatingFeedback = (text, type) => {
        const floatEl = document.createElement('div');
        floatEl.className = `sd-float-feedback ${type}`;
        floatEl.textContent = text;
        overlay.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1100);
    };

    const triggerConfetti = () => {
        const colors = ['#FFD700', '#FF4500', '#FF0080', '#00FF00', '#00FFFF', '#8A2BE2'];
        for (let i = 0; i < 60; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'sd-confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
            confetti.style.animationDelay = `${Math.random() * 1.5}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(confetti);
            setTimeout(() => confetti.remove(), 3500);
        }
    };

    // Keyboard shortcut handler
    const keyHandler = (e) => {
        if (isIntro) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                startGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
            return;
        }

        if (gameOverActive) {
            if (e.key === 'Enter') {
                e.preventDefault();
                restartGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
            return;
        }
        
        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }
        
        // If question is already answered, space/enter/click advances to next card immediately
        if (answered) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                advanceNext();
            }
            return;
        }
        
        if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex] && !buttons[optIndex].disabled) {
                    buttons[optIndex].click();
                }
            }
        }
    };
    document.addEventListener('keydown', keyHandler);

    // Global click-to-skip listener during answers
    overlay.addEventListener('mousedown', (e) => {
        if (answered && !gameOverActive && !isIntro) {
            // Ignore if they click an expanded mistake or something interactive
            if (e.target.closest('.sd-mistake-item') || e.target.closest('button')) return;
            advanceNext();
        }
    });

    // Handle button visual click feedback during keyboard events
    pressKeyHandler = (e) => {
        if (['1', '2', '3', '4'].includes(e.key) && !answered && !isIntro && !gameOverActive) {
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex]) {
                    buttons[optIndex].classList.add('pressed');
                }
            }
        }
    };
    document.addEventListener('keydown', pressKeyHandler);

    releaseKeyHandler = (e) => {
        if (['1', '2', '3', '4'].includes(e.key)) {
            const optIndex = parseInt(e.key, 10) - 1;
            const optContainer = overlay.querySelector('#sd-options');
            if (optContainer) {
                const buttons = optContainer.querySelectorAll('.sd-option-btn');
                if (buttons[optIndex]) {
                    buttons[optIndex].classList.remove('pressed');
                }
            }
        }
    };
    document.addEventListener('keyup', releaseKeyHandler);

    const advanceNext = () => {
        clearTimeout(advanceTimeout);
        cardIdx++;
        showCard();
    };

    const startGame = () => {
        isIntro = false;
        renderGameLayout();
        showCard();
    };

    const restartGame = () => {
        cleanup();
        
        // Shuffle fresh subset
        const freshCards = fisherYatesShuffle([...cards]);
        currentStudyCards = freshCards;
        
        score = 0;
        streak = 0;
        maxStreak = 0;
        lives = 3;
        cardIdx = 0;
        correctCount = 0;
        gameOverActive = false;
        isIntro = false;
        answered = false;
        mistakes = [];
        speedBonusCount = 0;
        lateSaveCount = 0;
        
        renderGameLayout();
        showCard();
    };

    const renderGameLayout = () => {
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.2rem;position:relative;">
                <!-- Top HUD -->
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:0.5rem; z-index: 5;">
                    <div id="sd-lives" style="display:flex;gap:0.4rem;font-size:1.8rem;transition:transform 0.2s ease;"></div>
                    <div style="display:flex; gap:1rem; font-size:0.95rem; font-weight:700; color:#fff; align-items:center;">
                        <span id="sd-pb" style="color:#FFD700; text-shadow:0 0 8px rgba(255,215,0,0.4); display:flex; align-items:center; gap:4px;">
                            Rekord: ${personalBest}
                        </span>
                        <span id="sd-card-progress" style="color:var(--text-secondary);">Kort ${cardIdx + 1} / ${cards.length}</span>
                    </div>
                </div>
                
                <!-- Timer Bar -->
                <div style="width:100%; display:flex; align-items:center; gap:0.75rem; z-index: 5;">
                    <div id="sd-timer-bar" style="flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;position:relative;">
                        <div id="sd-timer-fill" style="width:100%;height:100%;background:#00ffff;transform-origin:left;transform:scaleX(1);"></div>
                    </div>
                    <span id="sd-timer-text" style="font-family:monospace; font-size:1rem; font-weight:700; color:#00ffff; min-width:45px; text-align:right;">7.0s</span>
                </div>
                
                <!-- Score & Streak display -->
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; min-height:30px; z-index: 5;">
                    <span id="sd-score-hud" style="font-size:1.3rem; font-weight:900; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.15);">Poäng: 0</span>
                    <span id="sd-streak-hud" style="opacity:0; transition:all 0.2s ease;">
                        <div class="sd-combo-badge">
                            <span>Combo x<span id="sd-streak-count">0</span></span>
                        </div>
                    </span>
                </div>
                
                <!-- Question Area -->
                <div id="sd-question" style="font-size:1.4rem;font-weight:700;color:#fff;text-align:center;line-height:1.4;width:100%;margin:0.5rem 0;z-index: 5; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 1rem;"></div>
                
                <!-- Options Grid -->
                <div id="sd-options" style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;width:100%;z-index: 5;"></div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
    };

    const renderLives = () => {
        const container = overlay.querySelector('#sd-lives');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const heartSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            heartSvg.setAttribute('class', 'sd-heart-icon');
            heartSvg.setAttribute('viewBox', '0 0 24 24');
            heartSvg.innerHTML = `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`;
            
            if (i >= lives) {
                heartSvg.classList.add('lost');
                if (i === lives && answered) {
                    heartSvg.classList.add('shattered');
                }
            }
            container.appendChild(heartSvg);
        }
    };

    const stripHtmlForOption = (html) => {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').trim().substring(0, 120);
    };

    const showIntroScreen = () => {
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="sd-intro-screen">
                <div class="sd-crown-container">
                    <svg viewBox="0 0 24 24" width="60" height="60" fill="currentColor">
                        <path d="M2 22h20v-2H2v2zm1-3l2.5-9 4.5 4 2.5-10 2.5 10 4.5-4 2.5 9H3z"/>
                    </svg>
                </div>
                <h1 style="font-family:'Russo One', 'Impact', sans-serif; font-size:3rem; margin:0; color:#DC143C; text-shadow: 0 0 15px rgba(220,20,60,0.6), 2px 3px 0 #3a0008; letter-spacing:0.05em;">SUDDEN DEATH</h1>
                <div style="background: rgba(255, 215, 0, 0.08); border: 1px dashed #FFD700; padding: 0.75rem 1.5rem; border-radius: 12px; font-weight: 700; color: #FFD700; text-shadow: 0 0 6px rgba(255,215,0,0.3); font-size: 1.1rem;">
                    Rekord (${pbTitle}): ${personalBest} poäng
                </div>
                <p style="color: rgba(255,255,255,0.7); line-height: 1.6; font-size: 0.95rem; margin: 0;">
                    Välj rätt svar med <strong style="color:#fff;">[1] - [4]</strong>. Du har <strong style="color:#EA4335;">3 liv</strong>.<br>
                    Tiden tickar snabbare ju fler rätt du har!<br>
                    Vid fel visas rätt svar — studera det innan du fortsätter.
                </p>
                <div style="display:flex; flex-direction:column; gap:0.5rem; width:100%; align-items:center;">
                    <button id="sd-btn-start" class="btn primary" style="width: 100%; max-width: 250px; font-weight: 700; font-size: 1.1rem; padding: 0.9rem; border-radius: 10px;">STARTA UTMANINGEN</button>
                    <span style="font-size: 0.8rem; color: rgba(255,255,255,0.4); font-style: italic;">[Tryck på Space för att starta]</span>
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        overlay.querySelector('#sd-btn-start').onclick = startGame;
    };

    const showEndScreen = () => {
        cleanup();
        
        const isNewPB = score > personalBest;
        if (isNewPB) {
            personalBest = score;
            localStorage.setItem(pbKey, score);
        }
        
        // Sync stats to globally accessible playground session
        playgroundSessionStats.correct = score; 

        const isVictory = lives > 0 && cardIdx >= cards.length;
        const screenClass = isVictory ? 'victory' : '';
        const titleClass = isVictory ? 'victory' : 'gameover';
        const titleText = isVictory ? 'SEGER!' : 'SPELET SLUT';
        const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
        
        // Earned badges calculation
        const badges = [];
        if (speedBonusCount >= 5) {
            badges.push({
                text: 'Blixtsnabb',
                color: '#60A5FA',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#60A5FA"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34 1.2-2.11 3.03-5.34L13 3h1l-1 7h3.5c.49 0 .56.33.38.66l-4.5 8.34c-.18.33-.38.34-.38.34z"/></svg>`,
                desc: 'Svarade blixtsnabbt på 5+ kort'
            });
        }
        if (maxStreak >= 10) {
            badges.push({
                text: 'Streak-mästare',
                color: '#F59E0B',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#F59E0B"><path d="M12 23c4.97 0 9-4.03 9-9 0-2.12-.74-4.07-1.97-5.61L12.35 1c-.39-.4-.97-.3-1.09.26C10.74 3.76 8.44 6 5.86 8.62 3.42 11.08 2 13.9 2 17c0 3.31 2.69 6 6 6h4zm-3-9c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3-3-1.34-3-3z"/></svg>`,
                desc: 'Nådde en streak på 10+'
            });
        }
        if (lives === 3 && cardIdx > 0) {
            badges.push({
                text: 'Oslagbar',
                color: '#34A853',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#34A853"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`,
                desc: 'Förlorade inte ett enda liv'
            });
        }
        if (lateSaveCount >= 1) {
            badges.push({
                text: 'Sista sekunden',
                color: '#F87171',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#F87171"><path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6v6h12v-6h-.01L18 16l-4-4 4-4-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zM8 7.5V4h8v3.5l-4 4-4-4z"/></svg>`,
                desc: 'Svarade med under 0.5s kvar'
            });
        }
        if (badges.length === 0) {
            badges.push({
                text: 'Kämpe',
                color: '#A855F7',
                svg: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#A855F7"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
                desc: 'Kämpade väl under spelrundan'
            });
        }

        // Mistakes list HTML
        const mistakesHtml = mistakes.length > 0 ? `
            <div class="sd-mistakes-list">
                ${mistakes.map((m, idx) => `
                    <div class="sd-mistake-item" data-idx="${idx}">
                        <div class="sd-mistake-summary">
                            <span class="sd-mistake-index">#${idx + 1}</span>
                            <span class="sd-mistake-front-preview">${stripHtmlForOption(m.card.front)}</span>
                            <span class="sd-mistake-chevron">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5H7z"/></svg>
                            </span>
                        </div>
                        <div class="sd-mistake-detail hidden">
                            <div class="sd-mistake-detail-section">
                                <strong>Fråga</strong>
                                <div class="sd-mistake-text">${typeof safeParse === 'function' ? safeParse(m.card.front) : m.card.front}</div>
                            </div>
                            <div class="sd-mistake-detail-section">
                                <strong>Ditt svar</strong>
                                <div class="sd-mistake-text wrong-text">${m.userAnswer}</div>
                            </div>
                            <div class="sd-mistake-detail-section">
                                <strong>Rätt svar</strong>
                                <div class="sd-mistake-text correct-text" id="sd-mistake-correct-${idx}">${typeof safeParse === 'function' ? safeParse(m.card.back) : m.card.back}</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; opacity:0.8; height: 100%;">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="#FFD700"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <span style="font-weight:700; color:#fff;">Perfekt spelrunda!</span>
                <span style="font-size:0.85rem; color:rgba(255,255,255,0.5); text-align:center;">Du gjorde inga misstag alls. Imponerande!</span>
            </div>
        `;

        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="sd-end-layout">
                <!-- Left Screen: Stats & Badges -->
                <div class="sd-end-screen-left ${screenClass}">
                    <h2 class="sd-end-title ${titleClass}">${titleText}</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        ${isVictory ? 'Du överlevde alla korten!' : 'Du fick slut på liv.'}
                    </p>
                    
                    <div class="sd-stats-grid" style="margin: 0.5rem 0;">
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Besvarade kort</span>
                            <span class="sd-stat-value">${cardIdx} / ${cards.length}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Längsta streak</span>
                            <span class="sd-stat-value">${maxStreak}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Tid spelat</span>
                            <span class="sd-stat-value">⏱ ${timeSpent}s</span>
                        </div>
                        <div class="sd-stat-row sd-stat-highlight">
                            <span class="sd-stat-label">Slutpoäng</span>
                            <span class="sd-stat-value">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: rgba(255,215,0,0.12); border: 1px dashed #FFD700; border-radius: 8px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #FFD700; text-shadow: 0 0 4px rgba(255,215,0,0.2);">
                                 NYTT REKORD! 👑
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="opacity: 0.65;">
                                <span class="sd-stat-label">Rekord</span>
                                <span class="sd-stat-value">${personalBest}</span>
                            </div>
                        `}
                    </div>

                    <!-- Badges Row -->
                    <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:1rem; text-align:left;">
                        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.4); margin-bottom:0.5rem; text-align:center;">Intjänade utmärkelser</div>
                        <div class="sd-badges-list">
                            ${badges.map(b => `<div class="sd-badge-item" title="${b.desc}">${b.svg} <span>${b.text}</span></div>`).join('')}
                        </div>
                    </div>
                    
                    <div class="sd-end-actions" style="margin-top:0.5rem;">
                        <button id="sd-btn-restart" class="btn primary" style="border-radius:10px;">Spela igen</button>
                        <button id="sd-btn-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button>
                    </div>
                </div>

                <!-- Right Screen: Mistakes Review -->
                <div class="sd-end-screen-right">
                    <div style="font-size: 1.15rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>Granska dina misstag</span>
                        <span style="font-size: 0.8rem; color: #EA4335; background: rgba(234, 67, 53, 0.15); padding: 2px 8px; border-radius: 12px; font-weight: 600;">
                            ${mistakes.length} fel
                        </span>
                    </div>
                    ${mistakesHtml}
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        gameOverActive = true;
        
        const endLayout = overlay.querySelector('.sd-end-layout');
        
        // Mistakes details expand/collapse handler
        const mistakeItems = endLayout.querySelectorAll('.sd-mistake-item');
        mistakeItems.forEach(item => {
            item.addEventListener('click', () => {
                const detail = item.querySelector('.sd-mistake-detail');
                const isExpanded = item.classList.contains('expanded');
                
                // Collapse all others
                mistakeItems.forEach(other => {
                    other.classList.remove('expanded');
                    other.querySelector('.sd-mistake-detail').classList.add('hidden');
                });
                
                if (!isExpanded) {
                    item.classList.add('expanded');
                    detail.classList.remove('hidden');
                    
                    const idx = parseInt(item.getAttribute('data-idx'));
                    const m = mistakes[idx];
                    const correctTextEl = detail.querySelector(`#sd-mistake-correct-${idx}`);
                    if (correctTextEl && typeof renderCardBackImages === 'function') {
                        renderCardBackImages(correctTextEl, m.card.backImages);
                    }
                    renderLatex(detail);
                }
            });
        });

        overlay.querySelector('#sd-btn-restart').onclick = restartGame;
        overlay.querySelector('#sd-btn-exit').onclick = closeGame;
        
        if (isNewPB || isVictory) {
            triggerConfetti();
        }
    };

    const showCard = () => {
        if (cardIdx >= cards.length || lives <= 0) {
            showEndScreen();
            return;
        }

        clearTimeout(timerHandle);
        clearTimeout(advanceTimeout);
        cancelAnimationFrame(timerRAF);
        overlay.classList.remove('sd-urgent-pulse');

        answered = false;
        const card = cards[cardIdx];
        
        // Update HUD
        const cardProgressEl = overlay.querySelector('#sd-card-progress');
        const scoreHudEl = overlay.querySelector('#sd-score-hud');
        if (cardProgressEl) cardProgressEl.textContent = `Kort ${cardIdx + 1} / ${cards.length}`;
        if (scoreHudEl) scoreHudEl.textContent = `Poäng: ${score}`;
        
        const streakHud = overlay.querySelector('#sd-streak-hud');
        if (streakHud) {
            if (streak >= 2) {
                overlay.querySelector('#sd-streak-count').textContent = streak;
                streakHud.style.opacity = '1';
            } else {
                streakHud.style.opacity = '0';
            }
        }

        const qEl = overlay.querySelector('#sd-question');
        if (qEl) {
            qEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
            renderLatex(qEl);
        }
        
        const showFullAnswer = () => {
            if (!qEl) return;
            qEl.style.maxHeight = 'none';
            qEl.innerHTML = `
                <div style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.25rem; text-align: left;">Fråga:</div>
                <div style="font-size: 1.05rem; margin-bottom: 0.75rem; text-align: left; font-weight:600;">${typeof safeParse === 'function' ? safeParse(card.front) : card.front}</div>
                <div style="font-size: 0.9rem; color: #34A853; margin-bottom: 0.25rem; font-weight: 700; text-align: left;">Rätt svar:</div>
                <div id="sd-full-answer-text" style="font-size: 1.1rem; color: #fff; background: rgba(52, 168, 83, 0.08); border: 1px solid rgba(52, 168, 83, 0.2); padding: 0.75rem; border-radius: 8px; text-align: left;">
                    ${typeof safeParse === 'function' ? safeParse(card.back) : card.back}
                </div>
                <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.35); margin-top: 0.75rem; text-align: center; font-style: italic;">
                    [Space] fortsätt
                </div>
            `;
            const answerTextEl = qEl.querySelector('#sd-full-answer-text');
            if (answerTextEl && typeof renderCardBackImages === 'function') {
                renderCardBackImages(answerTextEl, card.backImages);
            }
            renderLatex(qEl);
        };
        
        const revealCorrectOption = (button) => {
            button.classList.add('sd-correct');
            const optTextEl = button.querySelector('.sd-opt-text');
            if (optTextEl) {
                optTextEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.back) : card.back;
                if (typeof renderCardBackImages === 'function') {
                    renderCardBackImages(optTextEl, card.backImages);
                }
                renderLatex(button);
            }
        };
        
        renderLives();

        const optContainer = overlay.querySelector('#sd-options');
        if (!optContainer) return;
        optContainer.style.display = 'grid';

        const correctAnswer = stripHtmlForOption(card.back);
        const sameSectionCards = card.sectionId
            ? allCards.filter(c => c.id !== card.id && c.sectionId === card.sectionId && stripHtmlForOption(c.back) !== correctAnswer)
            : [];
        const sameDeckCards = allCards.filter(c =>
            c.id !== card.id &&
            c.originalDeckId === card.originalDeckId &&
            stripHtmlForOption(c.back) !== correctAnswer &&
            !sameSectionCards.some(s => s.id === c.id)
        );
        const otherCards = allCards.filter(c =>
            c.id !== card.id &&
            stripHtmlForOption(c.back) !== correctAnswer &&
            !sameSectionCards.some(s => s.id === c.id) &&
            !sameDeckCards.some(s => s.id === c.id)
        );
        const wrongPool = [...fisherYatesShuffle(sameSectionCards), ...fisherYatesShuffle(sameDeckCards), ...fisherYatesShuffle(otherCards)];
        const seen = new Set();
        const wrongs = [];
        for (const c of wrongPool) {
            const txt = stripHtmlForOption(c.back);
            if (!seen.has(txt)) {
                seen.add(txt);
                wrongs.push(txt);
                if (wrongs.length === 3) break;
            }
        }
        while (wrongs.length < 3) wrongs.push('...');

        const options = fisherYatesShuffle([
            { text: correctAnswer, correct: true },
            { text: wrongs[0], correct: false },
            { text: wrongs[1], correct: false },
            { text: wrongs[2], correct: false },
        ]);

        optContainer.innerHTML = '';

        options.forEach((opt, optIdx) => {
            const btn = document.createElement('button');
            btn.className = 'sd-option-btn sd-option-entry';
            btn.style.animationDelay = `${optIdx * 50}ms`;
            btn.innerHTML = `<span class="sd-key-badge">${optIdx + 1}</span><span class="sd-opt-text"></span>`;
            btn.querySelector('.sd-opt-text').innerHTML = typeof safeParse === 'function' ? safeParse(opt.text) : opt.text;
            renderLatex(btn);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (answered) return;
                answered = true;
                
                clearTimeout(timerHandle);
                cancelAnimationFrame(timerRAF);
                overlay.classList.remove('sd-urgent-pulse');

                const responseTime = performance.now() - startTime;
                const remainingTimePct = Math.max(0, 1 - (performance.now() - startTime) / duration);

                if (opt.correct) {
                    revealCorrectOption(btn);
                    correctCount++;
                    streak++;
                    if (streak > maxStreak) maxStreak = streak;

                    // Score logic with streak multiplier and speed bonus
                    const multiplier = 1 + streak * 0.1;
                    let basePoints = 100;
                    let isSpeedBonus = false;
                    
                    if (responseTime < 1200) {
                        basePoints += 50;
                        isSpeedBonus = true;
                        speedBonusCount++;
                    }
                    if (remainingTimePct < 0.08) {
                        lateSaveCount++;
                    }

                    const gainedPoints = Math.round(basePoints * multiplier);
                    score += gainedPoints;

                    // Extra life check at streak of 10
                    if (streak === 10) {
                        if (lives < 3) {
                            lives++;
                            showFloatingFeedback('EXTRA LIV! 🛡️', 'streak');
                            renderLives();
                        } else {
                            showFloatingFeedback('COMBO x10! 🔥', 'streak');
                        }
                    } else if (streak >= 3) {
                        showFloatingFeedback(`COMBO x${streak}! 🔥`, 'streak');
                    } else {
                        showFloatingFeedback(isSpeedBonus ? `BLIXTSNABB! +${gainedPoints}` : `+${gainedPoints}`, 'correct');
                    }
                    
                    if (scoreHudEl) scoreHudEl.textContent = `Poäng: ${score}`;
                    showFullAnswer();
                    if (optContainer) optContainer.style.display = 'none';
                    advanceTimeout = setTimeout(() => advanceNext(), 2000);
                } else {
                    btn.classList.add('sd-wrong');
                    optContainer.querySelectorAll('.sd-option-btn').forEach(b => {
                        const originalIndex = Array.from(optContainer.children).indexOf(b);
                        if (options[originalIndex]?.correct) revealCorrectOption(b);
                    });
                    
                    streak = 0;
                    lives--;
                    
                    // Log mistake
                    mistakes.push({
                        card: card,
                        userAnswer: opt.text || '(tomt)',
                        correctAnswer: correctAnswer
                    });
                    
                    showFloatingFeedback('FEL! -1 💔', 'wrong');
                    renderLives();

                    // Flash screen & shake
                    overlay.classList.add('shake-active');
                    const flashOverlay = document.createElement('div');
                    flashOverlay.style.position = 'absolute';
                    flashOverlay.style.inset = '0';
                    flashOverlay.style.background = 'rgba(234, 67, 53, 0.2)';
                    flashOverlay.style.pointerEvents = 'none';
                    flashOverlay.style.zIndex = '99';
                    overlay.appendChild(flashOverlay);
                    
                    setTimeout(() => {
                        overlay.classList.remove('shake-active');
                        flashOverlay.remove();
                    }, 300);

                    showFullAnswer();
                }
            });
            optContainer.appendChild(btn);
        });

        // Setup dynamic countdown timer
        const fill = overlay.querySelector('#sd-timer-fill');
        const timerText = overlay.querySelector('#sd-timer-text');
        if (fill) {
            fill.style.transition = 'none';
            fill.style.transform = 'scaleX(1)';
            fill.style.backgroundColor = '#00ffff';
            fill.style.setProperty('--timer-glow', '#00ffff');
        }

        // Timer duration scales down as correct count increases (down to 3.5s from 7.0s)
        const duration = Math.max(3500, 7000 - correctCount * 100);
        const startTime = performance.now();

        const animateTimer = (now) => {
            if (answered) return;
            const elapsed = now - startTime;
            const pct = Math.max(0, 1 - elapsed / duration);
            if (fill) fill.style.transform = `scaleX(${pct})`;
            
            const remainingSecs = (pct * (duration / 1000)).toFixed(1);
            if (timerText) {
                timerText.textContent = `${remainingSecs}s`;
            }

            if (pct <= 0.33) {
                if (fill) {
                    fill.style.backgroundColor = '#ff2200';
                    fill.style.setProperty('--timer-glow', '#ff2200');
                }
                if (timerText) timerText.style.color = '#ff2200';
                overlay.classList.add('sd-urgent-pulse');
            } else if (pct <= 0.66) {
                if (fill) {
                    fill.style.backgroundColor = '#ffaa00';
                    fill.style.setProperty('--timer-glow', '#ffaa00');
                }
                if (timerText) timerText.style.color = '#ffaa00';
            } else {
                if (fill) {
                    fill.style.backgroundColor = '#00ffff';
                    fill.style.setProperty('--timer-glow', '#00ffff');
                }
                if (timerText) timerText.style.color = '#00ffff';
                overlay.classList.remove('sd-urgent-pulse');
            }

            if (pct > 0) {
                timerRAF = requestAnimationFrame(animateTimer);
            }
        };
        timerRAF = requestAnimationFrame(animateTimer);

        timerHandle = setTimeout(() => {
            if (answered) return;
            answered = true;
            cancelAnimationFrame(timerRAF);
            overlay.classList.remove('sd-urgent-pulse');
            
            lives--;
            streak = 0;
            
            // Log mistake
            mistakes.push({
                card: card,
                userAnswer: '(Tiden ute)',
                correctAnswer: correctAnswer
            });
            
            showFloatingFeedback('TIDEN UTE! -1 💔', 'wrong');
            renderLives();

            optContainer.querySelectorAll('.sd-option-btn').forEach(b => {
                const originalIndex = Array.from(optContainer.children).indexOf(b);
                if (options[originalIndex]?.correct) revealCorrectOption(b);
            });
            
            showFullAnswer();
            
            // Shake and red flash
            overlay.classList.add('shake-active');
            const flashOverlay = document.createElement('div');
            flashOverlay.style.position = 'absolute';
            flashOverlay.style.inset = '0';
            flashOverlay.style.background = 'rgba(234, 67, 53, 0.2)';
            flashOverlay.style.pointerEvents = 'none';
            flashOverlay.style.zIndex = '99';
            overlay.appendChild(flashOverlay);

            setTimeout(() => {
                overlay.classList.remove('shake-active');
                flashOverlay.remove();
            }, 300);
        }, duration);
    };

    showIntroScreen();
};

// --- TRANSPORTBANDET OVERLAY ---
const transportbandetReveal = () => {
    // Determine the top 4 section titles (by card count) from the candidate pool
    const allCandidates = currentStudyCards;
    const sectionCountMap = {};
    allCandidates.forEach(c => {
        sectionCountMap[c._sectionTitle] = (sectionCountMap[c._sectionTitle] || 0) + 1;
    });
    const sectionTitles = Object.entries(sectionCountMap)
        .sort((a, b) => b[1] - a[1])  // most cards first for a richer game
        .slice(0, 4)
        .map(([title]) => title);

    // Only keep cards that belong to one of the chosen categories
    const filteredPool = allCandidates.filter(c => sectionTitles.includes(c._sectionTitle));
    let cards = fisherYatesShuffle(filteredPool).slice(0, 20);
    
    const startTimeSession = Date.now();
    
    // State variables
    let cardIdx = 0;
    let score = 0;
    let streak = 0;
    let maxStreak = 0;
    let lives = 3;
    let correctCount = 0;
    let baseSpeed = 2.8; // seconds for full drop
    let fallingRAF = null;
    let activeBinIdx = 0;
    let gameActive = false; // Starts as false (intro screen)
    let gameOverActive = false;
    let dropped = false;
    
    // Determine highscore key & title based on playground focus filter
    let pbKey = 'spaced_rep_tb_pb_all';
    let pbTitle = 'Hela biblioteket';
    if (playgroundFilterSource && playgroundFilterSource.size > 0) {
        const deckIds = new Set();
        playgroundFilterSource.forEach(val => {
            const match = val.match(/^deck:([^:]+)/);
            if (match) deckIds.add(match[1]);
        });
        if (deckIds.size === 1) {
            const singleDeckId = Array.from(deckIds)[0];
            const deckObj = appData.decks.find(d => d.id === singleDeckId);
            pbKey = `spaced_rep_tb_pb_${singleDeckId}`;
            pbTitle = deckObj ? deckObj.title : 'Fokusområde';
        } else {
            pbKey = `spaced_rep_tb_pb_focus_${Array.from(deckIds).sort().join('_')}`;
            pbTitle = 'Fokusområde';
        }
    }
    
    let personalBest = parseInt(localStorage.getItem(pbKey) || '0', 10);

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'rgba(0, 5, 20, 0.97)';

    // Render Intro Screen initially
    overlay.innerHTML = `
        <div class="cinema-bar cinema-bar-top"></div>
        <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;position:relative;">
            <div class="tb-intro-card">
                <h2 class="tb-intro-title">TRANSPORTBANDET</h2>
                <p style="color: rgba(255,255,255,0.7); margin: 0; font-size: 0.95rem; line-height: 1.4;">
                    Sortera de fallande korten i rätt korgar i botten. Se upp för felaktiga placeringar!
                </p>
                
                <div style="width: 100%; text-align: left;">
                    <span style="font-size: 0.8rem; font-weight: 700; color: #60A5FA; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.5rem;">Kategorier i spel:</span>
                    <div class="tb-intro-categories">
                        ${sectionTitles.map((t, i) => {
                            const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                            const color = colors[i] || '#A78BFA';
                            return `
                                <div class="tb-intro-item">
                                    <span class="tb-category-dot" style="color: ${color}; background-color: ${color};"></span>
                                    <span class="tb-category-name">${t}</span>
                                    <span class="tb-category-key">${i + 1}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <div class="tb-intro-guide">
                    <strong>Kontroller:</strong><br/>
                    • <code>←</code> / <code>→</code> : Flytta korg-markering<br/>
                    • <code>↓</code> : Släpp kortet omedelbart<br/>
                    • <code>1</code>, <code>2</code>, <code>3</code>, <code>4</code> : Sortera direkt i korg 1-4
                </div>
                
                <button id="tb-btn-start" class="btn primary" style="width: 100%; padding: 0.9rem; font-weight: 600; font-size: 1rem; border-radius: 8px;">
                    Starta spelet
                </button>
            </div>
        </div>
        <div class="cinema-bar cinema-bar-bottom"></div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    let arena = null;
    let fallingCard = null;
    let bins = null;

    const renderLives = () => {
        const container = overlay.querySelector('#tb-lives');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const heart = document.createElement('span');
            heart.textContent = i < lives ? '' : '';
            heart.style.transition = 'transform 0.2s ease';
            if (i >= lives) {
                heart.style.opacity = '0.25';
                heart.style.transform = 'scale(0.8)';
            } else {
                heart.style.filter = 'drop-shadow(0 0 4px rgba(234,67,53,0.5))';
            }
            container.appendChild(heart);
        }
    };

    const showFloatingFeedback = (text, type) => {
        const floatEl = document.createElement('div');
        floatEl.className = `tb-float-feedback ${type}`;
        floatEl.textContent = text;
        overlay.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1000);
    };

    const triggerConfetti = () => {
        const colors = ['#FFD700', '#FF4500', '#FF0080', '#00FF00', '#00FFFF', '#8A2BE2'];
        for (let i = 0; i < 60; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'sd-confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.transform = `scale(${0.5 + Math.random() * 0.8})`;
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(confetti);
            setTimeout(() => confetti.remove(), 4000);
        }
    };

    const showEndScreen = () => {
        cleanup();
        overlay.classList.remove('cinema-overlay--game');
        
        const isNewPB = score > personalBest;

        if (isNewPB) {
            personalBest = score;
            localStorage.setItem(pbKey, score);
        }
        
        // Sync stats
        playgroundSessionStats.correct = score;

        const isVictory = lives > 0 && cardIdx >= cards.length;
        const screenClass = isVictory ? 'victory' : '';
        const titleClass = isVictory ? 'victory' : 'gameover';
        const titleText = isVictory ? 'SEGER!' : 'SPELET SLUT';
        
        const timeSpent = Math.round((Date.now() - startTimeSession) / 1000);
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1.5rem;position:relative;">
                <div class="tb-end-screen ${screenClass}">
                    <h2 class="tb-end-title ${titleClass}">${titleText}</h2>
                    <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 0.95rem;">
                        ${isVictory ? 'Du lyckades sortera alla korten!' : 'Alla liv tog slut.'}
                    </p>
                    
                    <div class="sd-stats-grid">
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Sorterade kort</span>
                            <span class="sd-stat-value">${cardIdx} / ${cards.length}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Längsta streak</span>
                            <span class="sd-stat-value"> ${maxStreak}</span>
                        </div>
                        <div class="sd-stat-row">
                            <span class="sd-stat-label">Tid spelat</span>
                            <span class="sd-stat-value">⏱ ${timeSpent}s</span>
                        </div>
                        <div class="sd-stat-row sd-stat-highlight">
                            <span class="sd-stat-label">Slutpoäng</span>
                            <span class="sd-stat-value">${score}</span>
                        </div>
                        ${isNewPB ? `
                            <div style="background: rgba(255,215,0,0.15); border: 1px dashed #FFD700; border-radius: 6px; padding: 0.5rem; font-size: 0.9rem; font-weight: 700; color: #FFD700; text-shadow: 0 0 4px rgba(255,215,0,0.2);">
                                 NYTT REKORD! 
                            </div>
                        ` : `
                            <div class="sd-stat-row" style="opacity: 0.7;">
                                <span class="sd-stat-label">Rekord (${pbTitle})</span>
                                <span class="sd-stat-value"> ${personalBest}</span>
                            </div>
                        `}
                    </div>
                    
                    <div class="sd-end-actions">
                        <button id="tb-btn-restart" class="btn primary">Spela igen</button>
                        <button id="tb-btn-exit" class="btn secondary">Avsluta</button>
                    </div>
                </div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        gameOverActive = true;
        document.addEventListener('keydown', onKeyDown);
        
        overlay.querySelector('#tb-btn-restart').onclick = restartGame;
        overlay.querySelector('#tb-btn-exit').onclick = closeGame;
        
        if (isNewPB || isVictory) {
            triggerConfetti();
        }
    };

    const restartGame = () => {
        cleanup();
        
        cards = fisherYatesShuffle(filteredPool).slice(0, 20);
        currentStudyCards = cards;
        
        cardIdx = 0;
        score = 0;
        streak = 0;
        maxStreak = 0;
        lives = 3;
        correctCount = 0;
        activeBinIdx = 0;
        gameActive = false;
        gameOverActive = false;
        dropped = false;
        
        startGame();
    };

    const cleanup = () => {
        cancelAnimationFrame(fallingRAF);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keydown', introKeyHandler);
    };
    
    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const introKeyHandler = (e) => {
        if (!gameActive && !gameOverActive) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                startGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
        }
    };
    document.addEventListener('keydown', introKeyHandler);

    const startGame = () => {
        gameActive = true;
        document.removeEventListener('keydown', introKeyHandler);
        overlay.classList.add('cinema-overlay--game');
        
        overlay.innerHTML = `
            <div class="cinema-bar cinema-bar-top"></div>
            <div class="tb-container">
                <div class="tb-header">
                    <div id="tb-lives" style="display:flex;gap:0.3rem;font-size:1.6rem; z-index: 5;"></div>
                    <div style="display:flex; gap:1.2rem; align-items:center; font-weight:700; z-index: 5;">
                        <span id="tb-pb" style="color:#FFD700; font-size:0.9rem;"> Rekord: ${personalBest}</span>
                        <span id="tb-score" class="tb-score" style="font-size:1.1rem;">Poäng: 0</span>
                        <span id="tb-progress" class="tb-progress">1 / ${cards.length}</span>
                    </div>
                </div>
                
                <div style="text-align: center; height: 25px; margin-top: -0.25rem; z-index: 5;">
                    <span id="tb-streak" class="tb-streak" style="font-weight:900; transition: opacity 0.2s ease;"></span>
                </div>
                
                <div id="tb-arena" class="tb-arena">
                    <div id="tb-falling-card" class="tb-falling-card"></div>
                </div>
                
                <div id="tb-bins" class="tb-bins">
                    ${sectionTitles.map((t, i) => {
                        const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                        const color = colors[i] || '#A78BFA';
                        return `
                        <div class="tb-bin${i === 0 ? ' tb-bin-active' : ''}" data-idx="${i}" style="--bin-color: ${color};" title="${t}">
                            <div style="display:flex; flex-direction:column; align-items:center; gap:0.4rem; width:100%;">
                                <span class="tb-bin-num" style="background:${color}20; color:${color}; border:1.5px solid ${color}; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800; flex-shrink:0;">${i + 1}</span>
                                <span class="tb-bin-label" style="color:${color};">${t}</span>
                            </div>
                        </div>
                    `}).join('')}
                </div>
                <div class="tb-controls-hint">← → Flytta &nbsp; ↓ Släpp &nbsp;|&nbsp; 1 - 4 Sortera direkt</div>
            </div>
            <div class="cinema-bar cinema-bar-bottom"></div>
        `;
        
        arena = overlay.querySelector('#tb-arena');
        fallingCard = overlay.querySelector('#tb-falling-card');
        bins = overlay.querySelectorAll('.tb-bin');
        
        document.addEventListener('keydown', onKeyDown);
        
        renderLives();
        dropCard();
    };

    const updateBinHighlight = () => {
        bins.forEach((b, i) => b.classList.toggle('tb-bin-active', i === activeBinIdx));
    };

    const dropCard = () => {
        if (cardIdx >= cards.length || lives <= 0) {
            showEndScreen();
            return;
        }

        dropped = false;
        const card = cards[cardIdx];
        
        fallingCard.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
        renderLatex(fallingCard);
        
        fallingCard.style.top = '0%';
        fallingCard.style.opacity = '1';
        fallingCard.className = 'tb-falling-card';

        const binWidth = 100 / sectionTitles.length;
        fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        fallingCard.style.transform = 'translateX(-50%)';

        updateBinHighlight();

        overlay.querySelector('#tb-progress').textContent = `${cardIdx + 1} / ${cards.length}`;
        overlay.querySelector('#tb-score').textContent = `Poäng: ${score}`;

        const streakEl = overlay.querySelector('#tb-streak');
        if (streak >= 2) {
            streakEl.textContent = ` ${streak} i rad`;
            streakEl.style.opacity = '1';
        } else {
            streakEl.style.opacity = '0';
        }

        // Falling speed increases as you score correct categories
        const dropDuration = Math.max(1.0, baseSpeed - correctCount * 0.08);
        const startTime = performance.now();

        const animateFall = (now) => {
            if (dropped) return;
            const elapsed = (now - startTime) / 1000;
            const pct = Math.min(1, elapsed / dropDuration);
            fallingCard.style.top = `${pct * 80}%`;

            if (pct >= 1) {
                handleLanding(card, true);
                return;
            }
            fallingRAF = requestAnimationFrame(animateFall);
        };
        fallingRAF = requestAnimationFrame(animateFall);

        const handleLanding = (c, isTimeout = false) => {
            if (dropped) return;
            dropped = true;
            cancelAnimationFrame(fallingRAF);

            const correctIdx = sectionTitles.indexOf(c._sectionTitle);
            const isCorrect = activeBinIdx === correctIdx;

            // Flip/Reveal the answer on the falling card
            fallingCard.innerHTML = typeof safeParse === 'function' ? safeParse(c.back) : c.back;
            renderLatex(fallingCard);
            fallingCard.classList.add('tb-revealed');
            
            // Center the card in the arena to prevent overflow/clipping of long text
            fallingCard.style.top = '40%';
            fallingCard.style.left = '50%';
            fallingCard.style.transform = 'translate(-50%, -50%)';

            if (isCorrect) {
                const multiplier = 1 + streak * 0.1;
                const gained = Math.round(10 * multiplier);
                score += gained;
                
                streak++;
                if (streak > maxStreak) maxStreak = streak;
                
                correctCount++;
                playgroundSessionStats.correct++;
                fallingCard.classList.add('tb-correct');
                bins[activeBinIdx].classList.add('tb-bin-flash-correct');
                showFloatingFeedback(`+${gained}`, 'correct');
            } else {
                streak = 0;
                lives--;
                playgroundSessionStats.again++;
                fallingCard.classList.add('tb-wrong');
                bins[activeBinIdx].classList.add('tb-bin-flash-wrong');
                if (correctIdx >= 0 && correctIdx < bins.length) {
                    bins[correctIdx].classList.add('tb-bin-flash-correct');
                }
                
                showFloatingFeedback(isTimeout ? 'MISSAD! -1 ' : '-1 ', 'wrong');
                renderLives();

                // Arena screen shake
                overlay.classList.add('shake-active');
                const flashOverlay = document.createElement('div');
                flashOverlay.style.position = 'absolute';
                flashOverlay.style.inset = '0';
                flashOverlay.style.background = 'rgba(234, 67, 53, 0.18)';
                flashOverlay.style.pointerEvents = 'none';
                flashOverlay.style.zIndex = '99';
                overlay.appendChild(flashOverlay);
                
                setTimeout(() => {
                    overlay.classList.remove('shake-active');
                    flashOverlay.remove();
                }, 300);
            }

            // Show correct category and wait for click/space to advance
            const correctLabel = sectionTitles[correctIdx] || '?';
            const hint = document.createElement('div');
            hint.style.cssText = 'position:absolute;bottom:8%;left:50%;transform:translateX(-50%);font-size:0.8rem;color:rgba(255,255,255,0.35);font-style:italic;z-index:10;white-space:nowrap;';
            hint.textContent = `${isCorrect ? '✓' : '✗'} Rätt mapp: ${correctLabel} — [Space] fortsätt`;
            arena.appendChild(hint);

            let tbAdvanced = false;
            const tbAdvanceHandler = (e) => {
                if (tbAdvanced) return;
                if (e.type === 'keydown') {
                    if (e.key !== ' ' && e.key !== 'Enter') return;
                    e.preventDefault();
                }
                if (e.target && e.target.closest && e.target.closest('button')) return;
                tbAdvanced = true;
                overlay.removeEventListener('mousedown', tbAdvanceHandler);
                document.removeEventListener('keydown', tbAdvanceHandler);
                hint.remove();
                bins.forEach(b => { b.classList.remove('tb-bin-flash-correct', 'tb-bin-flash-wrong'); });
                cardIdx++;
                dropCard();
            };
            overlay.addEventListener('mousedown', tbAdvanceHandler);
            document.addEventListener('keydown', tbAdvanceHandler);
        };

        overlay._handleLanding = (c) => handleLanding(c);
    };

    const onKeyDown = (e) => {
        if (gameOverActive) {
            if (e.key === 'Enter') {
                e.preventDefault();
                restartGame();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeGame();
            }
            return;
        }

        if (!gameActive) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            closeGame();
            return;
        }

        if (dropped) return;

        const card = cards[cardIdx];

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            activeBinIdx = Math.max(0, activeBinIdx - 1);
            updateBinHighlight();
            const binWidth = 100 / sectionTitles.length;
            fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            activeBinIdx = Math.min(sectionTitles.length - 1, activeBinIdx + 1);
            updateBinHighlight();
            const binWidth = 100 / sectionTitles.length;
            fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (overlay._handleLanding) overlay._handleLanding(card);
        } else if (['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const binIndex = parseInt(e.key, 10) - 1;
            if (binIndex >= 0 && binIndex < sectionTitles.length) {
                activeBinIdx = binIndex;
                updateBinHighlight();
                const binWidth = 100 / sectionTitles.length;
                fallingCard.style.left = `${activeBinIdx * binWidth + binWidth / 2}%`;
                if (overlay._handleLanding) overlay._handleLanding(card);
            }
        }
    };

    // Skip intro, go straight into game
    startGame();
};

// --- DRAGKAMPEN OVERLAY ---
const dragkampenReveal = (allCards) => {
    const cards = currentStudyCards;
    let meterValue = 0;
    let cardIdx = 0;
    let correctCount = 0;
    let driftTimer = null;
    let driftPaused = false;
    const startTime = Date.now();

    const overlay = document.createElement('div');
    overlay.id = 'cinema-overlay';
    overlay.className = 'cinema-overlay';
    overlay.style.background = 'rgba(10, 5, 0, 0.97)';

    overlay.innerHTML = `
        <div class="cinema-bar cinema-bar-top"></div>
        <div class="cinema-content" style="width:90%;max-width:700px;display:flex;flex-direction:column;align-items:center;gap:1rem;position:relative;">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center;font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.5);">
                <span id="dk-progress">Kort 1 / ${cards.length}</span>
                <span id="dk-drift-warn" style="color:#F59E0B;opacity:0;transition:opacity 0.3s ease;">Datorn drar...</span>
            </div>
            <div class="dk-meter-labels">
                <span class="dk-label-cpu">Dator</span>
                <span class="dk-label-player">Du</span>
            </div>
            <div class="dk-meter-track">
                <div id="dk-meter-fill-neg" class="dk-meter-fill-neg"></div>
                <div id="dk-meter-fill-pos" class="dk-meter-fill-pos"></div>
                <div id="dk-meter-cursor" class="dk-meter-cursor"></div>
            </div>
            <div id="dk-question" style="font-size:1.3rem;font-weight:700;color:#fff;text-align:center;line-height:1.4;width:100%;"></div>
            <div id="dk-claim" style="font-size:1.05rem;color:#ccc;text-align:center;line-height:1.4;padding:0.75rem 1rem;background:rgba(255,255,255,0.05);border-radius:var(--radius-md);width:100%;"></div>
            <div id="dk-buttons" class="dk-buttons">
                <button id="dk-false" class="dk-btn dk-btn-false">← Falskt</button>
                <button id="dk-true" class="dk-btn dk-btn-true">Sant →</button>
            </div>
            <div id="dk-answer-area" style="display:none;width:100%;text-align:center;"></div>
        </div>
        <div class="cinema-bar cinema-bar-bottom"></div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const updateMeter = () => {
        const pct = (meterValue + 100) / 200;
        const cursor = overlay.querySelector('#dk-meter-cursor');
        if (cursor) cursor.style.left = `${pct * 100}%`;
        const negFill = overlay.querySelector('#dk-meter-fill-neg');
        const posFill = overlay.querySelector('#dk-meter-fill-pos');
        if (!negFill || !posFill) return;
        if (meterValue < 0) {
            negFill.style.width = `${Math.abs(meterValue) / 2}%`;
            negFill.style.right = '50%';
            posFill.style.width = '0%';
        } else {
            posFill.style.width = `${meterValue / 2}%`;
            posFill.style.left = '50%';
            negFill.style.width = '0%';
        }
    };

    const cleanup = () => {
        clearInterval(driftTimer);
        document.removeEventListener('keydown', globalKeyHandler);
    };

    const closeGame = () => {
        cleanup();
        overlay.remove();
        finishPlaygroundSession();
    };

    const showEndScreen = (won) => {
        cleanup();
        playgroundSessionStats._dragkampenWon = won;
        const timeSpent = Math.round((Date.now() - startTime) / 1000);
        const content = overlay.querySelector('.cinema-content');
        content.innerHTML = `
            <h2 style="font-family:'Bangers',cursive;font-size:2.8rem;color:${won ? '#34A853' : '#EA4335'};text-shadow:0 0 20px ${won ? 'rgba(52,168,83,0.4)' : 'rgba(234,67,53,0.4)'};margin:0;">${won ? 'DU VANN!' : 'DATORN VANN'}</h2>
            <p style="color:rgba(255,255,255,0.6);margin:0;font-size:0.95rem;">${won ? 'Du drog markören till din sida!' : 'Datorn drog ifrån dig.'}</p>
            <div class="sd-stats-grid" style="width:100%;max-width:400px;">
                <div class="sd-stat-row"><span class="sd-stat-label">Besvarade kort</span><span class="sd-stat-value">${cardIdx} / ${cards.length}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Rätt svar</span><span class="sd-stat-value">${correctCount}</span></div>
                <div class="sd-stat-row"><span class="sd-stat-label">Tid</span><span class="sd-stat-value">${timeSpent}s</span></div>
                <div class="sd-stat-row sd-stat-highlight"><span class="sd-stat-label">Slutposition</span><span class="sd-stat-value">${meterValue > 0 ? '+' : ''}${meterValue}</span></div>
            </div>
            <div class="sd-end-actions">
                <button id="dk-btn-exit" class="btn secondary" style="border-radius:10px;">Avsluta</button>
            </div>
        `;
        overlay.querySelector('#dk-btn-exit').onclick = closeGame;
        const endKH = (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', endKH); closeGame(); }
        };
        document.addEventListener('keydown', endKH);
    };

    let roundKeyHandler = null;

    const showRound = () => {
        if (meterValue >= 100) { showEndScreen(true); return; }
        if (meterValue <= -100) { showEndScreen(false); return; }
        if (cardIdx >= cards.length) { showEndScreen(meterValue > 0); return; }

        driftPaused = false;
        const card = cards[cardIdx];
        const isCorrectAnswer = Math.random() < 0.5;

        const randomOther = !isCorrectAnswer ? (() => {
            const sameDeck = allCards.filter(c => c.id !== card.id && c.originalDeckId === card.originalDeckId);
            const pool = sameDeck.length > 0 ? sameDeck : allCards.filter(c => c.id !== card.id);
            return pool[Math.floor(Math.random() * pool.length)];
        })() : null;
        const rawClaim = isCorrectAnswer ? card.back : (randomOther ? randomOther.back : card.back);

        const progressEl = overlay.querySelector('#dk-progress');
        if (progressEl) progressEl.textContent = `Kort ${cardIdx + 1} / ${cards.length}`;

        const qEl = overlay.querySelector('#dk-question');
        qEl.innerHTML = typeof safeParse === 'function' ? safeParse(card.front) : card.front;
        renderLatex(qEl);

        const claimEl = overlay.querySelector('#dk-claim');
        claimEl.innerHTML = `<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.35);margin-bottom:0.3rem;">Påstående:</div>` + (typeof safeParse === 'function' ? safeParse(rawClaim) : rawClaim);
        renderLatex(claimEl);

        const buttonsEl = overlay.querySelector('#dk-buttons');
        const answerArea = overlay.querySelector('#dk-answer-area');
        buttonsEl.style.display = 'flex';
        answerArea.style.display = 'none';
        updateMeter();

        let answered = false;

        const handleAnswer = (userSaysTrue) => {
            if (answered) return;
            answered = true;
            driftPaused = true;
            if (roundKeyHandler) document.removeEventListener('keydown', roundKeyHandler);

            const correct = userSaysTrue === isCorrectAnswer;
            if (correct) { meterValue = Math.min(100, meterValue + 10); correctCount++; playgroundSessionStats.correct++; }
            else { meterValue = Math.max(-100, meterValue - 15); playgroundSessionStats.again++; }
            updateMeter();

            buttonsEl.style.display = 'none';
            answerArea.style.display = 'block';
            answerArea.innerHTML = `
                <div style="font-size:0.85rem;font-weight:700;color:${correct ? '#34A853' : '#EA4335'};margin-bottom:0.5rem;">${correct ? '✓ Rätt!' : '✗ Fel!'} Påståendet var ${isCorrectAnswer ? 'SANT' : 'FALSKT'}.</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:0.3rem;">Rätt svar:</div>
                <div id="dk-full-answer" style="font-size:1rem;color:#fff;background:rgba(255,255,255,0.04);padding:0.75rem;border-radius:8px;text-align:left;">${typeof safeParse === 'function' ? safeParse(card.back) : card.back}</div>
                <div style="font-size:0.8rem;color:rgba(255,255,255,0.3);margin-top:0.5rem;font-style:italic;">[Space] fortsätt</div>
            `;
            const ansEl = answerArea.querySelector('#dk-full-answer');
            if (ansEl) { renderLatex(ansEl); if (typeof renderCardBackImages === 'function') renderCardBackImages(ansEl, card.backImages); }

            let advanced = false;
            const advH = (e) => {
                if (advanced) return;
                if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
                if (e.type === 'keydown') e.preventDefault();
                advanced = true;
                overlay.removeEventListener('mousedown', advH);
                document.removeEventListener('keydown', advH);
                cardIdx++;
                showRound();
            };
            overlay.addEventListener('mousedown', advH);
            document.addEventListener('keydown', advH);
        };

        overlay.querySelector('#dk-true').onclick = () => handleAnswer(true);
        overlay.querySelector('#dk-false').onclick = () => handleAnswer(false);

        roundKeyHandler = (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); handleAnswer(true); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleAnswer(false); }
        };
        document.addEventListener('keydown', roundKeyHandler);
    };

    const globalKeyHandler = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(); overlay.remove(); finishPlaygroundSession(); }
    };
    document.addEventListener('keydown', globalKeyHandler);

    showRound();

    driftTimer = setInterval(() => {
        if (driftPaused) return;
        meterValue = Math.max(-100, meterValue - 2);
        updateMeter();
        const warn = overlay.querySelector('#dk-drift-warn');
        if (warn) { warn.style.opacity = '1'; setTimeout(() => { if (warn) warn.style.opacity = '0'; }, 800); }
        if (meterValue <= -100) showEndScreen(false);
    }, 1500);
};

// --- INITIALIZATION ---
const initApp = () => {
    try {
        loadData();
        renderDecks();
        renderSidebar();
        

        document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPlaygroundSession) playgroundEscAbort = true;
    }, true);

        // Backup: run auto-backup once conditions are met, show status, wire buttons
        maybeAutoBackup();
        renderBackupStatus();
        document.getElementById('btn-export-backup')?.addEventListener('click', () => {
            exportBackup();
            renderBackupStatus();
        });
        document.getElementById('btn-import-backup')?.addEventListener('click', () => {
            document.getElementById('import-backup-input')?.click();
        });
        document.getElementById('import-backup-input')?.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) await importBackupFromFile(file);
        });

    // Global click handler for closing modals
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
                return;
            }
            if (e.target === document.body || e.target === document.documentElement) {
                if (typeof handleBackgroundBack === 'function') {
                    handleBackgroundBack();
                }
            }
        });

        // Escape key closes the topmost open modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const openModals = document.querySelectorAll('.modal:not(.hidden)');
                if (openModals.length > 0) {
                    openModals[openModals.length - 1].classList.add('hidden');
                    return;
                }
                if (currentViewName === 'complete') {
                    document.getElementById('btn-complete-back').click();
                } else if (currentViewName === 'study' && !document.getElementById('cinema-overlay')) {
                    document.getElementById('btn-end-study').click();
                } else if (currentViewName === 'deck') {
                    filterBookshelf(null);
                } else if (currentViewName === 'addCard') {
                    openDeck(currentDeckId);
                } else if (currentViewName === 'notebook') {
                    filterBookshelf(null);
                } else if (currentViewName === 'addNote') {
                    openNotebook(currentNotebookId);
                }
            }
        });

        // Global Command Palette Key Shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                openGlobalSearch();
            }
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                openGlobalSearch();
            }
        });

        let librarySearchTimeout = null;
        document.getElementById('library-search')?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (librarySearchTimeout) clearTimeout(librarySearchTimeout);
            librarySearchTimeout = setTimeout(() => {
                librarySearchFilter = val;
                renderLibrary();
            }, 100);
        });

        // Sidebar search input event to filter sidebar
        let sidebarSearchTimeout = null;
        const sidebarSearchInput = document.getElementById('sidebar-search');
        if (sidebarSearchInput) {
            sidebarSearchInput.addEventListener('input', () => {
                if (sidebarSearchTimeout) clearTimeout(sidebarSearchTimeout);
                sidebarSearchTimeout = setTimeout(() => {
                    renderSidebar();
                }, 100);
            });
        }

        // Global search triggers on clicking the search icon
        const globalSearchTrigger = document.getElementById('btn-global-search-trigger');
        if (globalSearchTrigger) {
            globalSearchTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openGlobalSearch();
            });
        }

        // Global Search Input Handlers
        let globalSearchTimeout = null;
        const globalSearchInput = document.getElementById('global-search-input');
        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', () => {
                if (globalSearchTimeout) clearTimeout(globalSearchTimeout);
                globalSearchTimeout = setTimeout(() => {
                    performGlobalSearch();
                }, 100);
            });
            globalSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateSearchResults(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateSearchResults(-1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    triggerActiveSearchResult();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeGlobalSearch();
                }
            });
        }

        // Sidebar collapse (desktop)
        document.getElementById('sidebar-collapse')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('collapsed');
            document.getElementById('app-container').classList.add('expanded');
            document.getElementById('sidebar-toggle').classList.add('visible');
            document.getElementById('sidebar').classList.remove('open');
        });

        // Sidebar expand (desktop/mobile)
        document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('collapsed');
            document.getElementById('app-container').classList.remove('expanded');
            document.getElementById('sidebar-toggle').classList.remove('visible');
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.toggle('open');
            }
        });

        document.getElementById('note-content')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('form-add-note')?.requestSubmit();
            }
        });
    } catch (err) {
        console.error("Initial load failed", err);
        if (typeof renderLibrary === 'function') renderLibrary();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

const renameDeck = async (event, id, type = 'deck') => {
    event.stopPropagation();
    const list = type === 'deck' ? appData.decks : appData.notebooks;
    const item = list.find(i => i.id === id);
    if (!item) return;
    const newTitle = await showPromptModal('Skriv in nytt namn:', item.title);
    if (newTitle && newTitle.trim() !== '') {
        item.title = newTitle.trim();
        saveData();
        renderLibrary();
        if (type === 'deck' && currentDeckId === id) {
            document.getElementById('current-deck-title').innerText = item.title;
        } else if (type === 'notebook' && currentNotebookId === id) {
            document.getElementById('current-notebook-title').innerText = item.title;
        }
    }
};

window.renameDeck = renameDeck;
window.startBookshelfStudy = startBookshelfStudy;
window.startSectionStudy = startSectionStudy;
window.deleteSection = deleteSection;
window.openDeck = openDeck;
window.openNotebook = openNotebook;
window.renderLibrary = renderLibrary;
window.renderSidebar = renderSidebar;
window.switchView = switchView;
window.studyDagensMapp = studyDagensMapp;
window.renderDagensMapp = renderDagensMapp;
if (typeof CityBuilder !== 'undefined') window.CityBuilder = CityBuilder;

// ==========================================
// GLOBAL SEARCH ENGINE (COMMAND PALETTE)
// ==========================================

let activeSearchResultIndex = -1;
let currentSearchResults = [];

const openGlobalSearch = () => {
    const modal = document.getElementById('modal-global-search');
    const input = document.getElementById('global-search-input');
    if (!modal || !input) return;
    
    modal.classList.remove('hidden');
    input.value = '';
    activeSearchResultIndex = -1;
    currentSearchResults = [];
    performGlobalSearch();
    
    setTimeout(() => input.focus(), 50);
};

const closeGlobalSearch = () => {
    const modal = document.getElementById('modal-global-search');
    if (modal) modal.classList.add('hidden');
};



const highlightMatch = (text, query) => {
    const escapedText = escapeHtml(text);
    if (!query) return escapedText;
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight-match">$1</span>');
};

const performGlobalSearch = () => {
    const resultsContainer = document.getElementById('global-search-results');
    const countSpan = document.getElementById('global-search-count');
    const input = document.getElementById('global-search-input');
    if (!resultsContainer || !countSpan || !input) return;

    const query = input.value.trim().toLowerCase();
    resultsContainer.innerHTML = '';
    activeSearchResultIndex = -1;
    currentSearchResults = [];

    if (!query) {
        resultsContainer.innerHTML = `
            <div style="padding: 2.5rem; text-align: center; color: var(--text-secondary); font-size: 0.95rem;">
                Skriv för att söka i hela ditt bibliotek...
            </div>
        `;
        countSpan.textContent = '0 resultat';
        return;
    }

    const matchedBookshelves = [];
    const matchedDecks = [];
    const matchedSections = [];
    const matchedCards = [];
    const matchedNotebooks = [];
    const matchedNotes = [];

    // 1. Search Bookshelves
    appData.bookshelves.forEach(shelf => {
        if (shelf.title.toLowerCase().includes(query)) {
            matchedBookshelves.push({
                type: 'bookshelf',
                id: shelf.id,
                title: shelf.title,
                color: shelf.color || '#4F46E5',
                subtitle: 'Bokhylla',
                action: () => {
                    filterBookshelf(shelf.id);
                    closeGlobalSearch();
                }
            });
        }
    });

    // 2. Search Decks & Sections & Cards
    appData.decks.forEach(deck => {
        const bookshelf = deck.bookshelfId ? appData.bookshelves.find(s => s.id === deck.bookshelfId) : null;
        const deckPath = bookshelf ? `${bookshelf.title}` : 'Rotkatalog';

        // Check Deck title
        if (deck.title.toLowerCase().includes(query)) {
            matchedDecks.push({
                type: 'deck',
                id: deck.id,
                title: deck.title,
                subtitle: `Kortlek • I ${deckPath} • ${deck.cards.filter(c => c.type !== 'note').length} kort`,
                color: deck.color || (bookshelf ? bookshelf.color : '#4F46E5'),
                action: () => {
                    openDeck(deck.id);
                    closeGlobalSearch();
                }
            });
        }

        // Check Sections
        if (deck.sections) {
            deck.sections.forEach(section => {
                if (section.title.toLowerCase().includes(query)) {
                    matchedSections.push({
                        type: 'section',
                        id: section.id,
                        deckId: deck.id,
                        title: section.title,
                        subtitle: `Mapp i "${deck.title}" • ${deckPath}`,
                        action: () => {
                            highlightSection(deck.id, section.id);
                            closeGlobalSearch();
                        }
                    });
                }
            });
        }

        // Check Cards
        deck.cards.forEach(card => {
            const frontText = stripHtml(card.front);
            const backText = stripHtml(card.back || card.content || '');
            if (frontText.toLowerCase().includes(query) || backText.toLowerCase().includes(query)) {
                let cardLabel = card.type === 'note' ? 'Anteckningskort' : 'Kort';
                const section = card.sectionId && deck.sections ? deck.sections.find(s => s.id === card.sectionId) : null;
                const path = section ? `"${deck.title}" › "${section.title}"` : `"${deck.title}"`;
                
                // Construct matched snippet preview
                let snippet = '';
                if (frontText.toLowerCase().includes(query)) {
                    snippet = `Fråga: ${frontText}`;
                } else {
                    snippet = `Svar: ${backText}`;
                }

                // Limit snippet size
                if (snippet.length > 90) {
                    const idx = snippet.toLowerCase().indexOf(query);
                    const start = Math.max(0, idx - 30);
                    snippet = (start > 0 ? '...' : '') + snippet.substring(start, start + 90) + (snippet.length > start + 90 ? '...' : '');
                }

                matchedCards.push({
                    type: card.type === 'note' ? 'notecard' : 'card',
                    id: card.id,
                    deckId: deck.id,
                    title: card.type === 'note' ? backText.substring(0, 50) + (backText.length > 50 ? '...' : '') : frontText,
                    subtitle: `${cardLabel} i ${path}`,
                    snippet: snippet,
                    action: () => {
                        highlightCard(card.id);
                        closeGlobalSearch();
                    }
                });
            }
        });
    });

    // 3. Search Notebooks & Notes
    appData.notebooks.forEach(notebook => {
        const bookshelf = notebook.bookshelfId ? appData.bookshelves.find(s => s.id === notebook.bookshelfId) : null;
        const shelfPath = bookshelf ? `${bookshelf.title}` : 'Rotkatalog';

        if (notebook.title.toLowerCase().includes(query)) {
            matchedNotebooks.push({
                type: 'notebook',
                id: notebook.id,
                title: notebook.title,
                subtitle: `Anteckningsblock • I ${shelfPath} • ${notebook.notes ? notebook.notes.length : 0} anteckningar`,
                action: () => {
                    openNotebook(notebook.id);
                    closeGlobalSearch();
                }
            });
        }

        if (notebook.notes) {
            notebook.notes.forEach(note => {
                const contentText = stripHtml(note.content);
                if (contentText.toLowerCase().includes(query)) {
                    const firstLine = contentText.split('\n')[0] || 'Anteckning';
                    let snippet = contentText;
                    if (snippet.length > 90) {
                        const idx = snippet.toLowerCase().indexOf(query);
                        const start = Math.max(0, idx - 30);
                        snippet = (start > 0 ? '...' : '') + snippet.substring(start, start + 90) + (snippet.length > start + 90 ? '...' : '');
                    }

                    matchedNotes.push({
                        type: 'note',
                        id: note.id,
                        notebookId: notebook.id,
                        title: firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : ''),
                        subtitle: `Anteckning i "${notebook.title}"`,
                        snippet: snippet,
                        action: () => {
                            openNote(notebook.id, note.id);
                            closeGlobalSearch();
                        }
                    });
                }
            });
        }
    });

    // Group and render
    const groups = [
        { title: 'Bokhyllor', items: matchedBookshelves, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>` },
        { title: 'Kortlekar', items: matchedDecks, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 21h12"/></svg>` },
        { title: 'Mappar', items: matchedSections, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` },
        { title: 'Kort', items: matchedCards, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>` },
        { title: 'Anteckningsblock', items: matchedNotebooks, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="6" y1="6" x2="18" y2="6"/><line x1="6" y1="10" x2="18" y2="10"/></svg>` },
        { title: 'Anteckningar', items: matchedNotes, icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` }
    ];

    let globalIndex = 0;
    let totalCount = 0;
    let html = '';

    groups.forEach(group => {
        if (group.items.length === 0) return;
        totalCount += group.items.length;

        html += `
            <div class="search-result-group">
                <div class="search-result-group-title">
                    ${group.icon}
                    <span>${group.title}</span>
                </div>
        `;

        group.items.forEach(item => {
            currentSearchResults.push(item);
            const idx = globalIndex++;

            let iconStyle = '';
            if (item.type === 'bookshelf' || item.type === 'deck') {
                iconStyle = `style="background: ${item.color}15; color: ${item.color}; border: 1px solid ${item.color}25;"`;
            }

            html += `
                <div class="search-result-item" data-index="${idx}" onclick="window._triggerSearchResult(${idx})">
                    <div class="search-result-icon" ${iconStyle}>
                        ${group.icon}
                    </div>
                    <div class="search-result-details">
                        <div class="search-result-title">${highlightMatch(item.title, query)}</div>
                        <div class="search-result-subtitle">${highlightMatch(item.subtitle, query)}</div>
                        ${item.snippet ? `<div class="search-result-snippet">${highlightMatch(item.snippet, query)}</div>` : ''}
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    });

    if (totalCount === 0) {
        resultsContainer.innerHTML = `
            <div style="padding: 2.5rem; text-align: center; color: var(--text-secondary); font-size: 0.95rem;">
                Inga resultat hittades för "${escapeHtml(query)}"
            </div>
        `;
        countSpan.textContent = '0 resultat';
    } else {
        resultsContainer.innerHTML = html;
        countSpan.textContent = `${totalCount} resultat`;
        navigateSearchResults(1);
    }
};

const navigateSearchResults = (direction) => {
    if (currentSearchResults.length === 0) return;
    
    if (activeSearchResultIndex >= 0) {
        const prevEl = document.querySelector(`.search-result-item[data-index="${activeSearchResultIndex}"]`);
        if (prevEl) prevEl.classList.remove('active');
    }

    if (activeSearchResultIndex === -1 && direction === 1) {
        activeSearchResultIndex = 0;
    } else {
        activeSearchResultIndex += direction;
        if (activeSearchResultIndex >= currentSearchResults.length) {
            activeSearchResultIndex = 0;
        } else if (activeSearchResultIndex < 0) {
            activeSearchResultIndex = currentSearchResults.length - 1;
        }
    }

    const activeEl = document.querySelector(`.search-result-item[data-index="${activeSearchResultIndex}"]`);
    if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ block: 'nearest' });
    }
};

const triggerActiveSearchResult = () => {
    if (activeSearchResultIndex >= 0 && activeSearchResultIndex < currentSearchResults.length) {
        currentSearchResults[activeSearchResultIndex].action();
    }
};

const highlightCard = (cardId) => {
    let foundDeck = null;
    let foundCard = null;
    appData.decks.forEach(d => {
        const c = d.cards.find(card => card.id === cardId);
        if (c) {
            foundDeck = d;
            foundCard = c;
        }
    });

    if (!foundDeck || !foundCard) return;

    openDeck(foundDeck.id);

    if (foundCard.sectionId) {
        const secEl = document.getElementById(`section-${foundCard.sectionId}`);
        if (secEl) secEl.classList.remove('collapsed');
    }

    setTimeout(() => {
        const cardEl = document.getElementById(`card-${cardId}`);
        if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('search-highlight');
            setTimeout(() => cardEl.classList.remove('search-highlight'), 2500);
        }
    }, 150);
};

const highlightSection = (deckId, sectionId) => {
    openDeck(deckId);
    
    const secEl = document.getElementById(`section-${sectionId}`);
    if (secEl) {
        secEl.classList.remove('collapsed');
        setTimeout(() => {
            secEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const header = secEl.querySelector('.section-header');
            if (header) {
                header.classList.add('search-highlight-section');
                setTimeout(() => header.classList.remove('search-highlight-section'), 2500);
            }
        }, 150);
    }
};

const openNote = (notebookId, noteId) => {
    openNotebook(notebookId);
    const notebook = appData.notebooks.find(n => n.id === notebookId);
    if (!notebook) return;
    const note = notebook.notes.find(n => n.id === noteId);
    if (!note) return;
    
    setTimeout(() => {
        currentNoteId = note.id;
        document.getElementById('note-content').value = note.content;
        document.getElementById('note-form-title').innerText = 'Visa anteckning';
        switchView('addNote');
    }, 150);
};

window.renameDeck = renameDeck;
window.startBookshelfStudy = startBookshelfStudy;
window.startSectionStudy = startSectionStudy;
window.deleteSection = deleteSection;
window.openDeck = openDeck;
window.openNotebook = openNotebook;
window.renderLibrary = renderLibrary;
window.renderSidebar = renderSidebar;
window.switchView = switchView;
window.studyDagensMapp = studyDagensMapp;
window.renderDagensMapp = renderDagensMapp;
if (typeof CityBuilder !== 'undefined') window.CityBuilder = CityBuilder;
window.openGlobalSearch = openGlobalSearch;
window.closeGlobalSearch = closeGlobalSearch;
window.performGlobalSearch = performGlobalSearch;
window.navigateSearchResults = navigateSearchResults;
window.triggerActiveSearchResult = triggerActiveSearchResult;
window.highlightCard = highlightCard;
window.highlightSection = highlightSection;
window.openNote = openNote;
window._triggerSearchResult = (idx) => {
    if (currentSearchResults[idx]) currentSearchResults[idx].action();
};
