import { S } from './state.js';
import { loadData } from './storage.js';
import {
    collectBackupImages,
    collectCloudImagePaths,
    formatBytes,
    inlineBackupImages,
    writeWithinQuota,
} from './backup-images.js';
import { resolveMany } from './image-store.js';
import { renderDecks } from '../ui/deck.js';
import { renderSidebar } from '../ui/modals-wiring.js';
import { showConfirmModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';


// --- BACKUP / DATA SAFETY ---
// Everything the app persists lives under these three keys. A backup file
// captures the raw stored strings verbatim so a restore is byte-for-byte.
//
// Kortbilderna ligger inte längre i de strängarna. Efter bildmigreringen bär
// kortet en sökväg till molnlagringen, så en fil med enbart de här nycklarna är
// en fil med pekare: raderas kontot eller hinken är bilderna borta. Därför
// hämtas de hem vid export och läggs i ett eget fält bredvid — se
// backup-images.js — och sökvägarna lämnas orörda i strängen ovan, så att
// kravet "byte-for-byte" och en äldre importör fortfarande håller.
const BACKUP_KEYS = ['noji_clone_data', 'noji_dagens_mapp', 'pg_records'];
const BACKUP_APP_ID = 'noji-spaced-rep';
// Version 2 bär bilddata bredvid sökvägarna. Sökvägarna står kvar orörda i
// noji_clone_data, så en importör som bara känner version 1 läser samma sträng
// som förut i stället för att avvisa filen.
const BACKUP_VERSION = 2;
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

// Vad filen faktiskt saknar räknas mot biblioteket som skrivs ut, inte mot
// listan hämtningen började med: ett kort kan ha fått eller tappat en bild
// medan hämtningen pågick, och det är den utskrivna datan som ska stämma.
const missingInFile = (bilder) => {
    const skal = new Map(bilder.missing.map(m => [m.path, m.reason]));
    return collectCloudImagePaths(S.appData)
        .filter(p => !(p in bilder.images))
        .map(p => ({ path: p, reason: skal.get(p) ?? 'Bilden tillkom medan exporten pågick.' }));
};

const buildBackupObject = (bilder, saknas) => {
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
        // Filen säger själv om den är självbärande. Utan flaggan har den som
        // öppnar en gammal fil om ett år ingen möjlighet att se skillnad på
        // "inga bilder" och "bilderna kom aldrig med".
        imagesEmbedded: saknas.length === 0,
        imageCount: Object.keys(bilder.images).length,
        imageBytes: bilder.bytes,
        imagesMissing: saknas,
        images: bilder.images,
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

const markBackupDone = (saknade = 0) => {
    try {
        localStorage.setItem('noji_backup_last_at', String(Date.now()));
        localStorage.setItem('noji_backup_last_sig', backupSignature());
        localStorage.setItem('noji_backup_last_missing', String(saknade));
    } catch (e) { /* ignore */ }
};

// Sant medan en export pågår. Både knapparna och statusraden läser den: en
// hämtning av bilder tar tid, och under tiden får appen inte se ut som om
// ingenting händer eller som om en ny export kan startas ovanpå den första.
let exportPagar = false;

const setStatusText = (text) => {
    const el = document.getElementById('backup-status');
    if (el) el.textContent = text;
};

const setDataButtonsDisabled = (avstangda) => {
    ['btn-export-backup', 'btn-import-backup'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = avstangda;
    });
};

// Hämtar hem bilderna som ska bäddas in, eller null om användaren avbryter.
const gatherImagesForExport = async (opts) => {
    const sokvagar = collectCloudImagePaths(S.appData);
    if (sokvagar.length === 0) return { images: {}, bytes: 0, total: 0, missing: [] };

    setStatusText(`Hämtar bilder — 0 av ${sokvagar.length}`);
    const bilder = await collectBackupImages(S.appData, {
        resolve: resolveMany,
        fetch: (url) => fetch(url),
        onProgress: ({ hanterade, totalt }) => setStatusText(`Hämtar bilder — ${hanterade} av ${totalt}`),
    });

    if (bilder.missing.length === 0) return bilder;

    // Ett tyst läge har ingen att fråga — den automatiska kopian körs vid
    // uppstart och säkerhetskopian före en import är redan påbörjad. Där skrivs
    // filen ändå, med bristen bokförd i den och ett besked på skärmen.
    if (opts.silent) return bilder;

    const ok = await showConfirmModal(
        'Bilder kunde inte hämtas',
        `${bilder.missing.length} av ${bilder.total} bilder gick inte att hämta. Exportfilen blir ofullständig — de bilderna finns bara kvar i molnet.`,
        'Exportera ändå',
        true
    );
    return ok ? bilder : null;
};

/**
 * Skriver en exportfil med allt som behövs för att återställa utan nät och
 * utan konto: appdatan, och bilderna hämtade hem som data-URL:er.
 *
 * @returns {Promise<{imageCount:number, missing:number, bytes:number}|null>}
 *   null när exporten avbröts eller misslyckades.
 */
export const exportBackup = async (opts = {}) => {
    if (exportPagar) {
        if (!opts.silent) showToast('En export pågår redan.');
        return null;
    }
    exportPagar = true;
    setDataButtonsDisabled(true);
    try {
        const bilder = await gatherImagesForExport(opts);
        if (!bilder) return null;

        const saknas = missingInFile(bilder);
        downloadJson(buildBackupObject(bilder, saknas), backupFilename());
        markBackupDone(saknas.length);

        const antal = Object.keys(bilder.images).length;
        if (!opts.silent) {
            if (saknas.length > 0) {
                showToast(`Backup exporterad — ${saknas.length} av ${antal + saknas.length} bilder saknas i filen.`);
            } else if (antal > 0) {
                showToast(`Backup exporterad — ${antal} bilder, ${formatBytes(bilder.bytes)} ✔`);
            } else {
                showToast('Backup exporterad ✔');
            }
        }
        return { imageCount: antal, missing: saknas.length, bytes: bilder.bytes };
    } catch (e) {
        console.error('Export failed', e);
        showToast('Kunde inte exportera backup.');
        return null;
    } finally {
        // Även en misslyckad hämtning ska lämna knapparna klickbara och raden
        // med sin vanliga text. Ett halvläge här är ett läge man inte tar sig ur.
        exportPagar = false;
        setDataButtonsDisabled(false);
        renderBackupStatus();
    }
};

/* Den automatiska kopian är borta, och kommer inte tillbaka.
 *
 * Den laddade ner hela biblioteket som en fil vid uppstart, en gång per dygn
 * när innehållet ändrats. Vid uppstart betyder FÖRE inloggningen: initApp
 * körde den direkt efter loadData, och den enda inloggningsspärr som fanns
 * gällde bara om datan råkade innehålla molnbilder — utan sådana hämtades
 * filen omedelbart, och med dem gav väntan ändå upp efter tolv sekunder och
 * hämtade den ändå. Följden var en fil med hela innehållet i telefonens
 * nedladdningsmapp, oombedd, innan någon identifierat sig.
 *
 * Molnet är kopian. Supabase håller datan, och en fil som skriver sig själv
 * till disk är inte ett skydd utan en spridning: den ligger kvar på varje
 * enhet appen råkat öppnas på, och den åldras utan att någon märker det.
 *
 * Export och import finns kvar under Inställningar. De görs av användaren, med
 * avsikt, och importen är dessutom enda vägen tillbaka när den lokala datan
 * blivit oläslig — se kommentaren överst i initApp. */

export const renderBackupStatus = () => {
    const el = document.getElementById('backup-status');
    if (!el) return;
    // Under en pågående export bär raden hämtningens framsteg. init.js ritar om
    // statusen direkt efter klicket, alltså mitt i hämtningen.
    if (exportPagar) return;
    const lastAt = parseInt(localStorage.getItem('noji_backup_last_at') || '0', 10);
    if (!lastAt) {
        // Ett konstaterande, inte en uppmaning. Knappen bredvid heter redan
        // Exportera; att peka på den är att säga samma sak en gång till.
        el.textContent = 'Ingen backup ännu';
        return;
    }
    const days = Math.floor((Date.now() - lastAt) / DAY_MS);
    const label = days <= 0 ? 'idag' : (days === 1 ? 'igår' : `${days} dagar sedan`);
    const missing = parseInt(localStorage.getItem('noji_backup_last_missing') || '0', 10);
    el.textContent = missing > 0
        ? `Senaste backup: ${label} — ${missing} bilder saknas i filen`
        : `Senaste backup: ${label}`;
};

// Restore from a user-picked backup file. Accepts our wrapper format or a raw
// noji_clone_data export. Always downloads the current state first, confirms via
// the app modal, then replaces all three keys.
export const importBackupFromFile = async (file) => {
    if (exportPagar) { showToast('Vänta tills exporten är klar.'); return; }

    let text;
    try { text = await file.text(); }
    catch (e) { showToast('Kunde inte läsa filen.'); return; }

    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { showToast('Ogiltig backup-fil (inte JSON).'); return; }

    let data = null;
    let images = {};
    if (obj && obj.data && typeof obj.data === 'object' && obj.data.noji_clone_data) {
        data = obj.data;                                   // our wrapper format
        // Bilddatan ligger bredvid appdatan, aldrig inuti den. En fil från före
        // version 2 har inget här och läses precis som förut.
        if (obj.images && typeof obj.images === 'object') images = obj.images;
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

    // Bilderna läggs tillbaka i korten innan något skrivs. Efter bytet är de
    // base64 i localStorage igen, precis som före migreringen, och de kräver
    // varken konto eller nät för att visas. Nästa inloggning flyttar upp dem på
    // nytt — under den inloggades egen sökväg, vilket är det enda som fungerar
    // när filen kommer från ett annat konto.
    const { ersatta, kvar, inlagda } = inlineBackupImages(parsed, images);

    const incomingCards = countCards(parsed);
    const currentCards = countCards(S.appData);
    const bildrad = ersatta > 0 ? ` ${ersatta} bilder följer med filen.` : '';
    // En fil utan bilddata är inte fel, men den är ofullständig — och det ska
    // sägas före ersättningen, inte upptäckas när ett kort visar en tom ruta.
    const saknasrad = kvar > 0
        ? ` ${kvar} bilder saknar bilddata i filen och går bara att visa med konto och uppkoppling.`
        : '';
    const ok = await showConfirmModal(
        'Importera backup',
        `Nuvarande: ${currentCards} kort → Import: ${incomingCards} kort. Detta ersätter allt nuvarande innehåll. En säkerhetskopia av nuvarande data laddas ner först.${bildrad}${saknasrad}`,
        'Ersätt allt',
        true
    );
    if (!ok) return;

    // Inväntas: säkerhetsnätet hämtar numera hem bilder, och en ersättning får
    // inte hinna börja innan filen med det som ersätts ligger på disk.
    const natet = await exportBackup({ silent: true });
    if (!natet) {
        showToast('Säkerhetskopian av nuvarande data kunde inte laddas ner.');
    } else if (natet.missing > 0) {
        showToast(`Säkerhetskopian saknar ${natet.missing} bilder som inte gick att hämta.`);
    }

    // De två små nycklarna först. Bilderna fyller lagringen ända till kanten,
    // och det får inte vara de här två kilobytena som blir kvar utanför. Går
    // biblioteket sedan inte in alls läggs de tillbaka som de var.
    const smaNycklar = BACKUP_KEYS.filter(k => k !== 'noji_clone_data');
    const foreImport = new Map(smaNycklar.map(k => [k, localStorage.getItem(k)]));
    const aterstallSma = () => {
        foreImport.forEach((v, k) => {
            if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        });
    };

    const arKvotfel = (e) => Boolean(e) && (e.name === 'QuotaExceededError' || e.code === 22);

    let aterstallda = ersatta;
    try {
        smaNycklar.forEach(k => {
            if (data[k] !== undefined && data[k] !== null) localStorage.setItem(k, data[k]);
        });
        if (inlagda.length === 0) {
            // Inget att bädda in: strängen ur filen skrivs som den är, byte för byte.
            localStorage.setItem('noji_clone_data', data.noji_clone_data);
        } else {
            const { behallna, utelamnade } = writeWithinQuota(
                inlagda,
                (text) => localStorage.setItem('noji_clone_data', text),
                () => JSON.stringify(parsed),
                arKvotfel
            );
            aterstallda = behallna;
            if (utelamnade > 0) {
                showToast(`Lagringen räckte inte till ${utelamnade} av bilderna. De ligger kvar i filen.`);
            }
        }
    } catch (e) {
        console.error('Import write failed', e);
        aterstallSma();
        showToast('Kunde inte spara importerad data (lagringsfel).');
        return;
    }

    S.dataLoadBlocked = false;
    loadData();
    renderDecks();
    renderSidebar();
    markBackupDone(kvar);
    renderBackupStatus();
    const bilder = aterstallda > 0 ? ` och ${aterstallda} bilder` : '';
    showToast(`Import klar — ${countCards(S.appData)} kort${bilder} återställda ✔`);
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
