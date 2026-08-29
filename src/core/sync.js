// Synk mellan den lokala spegeln och Supabase.
//
// Modellen är offline först. Appen läser och skriver alltid lokalt och blir
// aldrig blockerad av nätet. Ändringar köas i en utkorg och skickas när det
// går. Det betyder att en repetition i tunnelbanan räknas direkt och laddas upp
// när täckningen kommer tillbaka.
//
// Konflikter löses per rad med senaste ändring vinner. Repetitionsloggen kan
// aldrig konflikta eftersom rader bara läggs till.

import {
  ackOutbox,
  ackReviews,
  appendReviews,
  clearAll,
  enqueue,
  getAllRows,
  getMeta,
  getOutbox,
  getPendingReviews,
  getReviewsSince,
  outboxSize,
  putRows,
  setMeta,
} from './local-db.js';
import { collapse, diffSnapshots, groupForSend } from '../domain/diff.js';
import { TABLES, flatten } from '../domain/model.js';
import { getUserId, supabase } from './supabase.js';

/** Hur många rader som skickas per anrop. Håller förfrågningarna små nog att
 *  lyckas på en skakig mobiluppkoppling. */
const BATCH = 200;

/**
 * Markör för inkrementell hämtning: allt som ändrats efter denna tidpunkt.
 *
 * Namnrymdad per användare. En delad markör hade betytt att nästa konto på
 * samma enhet börjar hämta från förra kontots synktid, och allt äldre än så
 * hade aldrig kommit ner — ett halvtomt bibliotek utan felmeddelande.
 */
const cursorKey = (userId) => `sync:cursor:${userId}`;

/** Vem den lokala spegeln tillhör. Se claimMirror. */
const OWNER_KEY = 'sync:owner';

const listeners = new Set();
const remoteListeners = new Set();
const wipeListeners = new Set();
let state = { status: 'idle', pending: 0, lastSyncedAt: null, error: null };
let running = null;
let queued = false;
let lastSnapshot = null;
let debounce = null;

export function onSyncChange(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function getSyncState() {
  return state;
}

/**
 * Prenumerera pa att servern hade nya rader at oss.
 *
 * Sarskild fran onSyncChange eftersom mottagaren maste bygga om biblioteket
 * och rendera om — och det far inte ske mitt i en repetition. Beslutet om NAR
 * det ar lampligt hor hemma i granssnittslagret, inte har.
 */
export function onRemoteChange(fn) {
  remoteListeners.add(fn);
  return () => remoteListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Utgående: lokala ändringar till servern
// ---------------------------------------------------------------------------

/**
 * Jämför biblioteket mot förra ögonblicksbilden och köar det som ändrats.
 *
 * Anropas efter varje sparning. Är billigt nog att köra ofta: en diff över
 * några tusen kort tar under en millisekund, och alternativet — att skriva om
 * appens fyrtiotal mutationsställen till att anmäla sin egen avsikt — hade
 * gett en tyst felkälla varje gång någon glömmer ett anrop.
 */
export async function recordChanges(appData) {
  const userId = getUserId();
  if (!userId) return 0;

  const next = flatten(appData, userId);
  const mutations = diffSnapshots(lastSnapshot, next);
  lastSnapshot = next;
  if (!mutations.length) return 0;

  await enqueue(mutations);
  setState({ pending: await outboxSize() });
  scheduleSync();
  return mutations.length;
}

/**
 * Sätter utgångsläget för diffen utan att köa något.
 * Används efter en hämtning, så att serverns data inte skickas tillbaka.
 */
export function primeSnapshot(appData) {
  const userId = getUserId();
  lastSnapshot = userId ? flatten(appData, userId) : null;
}

/**
 * Loggar en repetition. Skrivs lokalt direkt och laddas upp vid nästa synk.
 *
 * Loggas även när ingen är inloggad. `user_id` fylls i vid uppladdningen, så
 * att repetitioner gjorda innan man skapat konto inte går förlorade utan följer
 * med upp när kontot väl finns.
 */
export async function recordReview(row) {
  await appendReviews([row]);
  if (reviewLog) reviewLog.push(row);
  if (getUserId()) scheduleSync();
}

// Repetitionsloggen hålls i minnet så att Spelhallen kan räkna statistik
// synkront under rendering. Loggen är liten: några tiotal byte per rad.
let reviewLog = null;

/** Läser in loggen från den lokala databasen. Anropas en gång vid uppstart. */
export async function loadReviewLog() {
  reviewLog = await getReviewsSince();
  return reviewLog;
}

/** Loggen som den ser ut just nu. Tom array innan den lästs in. */
export function getReviewLog() {
  return reviewLog ?? [];
}

async function pushOutbox() {
  const pending = await getOutbox(BATCH * 4);
  if (!pending.length) return 0;

  const collapsed = collapse(pending);
  const { upserts, deletes } = groupForSend(collapsed);

  for (const { table, rows } of upserts) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      // deleted_at nollställs explicit: en rad som återskapats lokalt med samma
      // id ska sluta vara raderad, inte förbli osynlig för andra enheter.
      const payload = chunk.map((r) => ({ ...r, deleted_at: null }));
      const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  for (const { table, ids } of deletes) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      /* Bildens fil måste hämtas INNAN raden märks som raderad — efteråt är
       * sökvägen inte längre läsbar. */
      const filer = table === 'card_images' ? await hamtaBildvagar(chunk) : [];

      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .in('id', chunk);
      if (error) throw error;

      await taBortFiler(filer);
    }
  }

  await ackOutbox(pending.map((m) => m.seq));
  return pending.length;
}

/**
 * Sökvägarna till de bilder som är på väg att raderas.
 *
 * Mjuk radering satte tidigare bara `deleted_at` och lämnade filen i hinken.
 * Ur användarens synvinkel var raderingen alltså inte en radering: bilden låg
 * kvar hos leverantören i obegränsad tid, och vid en kontoradering blev den
 * dessutom föräldralös.
 */
async function hamtaBildvagar(ids) {
  const { data, error } = await supabase
    .from('card_images')
    .select('storage_path')
    .in('id', ids);
  if (error) return [];
  return (data ?? []).map((rad) => rad.storage_path).filter(Boolean);
}

/**
 * Filen tas efter att raden märkts, inte före.
 *
 * Misslyckas det blir filen föräldralös — men raden är redan borta ur
 * användarens vy, och att kasta här hade stoppat hela synken för en bild som
 * ingen längre ser. En föräldralös fil är ett städproblem; en död synk är ett
 * dataproblem.
 */
async function taBortFiler(vagar) {
  if (!vagar.length) return;
  try {
    const { deleteImage } = await import('./image-store.js');
    for (const vag of vagar) await deleteImage(vag);
  } catch (fel) {
    console.error('Kunde inte radera bildfiler', fel);
  }
}

async function pushReviews() {
  const pending = await getPendingReviews(BATCH);
  if (!pending.length) return 0;
  const userId = getUserId();
  // Rader loggade före inloggning saknar ägare. De tillhör den som nu är
  // inloggad — det är samma enhet och samma person som gjorde repetitionen.
  const rows = pending.map((r) => ({ ...r, user_id: r.user_id ?? userId }));
  /* id genereras lokalt så att en uppladdning som skickas två gånger — efter en
   * timeout där svaret ändå kom fram — inte skapar dubbletter i loggen.
   *
   * ignoreDuplicates är inte en detalj. Utan den blir upsert ett
   * `ON CONFLICT DO UPDATE`, och reviews saknar MED FLIT update-policy
   * (loggen är append-only). En verklig krock fick alltså radnivåsäkerheten
   * att neka och hela anropet att kasta — och eftersom pushReviews ligger före
   * pull() i synken innebar det att inkommande hämtning aldrig kördes igen.
   * Synken var permanent död, och användaren såg bara "Kunde inte synka".
   *
   * Två öppna flikar räckte för att utlösa det: båda läser samma köade rader
   * innan någon hinner kvittera. Med ignoreDuplicates blir det
   * `ON CONFLICT DO NOTHING`, som aldrig rör update-vägen. */
  const { error } = await supabase
    .from('reviews')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  await ackReviews(pending.map((r) => r.id));
  return pending.length;
}

// ---------------------------------------------------------------------------
// Inkommande: serverns ändringar till den lokala spegeln
// ---------------------------------------------------------------------------

async function pull() {
  const nyckel = cursorKey(getUserId());
  const since = await getMeta(nyckel, new Date(0).toISOString());
  let newest = since;

  for (const table of TABLES) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + BATCH - 1);
      if (error) throw error;
      if (!data.length) break;

      await putRows(table, data);
      for (const row of data) if (row.updated_at > newest) newest = row.updated_at;

      if (data.length < BATCH) break;
      from += BATCH;
    }
  }

  // Markören flyttas först när hela hämtningen lyckats. Avbryts den halvvägs
  // hämtas samma intervall om nästa gång, vilket är ofarligt — men att flytta
  // markören för tidigt hade tappat rader för alltid.
  if (newest !== since) await setMeta(nyckel, newest);
  return newest !== since;
}

// ---------------------------------------------------------------------------
// Körning
// ---------------------------------------------------------------------------

/**
 * Skjuter upp synken en kort stund. Appen sparar efter varje mutation, och
 * utan detta skulle varje tangenttryck i en kortredigering bli ett natanrop.
 */
export function scheduleSync({ delayMs = 1500 } = {}) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void sync();
  }, delayMs);
}

/**
 * Vem spegeln tillhör — och att tömma den när svaret är "någon annan".
 *
 * Utloggningsknappen tömde spegeln, men den är bara EN av vägarna ut ur en
 * session. Går sessionen förlorad på annat sätt — förnyelsetoken avvisas,
 * utloggning i en annan flik, en återkallad session — öppnas bara
 * inloggningsrutan, och nästa användare loggar in ovanpå förra användarens
 * lokala data. Då läser molnlagret spegeln, ser ett fullt bibliotek, och
 * visar det. Det var en fullständig läcka mellan två konton på samma dator.
 *
 * Kontrollen ligger här och inte i gränssnittet därför att det här är sista
 * stället datan passerar innan den blir någons: vilken väg man än kom in
 * genom måste man förbi den.
 */
async function claimMirror(userId) {
  const agare = await getMeta(OWNER_KEY, null);
  if (agare && agare !== userId) {
    await clearAll();
    try {
      localStorage.removeItem('noji_clone_data');
    } catch { /* privat läge: spegeln är ändå tömd */ }
    for (const fn of wipeListeners) fn();
  }
  if (agare !== userId) await setMeta(OWNER_KEY, userId);
}

/** Sagt till när spegeln tömts för att den tillhörde någon annan. */
export function onMirrorWiped(fn) {
  wipeListeners.add(fn);
  return () => wipeListeners.delete(fn);
}

/**
 * Kor en synkomgang: skickar utkorgen, laddar upp repetitioner och hamtar
 * serverns andringar. Flera samtidiga anrop delar samma korning.
 */
export function sync() {
  if (!supabase || !getUserId()) return Promise.resolve(false);
  // En synk som startas medan en annan pagar far inte tappas bort: den kan
  // bara ha kommit efter att utkorgen fyllts pa. Vi kor en omgang till efterat.
  if (running) {
    queued = true;
    return running;
  }

  running = (async () => {
    setState({ status: 'syncing', error: null });
    try {
      // Före allt annat: är spegeln vår? Att skicka utkorgen först hade
      // laddat upp förra användarens köade ändringar under det nya kontot.
      await claimMirror(getUserId());
      await pushOutbox();
      await pushReviews();
      const changed = await pull();
      setState({
        status: 'idle',
        pending: await outboxSize(),
        lastSyncedAt: Date.now(),
        error: null,
      });
      if (changed) for (const fn of remoteListeners) fn();
      return changed;
    } catch (err) {
      // Ett misslyckande är normalt offline. Utkorgen ligger kvar och skickas
      // vid nästa försök, så ingenting går förlorat.
      setState({
        status: navigator.onLine ? 'error' : 'offline',
        pending: await outboxSize().catch(() => state.pending),
        error: err?.message ?? String(err),
      });
      return false;
    } finally {
      running = null;
      if (queued) {
        queued = false;
        scheduleSync({ delayMs: 0 });
      }
    }
  })();

  return running;
}

/** Startar bakgrundssynk: vid uppkoppling, när fliken blir synlig, och periodiskt. */
export function startAutoSync({ intervalMs = 60_000 } = {}) {
  if (!supabase) return () => {};

  const onOnline = () => void sync();
  const onVisible = () => document.visibilityState === 'visible' && void sync();

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') void sync();
  }, intervalMs);

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}

/** Hela biblioteket ur den lokala spegeln. */
export async function loadFromLocal() {
  return getAllRows();
}
