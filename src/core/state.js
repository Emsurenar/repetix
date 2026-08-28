// Delat, muterbart apptillstånd. Samlat i ett objekt så att modulerna kan
// dela det utan att varje fil deklarerar egna globaler.
export const S = {};

export function initCoreState() {

  // Default Data Structure
  S.appData = {
      decks: [], // Array of { id, title, cards: [], bookshelfId: string|null }
      notebooks: [], // Array of { id, title, notes: [], bookshelfId: string|null }
      bookshelves: []
  };

  // --- DATA-SAFETY FLAGS ---
  // Set when the stored data existed but failed to parse: blocks saveData so a
  // corrupt-but-maybe-recoverable payload is never silently overwritten.
  S.dataLoadBlocked = false;
  // One-shot escape hatch used by confirmWipe() to allow an intentional full wipe.
  S.allowWipeOnce = false;
  // Guards against opening the wipe-confirm modal repeatedly while it is already open.
  S.wipeConfirmInProgress = false;

  // --- GLOBAL APP STATE ---
  S.currentDeckId = null;
  S.currentSectionId = null;
  S.currentNotebookId = null;
  S.currentNoteId = null; // for editing
  S.currentViewName = 'library';
  S.currentBookshelfFilterId = null;
  S.currentStudyCards = [];
  S.currentStudyIndex = 0;
  S.isPlaygroundSession = false;
  S.playgroundEscAbort = false;
  S.lastSessionWasPlayground = false;
  S.draggedDeckIndex = null;
  S.playgroundFilterSource = new Set(); // stores 'deck:<id>:section:<id>' or 'deck:<id>:unsorted'
  S.playgroundFilterAll = true; // true = whole library selected
  S.playgroundExpandedNodes = new Set();
  S.playgroundDropdownOpen = false;
}
