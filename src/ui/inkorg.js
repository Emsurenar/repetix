/* Inkorgen: delningar som väntar på mig, och de jag skickat.
 *
 * En egen vy, nådd från sidopanelens fot med ett tal bredvid — samma tal som
 * kortleksraderna bär för förfallna kort. Det som väntar på en ska synas där
 * man alltid är, inte bakom Inställningar.
 *
 * En hel kortlek tas emot som en ny kortlek. En mapp eller ett kort läggs i
 * en av mottagarens egna — vilken frågas i en liten dialog — eller blir en
 * ny kortlek om hen hellre vill det.
 */

import {
  acceptera,
  aterkalla,
  hamtaInkorg,
  hamtaSkickade,
  neka,
  onInkorgChange,
} from '../core/delning.js';
import { S } from '../core/state.js';
import { NY_KORTLEK } from '../domain/delning.js';
import { delningsSort } from '../domain/vanner.js';
import { openDeck } from './deck.js';
import { renderLibrary } from './library.js';
import { renderSidebar } from './modals-wiring.js';
import { showConfirmModal } from './modals.js';
import { profilnamn } from './profil.js';
import { switchView } from './router.js';
import { showToast } from './toast.js';

const el = (id) => document.getElementById(id);

const datum = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
};

/* Raderna byggs som noder, inte som markup: titel och adress är någon annans
 * text. En rubrik med ett citattecken i får inte kunna bli ett attribut. */
function rad({ titel, meta, handlingar }) {
  const li = document.createElement('li');
  li.className = 'inkorg-rad';

  const text = document.createElement('div');
  text.className = 'inkorg-text';
  const t = document.createElement('p');
  t.className = 'inkorg-titel';
  t.textContent = titel;
  const m = document.createElement('p');
  m.className = 'inkorg-meta';
  m.textContent = meta;
  text.append(t, m);

  const knappar = document.createElement('div');
  knappar.className = 'inkorg-handlingar';
  for (const { text: etikett, klass, onClick } of handlingar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = klass;
    b.textContent = etikett;
    b.addEventListener('click', () => void onClick(b));
    knappar.appendChild(b);
  }

  li.append(text, knappar);
  return li;
}

const tomRad = (text) => {
  const p = document.createElement('p');
  p.className = 'inkorg-tom';
  p.textContent = text;
  return p;
};

/** Vem: profilens namn och handtag när avsändaren har en, annars adressen. */
const vem = (profil, epost) => {
  if (profil) return profil.handle ? `${profilnamn(profil)} (@${profil.handle})` : profilnamn(profil);
  return epost ?? 'okänd';
};

function innehallstext(r) {
  const sort = delningsSort(r.kind);
  const delar = [sort === 'kortlek' ? `${r.card_count} kort` : sort === 'mapp' ? `mapp med ${r.card_count} kort` : '1 kort'];
  if (r.image_count) delar.push(`${r.image_count} ${r.image_count === 1 ? 'bild' : 'bilder'}`);
  if (r.source_count) delar.push(`${r.source_count} ${r.source_count === 1 ? 'källa' : 'källor'}`);
  return delar.join(' · ');
}

const STATUSORD = {
  preparing: 'förbereds',
  pending: 'väntar på svar',
  accepted: 'mottagen',
  declined: 'nekad',
};

/** Efter en lyckad accept: biblioteket, sidopanelen, en mening, och dit. */
function efterMottagning(res) {
  renderLibrary();
  renderSidebar();
  const brister = [];
  if (res.bilderSaknas) brister.push(`${res.bilderSaknas} bilder kunde inte kopieras`);
  if (res.kallorSaknas) brister.push(`${res.kallorSaknas} källor kunde inte kopieras`);
  const vad = res.ny ? `${res.deck.title} finns nu i ditt bibliotek.` : `Lades i ${res.deck.title}.`;
  showToast(brister.length ? `Mottaget, men ${brister.join(' och ')}.` : (res.varning ?? vad));
  openDeck(res.deck.id, res.sectionId);
}

/* Dialogen för mappar och kort: var ska det in? Kortleken väljs ur en
 * lista; sista valet är en ny kortlek med delningens namn. */
let vantandeMottagning = null;

function oppnaTaEmot(r) {
  const modal = el('modal-ta-emot');
  const select = el('ta-emot-kortlek');
  if (!modal || !select) return;
  vantandeMottagning = r;
  el('ta-emot-titel').textContent = r.title;
  el('ta-emot-vad').textContent = delningsSort(r.kind) === 'mapp' ? 'Mappen' : 'Kortet';
  const status = el('ta-emot-status');
  status.hidden = true;
  status.textContent = '';
  const knapp = el('btn-ta-emot');
  knapp.disabled = false;
  knapp.textContent = 'Ta emot';

  select.innerHTML = '';
  const lekar = [...S.appData.decks].sort((a, b) => a.title.localeCompare(b.title, 'sv'));
  for (const d of lekar) {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.title;
    select.appendChild(o);
  }
  const ny = document.createElement('option');
  ny.value = NY_KORTLEK;
  ny.textContent = `Ny kortlek: ${r.title}`;
  select.appendChild(ny);
  // Den öppna leken är det sannolika målet; annars en ny.
  select.value = lekar.some((d) => d.id === S.currentDeckId) ? S.currentDeckId : NY_KORTLEK;

  modal.classList.remove('hidden');
}

function stangTaEmot() {
  el('modal-ta-emot')?.classList.add('hidden');
  vantandeMottagning = null;
}

async function taEmot(r, knapp) {
  if (r.kind && r.kind !== 'deck') {
    oppnaTaEmot(r);
    return;
  }
  knapp.disabled = true;
  knapp.textContent = 'Tar emot...';
  const res = await acceptera(r.id);
  if (!res.ok) {
    showToast(res.fel);
    knapp.disabled = false;
    knapp.textContent = 'Acceptera';
    return;
  }
  efterMottagning(res);
}

async function avboj(r, knapp) {
  const ok = await showConfirmModal('Neka delningen', `${r.title} från ${vem(r.sender, r.sender_email)} tas bort ur inkorgen.`, 'Neka', true);
  if (!ok) return;
  knapp.disabled = true;
  const res = await neka(r.id);
  if (!res.ok) {
    showToast(res.fel);
    knapp.disabled = false;
    return;
  }
  void renderInkorg();
}

async function taBortSkickad(r, knapp) {
  const vantar = r.status === 'pending' || r.status === 'preparing';
  if (vantar) {
    const ok = await showConfirmModal('Återkalla delningen', `${vem(r.recipient, r.recipient_email)} kan inte längre ta emot ${r.title}.`, 'Återkalla', true);
    if (!ok) return;
  }
  knapp.disabled = true;
  const res = await aterkalla(r.id);
  if (!res.ok) {
    showToast(res.fel);
    knapp.disabled = false;
    return;
  }
  void renderInkorg();
}

/** Ritar båda listorna. Hämtar från servern varje gång: inkorgen är liten. */
export async function renderInkorg() {
  const mottagna = el('inkorg-lista');
  const skickade = el('inkorg-skickade');
  if (!mottagna || !skickade) return;

  const [inkorg, sant] = await Promise.all([hamtaInkorg(), hamtaSkickade()]);
  // Vyn kan ha lämnats under hämtningen.
  if (S.currentViewName !== 'inkorg') return;

  mottagna.innerHTML = '';
  if (!inkorg.ok) mottagna.appendChild(tomRad(inkorg.fel));
  else if (!inkorg.rader.length) mottagna.appendChild(tomRad('Inget väntar.'));
  for (const r of inkorg.rader) {
    mottagna.appendChild(
      rad({
        titel: r.title,
        meta: `Från ${vem(r.sender, r.sender_email)} · ${innehallstext(r)} · går ut ${datum(r.expires_at)}`,
        handlingar: [
          { text: 'Acceptera', klass: 'btn primary', onClick: (k) => taEmot(r, k) },
          { text: 'Neka', klass: 'btn text', onClick: (k) => avboj(r, k) },
        ],
      })
    );
  }

  skickade.innerHTML = '';
  if (!sant.ok) skickade.appendChild(tomRad(sant.fel));
  else if (!sant.rader.length) skickade.appendChild(tomRad('Du har inte delat något än.'));
  const nu = Date.now();
  for (const r of sant.rader) {
    const utgangen = r.status === 'pending' && Date.parse(r.expires_at) < nu;
    const lage = utgangen ? 'utgången' : (STATUSORD[r.status] ?? r.status);
    const vantar = !utgangen && (r.status === 'pending' || r.status === 'preparing');
    skickade.appendChild(
      rad({
        titel: r.title,
        meta: `Till ${vem(r.recipient, r.recipient_email)} · ${innehallstext(r)} · ${lage} · ${datum(r.created_at)}`,
        handlingar: [
          { text: vantar ? 'Återkalla' : 'Ta bort', klass: 'btn text', onClick: (k) => taBortSkickad(r, k) },
        ],
      })
    );
  }
}

export function openInkorg() {
  switchView('inkorg');
  const mottagna = el('inkorg-lista');
  const skickade = el('inkorg-skickade');
  if (mottagna) mottagna.innerHTML = '';
  if (skickade) skickade.innerHTML = '';
  void renderInkorg();
}

export function initUiInkorg() {
  el('btn-open-inkorg')?.addEventListener('click', openInkorg);

  el('btn-cancel-ta-emot')?.addEventListener('click', stangTaEmot);
  el('btn-ta-emot')?.addEventListener('click', async () => {
    const r = vantandeMottagning;
    const knapp = el('btn-ta-emot');
    if (!r || knapp.disabled) return;
    knapp.disabled = true;
    knapp.textContent = 'Tar emot...';
    const res = await acceptera(r.id, { malDeckId: el('ta-emot-kortlek').value });
    if (!res.ok) {
      const status = el('ta-emot-status');
      status.textContent = res.fel;
      status.hidden = false;
      knapp.disabled = false;
      knapp.textContent = 'Ta emot';
      return;
    }
    stangTaEmot();
    efterMottagning(res);
  });

  /* Talet i sidopanelen. Noll skrivs ut men tyst, som kortleksradernas
   * noll: kolumnen står, färgen säger om det finns något. */
  onInkorgChange((antal) => {
    const tal = el('inkorg-count');
    if (!tal) return;
    tal.textContent = String(antal);
    tal.classList.toggle('is-zero', antal === 0);
    // Står man i inkorgen när något nytt kommer ritas listan om.
    if (S.currentViewName === 'inkorg') void renderInkorg();
  });
}
