// Vänner och profiler: reglerna, utan nätverk och utan DOM.
//
// Vad ett handtag får heta, vad två konton är för varandra, vilka tal en
// profil bär och hur de räknas fram ur biblioteket. Allt här prövas utan
// webbläsare; anropen mot Supabase ligger i core/vanner.js och vyerna i
// ui/vanner.js och ui/profil.js.

import { MASTERED_INTERVAL_DAYS } from './srs.js';

/** Samma form som check-villkoret i migration 0011. */
export const HANDLE_FORM = /^[a-z0-9_]{3,20}$/;

export const VISNINGSNAMN_MAX = 40;

/** Så många dagar av aktivitet profilen bär: ett halvår i veckokolumner. */
export const AKTIVITETSDAGAR = 26 * 7;

export const STATISTIK_VERSION = 1;

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Ett handtag som det skrivs in: med eller utan @, med versaler, med
 * blanksteg omkring. Ut kommer det som lagras.
 *
 * @param {string} inmatning
 * @returns {string}
 */
export function normaliseraHandle(inmatning) {
  return str(inmatning).trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Får handtaget lagras?
 *
 * @param {string} inmatning
 * @returns {{ok: true, varde: string} | {ok: false, fel: string}}
 */
export function provaHandle(inmatning) {
  const varde = normaliseraHandle(inmatning);
  if (!varde) return { ok: false, fel: 'Skriv ett namn.' };
  if (varde.length < 3) return { ok: false, fel: 'Namnet behöver minst tre tecken.' };
  if (varde.length > 20) return { ok: false, fel: 'Namnet får vara högst tjugo tecken.' };
  if (!HANDLE_FORM.test(varde)) {
    return { ok: false, fel: 'Bara små bokstäver a–z, siffror och understreck.' };
  }
  return { ok: true, varde };
}

/**
 * Får visningsnamnet lagras?
 *
 * @param {string} inmatning
 * @returns {{ok: true, varde: string} | {ok: false, fel: string}}
 */
export function provaVisningsnamn(inmatning) {
  const varde = str(inmatning).replace(/\s+/g, ' ').trim();
  if (!varde) return { ok: false, fel: 'Skriv ett namn.' };
  if (varde.length > VISNINGSNAMN_MAX) {
    return { ok: false, fel: `Namnet får vara högst ${VISNINGSNAMN_MAX} tecken.` };
  }
  return { ok: true, varde };
}

/**
 * Sökmönster för ilike: det man skrivit, som prefix, med LIKE:s egna
 * jokertecken oskadliggjorda. Ett understreck i ett handtag är ett tecken,
 * inte "vilket tecken som helst".
 *
 * @param {string} inmatning
 * @returns {string} tomt när det inte finns något att söka på
 */
export function sokmonster(inmatning) {
  const q = normaliseraHandle(inmatning).replace(/[\\%_]/g, (t) => `\\${t}`);
  return q ? `${q}%` : '';
}

/**
 * Vad två konton är för varandra, ur raderna i friendships.
 *
 * @param {Array<{id: string, requester_id: string, addressee_id: string, status: string}>} rader
 * @param {string} mig
 * @param {string} dem
 * @returns {{lage: 'ingen'|'vanner'|'skickad'|'mottagen', rad: object|null}}
 */
export function vanskapsLage(rader, mig, dem) {
  const rad = (rader ?? []).find(
    (r) =>
      (r.requester_id === mig && r.addressee_id === dem) ||
      (r.requester_id === dem && r.addressee_id === mig)
  );
  if (!rad) return { lage: 'ingen', rad: null };
  if (rad.status === 'accepted') return { lage: 'vanner', rad };
  return { lage: rad.requester_id === mig ? 'skickad' : 'mottagen', rad };
}

/**
 * Den andra i en vänskapsrad, sedd från mig.
 *
 * @param {{requester_id: string, addressee_id: string, requester?: object, addressee?: object}} rad
 * @param {string} mig
 */
export function denAndra(rad, mig) {
  return rad.requester_id === mig ? rad.addressee : rad.requester;
}

const antal = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/**
 * Nyckeln för en dag, lokal tid. Samma som history.localDateKey, men utan
 * att dra in hela loggen hit.
 */
export function dagnyckel(datum) {
  const d = new Date(datum);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Statistikbilden som ägarens klient publicerar på sin profil.
 *
 * Samma tal som Spelhallen visar, plus ett halvår av dagsräkningar för
 * aktivitetskartan. Prestationerna kommer in färdigräknade — de bor i
 * domain/stats.js, som läser appens tillstånd, och ska inte räknas två
 * gånger på två sätt.
 *
 * @param {object} arg
 * @param {Array<{cards: object[]}>} arg.decks
 * @param {Map<string, number>|Record<string, number>} arg.dagsrakningar dag → repetitioner
 * @param {{bestStreak?: number, bestDayCount?: number}} [arg.records]
 * @param {number} arg.streak
 * @param {number} [arg.longestStreak]
 * @param {Array<{title: string, desc: string}>} [arg.prestationer] de upplåsta
 * @param {Date} [arg.idag]
 * @returns {object}
 */
export function byggProfilstatistik({
  decks,
  dagsrakningar,
  records = {},
  streak,
  longestStreak = 0,
  prestationer = [],
  idag = new Date(),
}) {
  const kort = (decks ?? []).flatMap((d) => (d?.cards ?? []).filter((c) => c && c.type !== 'note'));
  const las = (nyckel) =>
    dagsrakningar instanceof Map ? (dagsrakningar.get(nyckel) ?? 0) : (dagsrakningar?.[nyckel] ?? 0);

  const aktivitet = {};
  let repetitioner = 0;
  let aktivaDagar = 0;
  const alla = dagsrakningar instanceof Map ? [...dagsrakningar.entries()] : Object.entries(dagsrakningar ?? {});
  for (const [, n] of alla) {
    repetitioner += antal(n);
    if (antal(n) > 0) aktivaDagar += 1;
  }
  for (let i = AKTIVITETSDAGAR - 1; i >= 0; i--) {
    const d = new Date(idag);
    d.setDate(d.getDate() - i);
    const nyckel = dagnyckel(d);
    const n = antal(las(nyckel));
    if (n > 0) aktivitet[nyckel] = n;
  }

  const langstaIntervall = Math.ceil(Math.max(0, ...kort.map((c) => c.interval || 0)));

  return {
    version: STATISTIK_VERSION,
    updatedAt: idag.toISOString(),
    cards: kort.length,
    decks: (decks ?? []).length,
    mastered: kort.filter((c) => (c.interval || 0) >= MASTERED_INTERVAL_DAYS).length,
    reviews: repetitioner,
    activeDays: aktivaDagar,
    streak: antal(streak),
    longestStreak: Math.max(antal(longestStreak), antal(records?.bestStreak), antal(streak)),
    bestDay: antal(records?.bestDayCount),
    longestInterval: langstaIntervall,
    achievements: prestationer
      .filter((p) => p && typeof p.title === 'string')
      .slice(0, 50)
      .map((p) => ({ title: p.title.slice(0, 60), desc: str(p.desc).slice(0, 120) })),
    activity: aktivitet,
  };
}

/**
 * Prövar en statistikbild som kommer från någon annans profil.
 *
 * Den skrevs av en annan klient och kan vara vad som helst. Ut kommer bara
 * tal och strängar i de fält vyn läser, kapade vid rimliga tak; en trasig
 * bild ger en tom, inte ett fel.
 *
 * @param {unknown} stats
 * @returns {object|null} null när det inte finns något att visa
 */
export function provaProfilstatistik(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const tal = (v, max = 10_000_000) => Math.min(antal(Number(v)), max);
  const aktivitet = {};
  if (stats.activity && typeof stats.activity === 'object') {
    for (const [dag, n] of Object.entries(stats.activity).slice(0, 400)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dag) && antal(Number(n)) > 0) aktivitet[dag] = tal(n, 100_000);
    }
  }
  const prestationer = Array.isArray(stats.achievements)
    ? stats.achievements
        .filter((p) => p && typeof p.title === 'string' && p.title.trim())
        .slice(0, 50)
        .map((p) => ({ title: p.title.slice(0, 60), desc: str(p.desc).slice(0, 120) }))
    : [];
  return {
    updatedAt: typeof stats.updatedAt === 'string' ? stats.updatedAt : null,
    cards: tal(stats.cards),
    decks: tal(stats.decks),
    mastered: tal(stats.mastered),
    reviews: tal(stats.reviews),
    activeDays: tal(stats.activeDays),
    streak: tal(stats.streak),
    longestStreak: tal(stats.longestStreak),
    bestDay: tal(stats.bestDay),
    longestInterval: tal(stats.longestInterval),
    achievements: prestationer,
    activity: aktivitet,
  };
}

/**
 * Rekorden att visa på en profil, ur en prövad statistikbild. Samma urval
 * och samma ordalag som Spelhallen, så att ens egen profil säger det man
 * redan sett där.
 *
 * @param {object} stats det provaProfilstatistik gav
 * @returns {Array<{n: number, l: string}>}
 */
export function profilRekord(stats) {
  if (!stats) return [];
  return [
    stats.bestDay ? { n: stats.bestDay, l: 'kort på en dag' } : null,
    stats.longestStreak ? { n: stats.longestStreak, l: 'dagars längsta streak' } : null,
    stats.longestInterval >= 7 ? { n: stats.longestInterval, l: 'dagars längsta intervall' } : null,
    stats.activeDays ? { n: Math.round(stats.reviews / stats.activeDays), l: 'snitt per aktiv dag' } : null,
    stats.reviews ? { n: stats.reviews, l: 'repetitioner totalt' } : null,
  ].filter(Boolean);
}

/** Vad en delning kallas i löpande text, efter sort. */
export function delningsSort(kind) {
  return { section: 'mapp', card: 'kort' }[kind] ?? 'kortlek';
}

/**
 * Sökvägen till profilbilden i hinken. Ett namn per konto: byts bilden
 * skrivs den över, och den gamla lämnar ingen fil efter sig.
 *
 * @param {string} userId
 * @param {string} andelse webp, jpg eller png
 */
export function avatarSokvag(userId, andelse) {
  return `${userId}/avatar.${andelse}`;
}

/**
 * Initialerna att visa när det inte finns någon bild.
 *
 * @param {{display_name?: string, handle?: string}} profil
 */
export function initialer(profil) {
  const namn = str(profil?.display_name).trim() || str(profil?.handle);
  const delar = namn.split(/\s+/).filter(Boolean);
  const bokstaver = delar.length >= 2 ? delar[0][0] + delar[delar.length - 1][0] : namn.slice(0, 2);
  return bokstaver.toUpperCase();
}
