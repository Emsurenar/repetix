import { createCard, isEffectivelyEmpty } from './backup.js';
import { S } from './state.js';
import { renderDecks } from '../ui/deck.js';
import { renderSidebar } from '../ui/modals-wiring.js';
import { showConfirmModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';


// --- DATA & STORAGE ---
export const loadData = () => {
    const saved = localStorage.getItem('noji_clone_data');
    if (saved) {
        let parseFailed = false;
        try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                S.appData = parsed;
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
            S.dataLoadBlocked = true;
            if (typeof showToast === 'function') {
                showToast('Kunde inte läsa sparad data — den har säkrats. Sparning är pausad tills du importerar en backup.');
            }
            return;
        }

        // Migration to include decks, notebooks and bookshelves
        if (!S.appData.decks) S.appData.decks = [];
        if (!S.appData.notebooks) S.appData.notebooks = [];
        if (!S.appData.bookshelves) S.appData.bookshelves = [];
        
        // Ensure all decks and notebooks have arrays and bookshelfId
        S.appData.decks.forEach(d => {
            if (!d.cards) d.cards = [];
            if (d.bookshelfId === undefined) d.bookshelfId = null;
            if (!d.sections) d.sections = [];
            if (!d.color) d.color = '#4F46E5';
            d.cards.forEach(c => {
                if (c.sectionId === undefined) c.sectionId = null;
            });
        });
        S.appData.notebooks.forEach(n => { 
            if (!n.notes) n.notes = []; 
            if (n.bookshelfId === undefined) n.bookshelfId = null;
        });
    } else {
        // Initial dummy deck if empty
        S.appData.decks.push({
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
    if (!isEffectivelyEmpty(S.appData)) return false;
    const existing = localStorage.getItem('noji_clone_data');
    if (!existing) return false;
    try { return !isEffectivelyEmpty(JSON.parse(existing)); }
    catch (e) { return true; } // existing is unparseable — treat as content, don't clobber
};
export const saveData = () => {
    if (S.saveTimeout) clearTimeout(S.saveTimeout);
    S.saveTimeout = setTimeout(() => {
        S.saveTimeout = null;
        // Never overwrite a payload we failed to load.
        if (S.dataLoadBlocked) {
            console.warn('saveData blocked: previous load failed to parse');
            return;
        }
        // Never silently replace a non-empty store with an empty one; ask first.
        if (!S.allowWipeOnce && wouldWipeStoredData()) {
            if (!S.wipeConfirmInProgress) confirmWipe();
            return;
        }
        S.allowWipeOnce = false;
        try {
            localStorage.setItem('noji_clone_data', JSON.stringify(S.appData));
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
    S.wipeConfirmInProgress = true;
    const ok = await showConfirmModal(
        'Radera allt innehåll?',
        'Detta skulle ta bort alla kortlekar och anteckningar. Är du säker?',
        'Ja, radera allt',
        true
    );
    S.wipeConfirmInProgress = false;
    if (ok) {
        S.allowWipeOnce = true;
        saveData();
    } else {
        loadData();
        renderDecks();
        renderSidebar();
        showToast('Radering avbruten — inget togs bort.');
    }
};

export function initCoreStorage() {

  S.saveTimeout = null;

  // Synchronously save any pending data changes when exiting the page. The same
  // guards apply — a background bug must not wipe good data on unload (no modal is
  // possible here, so we simply skip the destructive write).
  window.addEventListener('beforeunload', () => {
      if (S.dataLoadBlocked) return;
      if (S.saveTimeout) {
          clearTimeout(S.saveTimeout);
          if (wouldWipeStoredData()) return;
          try {
              localStorage.setItem('noji_clone_data', JSON.stringify(S.appData));
          } catch (e) {}
      }
  });
}
