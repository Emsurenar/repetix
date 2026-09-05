/* Vännerna: sök, förfrågningar, listan.
 *
 * En egen vy, nådd från sidopanelens fot med ett tal bredvid — samma tal
 * som inkorgen bär. Raderna byggs som noder, inte som markup: namn och
 * handtag är någon annans text.
 */

import { S } from '../core/state.js';
import { getUserId } from '../core/supabase.js';
import {
  accepteraVanforfragan,
  hamtaVanskaper,
  minProfil,
  onVannerChange,
  skickaVanforfragan,
  sokProfiler,
  taBortVanskap,
  vannerTillganglig,
} from '../core/vanner.js';
import { denAndra } from '../domain/vanner.js';
import { fokusera } from './fokus.js';
import { avatarNod, openProfil, profilnamn } from './profil.js';
import { switchView } from './router.js';
import { showToast } from './toast.js';

const el = (id) => document.getElementById(id);

/** En rad: bild, namn och handtag, handlingar till höger. Raden öppnar profilen. */
function rad(profil, handlingar = []) {
  const li = document.createElement('li');
  li.className = 'vanner-rad';

  const oppna = document.createElement('button');
  oppna.type = 'button';
  oppna.className = 'vanner-person';
  oppna.setAttribute('aria-label', `${profilnamn(profil)}, öppna profilen`);
  oppna.appendChild(avatarNod(profil, 'avatar avatar-rad'));
  const text = document.createElement('span');
  text.className = 'vanner-text';
  const namn = document.createElement('span');
  namn.className = 'vanner-namn';
  namn.textContent = profilnamn(profil);
  const handtag = document.createElement('span');
  handtag.className = 'vanner-handtag num';
  handtag.textContent = profil?.handle ? `@${profil.handle}` : '';
  text.append(namn, handtag);
  oppna.appendChild(text);
  oppna.addEventListener('click', () => openProfil(profil.id));

  const knappar = document.createElement('div');
  knappar.className = 'vanner-handlingar';
  for (const { text: etikett, klass, onClick } of handlingar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = klass;
    b.textContent = etikett;
    b.addEventListener('click', () => void onClick(b));
    knappar.appendChild(b);
  }

  li.append(oppna, knappar);
  return li;
}

const tomRad = (text) => {
  const p = document.createElement('p');
  p.className = 'vanner-tom';
  p.textContent = text;
  return p;
};

/* En handling som låser sin knapp, visar felet om det blev ett, och ritar
 * om listorna när den gick. */
const utfor = async (b, fn, klar) => {
  b.disabled = true;
  const res = await fn();
  if (!res.ok) {
    showToast(res.fel);
    b.disabled = false;
    return;
  }
  if (klar) showToast(klar);
  void renderVanner();
};

/** Ritar förfrågningarna och vänlistan. Hämtar från servern varje gång. */
export async function renderVanner() {
  const forfragningar = el('vanner-forfragningar');
  const lista = el('vanner-lista');
  const sektion = el('vanner-forfragningar-sektion');
  const notis = el('vanner-namnlos');
  if (!forfragningar || !lista) return;

  const mig = getUserId();
  const [vanskaper, egen] = await Promise.all([hamtaVanskaper(), minProfil()]);
  if (S.currentViewName !== 'vanner') return;

  /* Utan handtag kan ingen hitta en. Det sägs överst, med vägen dit —
   * annars är den här sidan en tom lista utan förklaring. */
  if (notis) notis.hidden = !(egen.ok && egen.profil && !egen.profil.handle);

  forfragningar.innerHTML = '';
  lista.innerHTML = '';

  if (!vanskaper.ok) {
    sektion.hidden = true;
    lista.appendChild(tomRad(vanskaper.fel));
    return;
  }

  const vantande = vanskaper.rader.filter((r) => r.status === 'pending');
  sektion.hidden = vantande.length === 0;
  for (const r of vantande) {
    const andra = denAndra(r, mig);
    if (!andra) continue;
    const mottagen = r.addressee_id === mig;
    forfragningar.appendChild(
      rad(
        andra,
        mottagen
          ? [
              { text: 'Acceptera', klass: 'btn primary', onClick: (b) => utfor(b, () => accepteraVanforfragan(r.id), `Du och ${profilnamn(andra)} är nu vänner.`) },
              { text: 'Neka', klass: 'btn text', onClick: (b) => utfor(b, () => taBortVanskap(r.id)) },
            ]
          : [{ text: 'Återkalla', klass: 'btn text', onClick: (b) => utfor(b, () => taBortVanskap(r.id)) }]
      )
    );
    if (!mottagen) forfragningar.lastChild.classList.add('is-skickad');
  }

  const vanner = vanskaper.rader
    .filter((r) => r.status === 'accepted')
    .map((r) => denAndra(r, mig))
    .filter(Boolean)
    .sort((a, b) => profilnamn(a).localeCompare(profilnamn(b), 'sv'));
  if (!vanner.length) lista.appendChild(tomRad('Inga vänner än. Sök på ett användarnamn ovanför.'));
  for (const p of vanner) lista.appendChild(rad(p));
}

async function sok(q) {
  const traffar = el('vanner-traffar');
  if (!traffar) return;
  traffar.innerHTML = '';
  const res = await sokProfiler(q);
  if (S.currentViewName !== 'vanner') return;
  if (!res.ok) return traffar.appendChild(tomRad(res.fel));
  if (!res.rader.length) return traffar.appendChild(tomRad('Ingen med det namnet.'));

  const { rader: vanskaper } = await hamtaVanskaper();
  const mig = getUserId();
  for (const p of res.rader) {
    const redan = vanskaper.find(
      (r) => (r.requester_id === mig && r.addressee_id === p.id) || (r.requester_id === p.id && r.addressee_id === mig)
    );
    const handling = !redan
      ? [{ text: 'Lägg till', klass: 'btn primary', onClick: (b) => utfor(b, () => skickaVanforfragan(p.handle), `Förfrågan skickad till ${profilnamn(p)}.`).then(() => sok(q)) }]
      : redan.status === 'accepted'
        ? [{ text: 'Vänner', klass: 'btn text', onClick: () => openProfil(p.id) }]
        : redan.addressee_id === mig
          ? [{ text: 'Acceptera', klass: 'btn primary', onClick: (b) => utfor(b, () => accepteraVanforfragan(redan.id)).then(() => sok(q)) }]
          : [{ text: 'Förfrågan skickad', klass: 'btn text', onClick: () => openProfil(p.id) }];
    traffar.appendChild(rad(p, handling));
  }
}

export function openVanner() {
  if (!vannerTillganglig()) {
    showToast('Vänner kräver ett konto. Logga in via sidopanelen.');
    return;
  }
  switchView('vanner');
  for (const id of ['vanner-traffar', 'vanner-forfragningar', 'vanner-lista']) {
    const node = el(id);
    if (node) node.innerHTML = '';
  }
  void renderVanner();
}

export function initUiVanner() {
  el('btn-open-vanner')?.addEventListener('click', openVanner);
  el('btn-vanner-till-profil')?.addEventListener('click', () => window.openSettings?.());

  el('form-vanner-sok')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const falt = el('vanner-sok');
    void sok(falt.value);
    fokusera(falt);
  });

  /* Talet i sidopanelen. Noll skrivs ut men tyst, som inkorgens. */
  onVannerChange((antal) => {
    const tal = el('vanner-count');
    if (!tal) return;
    tal.textContent = String(antal);
    tal.classList.toggle('is-zero', antal === 0);
    if (S.currentViewName === 'vanner') void renderVanner();
  });
}
