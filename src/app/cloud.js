// Kopplar ihop konto, molndata och den befintliga appen.
//
// Ordningen vid inloggning spelar roll och är inte godtycklig:
//   1. hämta serverns data
//   2. avgör om lokal data ska migreras upp, laddas ner, eller båda finns
//   3. sätt appData och rendera
//   4. sätt diffens utgångsläge SIST, så att serverns egen data inte
//      omedelbart skickas tillbaka som "ändringar"

import { build } from '../domain/model.js';
import { S } from '../core/state.js';
import { saveData } from '../core/storage.js';
import {
  loadFromLocal,
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
  btn.textContent = getUserId() ? 'Logga ut' : 'Logga in';
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

  const text = {
    syncing: 'Synkar...',
    offline: state.pending ? `Offline, ${state.pending} väntar` : 'Offline',
    error: state.pending ? `Kunde inte synka, ${state.pending} väntar` : 'Kunde inte synka',
    idle: state.pending ? `${state.pending} väntar` : 'Synkad',
  };
  node.textContent = text[state.status] ?? '';
  node.dataset.state = state.status;
}

/** Loggar ut och tömmer den lokala spegeln, så att nästa användare inte ser den. */
export async function signOutAndClear() {
  const ok = await showConfirmModal(
    'Logga ut?',
    'Dina kort finns kvar i molnet. Den lokala kopian på den här enheten tas bort.',
    'Logga ut',
    true
  );
  if (!ok) return;

  stopAutoSync?.();
  stopAutoSync = null;
  await sync().catch(() => {});
  await signOut();

  const { clearAll } = await import('../core/local-db.js');
  await clearAll().catch(() => {});
  localStorage.removeItem('noji_clone_data');
  window.location.reload();
}

export { supabase };
