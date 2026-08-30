import { openMoveItemModal } from '../ai/client.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { grupperaPaHylla } from '../domain/hyllgruppering.js';
import { valjMenyplacering } from '../domain/menyplacering.js';
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

/**
 * Flyttar det som dras till en hylla, eller ut ur alla när `hyllId` är null.
 *
 * En enda väg in. Flytten skedde tidigare på tre ställen med var sin kopia av
 * "leta upp i rätt lista, sätt fältet, spara, rita om", och sidopanelen hade
 * ingen alls.
 */
export const flyttaTillHylla = (hyllId) => {
    if (S.draggedItemId === null || S.draggedItemType === null) return false;

    const lista = S.draggedItemType === 'deck' ? S.appData.decks : S.appData.notebooks;
    const objekt = lista.find((i) => i.id === S.draggedItemId);
    if (!objekt || objekt.bookshelfId === hyllId) return false;

    objekt.bookshelfId = hyllId;

    /* Draget släpps här och inte i `dragend`. Omritningen nedan byter ut raden
     * som drogs, och ett element som inte finns kvar får aldrig sitt
     * dragend — tillståndet hade blivit stående och tystat hyllornas egen
     * omordning, som håller sig undan just när något annat dras. */
    S.draggedItemId = null;
    S.draggedItemType = null;

    saveData();
    renderLibrary();
    return true;
};

export const renderLibrary = () => {
    document.getElementById('dagens-mapp-container')?.removeAttribute('hidden');
    renderDagensMapp();
    deckList.innerHTML = '';
    const filter = S.librarySearchFilter.toLowerCase();
    
    /* Ytan utanför grupperna tar bort hyllan. Är vyn indelad hör varje punkt
     * till en grupp, och då är det gruppen som svarar — inte den här. */
    deckList.ondragover = (e) => e.preventDefault();
    deckList.ondrop = (e) => {
        e.preventDefault();
        if (e.target.closest('.library-group')) return;
        flyttaTillHylla(null);
    };

    if (S.appData.decks.length === 0 && S.appData.notebooks.length === 0 && S.appData.bookshelves.length === 0) {
        /* Dagens mapp döljs tills den har något att säga, så att sidan har en
         * enda sak på sig: inbjudan. */
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
                        <span class="deck-card-due num${dueCards === 0 ? ' is-clear' : ''}">${dueCards} väntar</span>
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
        backBtn.innerHTML = '<button type="button" class="chip">← Visa alla</button>';
        // Samma skäl som överallt annars: ett onclick-attribut är kod i en
        // sträng, och det hindrar en CSP med script-src 'self'.
        backBtn.querySelector('button').addEventListener('click', () => window.filterBookshelf(null));
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

    const tomText = (text) => {
        const p = document.createElement('p');
        p.className = 'bookshelf-empty';
        p.textContent = text;
        return p;
    };

    /* En grupp är också hyllans släppyta. Etiketten ensam hade varit ett par
     * rader hög — hela gruppen ger ett mål man träffar utan att sikta. */
    const renderGrupp = (grupp) => {
        const sektion = document.createElement('section');
        sektion.className = 'library-group';
        sektion.dataset.shelfId = grupp.id ?? '';

        const etikett = document.createElement('h2');
        etikett.className = 'library-group-label';
        // Ordet står här och inte i domänmodulen: indelningen är en beräkning,
        // "Utan bokhylla" är gränssnitt.
        etikett.textContent = grupp.titel ?? 'Utan bokhylla';
        sektion.appendChild(etikett);

        const rutnat = document.createElement('div');
        rutnat.className = 'library-group-grid';
        if (grupp.objekt.length) {
            grupp.objekt.forEach(({ item, type }) => rutnat.appendChild(renderItem(item, type)));
        } else {
            // Samma ord som panelens tomma grupp. Ingen uppmaning att dra:
            // dragningen finns inte för fingret, och etiketten säger redan allt.
            rutnat.appendChild(tomText('Tom'));
        }
        sektion.appendChild(rutnat);

        sektion.addEventListener('dragover', (e) => {
            if (S.draggedItemId === null) return;
            e.preventDefault();
            sektion.classList.add('drag-over');
        });
        sektion.addEventListener('dragleave', (e) => {
            // Pekaren passerar barnen på vägen; bara att lämna sektionen räknas.
            if (!sektion.contains(e.relatedTarget)) sektion.classList.remove('drag-over');
        });
        sektion.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sektion.classList.remove('drag-over');
            flyttaTillHylla(grupp.id);
        });

        return sektion;
    };

    /* Indelningen är tillbaka, men inte apparaten. Hyllorna hade förut egen
     * rubrikrad, egen meny och egen "Repetera alla" i rutnätet — samma sak som
     * sidopanelen redan gjorde, en gång till. Kvar är etiketten och rutnätet;
     * åtgärderna bor där de bor.
     *
     * Står man i en hylla ritas ingen etikett: rubriken säger redan dess namn,
     * och en enda grupp är ingen indelning. */
    const visaGrupper = !shelfId && S.appData.bookshelves.length > 0;

    if (!visaGrupper) {
        if (items.length === 0) {
            deckList.appendChild(tomText(filter ? 'Inget matchar sökningen.' : 'Bokhyllan är tom.'));
        } else {
            items.forEach(({ item, type }) => deckList.appendChild(renderItem(item, type)));
        }
    } else {
        const grupper = grupperaPaHylla(items, S.appData.bookshelves, { soker: Boolean(filter) });
        if (grupper.length === 0) deckList.appendChild(tomText('Inget matchar sökningen.'));
        else grupper.forEach((grupp) => deckList.appendChild(renderGrupp(grupp)));
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

  /* Menyn fälls uppåt när det inte finns plats nedåt.
   *
   * Panelen är absolut placerad under sin knapp och visste ingenting om
   * skärmen. På det sista kortet i listan öppnade den sig alltså ut i tomma
   * intet: uppmätt på 375×812 låg alla tre posterna mellan 924 och 1056, och
   * sidan gick inte att rulla längre eftersom kortet redan var sist. Byt namn
   * såg ut att fungera bara för att den ibland hann hamna precis innanför
   * kanten — de två under gjorde det aldrig.
   *
   * Lyssnaren fångar i capture-fasen: toggle bubblar inte från <details>, och
   * en lyssnare per meny hade behövt kopplas om vid varje omritning. Här
   * täcks alla radmenyer i appen av en enda, oavsett vilken vy som ritat dem. */
  document.addEventListener(
      'toggle',
      (e) => {
          const meny = e.target;
          if (!meny.classList?.contains('row-menu')) return;
          const panel = meny.querySelector('.row-menu-items');
          if (!panel) return;

          // Stängd meny lämnar inget läge kvar: nästa gång kan platsen se
          // annorlunda ut, och ett gammalt beslut vore ett fel beslut.
          if (!meny.hasAttribute('open')) {
              panel.classList.remove('row-menu-items-uppat');
              return;
          }

          // Nollställt innan mätningen: annars mäts förra gångens tak.
          panel.classList.remove('row-menu-items-uppat');
          panel.style.removeProperty('--meny-maxhojd');

          const knapp = meny.querySelector('.row-menu-toggle')?.getBoundingClientRect();
          if (!knapp) return;

          /* Den synliga ytan, inte fönstret. På en telefon ligger webbläsarens
           * egen list över fönstrets nederkant, och innerHeight räknar med den
           * ytan — en meny som slutade strax innanför den kanten hamnade
           * alltså halvt bakom listen. visualViewport vet var man faktiskt
           * ser. */
          const vv = window.visualViewport;
          const synligTop = vv?.offsetTop ?? 0;
          const synligBottom = synligTop + (vv?.height ?? window.innerHeight);

          const { uppat, maxHojd } = valjMenyplacering({
              knappTop: knapp.top,
              knappBottom: knapp.bottom,
              panelHojd: panel.getBoundingClientRect().height,
              synligTop,
              synligBottom,
          });

          panel.classList.toggle('row-menu-items-uppat', uppat);
          // Taket är ett mått som bara går att räkna fram här; CSS äger vad
          // som händer med det.
          if (maxHojd !== null) panel.style.setProperty('--meny-maxhojd', `${maxHojd}px`);
      },
      true
  );

  // --- RENDERING ---
  S.draggedItemId = null;
  S.draggedItemType = null;
  S.draggedCardId = null;
  S.currentBookshelfToDelete = null;

  S.librarySearchFilter = '';
}
