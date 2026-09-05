/* Vänner och profiler mot Supabase.
 *
 * Direkta anrop, utanför synken — som delningen. En vänskap är inte en del
 * av biblioteket; den är ett förhållande mellan två konton, och profilen är
 * det man visar upp för dem. Reglerna — vad ett handtag får heta, vad två
 * konton är för varandra, vilka tal profilen bär — ligger i domain/vanner.js
 * och prövas utan webbläsare. Här utförs de. Se migration 0011 för vad
 * servern släpper igenom och varför.
 */

import { getAchievements, loadRecords } from '../domain/stats.js';
import { currentStreak, dailyCounts, longestStreak, mergeLegacyCounts } from '../domain/history.js';
import {
  avatarSokvag,
  byggProfilstatistik,
  provaHandle,
  provaVisningsnamn,
  sokmonster,
} from '../domain/vanner.js';
import { hash } from '../domain/wash-tilldelning.js';
import { compressDataUrl, dataUrlToBlob, extensionForMime } from './image-compress.js';
import { S } from './state.js';
import { getUserId, supabase } from './supabase.js';
import { getReviewLog } from './sync.js';

const BUCKET = 'avatars';

/** Kolumnerna en profil består av. Aldrig e-posten — den finns inte i raden. */
const PROFILKOLUMNER = 'id, handle, display_name, avatar_path, created_at, updated_at, stats, stats_updated_at';

/** Sant när det finns någon att vara vän med: moln och konto. */
export function vannerTillganglig() {
  return Boolean(supabase && getUserId());
}

/* Ett fel från servern översatt till en mening. Funktionerna i 0011 kastar
 * med egna texter på svenska; de behålls. Allt annat får en text som säger
 * vad man gjorde, inte vad servern heter. */
function feltext(error, standard) {
  const m = typeof error?.message === 'string' ? error.message : '';
  const kod = error?.code;
  if (/ingen med det namnet|dig själv|redan vänner|redan skickad|obesvarade förfrågningar|finns inte längre|inte vänner|användarnamn först/i.test(m)) {
    return m.replace(/\.?$/, '.');
  }
  if (kod === '23505' || /duplicate key|profiles_handle_unique/i.test(m)) return 'Namnet är upptaget.';
  if (kod === '23514' || /violates check constraint/i.test(m)) return 'Det gick inte att spara: värdet har fel form.';
  if (
    kod === '42703' ||
    kod === '42P01' ||
    /schema cache|could not find the function|does not exist|relation .* does not exist/i.test(m)
  ) {
    return 'Databasen saknar vänfunktionen. Kör migration 0011.';
  }
  if (/failed to fetch|load failed|networkerror/i.test(m)) {
    return 'Ingen kontakt med servern. Kontrollera din uppkoppling.';
  }
  return standard;
}

// ---------------------------------------------------------------------------
// Profilen
// ---------------------------------------------------------------------------

/** Min egen profilrad. */
export async function minProfil() {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILKOLUMNER)
    .eq('id', getUserId())
    .maybeSingle();
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta profilen.') };
  return { ok: true, profil: data ?? null };
}

/** Någon annans profil, om den är synlig: bara profiler med handtag är det. */
export async function hamtaProfil(userId) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const { data, error } = await supabase.from('profiles').select(PROFILKOLUMNER).eq('id', userId).maybeSingle();
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta profilen.') };
  if (!data) return { ok: false, fel: 'Profilen finns inte, eller är inte synlig.' };
  return { ok: true, profil: data };
}

/**
 * Sparar handtag och visningsnamn. Formen prövas här innan något skickas,
 * så att ett fel kan sägas med ord i stället för med en postgres-kod.
 *
 * @param {{handle: string, displayName: string}} arg
 */
export async function sparaProfil({ handle, displayName }) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const h = provaHandle(handle);
  if (!h.ok) return h;
  const n = provaVisningsnamn(displayName);
  if (!n.ok) return n;

  const { data, error } = await supabase
    .from('profiles')
    .update({ handle: h.varde, display_name: n.varde, updated_at: new Date().toISOString() })
    .eq('id', getUserId())
    .select(PROFILKOLUMNER)
    .maybeSingle();
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte spara profilen.') };
  return { ok: true, profil: data };
}

/**
 * Bildens adress, med bytesräknare: hinken är publik och webbläsaren cachar
 * hårt, så en ny bild på samma sökväg hade annars sett ut som den gamla
 * tills cachen gick ut.
 *
 * @param {{avatar_path?: string|null, updated_at?: string}|null} profil
 * @returns {string|null}
 */
export function avatarUrl(profil) {
  if (!supabase || !profil?.avatar_path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(profil.avatar_path);
  if (!data?.publicUrl) return null;
  const v = Date.parse(profil.updated_at ?? '') || 0;
  return `${data.publicUrl}?v=${v}`;
}

const lasFilSomDataUrl = (fil) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Filen gick inte att läsa.'));
    r.readAsDataURL(fil);
  });

/**
 * Laddar upp en profilbild.
 *
 * Skalas ned till 256 pixlar innan den skickas: profilbilden visas som
 * mest i 96 och oftast i 28, och en telefonbild på fyra megabyte hade
 * kostat varje besökare av profilen det. Ett filnamn per konto — byts
 * bilden skrivs den över, och en fil med annan ändelse tas bort.
 *
 * @param {Blob} fil
 */
export async function laddaUppAvatar(fil) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  if (!fil || !/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(fil.type)) {
    return { ok: false, fel: 'Välj en bild i JPEG, PNG eller WebP.' };
  }
  const userId = getUserId();

  try {
    const dataUrl = await lasFilSomDataUrl(fil);
    const { dataUrl: liten, mime } = await compressDataUrl(dataUrl, { maxSide: 256, quality: 0.85 });
    const blob = await dataUrlToBlob(liten);
    const typ = blob.type || mime;
    const andelse = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[typ];
    if (!andelse) return { ok: false, fel: 'Bilden gick inte att göra om till ett format hinken tar emot.' };

    const { data: fore } = await supabase.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
    const sokvag = avatarSokvag(userId, andelse);

    const { error: uppladdningsfel } = await supabase.storage.from(BUCKET).upload(sokvag, blob, {
      contentType: typ,
      upsert: true,
      cacheControl: '3600',
    });
    if (uppladdningsfel) return { ok: false, fel: feltext(uppladdningsfel, 'Bilden kunde inte laddas upp.') };

    const { data, error } = await supabase
      .from('profiles')
      .update({ avatar_path: sokvag, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select(PROFILKOLUMNER)
      .maybeSingle();
    if (error) return { ok: false, fel: feltext(error, 'Bilden är uppladdad men kunde inte kopplas till profilen.') };

    if (fore?.avatar_path && fore.avatar_path !== sokvag) {
      await supabase.storage.from(BUCKET).remove([fore.avatar_path]).catch(() => {});
    }
    return { ok: true, profil: data };
  } catch (e) {
    return { ok: false, fel: e?.message || 'Bilden gick inte att läsa.' };
  }
}

/** Tar bort profilbilden: filen först, sedan raden. */
export async function taBortAvatar() {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const userId = getUserId();
  const { data: fore } = await supabase.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
  if (fore?.avatar_path) await supabase.storage.from(BUCKET).remove([fore.avatar_path]).catch(() => {});
  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_path: null, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select(PROFILKOLUMNER)
    .maybeSingle();
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte ta bort bilden.') };
  return { ok: true, profil: data };
}

/**
 * Söker profiler på handtagets början. Högst tio: det är en sökruta, inte
 * en katalog, och den som vet vem hen letar efter behöver inte fler.
 *
 * @param {string} q
 */
export async function sokProfiler(q) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.', rader: [] };
  const monster = sokmonster(q);
  if (!monster) return { ok: true, rader: [] };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_path, updated_at')
    .ilike('handle', monster)
    .neq('id', getUserId())
    .order('handle')
    .limit(10);
  if (error) return { ok: false, fel: feltext(error, 'Sökningen misslyckades.'), rader: [] };
  return { ok: true, rader: data ?? [] };
}

// ---------------------------------------------------------------------------
// Vänskaper
// ---------------------------------------------------------------------------

/* Raden med båda profilerna invävda. Namnen på nycklarna är de Postgres
 * gav när tabellen skapades; PostgREST behöver dem eftersom raden pekar på
 * profiles två gånger. */
const VANSKAPSKOLUMNER = `id, status, requester_id, addressee_id, created_at, responded_at,
  requester:profiles!friendships_requester_id_fkey(id, handle, display_name, avatar_path, updated_at),
  addressee:profiles!friendships_addressee_id_fkey(id, handle, display_name, avatar_path, updated_at)`;

/** Alla mina vänskapsrader: vänner och förfrågningar åt båda håll. */
export async function hamtaVanskaper() {
  if (!vannerTillganglig()) return { ok: true, rader: [] };
  const { data, error } = await supabase
    .from('friendships')
    .select(VANSKAPSKOLUMNER)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta vännerna.'), rader: [] };
  const rader = data ?? [];
  sattAntal(rader.filter((r) => r.status === 'pending' && r.addressee_id === getUserId()).length);
  return { ok: true, rader };
}

/**
 * Vännernas profiler med statistikbild, för veckolistan. En fråga för alla:
 * profilerna med handtag är läsbara för varje inloggad, så det behövs
 * ingen funktion på servern.
 *
 * @param {string[]} ids
 */
export async function hamtaProfiler(ids) {
  if (!vannerTillganglig() || !ids?.length) return { ok: true, rader: [] };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_path, updated_at, stats, stats_updated_at')
    .in('id', ids.slice(0, 200));
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta vännernas statistik.'), rader: [] };
  return { ok: true, rader: data ?? [] };
}

/** Skickar en förfrågan till ett handtag. Kan bli ett ja, se 0011. */
export async function skickaVanforfragan(handle) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const h = provaHandle(handle);
  if (!h.ok) return h;
  const { data, error } = await supabase.rpc('send_friend_request', { p_handle: h.varde });
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte skicka förfrågan.') };
  void uppdateraVanantal();
  return { ok: true, id: data };
}

/** Tackar ja till en förfrågan som väntar på mig. */
export async function accepteraVanforfragan(id) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const { error } = await supabase.rpc('accept_friend_request', { p_id: id });
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte acceptera förfrågan.') };
  void uppdateraVanantal();
  return { ok: true };
}

/**
 * Tar bort raden: nekar, drar tillbaka eller avslutar. Samma sak för
 * databasen; vad det heter avgör vyn.
 */
export async function taBortVanskap(id) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const { error } = await supabase.from('friendships').delete().eq('id', id);
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte ta bort.') };
  void uppdateraVanantal();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Räknaren i sidopanelen
// ---------------------------------------------------------------------------

const lyssnare = new Set();
let antalVantande = 0;

/** Prenumerera på antalet förfrågningar som väntar på mig. */
export function onVannerChange(fn) {
  lyssnare.add(fn);
  fn(antalVantande);
  return () => lyssnare.delete(fn);
}

function sattAntal(n) {
  if (n === antalVantande) return;
  antalVantande = n;
  for (const fn of lyssnare) fn(n);
}

/** Räknar om förfrågningarna. Anropas efter varje lyckad synk, som inkorgen. */
export async function uppdateraVanantal() {
  if (!vannerTillganglig()) return sattAntal(0);
  const { count, error } = await supabase
    .from('friendships')
    .select('id', { count: 'exact', head: true })
    .eq('addressee_id', getUserId())
    .eq('status', 'pending');
  if (!error) sattAntal(count ?? 0);
}

// ---------------------------------------------------------------------------
// Statistiken på profilen
// ---------------------------------------------------------------------------

const SIGNATURNYCKEL = 'repetix_profilstatistik_signatur';

/**
 * Räknar fram statistikbilden ur biblioteket och repetitionsloggen. Samma
 * tal som Spelhallen: dagsräkningarna med de äldre invävda, streaken ur
 * dem, prestationerna ur domain/stats.js.
 */
export function raknaStatistik() {
  const records = loadRecords();
  const dagsrakningar = mergeLegacyCounts(dailyCounts(getReviewLog()), records.dailyCounts);
  const streak = currentStreak(dagsrakningar);
  const allaKort = (S.appData?.decks ?? []).flatMap((d) => (d.cards ?? []).filter((c) => c.type !== 'note'));
  const kategorier = getAchievements(allaKort, streak, records);
  const prestationer = Object.values(kategorier)
    .flat()
    .filter((a) => a.unlocked)
    .map((a) => ({ title: a.title, desc: a.desc }));
  return byggProfilstatistik({
    decks: S.appData?.decks ?? [],
    dagsrakningar,
    records,
    streak,
    longestStreak: longestStreak(dagsrakningar),
    prestationer,
  });
}

/**
 * Publicerar statistiken på min profil, om den ändrats sedan sist.
 *
 * Anropas efter varje lyckad synk. Signaturen sparas lokalt, så att en synk
 * som inte ändrat något inte heller skriver något — profilen uppdateras
 * när talen gör det, och stämpeln säger när. Utan handtag publiceras
 * inget: ingen kan se raden, och en bild ingen ser är en skrivning i onödan.
 *
 * @param {{tvinga?: boolean}} [val]
 */
export async function publiceraStatistik({ tvinga = false } = {}) {
  if (!vannerTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  const stats = raknaStatistik();
  const signatur = String(hash(JSON.stringify({ ...stats, updatedAt: null })));

  let sparad = null;
  try {
    sparad = localStorage.getItem(SIGNATURNYCKEL);
  } catch {
    /* lagringen kan vara avstängd; då publiceras vid varje synk, vilket duger */
  }
  if (!tvinga && sparad === `${getUserId()}:${signatur}`) return { ok: true, oforandrad: true };

  const { data: rad } = await supabase.from('profiles').select('handle').eq('id', getUserId()).maybeSingle();
  if (!rad?.handle && !tvinga) return { ok: true, oforandrad: true };

  const { error } = await supabase
    .from('profiles')
    .update({ stats, stats_updated_at: stats.updatedAt })
    .eq('id', getUserId());
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte publicera statistiken.') };

  try {
    localStorage.setItem(SIGNATURNYCKEL, `${getUserId()}:${signatur}`);
  } catch {
    /* se ovan */
  }
  return { ok: true, oforandrad: false };
}
