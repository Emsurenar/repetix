/* Delningsdialogen.
 *
 * Öppnas från kortlekens meny i biblioteket och sidopanelen, från knappen
 * nederst i kortleksvyn, från en mapps och ett korts meny, och från en väns
 * profil. Vännerna står som brickor överst — ett tryck väljer mottagaren —
 * och adressen finns kvar för den som inte är vän än. Adressen skrivs, den
 * slås aldrig upp; se 0010. En vän är ett id, och det får bara den som
 * faktiskt är vän skicka till; se 0011.
 */

import { delaKortlek, delningTillganglig, delningsInnehall } from '../../core/delning.js';
import { S } from '../../core/state.js';
import { getUserId } from '../../core/supabase.js';
import { hamtaVanskaper } from '../../core/vanner.js';
import { delbarMapp, delbartKort } from '../../domain/delning.js';
import { delningsSort, denAndra } from '../../domain/vanner.js';
import { fokusera } from '../fokus.js';
import { avatarNod, profilnamn } from '../profil.js';
import { showToast } from '../toast.js';

/* Det dialogen står för just nu: det som delas, dess sort, och mottagaren
 * om en vän valts. Null när dialogen är stängd. */
let lage = null;

const el = (id) => document.getElementById(id);

/** "14 kort, 2 bilder och 1 källa" — det som faktiskt följer med. */
function innehallsrad(tal, kind) {
  const delar = [];
  const kort = tal.kort + tal.anteckningar;
  delar.push(`${kort} kort`);
  if (tal.mappar) delar.push(`${tal.mappar} ${tal.mappar === 1 ? 'mapp' : 'mappar'}`);
  if (tal.bilder) delar.push(`${tal.bilder} ${tal.bilder === 1 ? 'bild' : 'bilder'}`);
  if (tal.kallor) delar.push(`${tal.kallor} ${tal.kallor === 1 ? 'källa' : 'källor'}`);
  const sista = delar.pop();
  const lista = delar.length ? `${delar.join(', ')} och ${sista}` : sista;
  const vad = kind === 'deck' ? 'en egen kopia' : `en egen kopia av ${delningsSort(kind) === 'mapp' ? 'mappen' : 'kortet'}`;
  return `Mottagaren får ${vad}: ${lista}. Repetitionsläget följer inte med.`;
}

/** Vad dialogen delar: kortleken, eller det mappen/kortet blir som lek. */
function delbar() {
  if (!lage) return null;
  if (lage.kind === 'section') return delbarMapp(lage.deck, lage.section);
  if (lage.kind === 'card') return delbartKort(lage.deck, lage.card);
  return lage.deck;
}

function valjMottagare(profil) {
  lage.mottagare = profil;
  const epost = el('dela-epost');
  epost.required = !profil;
  if (profil) epost.value = '';
  for (const b of el('dela-vanner').querySelectorAll('.dela-van')) {
    b.setAttribute('aria-pressed', String(Boolean(profil) && b.dataset.id === profil.id));
  }
}

/** Vännerna som brickor. Utan vänner döljs raden, och adressen är enda vägen. */
async function ritaVanner(forvald) {
  const rad = el('dela-vanner-rad');
  const host = el('dela-vanner');
  const etikett = el('dela-epost-label');
  host.innerHTML = '';
  rad.hidden = true;
  etikett.textContent = 'Mottagarens e-post';

  const { rader } = await hamtaVanskaper();
  if (!lage) return;
  const mig = getUserId();
  const vanner = rader
    .filter((r) => r.status === 'accepted')
    .map((r) => denAndra(r, mig))
    .filter(Boolean)
    .sort((a, b) => profilnamn(a).localeCompare(profilnamn(b), 'sv'));
  if (!vanner.length) return;

  rad.hidden = false;
  etikett.textContent = 'Eller till en e-postadress';
  for (const p of vanner) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dela-van';
    b.dataset.id = p.id;
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(avatarNod(p, 'avatar avatar-chip'));
    const namn = document.createElement('span');
    namn.textContent = profilnamn(p);
    b.appendChild(namn);
    b.addEventListener('click', () => valjMottagare(lage.mottagare?.id === p.id ? null : p));
    host.appendChild(b);
  }
  if (forvald) valjMottagare(vanner.find((p) => p.id === forvald.id) ?? forvald);
}

/** Kortleksväljaren, för dialogen som öppnats från en profil. */
function ritaKortleksval() {
  const rad = el('dela-kortlek-rad');
  const select = el('dela-kortlek');
  rad.hidden = Boolean(lage.deck);
  if (lage.deck) return;
  select.innerHTML = '';
  const lekar = [...S.appData.decks].sort((a, b) => a.title.localeCompare(b.title, 'sv'));
  for (const d of lekar) {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.title;
    select.appendChild(o);
  }
  if (lekar.length) {
    select.value = lekar[0].id;
    lage.deck = lekar[0];
  }
}

async function ritaInnehall() {
  const rad = el('dela-sammanfattning');
  rad.textContent = '';
  const vad = delbar();
  if (!vad) {
    rad.textContent = 'Det finns ingen kortlek att dela än.';
    return;
  }
  const token = (lage.token = {});
  const innehall = await delningsInnehall(vad, lage.kind);
  // Dialogen kan ha stängts, eller bytt kortlek, under hämtningen.
  if (!lage || lage.token !== token) return;
  rad.textContent = innehall.ok ? innehallsrad(innehall, lage.kind) : innehall.fel;
}

function ritaRubrik() {
  const vad = delbar();
  el('dela-vad').textContent = lage.kind === 'section' ? 'mappen ' : lage.kind === 'card' ? 'kortet ' : '';
  el('dela-titel').textContent = vad?.title ?? '';
}

/**
 * Öppnar dialogen.
 *
 * @param {object|null} deck kortleken, eller null för att låta användaren välja
 * @param {{section?: object, card?: object, mottagare?: object}} [val]
 *   en mapp eller ett kort ur leken, och en vän som redan är vald
 */
export async function openDelaModal(deck, { section = null, card = null, mottagare = null } = {}) {
  if (!delningTillganglig()) {
    showToast('Att dela kräver ett konto. Logga in via sidopanelen.');
    return;
  }
  lage = {
    deck,
    section,
    card,
    kind: card ? 'card' : section ? 'section' : 'deck',
    mottagare: null,
    token: {},
  };

  el('dela-epost').value = '';
  el('dela-epost').required = true;
  const status = el('dela-status');
  status.hidden = true;
  status.textContent = '';
  el('btn-dela').disabled = false;
  el('btn-dela').textContent = 'Dela';

  ritaKortleksval();
  ritaRubrik();
  el('modal-dela').classList.remove('hidden');
  // Med en vän redan vald finns inget att skriva; fokus i fältet hade fällt
  // upp tangentbordet över en dialog som bara behöver ett tryck.
  if (!mottagare) fokusera(el('dela-epost'));

  await Promise.all([ritaVanner(mottagare), ritaInnehall()]);
}

function stang() {
  el('modal-dela').classList.add('hidden');
  lage = null;
}

export function initUiWiringDela() {
  const form = el('form-dela');
  if (!form) return;

  el('btn-cancel-dela').addEventListener('click', stang);

  // Att skriva en adress är att välja bort vännen.
  el('dela-epost').addEventListener('input', () => {
    if (lage?.mottagare && el('dela-epost').value) valjMottagare(null);
  });

  el('dela-kortlek')?.addEventListener('change', () => {
    if (!lage) return;
    lage.deck = S.appData.decks.find((d) => d.id === el('dela-kortlek').value) ?? null;
    ritaRubrik();
    void ritaInnehall();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!lage) return;
    const knapp = el('btn-dela');
    const status = el('dela-status');
    if (knapp.disabled) return;

    const vad = delbar();
    if (!vad) return;

    knapp.disabled = true;
    knapp.textContent = 'Delar...';
    status.hidden = true;

    const { kind, mottagare } = lage;
    const res = await delaKortlek({
      deck: vad,
      epost: el('dela-epost').value,
      mottagarId: mottagare?.id ?? null,
      kind,
    });

    if (!res.ok) {
      status.textContent = res.fel;
      status.hidden = false;
      knapp.disabled = false;
      knapp.textContent = 'Dela';
      return;
    }
    stang();
    const till = mottagare ? profilnamn(mottagare) : 'mottagaren';
    showToast(`${vad.title} är delad. ${till === 'mottagaren' ? 'Mottagaren' : till} ser den i sin inkorg.`);
  });

  // Kortleksvyns egen ingång.
  el('btn-share-deck')?.addEventListener('click', () => {
    const deck = S.appData.decks.find((d) => d.id === S.currentDeckId);
    void openDelaModal(deck);
  });
}
