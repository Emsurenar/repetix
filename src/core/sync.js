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
  enqueue,
  getAllRows,
  getMeta,
  getOutbox,
  getPendingReviews,
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

/** Markör för inkrementell hämtning: allt som ändrats efter denna tidpunkt. */
const CURSOR_KEY = 'sync:cursor';

const listeners = new Set();
let state = { status: 'idle', pending: 0, lastSyncedAt: null, error: null };
let running = null;
let lastSnapshot = null;

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
  void sync();
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
  if (getUserId()) void sync();
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
      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .in('id', chunk);
      if (error) throw error;
    }
  }

  await ackOutbox(pending.map((m) => m.seq));
  return pending.length;
}

async function pushReviews() {
  const pending = await getPendingReviews(BATCH);
  if (!pending.length) return 0;
  const userId = getUserId();
  // Rader loggade före inloggning saknar ägare. De tillhör den som nu är
  // inloggad — det är samma enhet och samma person som gjorde repetitionen.
  const rows = pending.map((r) => ({ ...r, user_id: r.user_id ?? userId }));
  // id genereras lokalt så att en uppladdning som skickas två gånger — efter en
  // timeout där svaret ändå kom fram — inte skapar dubbletter i loggen.
  const { error } = await supabase.from('reviews').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  await ackReviews(pending.map((r) => r.id));
  return pending.length;
}

// ---------------------------------------------------------------------------
// Inkommande: serverns ändringar till den lokala spegeln
// ---------------------------------------------------------------------------

async function pull() {
  const since = await getMeta(CURSOR_KEY, new Date(0).toISOString());
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
  if (newest !== since) await setMeta(CURSOR_KEY, newest);
  return newest !== since;
}

// ---------------------------------------------------------------------------
// Körning
// ---------------------------------------------------------------------------

/**
 * Kör en synkomgång. Flera samtidiga anrop delar samma körning, så att en
 * sparning under pågående synk inte startar en andra omgång.
 */
export function sync() {
  if (!supabase || !getUserId()) return Promise.resolve(false);
  if (running) return running;

  running = (async () => {
    setState({ status: 'syncing', error: null });
    try {
      await pushOutbox();
      await pushReviews();
      const changed = await pull();
      setState({
        status: 'idle',
        pending: await outboxSize(),
        lastSyncedAt: Date.now(),
        error: null,
      });
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
