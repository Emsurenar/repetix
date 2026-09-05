/* Profilvyn: en användare sedd utifrån.
 *
 * Bild, namn och handtag överst; under dem de tal Spelhallen visar för en
 * själv — kort, kortlekar, bemästrade, repetitioner, streak — rekorden,
 * prestationerna och ett halvår av aktivitet. Talen kommer ur den
 * statistikbild ägarens egen klient publicerat (core/vanner.js), aldrig ur
 * hens rader, som ingen annan får läsa.
 *
 * Samma vy för ens egen profil: det man ser är exakt det andra ser.
 */

import { S } from '../core/state.js';
import { getUserId } from '../core/supabase.js';
import {
  accepteraVanforfragan,
  avatarUrl,
  hamtaProfil,
  hamtaVanskaper,
  publiceraStatistik,
  skickaVanforfragan,
  taBortVanskap,
} from '../core/vanner.js';
import { initialer, profilRekord, provaProfilstatistik, vanskapsLage } from '../domain/vanner.js';
import { aktivitetskartaHtml, veckorSomFarPlats } from './aktivitetskarta.js';
import { showConfirmModal } from './modals.js';
import { switchView } from './router.js';
import { showToast } from './toast.js';

const el = (id) => document.getElementById(id);

/**
 * Profilbilden som nod: bilden om den finns, annars initialerna på en
 * tyst yta. Delas av vänlistan, inställningarna och profilen.
 *
 * @param {object|null} profil
 * @param {string} [klass]
 */
export function avatarNod(profil, klass = 'avatar') {
  const url = avatarUrl(profil);
  if (url) {
    const img = document.createElement('img');
    img.className = klass;
    img.src = url;
    img.alt = '';
    img.decoding = 'async';
    return img;
  }
  const span = document.createElement('span');
  span.className = `${klass} avatar-initialer`;
  span.textContent = initialer(profil);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/** Vad profilen heter i löpande text. */
export const profilnamn = (profil) => profil?.display_name?.trim() || (profil?.handle ? `@${profil.handle}` : 'Någon');

const datum = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' });
};

/* Profilen som visas just nu. Hämtningarna är asynkrona och vyn kan ha
 * bytt profil, eller lämnats, innan svaret kommer. */
let visadId = null;

const knapp = (text, klass, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = klass;
  b.textContent = text;
  b.addEventListener('click', () => void onClick(b));
  return b;
};

/** Knapparna som säger vad vi är för varandra, och ändrar det. */
async function ritaHandlingar(profil) {
  const host = el('profil-handlingar');
  if (!host) return;
  host.innerHTML = '';
  const mig = getUserId();

  if (profil.id === mig) {
    host.appendChild(knapp('Redigera profil', 'btn', () => window.openSettings?.()));
    return;
  }

  const { rader } = await hamtaVanskaper();
  if (visadId !== profil.id) return;
  const { lage, rad } = vanskapsLage(rader, mig, profil.id);

  const omrita = () => openProfil(profil.id);
  const kor = async (b, fn, klar) => {
    b.disabled = true;
    const res = await fn();
    if (!res.ok) {
      showToast(res.fel);
      b.disabled = false;
      return;
    }
    if (klar) showToast(klar);
    omrita();
  };

  if (lage === 'ingen') {
    host.appendChild(
      knapp('Lägg till som vän', 'btn primary', (b) =>
        kor(b, () => skickaVanforfragan(profil.handle), `Förfrågan skickad till ${profilnamn(profil)}.`)
      )
    );
  } else if (lage === 'skickad') {
    const p = document.createElement('p');
    p.className = 'profil-lage';
    p.textContent = 'Förfrågan skickad';
    host.append(p, knapp('Återkalla', 'btn text', (b) => kor(b, () => taBortVanskap(rad.id))));
  } else if (lage === 'mottagen') {
    host.append(
      knapp('Acceptera', 'btn primary', (b) => kor(b, () => accepteraVanforfragan(rad.id), `Du och ${profilnamn(profil)} är nu vänner.`)),
      knapp('Neka', 'btn text', (b) => kor(b, () => taBortVanskap(rad.id)))
    );
  } else {
    const p = document.createElement('p');
    p.className = 'profil-lage is-vanner';
    p.textContent = 'Vänner';
    host.append(
      p,
      knapp('Ta bort vän', 'btn text', async (b) => {
        const ok = await showConfirmModal('Ta bort vän', `${profilnamn(profil)} tas bort ur din vänlista. Delningar mellan er påverkas inte.`, 'Ta bort', true);
        if (ok) await kor(b, () => taBortVanskap(rad.id));
      })
    );
  }
}

const tal = (n) => Number(n || 0).toLocaleString('sv-SE');

function ritaStatistik(profil) {
  const innehall = el('profil-innehall');
  const status = el('profil-status');
  const stats = provaProfilstatistik(profil.stats);
  const egen = profil.id === getUserId();

  if (!stats) {
    innehall.hidden = true;
    status.hidden = false;
    status.textContent = '';
    if (egen) {
      status.append(
        'Din statistik är inte publicerad än. Den publiceras när dina kort synkats nästa gång. ',
        knapp('Publicera nu', 'btn', async (b) => {
          b.disabled = true;
          const res = await publiceraStatistik({ tvinga: true });
          if (!res.ok) {
            showToast(res.fel);
            b.disabled = false;
            return;
          }
          openProfil(profil.id);
        })
      );
    } else {
      status.textContent = `${profilnamn(profil)} har inte publicerat någon statistik än.`;
    }
    return;
  }

  status.hidden = true;
  innehall.hidden = false;

  const talen = [
    { n: stats.cards, l: 'kort' },
    { n: stats.decks, l: 'kortlekar' },
    { n: stats.mastered, l: 'bemästrade' },
    { n: stats.reviews, l: 'repetitioner' },
    { n: stats.streak, l: 'dagars streak' },
  ];
  el('profil-tal').innerHTML = talen
    .map((t) => `<div class="profil-tal-ruta"><span class="profil-tal-varde num">${tal(t.n)}</span><span class="profil-tal-etikett">${t.l}</span></div>`)
    .join('');

  const rekord = profilRekord(stats);
  const rekordSektion = el('profil-rekord-sektion');
  rekordSektion.hidden = rekord.length === 0;
  el('profil-rekord').innerHTML = rekord
    .map((r) => `<div class="profil-rekord-rad"><span class="profil-rekord-tal num">${tal(r.n)}</span><span class="profil-rekord-etikett">${r.l}</span></div>`)
    .join('');

  const prestationer = el('profil-prestationer');
  prestationer.innerHTML = '';
  el('profil-prestationer-sektion').hidden = stats.achievements.length === 0;
  for (const p of stats.achievements) {
    const ruta = document.createElement('div');
    ruta.className = 'profil-prestation';
    const namn = document.createElement('span');
    namn.className = 'profil-prestation-namn';
    namn.textContent = p.title;
    const beskr = document.createElement('span');
    beskr.className = 'profil-prestation-desc';
    beskr.textContent = p.desc;
    ruta.append(namn, beskr);
    prestationer.appendChild(ruta);
  }

  /* Så många veckor som får plats i spalten, som i Spelhallen. Ytan mäts
   * efter att vyn visats — dold har den ingen bredd. */
  const karta = el('profil-aktivitet');
  const bredd = karta.clientWidth || karta.parentElement?.clientWidth || 0;
  const veckor = veckorSomFarPlats(bredd, { min: 8, max: 26 });
  karta.innerHTML = aktivitetskartaHtml({ dagsrakningar: stats.activity, veckor });

  const stampel = el('profil-uppdaterad');
  if (stampel) {
    const d = stats.updatedAt ? new Date(stats.updatedAt) : null;
    stampel.textContent = d && !Number.isNaN(d.getTime())
      ? `Uppdaterad ${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}`
      : '';
  }
}

/**
 * Öppnar en profil. Vyn visas direkt med det som redan är känt — namnet
 * — och fylls på när svaren kommer.
 *
 * @param {string} userId
 */
export async function openProfil(userId) {
  if (!userId) return;
  visadId = userId;

  const bild = el('profil-bild');
  const namn = el('profil-namn');
  const handtag = el('profil-handtag');
  const sedan = el('profil-sedan');
  const handlingar = el('profil-handlingar');
  const status = el('profil-status');
  const innehall = el('profil-innehall');
  if (!bild || !namn) return;

  bild.innerHTML = '';
  namn.textContent = 'Profil';
  handtag.textContent = '';
  sedan.textContent = '';
  handlingar.innerHTML = '';
  status.hidden = true;
  innehall.hidden = true;
  S.profilNamn = 'Profil';
  switchView('profil');

  const res = await hamtaProfil(userId);
  if (visadId !== userId || S.currentViewName !== 'profil') return;
  if (!res.ok) {
    status.hidden = false;
    status.textContent = res.fel;
    return;
  }
  const profil = res.profil;

  bild.appendChild(avatarNod(profil, 'avatar avatar-stor'));
  namn.textContent = profilnamn(profil);
  handtag.textContent = profil.handle ? `@${profil.handle}` : '';
  sedan.textContent = profil.created_at ? `Med sedan ${datum(profil.created_at)}` : '';
  S.profilNamn = profilnamn(profil);
  // Brödsmulan ritades med platshållaren; nu finns namnet.
  switchView('profil');

  ritaStatistik(profil);
  void ritaHandlingar(profil);
}

export function initUiProfil() {
  /* Vyn ritas om när skärmen ändrar bredd, så att kartan får rätt antal
   * veckor — bara när den är den som visas. */
  let timer = null;
  window.addEventListener('resize', () => {
    if (S.currentViewName !== 'profil' || !visadId) return;
    clearTimeout(timer);
    timer = setTimeout(() => openProfil(visadId), 250);
  });
}
