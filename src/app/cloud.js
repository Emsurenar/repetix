// Kopplar ihop konto, molndata och den befintliga appen.
//
// Ordningen vid inloggning spelar roll och är inte godtycklig:
//   1. hämta serverns data
//   2. avgör om lokal data ska migreras upp, laddas ner, eller båda finns
//   3. sätt appData och rendera
//   4. sätt diffens utgångsläge SIST, så att serverns egen data inte
//      omedelbart skickas tillbaka som "ändringar"

import { build } from '../domain/model.js';
import { clearUrlCache, collectPendingImages, migrateLocalImages } from '../core/image-store.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import {
  loadFromLocal,
  onRemoteChange,
  onSyncChange,
  primeSnapshot,
  recordChanges,
  startAutoSync,
  sync,
} from '../core/sync.js';
import { cloudConfigured, getUserId, initAuth, signOut, supabase } from '../core/supabase.js';
import { hasSkippedAuth, initAuthUi, openAuth } from '../ui/auth.js';
import { renderDecks } from '../ui/deck.js';
import { renderSidebar } from '../ui/modals-wiring.js';
import { showConfirmModal } from '../ui/modals.js';
import { onViewChange } from '../ui/router.js';
import { showToast } from '../ui/toast.js';

/** Säkerhetskopia av lokal data som inte migrerades. Raderas aldrig automatiskt. */
const LOCAL_BACKUP_KEY = 'repetix_lokal_data_innan_molnet';

const hasContent = (data) =>
  Boolean(data?.decks?.length || data?.notebooks?.length || data?.bookshelves?.length);

let stopAutoSync = null;

/**
 * Startar molnlagret. Anropas en gång vid uppstart, efter att appen renderat
 * sin lokala data — så att en långsam uppkoppling aldrig fördröjer första
 * målningen.
 */
export async function initCloud() {
  if (!cloudConfigured) return;

  await initAuth();

  initAuthUi({
    onSignedIn: async (user) => {
      try {
        await onSignedIn(user);
      } catch (err) {
        console.error('Molnsynk misslyckades vid inloggning:', err);
        showToast('Kunde inte hämta dina kort från molnet. Appen kör vidare lokalt.');
      }
    },
  });

  onSyncChange(renderSyncStatus);
  onRemoteChange(() => void applyRemoteChanges());
  // Nar anvandaren lamnar en repetition eller stanger en modal ar det tryggt
  // att byta in andringar som skjutits upp.
  onViewChange(() => flushPendingRemoteChanges());

  const accountBtn = document.getElementById('btn-account');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      if (getUserId()) void signOutAndClear();
      else openAuth();
    });
  }
  updateAccountButton();

  if (!getUserId() && !hasSkippedAuth()) openAuth();
}

async function onSignedIn() {
  const local = S.appData;
  const localHasData = hasContent(local);

  // Hämta serverns data. Första gången är utkorgen tom och markören står på
  // epoch, så detta blir en full hämtning.
  await sync();
  const rows = await loadFromLocal();
  const remote = build(rows);
  const remoteHasData = hasContent(remote);

  if (!remoteHasData && localHasData) {
    await migrateLocalToCloud(local);
    return;
  }

  if (remoteHasData && localHasData && !sameLibrary(local, remote)) {
    // Båda sidor har innehåll och de skiljer sig. Att slå ihop dem automatiskt
    // vore att gissa; i stället vinner molnet och den lokala datan sparas undan
    // så att ingenting kan gå förlorat.
    try {
      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(local));
    } catch {
      // Utrymmet räcker inte. Molnet vinner ändå, men vi säger till.
    }
    showToast('Molnets data laddades. Din tidigare lokala data finns kvar som säkerhetskopia.');
  }

  applyRemote(remote);
  startBackground();
  void migrateImages();
}

/**
 * Flyttar upp bilder som fortfarande ligger som base64 i lokal lagring.
 *
 * Kors i bakgrunden efter inloggning. En 5 MB mobilbild blir nagra hundra
 * kilobyte i lagringen, vilket ar hela anledningen till att localStorage-kvoten
 * slutar vara ett problem. Migreringen ar aterupptagbar: en bild byts mot sin
 * sokvag forst nar uppladdningen bekraftats.
 */
async function migrateImages() {
  const vantande = collectPendingImages(S.appData);
  if (!vantande.length) return;

  showToast(`Flyttar upp ${vantande.length} bilder till molnet...`);
  try {
    const resultat = await migrateLocalImages(S.appData, null, { persist: saveData });
    const megabyte = resultat.sparadeBytes / 1024 / 1024;
    if (resultat.misslyckade > 0) {
      showToast(
        `${resultat.klara} bilder flyttade, ${resultat.misslyckade} misslyckades och ligger kvar lokalt.`
      );
    } else if (megabyte >= 0.1) {
      showToast(`Bilderna flyttade. ${megabyte.toFixed(1)} MB frigjordes lokalt.`);
    }
    saveData();
  } catch (err) {
    console.error('Bildmigrering misslyckades:', err);
    showToast('Kunde inte flytta alla bilder. De ligger kvar lokalt och forsoks igen senare.');
  }
}

/** Laddar upp lokal data till ett tomt konto. */
async function migrateLocalToCloud(local) {
  const cardCount = (local.decks ?? []).reduce((sum, d) => sum + (d.cards?.length ?? 0), 0);
  const ok = await showConfirmModal(
    'Flytta upp dina kort?',
    `Kontot är tomt. Vill du ladda upp dina ${cardCount} kort och ${local.decks?.length ?? 0} kortlekar hit, så att de finns på alla dina enheter?`,
    'Ladda upp'
  );
  if (!ok) {
    showToast('Inget laddades upp. Du kan göra det senare från inställningarna.');
    startBackground();
    return;
  }

  // primeSnapshot med tomt utgångsläge gör att hela biblioteket räknas som nytt
  // och köas i sin helhet.
  primeSnapshot({ decks: [], notebooks: [], bookshelves: [] });
  const queued = await recordChanges(local);
  await sync();
  showToast(`${queued} poster laddades upp.`);
  startBackground();
}

function applyRemote(remote) {
  S.appData = remote;
  saveData();
  renderDecks();
  renderSidebar();
  // Sist, så att det vi just tog emot inte skickas tillbaka som en ändring.
  primeSnapshot(S.appData);
}

function startBackground() {
  primeSnapshot(S.appData);
  stopAutoSync?.();
  stopAutoSync = startAutoSync();
}

/**
 * Ar det lampligt att byta ut biblioteket under fotterna pa anvandaren just nu?
 *
 * Mitt i en repetition skulle en ombyggnad kasta bort sessionen, och med en
 * oppen modal skulle det redigerade objektet bytas ut. I bada fallen vantar vi
 * i stallet till nasta gang appen ar i vila.
 */
function safeToApplyRemote() {
  if (S.currentViewName === 'study') return false;
  if (document.querySelector('.modal:not(.hidden)')) return false;
  return true;
}

let vantandeFjarrandring = false;

async function applyRemoteChanges() {
  if (!getUserId()) return;
  if (!safeToApplyRemote()) {
    vantandeFjarrandring = true;
    return;
  }
  vantandeFjarrandring = false;
  const remote = build(await loadFromLocal());
  applyRemote(remote);
  showToast('Uppdaterad med andringar fran en annan enhet.');
}

/** Anropas nar appen atervander till vila, sa att uppskjutna andringar landar. */
export function flushPendingRemoteChanges() {
  if (vantandeFjarrandring) void applyRemoteChanges();
}

/**
 * Grov jämförelse av två bibliotek. Används bara för att avgöra om vi behöver
 * varna användaren, så antal räcker — en exakt jämförelse skulle ändå inte
 * kunna avgöra vilken sida som är "rätt".
 */
function sameLibrary(a, b) {
  const count = (data) => ({
    decks: data.decks?.length ?? 0,
    cards: (data.decks ?? []).reduce((s, d) => s + (d.cards?.length ?? 0), 0),
    notebooks: data.notebooks?.length ?? 0,
  });
  const x = count(a);
  const y = count(b);
  return x.decks === y.decks && x.cards === y.cards && x.notebooks === y.notebooks;
}

// ---------------------------------------------------------------------------
// Statusrad
// ---------------------------------------------------------------------------

function updateAccountButton() {
  const btn = document.getElementById('btn-account');
  if (!btn) return;
  btn.hidden = false;
  /* Bara namnet byts. textContent pa hela knappen torkade bort ikonen, och
   * raden hamnade darfor pa ett annat indrag an Spelhallen och Installningar
   * strax ovanfor. */
  const namn = btn.querySelector('.sidebar-item-name');
  const text = getUserId() ? 'Logga ut' : 'Logga in';
  if (namn) namn.textContent = text;
  else btn.textContent = text;
}

function renderSyncStatus(state) {
  updateAccountButton();
  const node = document.getElementById('sync-status');
  if (!node) return;

  if (!getUserId()) {
    node.textContent = 'Lokalt läge';
    node.dataset.state = 'local';
    return;
  }

  /* Sidopanelen bär bara klassen av fel — raden är för smal för en mening.
   * Hela texten står under Inställningar → Konto, se renderaSynk i
   * src/ui/settings.js. Sessionen är undantaget: det är det enda felet
   * användaren själv måste göra något åt, och ordet ryms. */
  const felord = state.errorType === 'session' ? 'Logga in igen' : 'Kunde inte synka';
  const text = {
    syncing: 'Synkar...',
    offline: state.pending ? `Offline, ${state.pending} väntar` : 'Offline',
    error: state.pending ? `${felord}, ${state.pending} väntar` : felord,
    idle: state.pending
      ? `${state.pending} väntar`
      : state.rejected
        ? `Synkad, ${state.rejected} avvisade`
        : 'Synkad',
  };
  node.textContent = text[state.status] ?? '';
  node.dataset.state = state.status;
}

/**
 * Loggar ut och tömmer den lokala spegeln, så att nästa användare inte ser den.
 *
 * `tyst` används efter en kontoradering: då finns varken något att fråga om
 * eller något att synka mot — kontot är redan borta, och en sista synk hade
 * bara gett ett fel att svälja.
 */
export async function signOutAndClear({ tyst = false } = {}) {
  if (!tyst) {
    const ok = await showConfirmModal(
      'Logga ut?',
      'Dina kort finns kvar i molnet. Den lokala kopian på den här enheten tas bort.',
      'Logga ut',
      true
    );
    if (!ok) return;
  }

  stopAutoSync?.();
  stopAutoSync = null;
  if (!tyst) await sync().catch(() => {});
  await signOut();

  clearUrlCache();
  const { clearAll } = await import('../core/local-db.js');
  await clearAll().catch(() => {});
  rensaLokalaNycklar();
  window.location.reload();
}

/* Allt appen äger i localStorage, inte bara biblioteket.
 *
 * Utloggningen tog tidigare bara bort `noji_clone_data`. Kvar låg bland annat
 * `repetix_lokal_data_innan_molnet` — hela biblioteket i klartext, med en
 * kommentar som sa att den aldrig raderas automatiskt — plus dagens mapp och
 * varje spelläges rekord. På en delad dator innebar det att nästa person hade
 * kvar förra personens innehåll på disken.
 *
 * Dialogen lovar redan att "den lokala kopian på den här enheten tas bort".
 * Det här är koden som gör påståendet sant.
 *
 * Prefixmatchning i stället för en lista: ett nytt spelläge som lägger till en
 * rekordnyckel ska inte behöva komma ihåg att uppdatera den här funktionen. */
const EGNA_PREFIX = ['noji_', 'pg_records', 'repetix_', 'spaced_rep_'];

function rensaLokalaNycklar() {
  try {
    const attTa = [];
    for (let i = 0; i < localStorage.length; i++) {
      const nyckel = localStorage.key(i);
      if (nyckel && EGNA_PREFIX.some((p) => nyckel.startsWith(p))) attTa.push(nyckel);
    }
    for (const nyckel of attTa) localStorage.removeItem(nyckel);
  } catch {
    /* Privat läge eller full kvot. IndexedDB är redan tömd, och sidan laddas
     * om ändå — det är inte värt att avbryta en utloggning för. */
  }
}

export { supabase };
