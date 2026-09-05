import { deleteSection, openCardModal, openEditCardModal, openMoveCardModal, openMoveSectionModal, openNoteCardModal, openSectionModal } from '../ai/client.js';
import { aiErrorMessage } from '../ai/call.js';
import { fragaKallan } from '../ai/kallfraga.js';
import { laggTill } from '../domain/fragehistorik.js';
import { S } from '../core/state.js';
import { hamtaKallor, taBortKalla } from '../core/sources.js';
import { kortIVyn, sektionerIVyn } from '../domain/deck-view.js';
import { saveData } from '../core/storage.js';
import { escapeHtml } from '../core/utils.js';
import { visaSammanfattning } from './sammanfattning.js';
import { cardList } from './dom.js';
import { fokusera } from './fokus.js';
import { safeParse } from './images.js';
import { renderLatex } from './latex.js';
import { renderLibrary } from './library.js';
import { showConfirmModal } from './modals.js';
import { switchView } from './router.js';
import { renderStudyCard, startSectionStudy, startStudy } from './study.js';
import { showToast } from './toast.js';
import { applyWash } from './wash.js';
import { uppskattadTid } from '../domain/estimate.js';


/* Samma menyikon och samma radmeny som i biblioteket. En <details> är alltid
 * synlig och öppnas av ett tryck; det gamla :hover-beroendet gjorde Redigera,
 * Flytta och Radera oåtkomliga på telefon. */
/* Mappar användaren fällt ut. Lever i minnet, inte i appdatan: det är ett
 * läge i den öppna vyn, inte något som hör till kortleken, och det ska inte
 * följa med i en säkerhetskopia eller synkas mellan enheter. */
const utfallda = new Set();

const MENU_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>`;

/* Attributvärde. escapeHtml() går via innerHTML och lämnar citattecken orörda,
 * vilket duger i textinnehåll men inte i ett attribut: en mapp som heter
 * 5" diskett skulle annars bryta sig ur aria-label. */
const attr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

const rowMenu = (label, items) => `
    <details class="row-menu">
        <summary class="row-menu-toggle" aria-label="${attr(label)}">${MENU_ICON}</summary>
        <div class="row-menu-items">${items}</div>
    </details>`;


export const studyDagensMapp = (deckId, sectionId) => {
    S.currentDeckId = deckId;
    startSectionStudy(sectionId, false);
};

/* Källorna hämtas vid varje öppning i stället för att cachas i S: de ändras
 * sällan, listan är kort, och en cache som blir gammal visar en källa som
 * raderats på en annan enhet. */
export async function renderaKallor(deckId) {
    const lista = document.getElementById('deck-kallor');
    if (!lista) return;

    const kallor = await hamtaKallor(deckId);

    /* Svaret kan komma efter att användaren bytt kortlek — listan är en enda
     * nod som delas av alla lekar, och ett sent svar hade ritat fel leks källor
     * under rätt leks rubrik. */
    if (deckId !== S.currentDeckId) return;

    lista.hidden = kallor.length === 0;
    lista.innerHTML = '';

    for (const kalla of kallor) {
        const li = document.createElement('li');
        li.className = 'deck-kalla';
        li.dataset.kalla = kalla.id;

        const namn = document.createElement('span');
        namn.className = 'deck-kalla-namn';
        namn.textContent = kalla.title;

        const meta = document.createElement('span');
        meta.className = 'deck-kalla-meta num';
        meta.textContent = `${kalla.pages} sidor · ${kalla.chars.toLocaleString('sv-SE')} tecken`;

        const generera = document.createElement('button');
        generera.type = 'button';
        generera.className = 'btn';
        generera.dataset.kallaHandling = 'generera';
        generera.textContent = 'Generera kort';
        generera.addEventListener('click', () => {
          // 1. Öppna modalen. Detta nollställer S.aiGeneratorOptions helt.
          document.getElementById('btn-open-topic-generator').click();

          // 2. Först nu går det att peka ut källan — ett sourceId satt före
          //    klicket hade skrivits över av återställningen.
          S.aiGeneratorOptions.sourceId = kalla.id;

          // 3. Visa segmentet och välj det. Återställningen gömde det, eftersom den
          //    inte kan veta att modalen öppnades från en källa.
          const segment = document.getElementById('toggle-source-kalla');
          segment.hidden = false;
          segment.click();
          document.getElementById('kalla-vald-namn').textContent = kalla.title;
        });

        const fraga = document.createElement('button');
        fraga.type = 'button';
        fraga.className = 'btn';
        fraga.dataset.kallaHandling = 'fraga';
        fraga.textContent = 'Ställ en fråga';
        fraga.addEventListener('click', () => oppnaFragepanel(kalla));

        const bort = document.createElement('button');
        bort.type = 'button';
        bort.className = 'btn text';
        bort.dataset.kallaHandling = 'bort';
        bort.textContent = 'Ta bort';
        bort.addEventListener('click', async () => {
            const { ok } = await taBortKalla(kalla.id);
            if (!ok) return showToast('Kunde inte ta bort källan.');
            /* hamtaKalltext filtrerar inte på deleted_at, så frågepanelen
             * skulle annars fortsätta svara mot en källa som just försvunnit
             * ur listan. Samma återställning som openDeck gör vid ett byte
             * av kortlek. */
            if (fragadKalla?.id === kalla.id) {
                fragadKalla = null;
                fragehistorik = [];
                document.getElementById('deck-kallfraga')?.classList.add('hidden');
                const svarsrutan = document.getElementById('deck-kallfraga-svar');
                if (svarsrutan) svarsrutan.innerHTML = '';
            }
            void renderaKallor(deckId);
        });

        li.append(namn, meta, generera, fraga, bort);
        lista.appendChild(li);
    }
}

/* Historiken lever här och sparas aldrig: den hör till den öppna vyn, inte till
 * kortleken, och ska varken följa med i en säkerhetskopia eller synkas. */
let fragehistorik = [];
let fragadKalla = null;

function oppnaFragepanel(kalla) {
  fragadKalla = kalla;
  fragehistorik = [];
  const panel = document.getElementById('deck-kallfraga');
  panel.classList.remove('hidden');
  document.getElementById('deck-kallfraga-kalla').textContent = kalla.title;
  document.getElementById('deck-kallfraga-svar').innerHTML = '';
  fokusera(document.getElementById('deck-kallfraga-input'));
}

export function initUiKallfraga() {
  const knapp = document.getElementById('btn-kallfraga');
  const falt = document.getElementById('deck-kallfraga-input');
  if (!knapp || !falt) return;

  const fraga = async () => {
    // Enter kan hamras i klump. Utan spärren startar varje extra tryck ett
    // nytt anrop som kapplöper mot den pågående cacheskrivningen och betalar
    // för hela dokumentet igen — knappen är redan avaktiverad så länge ett
    // svar väntas in.
    if (knapp.disabled) return;
    const text = falt.value.trim();
    if (!text || !fragadKalla) return;

    // Vilken källa frågan gällde. Panelen kan ha bytt källa medan svaret var på
    // väg, och ett svar som landar i fel källas historik följer sedan med som
    // sammanhang till ett helt annat dokument.
    const gallerKalla = fragadKalla;

    knapp.disabled = true;
    knapp.textContent = 'Frågar...';
    try {
      const svar = await fragaKallan({
        sourceId: gallerKalla.id,
        fraga: text,
        historik: fragehistorik,
      });
      if (fragadKalla !== gallerKalla) return;
      fragehistorik = laggTill(fragehistorik, text, svar);
      falt.value = '';
      ritaHistorik();
    } catch (e) {
      showToast(aiErrorMessage(e));
    } finally {
      knapp.disabled = false;
      knapp.textContent = 'Fråga';
    }
  };

  knapp.addEventListener('click', () => void fraga());
  falt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void fraga();
  });
}

/* Frågan är användarens egen ordagranna text — den tolkas aldrig som markup
 * och förblir textContent. Svaret däremot kommer från en modell som ombetts
 * skriva LaTeX mellan dollartecken och markdown för struktur (se SYSTEM i
 * kallfraga.js); textContent hade visat formlerna som råa dollartecken och
 * kollapsat styckesbrytningar. safeParse saniterar med DOMPurify innan
 * innerHTML sätts, så det här försvagar inte regeln mot rå markup. */
function ritaHistorik() {
  const rutan = document.getElementById('deck-kallfraga-svar');
  rutan.innerHTML = '';
  for (const tur of fragehistorik) {
    const f = document.createElement('p');
    f.className = 'deck-kallfraga-fraga';
    f.textContent = tur.fraga;
    const s = document.createElement('div');
    s.className = 'deck-kallfraga-text';
    s.innerHTML = safeParse(tur.svar);
    renderLatex(s);
    rutan.append(f, s);
  }
}

// Update existing renderDecks calls to renderLibrary
/* Kortförslaget står i verktygsraden och inte i panelen. Det döljs på samma
 * villkor som panelen: under två kort finns det ingen lucka att peka på. */
const aiKnapparSynliga = (synliga) => {
    const knapp = document.getElementById('btn-ai-suggest');
    if (knapp) knapp.hidden = !synliga;
    synkaVerktygsmenyn();
};

/* Telefonens AI-meny speglar knapparna i raden.
 *
 * Varje val pekar på en knapp med data-proxy och trycker på den. Knapparna
 * döljs och visas på flera ställen — sortering när det finns osorterade kort,
 * insikterna när leken har minst två — och menyn måste följa med, annars
 * står "Sortera i mappar" kvar i menyn som ett val som bara kan misslyckas.
 * Därför räknas synligheten om vid varje tillfälle som rör knapparna, ur
 * knapparna själva, i stället för att varje ställe också ska minnas menyn. */
const synkaVerktygsmenyn = () => {
    const meny = document.getElementById('deck-toolbar-menu');
    if (!meny) return;
    for (const val of meny.querySelectorAll('[data-proxy]')) {
        const mal = document.getElementById(val.dataset.proxy);
        val.hidden = !mal || mal.hidden || mal.classList.contains('hidden');
    }
};

export function initDeckToolbarMenu() {
    const meny = document.getElementById('deck-toolbar-menu');
    if (!meny) return;
    meny.addEventListener('click', (e) => {
        const val = e.target.closest('[data-proxy]');
        if (!val) return;
        // Menyn stängs innan knappen trycks: dialogen som öppnas ska inte
        // lämna en utfälld meny bakom sig.
        meny.removeAttribute('open');
        document.getElementById(val.dataset.proxy)?.click();
    });
}

/** Panelen visas först när den har något att visa. */
export const visaInsikt = (box) => {
    box.hidden = false;
    document.getElementById('deck-ai-insights')?.classList.remove('hidden');
};

export const renderDecks = renderLibrary;

export const openDeck = (id, sectionId = null) => {
    /* Frågepanelen hör till en källa i EN kortlek. Den är en enda nod som alla
     * lekar delar, så utan den här återställningen står förra lekens källa och
     * svar kvar under den nya lekens rubrik — och en ny fråga går fortfarande
     * till fel dokument. */
    fragadKalla = null;
    fragehistorik = [];
    document.getElementById('deck-kallfraga')?.classList.add('hidden');
    const svarsrutan = document.getElementById('deck-kallfraga-svar');
    if (svarsrutan) svarsrutan.innerHTML = '';

    S.currentDeckId = id;
    S.currentSectionId = sectionId;
    const deck = S.appData.decks.find(d => d.id === id);
    const section = sectionId ? deck.sections?.find(s => s.id === sectionId) : null;
    document.getElementById('current-deck-title').innerText = section ? `${deck.title} › ${section.title}` : deck.title;

    const displayCards = kortIVyn(deck, sectionId);

    const dueCount = displayCards.filter(c => c.nextReviewDate <= Date.now()).length;

    // Underrubrik med kortlekens två tal, så att omfattningen syns direkt under
    // titeln i stället för att behöva räknas ihop ur listan.
    const metaEl = document.getElementById('current-deck-meta');
    if (metaEl) {
        const studyable = displayCards.filter(c => c.type !== 'note').length;
        metaEl.innerHTML = dueCount > 0
            ? `${studyable} kort <span class="deck-heading-due">${dueCount} väntar</span>`
            : `${studyable} kort`;
    }

    /* Kortlekens ingång. Tre lägen, samma form: en etikett, en mening, en
     * underrad och en knapp som bär handlingen. Panelen följer "Dagens mapp" i
     * biblioteket — det är samma sorts påstående, och det ska se likadant ut.
     *
     * EN mall och tre uppsättningar värden, inte tre mallar. De tre var
     * tidigare utskrivna var för sig och gled isär: de tysta lägena hade två
     * rader och en liten knapp medan det brådskande hade tre rader och en stor,
     * så rutan bytte höjd beroende på vad den hade att säga. Mätt till 99 mot
     * 124 pixlar, och knappen till 34 mot 40. En mall kan inte glida isär.
     *
     * Knappen är stor i alla tre. Kommentaren vid .btn.lg reserverade den för
     * dagens repetition, men panelen har alltid exakt en handling och ska
     * alltid se ut som det — det tysta bärs av is-quiet, som dämpar
     * kantstrecket. */
    const heroStatus = document.getElementById('deck-hero-status');
    const studyable = displayCards.filter(c => c.type !== 'note').length;

    const lage =
        studyable === 0
            ? {
                  tyst: true,
                  handling: 'new',
                  kicker: 'Tom kortlek',
                  titel: 'Inga kort i leken ännu',
                  meta: '',
                  knapp: 'Nytt kort',
              }
            : dueCount === 0
              ? {
                    tyst: true,
                    handling: 'study-early',
                    kicker: 'Klart för idag',
                    titel: 'Inget väntar just nu',
                    meta: '',
                    knapp: 'Träna ändå',
                }
              : {
                    tyst: false,
                    handling: 'study',
                    kicker: 'Att repetera',
                    titel: `<span class="num">${dueCount}</span> kort väntar`,
                    meta: uppskattadTid(dueCount) || '',
                    knapp: 'Repetera',
                };

    heroStatus.className = `deck-hero hero-wash${lage.tyst ? ' is-quiet' : ''}`;
    /* Tom lek har ingen repetition att starta, så knappen i sidhuvudet ska
     * fortsätta göra ingenting. Panelens egen knapp leder dit den ska. */
    heroStatus.dataset.action = studyable === 0 ? '' : lage.handling;
    heroStatus.innerHTML = `
        <div class="deck-hero-body">
            <p class="label deck-hero-kicker">${lage.kicker}</p>
            <p class="deck-hero-title">${lage.titel}</p>
            <p class="deck-hero-meta">${lage.meta}</p>
        </div>
        <button type="button" class="btn primary lg" data-hero-action="${lage.handling}">${lage.knapp}</button>
    `;

    applyWash(heroStatus, S.currentDeckId);
    void renderaKallor(id);

    heroStatus.querySelector('[data-hero-action]')?.addEventListener('click', (e) => {
        const handling = e.currentTarget.dataset.heroAction;
        if (handling === 'new') document.getElementById('btn-add-card').click();
        else document.getElementById('btn-study').click();
    });

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

    /* Kortförslaget: handlingen bor i verktygsraden, panelen är ett rent
     * utdatafack som syns först när den har något att visa. En tom ruta med
     * en knapp i var en ruta i en ruta, och den tog en egen våning mellan
     * lekens ingång och dess kort. */
    const insightsContainer = document.getElementById('deck-ai-insights');
    const deckCards = deck.cards.filter(c => c.type !== 'note');
    if (!sectionId && deckCards.length >= 2) {
        aiKnapparSynliga(true);

        // Förslaget är alltid nytt: det gamla gällde en kortlek som kan ha
        // ändrats sedan dess.
        const suggestionContent = document.getElementById('deck-ai-suggestion-content');
        const suggestionBox = document.getElementById('deck-ai-suggestion');
        suggestionContent.innerHTML = '';
        suggestionBox.classList.remove('deck-ai-loaded');
        suggestionBox.hidden = true;
    } else {
        aiKnapparSynliga(false);
    }
    insightsContainer.classList.add('hidden');

    /* Meningen under titeln. openDeck körs efter varje ändring i leken, så
     * det här är det enda stället regeln "ny mening när leken ändrats"
     * behöver. I en mapp döljs den: titeln är då mappens, och meningen
     * beskriver hela leken. */
    visaSammanfattning(deck, { visa: !sectionId });
};

const renderCardItem = (card, deck) => {
    const isDue = card.nextReviewDate <= Date.now();
    const listItem = document.createElement('div');
    listItem.id = 'card-' + card.id;
    listItem.className = 'list-item';
    listItem.setAttribute('draggable', 'true');

    listItem.innerHTML = `
        <div class="list-item-content">
            <div class="question">${safeParse(card.front)}</div>
            <div class="answer"><div class="answer-inner"><div class="answer-body">${safeParse(card.back)}</div></div></div>
        </div>
        <div class="list-item-right">
            <span class="card-state${isDue ? ' is-due' : ''}" title="${isDue ? 'Ska repeteras' : 'Väntar'}"></span>
            ${rowMenu('Åtgärder för kortet', `
                    <button type="button" class="btn-study-card">Repetera direkt</button>
                    <button type="button" class="btn-edit-card">Redigera</button>
                    <button type="button" class="btn-move-card">Flytta</button>
                    <button type="button" class="btn-delete-card danger">Ta bort</button>`)}
        </div>
    `;

    listItem.addEventListener('click', (e) => {
        if (e.target.closest('.row-menu')) return;
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
        S.draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id); // Explicit data transfer
        e.stopPropagation();
    });
    
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        S.draggedCardId = null;
    });

    listItem.querySelector('.btn-study-card').addEventListener('click', (e) => {
        e.stopPropagation();
        S.currentStudyCards = [card];
        S.currentStudyIndex = 0;
        renderStudyCard();
        switchView('study');
    });
    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera kort', 'Är du säker på att du vill radera detta kort?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(kortIVyn(deck, S.currentSectionId));
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
        <div class="list-item-right">
            ${rowMenu('Åtgärder för anteckningen', `
                    <button type="button" class="btn-edit-note-card">Redigera</button>
                    <button type="button" class="btn-delete-card danger">Ta bort</button>`)}
        </div>
    `;

    listItem.addEventListener('dragstart', (e) => {
        S.draggedCardId = card.id;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('cardId', card.id);
        e.stopPropagation();
    });
    listItem.addEventListener('dragend', () => {
        listItem.classList.remove('dragging');
        S.draggedCardId = null;
    });

    listItem.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showConfirmModal('Radera anteckning', 'Är du säker på att du vill radera denna anteckning?', 'Radera', true)) {
            deck.cards = deck.cards.filter(c => c.id !== card.id);
            saveData();
            renderCards(kortIVyn(deck, S.currentSectionId));
        }
    });

    listItem.querySelector('.btn-edit-note-card').addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteCardModal(card);
    });

    renderLatex(listItem);
    return listItem;
};

export const renderCards = (cards) => {
    cardList.innerHTML = '';
    const deck = S.appData.decks.find(d => d.id === S.currentDeckId);
    if (!deck) return;

    /* AI-sortera vilar på att det finns lösa kort att lägga i mappar. Fanns
     * knappen ändå var enda utfallet av ett klick ett meddelande om att den
     * inte hade något att göra — en knapp som bara kan misslyckas.
     *
     * Härledningen låg tidigare i openDeck, och uppdaterades därför bara när
     * kortleken öppnades. Sparade man AI-genererade kort ritades listan om
     * men knappen inte, så den dök upp först efter en omladdning. Här är den
     * granne med samma data den vilar på, och varje väg som ritar om listan
     * uppdaterar den.
     *
     * Villkoret räknar HELA leken även när en mapp är öppen, eftersom
     * sorteringen gör det. */
    const osorterade = deck.cards.filter(c => !c.sectionId && c.type !== 'note').length;
    const sortBtn = document.getElementById('btn-ai-sort');
    if (sortBtn) sortBtn.hidden = osorterade === 0;
    synkaVerktygsmenyn();

    /* Vyn är den delmängd anroparen skickade in, inte hela leken.
     *
     * Listan lästes tidigare ur deck.cards oavsett vad som kom in, medan
     * rubriken och talen räknade delmängden. En öppnad mapp visade alltså
     * hela lekens innehåll under en rubrik som sa "2 kort". */
    const sections = sektionerIVyn(deck, S.currentSectionId);

    if (cards.length === 0 && sections.length === 0) {
        cardList.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
            </div>
            <h3>Kortleken väntar på sitt första kort</h3>
            <p>Skriv in ett själv, eller låt AI:n föreslå kort utifrån ett ämne eller en text du klistrar in.</p>
            <div class="empty-state-actions">
                <button type="button" class="btn primary" data-empty-action="card">Nytt kort</button>
                <button type="button" class="btn" data-empty-action="ai">AI-generera</button>
            </div>
        </div>`;
        cardList.querySelector('[data-empty-action="card"]')
            ?.addEventListener('click', () => document.getElementById('btn-add-card').click());
        cardList.querySelector('[data-empty-action="ai"]')
            ?.addEventListener('click', () => document.getElementById('btn-open-topic-generator').click());
        return;
    }

    // Render Root Section (cards without sectionId)
    const rootCards = cards.filter(c => !c.sectionId);
    if (rootCards.length > 0 || sections.length > 0) {
        const rootContainer = document.createElement('div');
        rootContainer.className = 'section-container root-section';
        rootContainer.innerHTML = `<div class="section-items"><div class="section-items-inner list-container"></div></div>`;
        const itemsList = rootContainer.querySelector('.section-items-inner');
        
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
            const cardId = e.dataTransfer.getData('cardId') || S.draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = null;
                    saveData();
                    renderCards(kortIVyn(deck, S.currentSectionId));
                }
            }
        });

        rootCards.forEach(card => {
            itemsList.appendChild(card.type === 'note' ? renderNoteCardItem(card, deck) : renderCardItem(card, deck));
        });
        cardList.appendChild(rootContainer);
    }

    // Render Sections
    sections.forEach(section => {
        const cardsInSection = cards.filter(c => c.sectionId === section.id);
        const dueInSection = cardsInSection.filter(c => c.nextReviewDate <= Date.now() && c.type !== 'note').length;

        const sectionEl = document.createElement('div');
        sectionEl.id = 'section-' + section.id;
        // Ihopfälld är förvalet, men det användaren själv fällt ut ska stå kvar.
        // Klassen sattes tidigare hårt vid varje rendering, och eftersom varje
        // radering, namnbyte och drag-släpp ritar om listan slog mappen igen
        // mitt framför den som arbetade i den.
        sectionEl.className = utfallda.has(section.id)
            ? 'section-container'
            : 'section-container collapsed';
        // Utfällningsknappen är ett <button> och inte en <div>: mappar måste gå
        // att fälla ut med tangentbordet, inte bara med musen. Räknetalen ligger
        // utanför knappen eftersom en knapp inte får innehålla en annan knapp.
        sectionEl.innerHTML = `
            <div class="section-header">
                <button type="button" class="section-header-left" aria-expanded="${utfallda.has(section.id)}" title="Fäll ut eller in mappen">
                    <svg class="section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    <span class="section-title">${escapeHtml(section.title)}</span>
                </button>
                <span class="section-count num">${cardsInSection.length} kort</span>
                ${dueInSection > 0 ? `<button type="button" class="section-due num btn-section-study" title="Repetera mappen nu" aria-label="${dueInSection} kort väntar, repetera mappen">${dueInSection}<span class="section-due-word"> väntar</span></button>` : ''}
                <div class="section-tools">
                    <button type="button" class="btn-icon btn-section-add-card" title="Lägg till kort i ${attr(section.title)}" aria-label="Lägg till kort i ${attr(section.title)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    ${rowMenu(`Åtgärder för ${section.title}`, `
                            <button type="button" class="btn-section-rename">Byt namn</button>
                            <button type="button" class="btn-section-move">Flytta</button>
                            <button type="button" class="btn-section-delete danger">Ta bort</button>`)}
                </div>
            </div>
            <div class="section-items"><div class="section-items-inner list-container"></div></div>
        `;

        const sectionHeader = sectionEl.querySelector('.section-header');
        /* Korten hänger i ETT barn under .section-items, inte som N syskon.
         *
         * Ihopfällningen krymper en rutnätsrad från 1fr till 0fr, och
         * grid-template-rows styr bara de EXPLICITA raderna. Låg korten som
         * syskon hamnade kort nummer två och framåt i implicita rader som
         * regeln inte når: mappen såg ihopfälld ut, första kortet klämdes till
         * en remsa, och resten stod kvar i full höjd. */
        const sectionItems = sectionEl.querySelector('.section-items-inner');

        sectionEl.querySelector('.btn-section-study')?.addEventListener('click', (e) => {
            e.stopPropagation();
            startSectionStudy(section.id, false);
        });

        const addCardBtn = sectionEl.querySelector('.btn-section-add-card');
        addCardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            S.preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });
        
        if (cardsInSection.length === 0) {
            sectionItems.innerHTML = '<p class="section-empty">Inga kort ännu</p>';
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
            const cardId = e.dataTransfer.getData('cardId') || S.draggedCardId;
            
            if (cardId) {
                const card = deck.cards.find(c => c.id === cardId);
                if (card) {
                    card.sectionId = section.id;
                    saveData();
                    renderCards(kortIVyn(deck, S.currentSectionId));
                }
            }
        });

        // Collapse toggle
        sectionEl.querySelector('.section-header-left').addEventListener('click', (e) => {
            const collapsed = sectionEl.classList.toggle('collapsed');
            e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed) utfallda.delete(section.id);
            else utfallda.add(section.id);
        });

        // Double-click header to study section
        sectionEl.querySelector('.section-header-left').addEventListener('dblclick', () => {
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
            S.preselectSectionId = section.id;
            document.getElementById('btn-add-card').click();
        });

        cardList.appendChild(sectionEl);
    });
};

export const openNotebook = (id) => {
    S.currentNotebookId = id;
    const notebook = S.appData.notebooks.find(n => n.id === id);
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
            <div class="list-item-right">
                ${rowMenu('Åtgärder för anteckningen', `
                        <button type="button" class="btn-edit-note">Redigera</button>
                        <button type="button" class="btn-delete-note danger">Ta bort</button>`)}
            </div>
        `;

        noteEl.onclick = (e) => {
            if (e.target.closest('.row-menu')) return;
            S.currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Visa anteckning';
            switchView('addNote');
        };

        noteEl.querySelector('.btn-delete-note').onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirmModal('Radera anteckning', 'Vill du verkligen radera denna anteckning?', 'Radera', true)) {
                const notebook = S.appData.notebooks.find(n => n.id === S.currentNotebookId);
                notebook.notes = notebook.notes.filter(n => n.id !== note.id);
                saveData();
                renderNotes(notebook.notes);
            }
        };

        noteEl.querySelector('.btn-edit-note').onclick = (e) => {
            e.stopPropagation();
            S.currentNoteId = note.id;
            document.getElementById('note-content').value = note.content;
            document.getElementById('note-form-title').innerText = 'Redigera anteckning';
            switchView('addNote');
        };

        noteList.appendChild(noteEl);
        renderLatex(noteEl);
    });
};
