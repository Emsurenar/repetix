import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { renderLibrary } from './library.js';
import { switchView } from './router.js';

export const openColorModal = (deck) => {
    S.currentColorEditItem = deck;
    document.querySelectorAll('#change-color-picker .color-dot').forEach(dot => {
        dot.classList.toggle('selected', dot.dataset.color === deck.color);
    });
    document.getElementById('modal-change-color').classList.remove('hidden');
};

export const renderSidebar = () => {
    const tree = document.getElementById('sidebar-tree');
    if (!tree) return;
    const filter = (document.getElementById('sidebar-search')?.value || '').toLowerCase();
    let html = '';

    // "Hem" / "Bibliotek" Item
    html += `<div class="sidebar-item ${S.currentViewName === 'library' && !S.currentBookshelfFilterId ? 'active' : ''}" onclick="filterBookshelf(null)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.75rem;opacity:0.7"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <span style="flex:1; font-weight: 500;">Hem</span>
    </div>`;

    // "Spelhallen" Item
    html += `<div class="sidebar-item ${S.currentViewName === 'playground' ? 'active' : ''}" onclick="openPlayground()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.75rem;opacity:0.7"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
        <span style="flex:1; font-weight: 500;">Spelhallen</span>
    </div>`;

    if (S.appData.bookshelves.length > 0) {
        html += `<div class="sidebar-section-label" style="margin-top:1.5rem;">Bokhyllor</div>`;
        S.appData.bookshelves.forEach((shelf, idx) => {
            if (filter && !shelf.title.toLowerCase().includes(filter)) return;
            html += `<div class="sidebar-item sidebar-shelf-item ${S.currentBookshelfFilterId === shelf.id && S.currentViewName === 'library' ? 'active' : ''}" draggable="false" data-shelf-idx="${idx}" data-shelf-id="${shelf.id}" onclick="filterBookshelf('${shelf.id}')">
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