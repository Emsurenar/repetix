import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { openDeck, openNotebook } from './deck.js';
import { renderLibrary } from './library.js';
import { initModalA11y } from './modals.js';
import { switchView } from './router.js';

/**
 * Ritar sidopanelens träd.
 *
 * Bokhyllan är rubriken över sina kortlekar, inte en egen rad man går till.
 * Panelen listade tidigare bara hyllnamnen, vilket gjorde den till en meny med
 * tre ord i — hela biblioteket låg gömt ett klick bort. Nu står lekarna under
 * sin hylla med antalet förfallna kort högerställt, så att man ser var arbetet
 * finns utan att öppna något.
 *
 * Raderna är knappar sedan tillgänglighetsgenomgången — som div med onclick
 * gick de inte att nå med tangentbord alls — och den rad som visas bär
 * aria-current="page" så att man hör var man står.
 */
/* Sidopanelens rader lägger sig på plats en gång per sidladdning, inte en
 * gång per omritning. */
let harLagtSig = false;

export const renderSidebar = () => {
    const tree = document.getElementById('sidebar-tree');
    if (!tree) return;
    const filter = (document.getElementById('sidebar-search')?.value || '').toLowerCase();
    const now = Date.now();

    // aria-current sätts bara på den rad som faktiskt visas, aldrig på flera.
    const current = (aktiv) => (aktiv ? ' aria-current="page"' : '');
    const matches = (title) => !filter || title.toLowerCase().includes(filter);

    const emptyGroup = (labelHtml) =>
        `<div class="sidebar-group">${labelHtml}<p class="sidebar-empty">Tom</p></div>`;

    const dueCount = (deck) =>
        deck.cards.filter((c) => c.type !== 'note' && c.nextReviewDate <= now).length;

    const deckRow = (deck) => {
        const aktiv = S.currentViewName === 'deck' && S.currentDeckId === deck.id;
        const due = dueCount(deck);
        return `<button type="button" class="sidebar-item ${aktiv ? 'active' : ''}"${current(aktiv)} data-deck-id="${deck.id}">
            <span class="sidebar-chip" aria-hidden="true"></span>
            <span class="sidebar-item-name">${escapeHtml(deck.title)}</span>
            <span class="sidebar-count num ${due === 0 ? 'is-zero' : ''}"><span class="sr-only">förfallna: </span>${due}</span>
        </button>`;
    };

    const notebookRow = (nb) => {
        const aktiv = S.currentViewName === 'notebook' && S.currentNotebookId === nb.id;
        return `<button type="button" class="sidebar-item ${aktiv ? 'active' : ''}"${current(aktiv)} data-notebook-id="${nb.id}">
            <span class="sidebar-chip" aria-hidden="true"></span>
            <span class="sidebar-item-name">${escapeHtml(nb.title)}</span>
            <span class="sidebar-count num is-zero"><span class="sr-only">anteckningar: </span>${nb.notes.length}</span>
        </button>`;
    };

    /* En hylla visas om den själv matchar sökningen, eller om någon av dess
     * lekar gör det. Matchar hyllan visas allt den innehåller — annars vore
     * en träff på hyllnamnet en tom grupp. */
    const groupHtml = (shelfId, shelfMatches, labelHtml) => {
        const decks = S.appData.decks.filter(
            (d) => d.bookshelfId === shelfId && (shelfMatches || matches(d.title))
        );
        const notebooks = S.appData.notebooks.filter(
            (n) => n.bookshelfId === shelfId && (shelfMatches || matches(n.title))
        );
        // En tom hylla visas bara när den är det man sökt efter. Etiketten
        // "Utan bokhylla" utan rader under sig är ingen upplysning.
        if (!decks.length && !notebooks.length) return shelfMatches ? emptyGroup(labelHtml) : '';
        return `<div class="sidebar-group" role="group" aria-labelledby="shelf-${shelfId ?? 'root'}">
            ${labelHtml}
            ${decks.map(deckRow).join('')}
            ${notebooks.map(notebookRow).join('')}
        </div>`;
    };

    let html = '';

    S.appData.bookshelves.forEach((shelf, idx) => {
        const aktiv = S.currentBookshelfFilterId === shelf.id && S.currentViewName === 'library';
        const label = `<button type="button" class="sidebar-group-label sidebar-shelf-item ${aktiv ? 'active' : ''}"${current(aktiv)}
                id="shelf-${shelf.id}" draggable="false" data-shelf-idx="${idx}" data-shelf-id="${shelf.id}"
                onclick="filterBookshelf('${shelf.id}')">
            <span class="sidebar-drag-handle" aria-hidden="true">&#10287;</span>
            <span class="sidebar-item-name">${escapeHtml(shelf.title)}</span>
        </button>`;
        html += groupHtml(shelf.id, matches(shelf.title), label);
    });

    /* Lösa lekar sist, under en egen etikett — men bara när det finns hyllor
     * ovanför. Utan hyllor är "Utan bokhylla" en indelning i ett. */
    const rootLabel = S.appData.bookshelves.length
        ? `<div class="sidebar-group-label" id="shelf-root">
            <span class="sidebar-item-name">Utan bokhylla</span>
        </div>`
        : '';
    html += groupHtml(null, false, rootLabel);

    if (!html) {
        html = `<p class="sidebar-empty">${filter ? 'Inget matchar sökningen.' : 'Inga kortlekar än.'}</p>`;
    }

    tree.innerHTML = html;

    /* Panelen ritas om vid varje vybyte, varje sparning och varje tangenttryck
     * i söket. Inflyttningen hör till första gången man ser listan — spelas den
     * varje gång blinkar hela biblioteket bort och tillbaka så fort man klickar
     * någonstans i appen. */
    tree.classList.toggle('stagger', !filter);
    if (!filter && !harLagtSig) {
        harLagtSig = true;
        tree.classList.add('is-entering');
        clearTimeout(tree._entryTimer);
        tree._entryTimer = setTimeout(() => tree.classList.remove('is-entering'), 700);
    }

    tree.querySelectorAll('[data-deck-id]').forEach((el) => {
        el.addEventListener('click', () => openDeck(el.dataset.deckId));
    });
    tree.querySelectorAll('[data-notebook-id]').forEach((el) => {
        el.addEventListener('click', () => openNotebook(el.dataset.notebookId));
    });

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

        // Handtaget är ett grepp, inte en knapp: ett klick på det ska inte
        // navigera till bokhyllan.
        el.querySelector('.sidebar-drag-handle')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Omordning med tangentbord. Dra-och-släpp är den enda vägen med mus,
        // och utan det här hade ordningen varit omöjlig att ändra utan mus.
        // Alt väljs för att pilarna ensamma ska fortsätta flytta fokus.
        el.addEventListener('keydown', (e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            const from = parseInt(el.dataset.shelfIdx, 10);
            const to = e.key === 'ArrowUp' ? from - 1 : from + 1;
            if (Number.isNaN(from) || to < 0 || to >= S.appData.bookshelves.length) return;

            e.preventDefault();
            const [moved] = S.appData.bookshelves.splice(from, 1);
            S.appData.bookshelves.splice(to, 0, moved);
            saveData();
            renderSidebar();
            renderLibrary();
            // Raden ritades om, så fokus måste följa med till den nya platsen.
            document.querySelector(`.sidebar-shelf-item[data-shelf-id="${moved.id}"]`)?.focus();
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
            const [moved] = S.appData.bookshelves.splice(dragSrcIdx, 1);
            
            // Adjust the target index according to the drop position and array splicing shift
            let newTargetIdx = targetIdx;
            if (dragSrcIdx < targetIdx) {
                newTargetIdx = insertAfter ? targetIdx : targetIdx - 1;
            } else {
                newTargetIdx = insertAfter ? targetIdx + 1 : targetIdx;
            }

            S.appData.bookshelves.splice(newTargetIdx, 0, moved);
            saveData();
            renderSidebar();
            renderLibrary();
        });
    });
};

export function initUiModalsWiring() {

  // Fokusfällan startas här, före all annan modalkoppling: den ska vara på
  // plats innan något överlägg hinner öppnas.
  initModalA11y();

  // ===== MODAL EVENT LISTENERS =====

  /* Fargvaljaren ar borttagen. Kortlekens och bokhyllans farg ritades ut pa
   * rubrikrader som inte finns langre, och en palett utanfor tokens hor inte
   * hemma i "Lugn precision" — kontrollen andrade ett varde ingen kunde se.
   * Kolumnen finns kvar i databasen for aldre data. */

  window.filterBookshelf = filterBookshelf;
}


export const filterBookshelf = (id) => {
    S.currentBookshelfFilterId = id;
    if (S.currentViewName !== 'library') {
        switchView('library');
    }
    renderLibrary();
    renderSidebar();
};