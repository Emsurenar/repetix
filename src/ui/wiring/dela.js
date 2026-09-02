/* Delningsdialogen.
 *
 * Öppnas från kortlekens meny i biblioteket och från knappen nederst i
 * kortleksvyn. En rad att skriva adressen i, en rad som säger vad som följer
 * med, och en knapp. Adressen skrivs — den slås aldrig upp, se 0010.
 */

import { delaKortlek, delningTillganglig, delningsInnehall } from '../../core/delning.js';
import { S } from '../../core/state.js';
import { fokusera } from '../fokus.js';
import { showToast } from '../toast.js';

let vald = null;

const el = (id) => document.getElementById(id);

/** "14 kort, 2 bilder och 1 källa" — det som faktiskt följer med. */
function innehallsrad(tal) {
  const delar = [];
  const kort = tal.kort + tal.anteckningar;
  delar.push(`${kort} ${kort === 1 ? 'kort' : 'kort'}`);
  if (tal.mappar) delar.push(`${tal.mappar} ${tal.mappar === 1 ? 'mapp' : 'mappar'}`);
  if (tal.bilder) delar.push(`${tal.bilder} ${tal.bilder === 1 ? 'bild' : 'bilder'}`);
  if (tal.kallor) delar.push(`${tal.kallor} ${tal.kallor === 1 ? 'källa' : 'källor'}`);
  const sista = delar.pop();
  const lista = delar.length ? `${delar.join(', ')} och ${sista}` : sista;
  return `Mottagaren får en egen kopia: ${lista}. Repetitionsläget följer inte med.`;
}

/**
 * Öppnar dialogen för en kortlek.
 *
 * @param {object} deck
 */
export async function openDelaModal(deck) {
  if (!deck) return;
  if (!delningTillganglig()) {
    showToast('Att dela kräver ett konto. Logga in via sidopanelen.');
    return;
  }
  vald = deck;
  el('dela-titel').textContent = deck.title;
  el('dela-epost').value = '';
  const status = el('dela-status');
  status.hidden = true;
  status.textContent = '';
  el('btn-dela').disabled = false;
  el('btn-dela').textContent = 'Dela';

  const rad = el('dela-sammanfattning');
  rad.textContent = '';
  el('modal-dela').classList.remove('hidden');
  fokusera(el('dela-epost'));

  const innehall = await delningsInnehall(deck);
  // Dialogen kan ha stängts, eller öppnats för en annan lek, under hämtningen.
  if (vald !== deck) return;
  rad.textContent = innehall.ok ? innehallsrad(innehall) : innehall.fel;
}

function stang() {
  el('modal-dela').classList.add('hidden');
  vald = null;
}

export function initUiWiringDela() {
  const form = el('form-dela');
  if (!form) return;

  el('btn-cancel-dela').addEventListener('click', stang);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!vald) return;
    const knapp = el('btn-dela');
    const status = el('dela-status');
    if (knapp.disabled) return;

    knapp.disabled = true;
    knapp.textContent = 'Delar...';
    status.hidden = true;

    const deck = vald;
    const res = await delaKortlek({ deck, epost: el('dela-epost').value });

    if (!res.ok) {
      status.textContent = res.fel;
      status.hidden = false;
      knapp.disabled = false;
      knapp.textContent = 'Dela';
      return;
    }
    stang();
    showToast(`${deck.title} är delad. Mottagaren ser den i sin inkorg.`);
  });

  // Kortleksvyns egen ingång.
  el('btn-share-deck')?.addEventListener('click', () => {
    const deck = S.appData.decks.find((d) => d.id === S.currentDeckId);
    void openDelaModal(deck);
  });
}
