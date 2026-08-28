import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { renderLibrary } from './library.js';
import { initModalA11y } from './modals.js';
import { switchView } from './router.js';

export const openColorModal = (deck) => {
    S.currentColorEditItem = deck;
    document.querySelectorAll('#change-color-picker .color-dot').forEach(dot => {
        dot.classList.toggle('selected', dot.dataset.color === deck.color);
    });
    document.getElementById('modal-change-color').classList.remove('hidden');
};

/**
 * Ritar sidopanelens träd.
 *
 * Raderna var tidigare div-element med onclick. De gick alltså inte att nå med
 * tangentbord alls, och skärmläsaren fick höra en namnlös grupp text i stället
 * för en navigering. Nu är varje rad en riktig knapp, och den rad som visas
 * bär aria-current="page" så att man hör var man står.
 */
export const renderSidebar = () => {
    const tree = document.getElementById('sidebar-tree');
    if (!tree) return;
    const filter = (document.getElementById('sidebar-search')?.value || '').toLowerCase();

    // aria-current sätts bara på den rad som faktiskt visas, aldrig på flera.
    const current = (aktiv) => (aktiv ? ' aria-current="page"' : '');
    let html = '';

    // "Hem" / "Bibliotek" Item
    const hemAktiv = S.currentViewName === 'library' && !S.currentBookshelfFilterId;
    html += `<button type="button" class="sidebar-item ${hemAktiv ? 'active' : ''}"${current(hemAktiv)} onclick="filterBookshelf(null)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <span class="sidebar-item-name">Hem</span>
    </button>`;

    // "Spelhallen" Item
    const spelAktiv = S.currentViewName === 'playground';
    html += `<button type="button" class="sidebar-item ${spelAktiv ? 'active' : ''}"${current(spelAktiv)} onclick="openPlayground()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
        <span class="sidebar-item-name">Spelhallen</span>
    </button>`;

    if (S.appData.bookshelves.length > 0) {
        html += `<div class="sidebar-group" role="group" aria-labelledby="sidebar-shelves-label">
            <div class="sidebar-group-label" id="sidebar-shelves-label">Bokhyllor</div>`;
        S.appData.bookshelves.forEach((shelf, idx) => {
            if (filter && !shelf.title.toLowerCase().includes(filter)) return;
            const aktiv = S.currentBookshelfFilterId === shelf.id && S.currentViewName === 'library';
            html += `<button type="button" class="sidebar-item sidebar-shelf-item ${aktiv ? 'active' : ''}"${current(aktiv)} draggable="false" data-shelf-idx="${idx}" data-shelf-id="${shelf.id}" onclick="filterBookshelf('${shelf.id}')">
                <span class="sidebar-drag-handle" aria-hidden="true">&#10287;</span>
                <span class="sidebar-item-name">${escapeHtml(shelf.title)}</span>
            </button>`;
        });
        html += `</div>`;
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

  S.currentColorEditItem = null;

  document.getElementById('btn-cancel-change-color')?.addEventListener('click', () => {
      document.getElementById('modal-change-color').classList.add('hidden');
  });

  document.getElementById('btn-save-change-color')?.addEventListener('click', () => {
      if (S.currentColorEditItem) {
          const selectedDot = document.querySelector('#change-color-picker .color-dot.selected');
          if (selectedDot) {
              S.currentColorEditItem.color = selectedDot.dataset.color;
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

  window.openBookshelfMenu = (id) => {
      const shelf = S.appData.bookshelves.find(s => s.id === id);
      if (shelf) openColorModal(shelf);
  };

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