import { S } from './state.js';
import { loadData } from './storage.js';
import { renderDecks } from '../ui/deck.js';
import { renderSidebar } from '../ui/modals-wiring.js';
import { showConfirmModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';


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
export const isEffectivelyEmpty = (data) => {
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
        cardCount: countCards(S.appData),
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
    return `${countCards(S.appData)}:${totalLen}`;
};

const markBackupDone = () => {
    try {
        localStorage.setItem('noji_backup_last_at', String(Date.now()));
        localStorage.setItem('noji_backup_last_sig', backupSignature());
    } catch (e) { /* ignore */ }
};

export const exportBackup = (opts = {}) => {
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
export const maybeAutoBackup = () => {
    try {
        if (S.dataLoadBlocked || isEffectivelyEmpty(S.appData)) return;
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

export const renderBackupStatus = () => {
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
export const importBackupFromFile = async (file) => {
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
    const currentCards = countCards(S.appData);
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

    S.dataLoadBlocked = false;
    loadData();
    renderDecks();
    renderSidebar();
    markBackupDone();
    renderBackupStatus();
    showToast(`Import klar — ${countCards(S.appData)} kort återställda ✔`);
};

// Fast regex-based HTML tag stripping
export const stripHtml = (html) => {
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

export const createNote = (content) => {
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        content,
        createdAt: Date.now()
    };
};
