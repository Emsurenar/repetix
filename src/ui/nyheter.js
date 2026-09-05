/* Nyheterna i den här versionen, visade en gång.
 *
 * Rutan öppnas första gången appen visas efter en uppdatering, och bara en
 * gång per konto: kvittot skrivs på profilen (profiles.seen_release, 0011),
 * så att ett andra konto på samma dator får sin egen ruta och samma konto på
 * en annan dator slipper den. Saknas kolumnen — migrationen är inte körd —
 * eller finns inget konto, minns webbläsaren i stället.
 *
 * Texten bor i index.html. Den byts när nästa version släpps, tillsammans
 * med talet nedan.
 */

import { S } from '../core/state.js';
import { getUserId, onAuthChange, supabase } from '../core/supabase.js';
import { hasSkippedAuth } from './auth.js';

/** Versionen rutan beskriver. Höjs när en ny ruta ska visas. */
export const VERSION = '3.1';

const NYCKEL = 'repetix_nyheter_sedd';

const el = (id) => document.getElementById(id);

/* Nyckeln är kontot, eller "lokal" för den som kör utan. */
const nyckelFor = (userId) => `${NYCKEL}:${userId ?? 'lokal'}`;

const lasLokalt = (userId) => {
  try {
    return localStorage.getItem(nyckelFor(userId));
  } catch {
    return null;
  }
};

const skrivLokalt = (userId) => {
  try {
    localStorage.setItem(nyckelFor(userId), VERSION);
  } catch {
    /* lagringen kan vara avstängd; då visas rutan igen nästa gång, vilket duger */
  }
};

/** Har kontot redan sett den här versionen? Kolumnen kan saknas; då null. */
async function settIMolnet(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from('profiles').select('seen_release').eq('id', userId).maybeSingle();
  if (error) return null;
  return data?.seen_release === VERSION;
}

async function kvitteraIMolnet(userId) {
  if (!supabase || !userId) return;
  // Ett fel här är ofarligt: webbläsaren minns ändå, och nästa dator visar
  // rutan en gång till. Kolumnen saknas tills 0011 är körd.
  await supabase.from('profiles').update({ seen_release: VERSION }).eq('id', userId);
}

let visad = false;

function visa(userId) {
  const modal = el('modal-nyheter');
  if (!modal || visad) return;
  visad = true;
  modal.classList.remove('hidden');

  const stang = () => {
    modal.classList.add('hidden');
    skrivLokalt(userId);
    void kvitteraIMolnet(userId);
  };
  el('btn-nyheter-ok')?.addEventListener('click', stang, { once: true });
}

/**
 * Avgör om rutan ska visas för det här kontot, och visar den i så fall.
 *
 * Inte mitt i något: en repetition eller ett spel ska inte avbrytas av en
 * ruta om nyheter. Då väntar rutan till nästa start.
 */
async function prova() {
  const userId = getUserId();
  if (!userId && !hasSkippedAuth()) return;
  if (lasLokalt(userId) === VERSION) return;
  if (S.currentViewName === 'study' || S.isPlaygroundSession) return;

  const iMolnet = await settIMolnet(userId);
  if (iMolnet) {
    skrivLokalt(userId);
    return;
  }
  // Läget kan ha hunnit ändras under frågan.
  if (getUserId() !== userId || S.currentViewName === 'study' || S.isPlaygroundSession) return;
  visa(userId);
}

export function initUiNyheter() {
  if (!el('modal-nyheter')) return;
  /* Efter första målningen, och efter att kontot är känt. Utan moln körs
   * onAuthChange aldrig; då prövas det en gång vid start. */
  const senare = () => setTimeout(() => void prova(), 900);
  if (supabase) onAuthChange(senare);
  else senare();
}
