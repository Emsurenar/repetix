import { openMoveItemModal } from '../ai/client.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { getReviewLog } from '../core/sync.js';
import { escapeHtml } from '../core/utils.js';
import { currentStreak, dailyCounts, mergeLegacyCounts } from '../domain/history.js';
import { loadRecords } from '../domain/stats.js';
import { renderDagensMapp } from './dagens-mapp.js';
import { openDeck, openNotebook } from './deck.js';
import { deckList } from './dom.js';
import { renderSidebar } from './modals-wiring.js';
import { showConfirmModal, showPromptModal } from './modals.js';
import { showToast } from './toast.js';


/* Menyknappens ikon. Tre punkter i stället för tecknet "⋮": ett glyf som
 * saknas i vald font faller tillbaka på systemets, och storleken hoppar då
 * mellan rader. En svg ritar likadant överallt. */
const MENU_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>`;

/* Attributvärde. escapeHtml() går via innerHTML och lämnar citattecken orörda,
 * vilket duger i textinnehåll men inte i ett attribut: en kortlek som heter
 * 5" diskett skulle annars bryta sig ur aria-label. */
const attr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

/* Radmeny som <details>. Knappen är därmed alltid synlig och öppnas av ett
 * tryck — den gamla lösningen låg bakom :hover och gick inte att nå med ett
 * finger. */
const rowMenu = (label, items) => `
    <details class="row-menu">
        <summary class="row-menu-toggle" aria-label="${attr(label)}">${MENU_ICON}</summary>
        <div class="row-menu-items">${items}</div>
    </details>`;


/* Stapelns tre andelar. Ett kort är moget när intervallet passerat tre veckor
 * — då är det inlärt och inte längre under arbete — påbörjat så länge det har
 * ett intervall alls, och osett dessförinnan. Gränsen är den vedertagna i
 * spaced repetition och bär hela skillnaden mellan "kan" och "sett en gång".
 * En enda fylld andel kunde inte visa den skillnaden. */
const MATURE_DAYS = 21;

const deckProgress = (cards) => {
    const total = cards.length;
    if (total === 0) return { maturePct: 0, youngPct: 0 };
    const mature = cards.filter((c) => (c.interval || 0) >= MATURE_DAYS).length;
    const young = cards.filter((c) => (c.interval || 0) > 0 && (c.interval || 0) < MATURE_DAYS).length;
    return {
        maturePct: Math.round((mature / total) * 100),
        youngPct: Math.round((young / total) * 100),
    };
};

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

/* Nyckeltalen överst i biblioteket.
 *
 * Streak och totalsumma räknas ur repetitionsloggen och inte ur
 * card.lastReviewed: det fältet skrivs över vid varje ny repetition och tappar
 * därmed all historik bakåt. Dagsräkningarna från tiden före loggen vävs in,
 * annars skulle en befintlig användares streak nollställas vid uppgraderingen.
 */
const renderLibrarySummary = () => {
    const dueEl = document.getElementById('library-stat-due');
    const streakEl = document.getElementById('library-stat-streak');
    const reviewsEl = document.getElementById('library-stat-reviews');
    if (!dueEl || !streakEl || !reviewsEl) return;

    const now = Date.now();
    const cards = S.appData.decks.flatMap(d => d.cards.filter(c => c.type !== 'note'));
    const due = cards.filter(c => c.nextReviewDate <= now).length;

    const counts = mergeLegacyCounts(dailyCounts(getReviewLog()), loadRecords().dailyCounts);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

    // Svenskt tusentalsavstånd: 1 340 läses snabbare än 1340 i en kolumn.
    const fmt = (n) => n.toLocaleString('sv-SE');

    /* Ett tal som ändrats bekräftar det en gång och är sedan tyst. Utan det
     * byter siffran i tysthet medan man tittar någon annanstans, och man får
     * aldrig veta att repetitionen räknades. Gäller alla tre — att bara ett av
     * dem svarade såg ut som ett fel i de andra två. */
    const satt = (el, varde) => {
        const forra = el.textContent;
        el.textContent = varde;
        if (!forra || forra === varde) return;
        el.classList.remove('is-updated');
        // Framtvingar omstart av animationen även när klassen precis togs bort.
        void el.offsetWidth;
        el.classList.add('is-updated');
    };

    satt(dueEl, fmt(due));
    // Accent bara när det finns något kvar att göra. En nolla ska inte ropa.
    dueEl.classList.toggle('is-accent', due > 0);
    satt(streakEl, fmt(currentStreak(counts)));
    satt(reviewsEl, fmt(total));
};

export const renderLibrary = () => {
    document.getElementById('library-summary')?.removeAttribute('hidden');
    document.getElementById('dagens-mapp-container')?.removeAttribute('hidden');
    renderLibrarySummary();
    renderDagensMapp();
    deckList.innerHTML = '';
    const filter = S.librarySearchFilter.toLowerCase();
    
    // Add dragover/drop on deckList for dropping items outside bookshelves
    deckList.ondragover = (e) => e.preventDefault();
    deckList.ondrop = (e) => {
        e.preventDefault();
        // Check if we dropped on a deck card or bookshelf container
        const closestContainer = e.target.closest('.bookshelf-items');
        if (!closestContainer && S.draggedItemId !== null && S.draggedItemType !== null) {
            if (S.draggedItemType === 'deck') {
                const item = S.appData.decks.find(d => d.id === S.draggedItemId);
                if (item) item.bookshelfId = null;
            } else if (S.draggedItemType === 'notebook') {
                const item = S.appData.notebooks.find(n => n.id === S.draggedItemId);
                if (item) item.bookshelfId = null;
            }
            saveData();
            renderLibrary();
        }
    };

    if (S.appData.decks.length === 0 && S.appData.notebooks.length === 0 && S.appData.bookshelves.length === 0) {
        /* Tre nollor är inget att visa någon som inte hunnit börja. Nyckeltalen
         * och dagens mapp döljs tills de har något att säga, så att sidan har
         * en enda sak på sig: inbjudan. */
        document.getElementById('library-summary')?.setAttribute('hidden', '');
        document.getElementById('dagens-mapp-container')?.setAttribute('hidden', '');

        /* Ett tomt läge är en inbjudan, inte ett kvitto på att det är tomt.
         * Den gamla texten pekade dessutom på en knapp som heter något annat
         * numera, och lämnade läsaren utan något att trycka på. */
        deckList.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="11" x2="13" y2="11"/></svg>
            </div>
            <h3>Här börjar det</h3>
            <p>Skapa en kortlek och lägg in det du vill minnas. Repetix håller reda på när du ska se varje kort igen.</p>
            <div class="empty-state-actions">
                <button type="button" class="btn primary" data-empty-action="create">Skapa din första kortlek</button>
            </div>
        </div>`;
        deckList.querySelector('[data-empty-action="create"]')
            ?.addEventListener('click', () => document.getElementById('btn-create-item-top').click());
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
        /* Kortet ar bibliotekets viktigaste objekt och var enbart musstyrt: en
         * div med klickhanterare, utan tabindex och utan roll. Enda vagen in
         * med tangentbord gick via sidopanelen. */
        itemEl.tabIndex = 0;
        itemEl.setAttribute('role', 'button');
        itemEl.setAttribute('aria-label', `${item.title}, öppna`);
        itemEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('.row-menu')) return;
            e.preventDefault();
            itemEl.click();
        });
        itemEl.draggable = true;
        itemEl.dataset.id = item.id;
        itemEl.dataset.type = type;

        if (type === 'deck') {
            const deckCards = item.cards.filter(c => c.type !== 'note');
            const total = deckCards.length;
            const dueCards = deckCards.filter(c => c.nextReviewDate <= Date.now()).length;
            const { maturePct, youngPct } = deckProgress(deckCards);

            itemEl.innerHTML = `
                <h3 class="deck-card-title">${escapeHtml(item.title)}</h3>
                ${rowMenu(`Åtgärder för ${item.title}`, `
                        <button type="button" class="btn-item-rename">Byt namn</button>
                        <button type="button" class="btn-item-move">Flytta till bokhylla</button>
                        <button type="button" class="btn-item-delete danger">Ta bort</button>`)}
                <div class="deck-card-foot">
                    <div class="progress" aria-hidden="true">
                        <i class="progress-fill" style="width: ${maturePct}%"></i>
                        <i class="progress-fill-soft" style="width: ${youngPct}%"></i>
                    </div>
                    <div class="deck-card-nums">
                        <span class="deck-card-count num">${total} kort</span>
                        <span class="deck-card-due num${dueCards === 0 ? ' is-clear' : ''}">${dueCards} förfallna</span>
                    </div>
                </div>
            `;
            itemEl.onclick = (e) => {
                // Menyn ligger inuti kortet; utan detta öppnar varje menyval
                // också kortleken bakom.
                if (e.target.closest('.row-menu')) return;
                openDeck(item.id);
            };
        } else if (type === 'notebook') {
            const total = item.notes.length;

            itemEl.innerHTML = `
                <h3 class="deck-card-title">${escapeHtml(item.title)}</h3>
                ${rowMenu(`Åtgärder för ${item.title}`, `
                        <button type="button" class="btn-item-rename">Byt namn</button>
                        <button type="button" class="btn-item-move">Flytta till bokhylla</button>
                        <button type="button" class="btn-item-delete danger">Ta bort</button>`)}
                <div class="deck-card-foot">
                    <div class="deck-card-nums">
                        <span class="deck-card-count num">${total} anteckningar</span>
                    </div>
                </div>
            `;
            itemEl.onclick = (e) => {
                if (e.target.closest('.row-menu')) return;
                openNotebook(item.id);
            };
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
                    S.appData.decks = S.appData.decks.filter(d => d.id !== item.id);
                } else {
                    S.appData.notebooks = S.appData.notebooks.filter(n => n.id !== item.id);
                }
                saveData();
                renderLibrary();
                showToast(type === 'deck' ? 'Kortleken har raderats' : 'Anteckningsblocket har raderats');
            }
        });

        itemEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            itemEl.classList.add('dragging');
            S.draggedItemId = item.id;
            S.draggedItemType = type;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', type);
        });

        itemEl.addEventListener('dragend', (e) => {
            e.stopPropagation();
            itemEl.classList.remove('dragging');
            S.draggedItemId = null;
            S.draggedItemType = null;
        });

        itemEl.addEventListener('dragover', (e) => e.preventDefault());
        itemEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            itemEl.classList.remove('drag-over');
            
            if (S.draggedItemId !== null && S.draggedItemType !== null) {
                const sourceList = S.draggedItemType === 'deck' ? S.appData.decks : S.appData.notebooks;
                const targetBookshelfId = item.bookshelfId;
                
                const draggedItem = sourceList.find(i => i.id === S.draggedItemId);
                if (draggedItem) {
                    draggedItem.bookshelfId = targetBookshelfId;
                    
                    if (S.draggedItemType === type && S.draggedItemId !== item.id) {
                        const originalIndex = sourceList.findIndex(i => i.id === S.draggedItemId);
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

    /* Ett platt rutnät. Biblioteket grupperades tidigare i bokhyllor med var
     * sin rubrikrad, meny och egen "Repetera alla" — samma gruppering som
     * sidopanelen redan visar, en gång till och med mer apparat. Hyllan bor nu
     * i panelen; ett tryck på dess etikett filtrerar hit. */
    /* Filtret laker sig sjalvt. Raderas hyllan man star i pekar filtret pa
     * nagot som inte finns, och vyn blir tom med en rubrik som ljuger. */
    if (S.currentBookshelfFilterId && !S.appData.bookshelves.some(b => b.id === S.currentBookshelfFilterId)) {
        S.currentBookshelfFilterId = null;
    }
    const shelfId = S.currentBookshelfFilterId;

    if (shelfId) {
        const backBtn = document.createElement('div');
        backBtn.className = 'library-filter-row';
        backBtn.innerHTML = `<button type="button" class="chip" onclick="filterBookshelf(null)">← Visa alla</button>`;
        deckList.appendChild(backBtn);
    }

    const inScope = (item) => (shelfId ? item.bookshelfId === shelfId : true);

    const getLastUpdated = (item) => {
        let max = parseInt(item.id, 10) || 0;
        const children = item.cards || item.notes || [];
        children.forEach((child) => {
            const time = parseInt(child.id, 10) || 0;
            if (time > max) max = time;
        });
        return max;
    };

    const items = [];
    S.appData.decks.forEach((deck) => {
        if (inScope(deck) && itemMatchesFilter(deck, 'deck', filter)) {
            items.push({ item: deck, type: 'deck', updated: getLastUpdated(deck), done: isDeckFullyReviewed(deck) });
        }
    });
    S.appData.notebooks.forEach((notebook) => {
        if (inScope(notebook) && itemMatchesFilter(notebook, 'notebook', filter)) {
            items.push({ item: notebook, type: 'notebook', updated: getLastUpdated(notebook), done: false });
        }
    });

    // Färdigrepeterat sjunker till botten: det som återstår att göra ska ligga
    // överst utan att man behöver leta.
    items.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return b.updated - a.updated;
    });

    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'bookshelf-empty';
        empty.textContent = filter
            ? 'Inget matchar sökningen.'
            : 'Bokhyllan är tom. Flytta hit en kortlek från dess meny.';
        deckList.appendChild(empty);
    } else {
        items.forEach(({ item, type }) => deckList.appendChild(renderItem(item, type)));
    }

    /* Rubriken säger vad man tittar på. Står man i en bokhylla är det hyllans
     * namn — annars påstår sidan "Bibliotek" medan den visar en delmängd. */
    const shelf = shelfId ? S.appData.bookshelves.find(s => s.id === shelfId) : null;
    const titleEl = document.querySelector('.library-title');
    if (titleEl) titleEl.textContent = shelf ? shelf.title : 'Bibliotek';
    renderShelfMenu(shelf);

    /* Primärknappen repeterar det som visas, inte alltid allt. Bokhyllans egen
     * "Repetera alla" försvann med rubrikraderna, och utan detta hade
     * hyllfiltret inte gått att repetera. */
    const scopedDecks = S.appData.decks.filter(inScope);
    const dueInScope = scopedDecks.flatMap(d => d.cards.filter(c => c.type !== 'note' && c.nextReviewDate <= Date.now()));
    const globalBtn = document.getElementById('btn-study-all');
    const globalLabel = document.getElementById('btn-study-all-label');
    if (dueInScope.length > 0) {
        globalBtn.classList.remove('hidden');
        globalLabel.innerText = shelf ? 'Repetera hyllan' : 'Repetera allt';
    } else {
        globalBtn.classList.add('hidden');
    }

    renderSidebar();
};

/* Bokhyllans åtgärder.
 *
 * De satt tidigare i rubrikraden över varje hylla i rutnätet. Med det platta
 * rutnätet finns de raderna inte längre, och hyllan har bara ett ställe där
 * den är öppnad: den här vyn, filtrerad. Menyn står därför bredvid rubriken
 * och bara då.
 *
 * "Ändra färg" följer inte med. Hyllfärgen ritades ut på rubrikraden som är
 * borta, och en färg vald ur en palett utanför tokens hör ändå inte hemma i
 * "Lugn precision" — kontrollen ändrade ett värde ingen kunde se.
 */
const renderShelfMenu = (shelf) => {
    const host = document.getElementById('library-shelf-menu');
    if (!host) return;

    if (!shelf) {
        host.innerHTML = '';
        return;
    }

    host.innerHTML = rowMenu(`Åtgärder för ${shelf.title}`, `
            <button type="button" class="btn-bookshelf-rename">Byt namn</button>
            <button type="button" class="btn-bookshelf-delete danger">Ta bort</button>`);

    host.querySelector('.btn-bookshelf-rename').addEventListener('click', async () => {
        const newTitle = await showPromptModal('Nytt namn för bokhyllan:', shelf.title);
        if (newTitle && newTitle.trim() !== '') {
            shelf.title = newTitle.trim();
            saveData();
            renderLibrary();
            showToast('Bokhyllan har bytt namn');
        }
    });

    host.querySelector('.btn-bookshelf-delete').addEventListener('click', () => {
        S.currentBookshelfToDelete = shelf.id;
        document.getElementById('modal-delete-bookshelf').classList.remove('hidden');
    });
};

export function initUiLibrary() {

  /* Radmenyerna är <details> och stängs inte av sig själva. Utan detta blir
   * varje öppnad meny liggande kvar, och på en lista med trettio kort står
   * snart lika många menyer öppna samtidigt. Escape stänger också, eftersom
   * en meny som bara går att stänga med musen inte går att stänga alls med
   * tangentbordet. */
  const closeRowMenus = (except) => {
      document.querySelectorAll('.row-menu[open]').forEach((menu) => {
          if (menu !== except) menu.removeAttribute('open');
      });
  };

  document.addEventListener('click', (e) => {
      // Bara menyn vars egen knapp trycktes får stå kvar. Ett tryck på ett
      // menyval stänger menyn, eftersom valet är utfört.
      const toggle = e.target.closest('.row-menu-toggle');
      closeRowMenus(toggle ? toggle.parentElement : null);
  });

  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeRowMenus(null);
  });

  // --- RENDERING ---
  S.draggedItemId = null;
  S.draggedItemType = null;
  S.draggedCardId = null;
  S.currentBookshelfToDelete = null;

  S.librarySearchFilter = '';
}
