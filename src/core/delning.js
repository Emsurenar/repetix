/* Delade kortlekar mot Supabase.
 *
 * Direkta anrop, utanför synken — som källorna. Delningen är inte en del av
 * biblioteket: den är ett brev mellan två konton, och det som till slut
 * hamnar i mottagarens bibliotek går in genom den vanliga vägen, saveData och
 * synken, som vilken ny kortlek som helst.
 *
 * Vad som får skickas och tas emot avgörs i domain/delning.js. Här utförs det:
 * raden, bilderna i väntområdet, kopian hos mottagaren. Se migration 0010 för
 * vad servern släpper igenom och varför.
 */

import {
  NY_KORTLEK,
  TAK,
  byggNyttolast,
  infogaIKortlek,
  packaUpp,
  sammanfatta,
  stagingVag,
  validera,
} from '../domain/delning.js';
import { nyttKortId } from '../domain/model.js';
import { dataUrlToBlob, isDataUrl } from './image-compress.js';
import { buildStoragePath } from './image-store.js';
import { hamtaKallor, hamtaKalltext, sparaKalla } from './sources.js';
import { S } from './state.js';
import { saveData } from './storage.js';
import { getUser, getUserId, supabase } from './supabase.js';
import { recordChanges, sync } from './sync.js';
import { nyttId } from './utils.js';

const BUCKET = 'card-images';

const ANDELSE_TILL_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const andelse = (filnamn) => filnamn.slice(filnamn.lastIndexOf('.') + 1).toLowerCase();

/** Den inloggades adress, normaliserad som servern gör det. */
const minEpost = () => {
  const e = getUser()?.email;
  return typeof e === 'string' ? e.trim().toLowerCase() : null;
};

/** Sant när det finns någon att dela med: moln och konto. */
export function delningTillganglig() {
  return Boolean(supabase && getUserId());
}

/* Ett fel från servern översatt till en mening. Funktionerna i 0010 kastar
 * med egna texter på svenska; de behålls. Allt annat får en text som säger
 * vad man gjorde, inte vad servern heter. */
function feltext(error, standard) {
  const m = typeof error?.message === 'string' ? error.message : '';
  if (/dela med dig själv|obesvarade delningar|finns inte/i.test(m)) return m.replace(/\.?$/, '.');
  if (/inte vänner|ingen mottagare|okänd sorts/i.test(m)) return m.replace(/\.?$/, '.');
  if (/schema cache|could not find the function|does not exist|relation .* does not exist/i.test(m)) {
    return 'Databasen saknar delningsfunktionen. Kör migration 0010 och 0011.';
  }
  if (/failed to fetch|load failed|networkerror/i.test(m)) {
    return 'Ingen kontakt med servern. Kontrollera din uppkoppling.';
  }
  return standard;
}

/* Sant när felet betyder att 0011 inte är körd: kolumnen eller relationen
 * finns inte. Frågorna nedan ställs då om i den form 0010 förstår, så att
 * inkorgen fungerar med adresser även innan vännerna finns. */
const saknar0011 = (error) =>
  error?.code === '42703' ||
  error?.code === 'PGRST200' ||
  /column .* does not exist|relationship|schema cache/i.test(error?.message ?? '');

/* Ett värde i ett or-filter. PostgREST läser kommatecken och parenteser som
 * syntax; citattecknen gör adressen till en sträng. */
const citerad = (v) => `"${String(v).replace(/"/g, '')}"`;

// ---------------------------------------------------------------------------
// Dela
// ---------------------------------------------------------------------------

/**
 * Väntområdets filer för en delning. Både avsändare och mottagare får lista
 * och ta bort dem så länge delningen väntar; se policyn i 0010.
 */
async function tomVantomrade(delningsId) {
  const { data, error } = await supabase.storage.from(BUCKET).list(`delningar/${delningsId}`, { limit: 1000 });
  if (error || !data?.length) return;
  const vagar = data.map((f) => stagingVag(delningsId, f.name));
  await supabase.storage.from(BUCKET).remove(vagar);
}

/**
 * Lägger en bild i väntområdet. En sökväg kopieras inom hinken; en base64-post
 * som ännu inte migrerats laddas upp som fil.
 */
async function laggIVantomrade(fran, till) {
  if (isDataUrl(fran)) {
    const blob = await dataUrlToBlob(fran);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(till, blob, { contentType: blob.type || undefined, upsert: false });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.storage.from(BUCKET).copy(fran, till);
  if (error) throw error;
}

/**
 * Vad som skulle följa med om det delades nu. För dialogens rad.
 *
 * @param {object} deck det som delas
 * @param {string} [kind]
 */
export async function delningsInnehall(deck, kind = 'deck') {
  const kallor = kind === 'deck' && delningTillganglig() ? await hamtaKallor(deck.id) : [];
  const byggd = byggNyttolast(deck, { kallor: kallor.map((k) => ({ ...k, text: '' })), kind });
  if (!byggd.ok) return { ok: false, fel: byggd.fel };
  return { ok: true, ...sammanfatta(byggd.nyttolast) };
}

/**
 * Delar en kortlek, en mapp eller ett kort — med en adress eller med en vän.
 *
 * Ordningen: raden först, i läget preparing, för väntområdets policy kräver
 * att delningen finns. Sedan bilderna. Först när alla ligger där publiceras
 * delningen — en accept ska aldrig hitta ett halvfyllt väntområde. Går något
 * på vägen fel städas raden och det som hann kopieras bort: en delning som
 * inte gick att fullborda ska inte ligga kvar som en gåta i "Skickade".
 *
 * Källorna följer bara med en hel kortlek: en mapp eller ett kort är en
 * del av leken, och källan hör till helheten.
 *
 * @param {{deck: object, epost?: string, mottagarId?: string|null, kind?: string}} arg
 *   `deck` är det som delas — en kortlek, eller det delbarMapp/delbartKort gav
 * @returns {Promise<{ok: true, id: string} | {ok: false, fel: string}>}
 */
export async function delaKortlek({ deck, epost, mottagarId = null, kind = 'deck' }) {
  if (!delningTillganglig()) return { ok: false, fel: 'Att dela kräver ett konto.' };
  let till = null;
  if (mottagarId) {
    if (mottagarId === getUserId()) return { ok: false, fel: 'Du kan inte dela med dig själv.' };
  } else {
    till = String(epost ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(till) || till.length > 320) {
      return { ok: false, fel: 'Adressen ser inte giltig ut.' };
    }
    if (till === minEpost()) return { ok: false, fel: 'Du kan inte dela med dig själv.' };
  }

  // Källtexterna hämtas en i taget: de är tunga, och listan ovan bär dem inte.
  const kallor = [];
  if (kind === 'deck') {
    const kallmeta = await hamtaKallor(deck.id);
    for (const k of kallmeta.slice(0, TAK.kallor)) {
      const text = await hamtaKalltext(k.id);
      if (text) kallor.push({ title: k.title, pages: k.pages, chars: k.chars, text });
    }
  }

  const byggd = byggNyttolast(deck, { kallor, kind });
  if (!byggd.ok) return { ok: false, fel: byggd.fel };
  const { nyttolast, bilder } = byggd;
  const tal = sammanfatta(nyttolast);

  const { data: id, error } = await supabase.rpc('share_deck', {
    p_recipient_email: till,
    p_recipient_id: mottagarId,
    p_kind: nyttolast.kind,
    p_title: nyttolast.title,
    p_card_count: tal.kort + tal.anteckningar,
    p_image_count: tal.bilder,
    p_source_count: tal.kallor,
    p_payload: nyttolast,
  });
  if (error || !id) return { ok: false, fel: feltext(error, 'Kunde inte dela kortleken.') };

  try {
    for (const { fran, filnamn } of bilder) {
      await laggIVantomrade(fran, stagingVag(id, filnamn));
    }
    const { error: publiceringsfel } = await supabase.rpc('publish_share', { p_id: id });
    if (publiceringsfel) throw publiceringsfel;
  } catch (fel) {
    await tomVantomrade(id).catch(() => {});
    await supabase.from('deck_shares').delete().eq('id', id);
    return { ok: false, fel: feltext(fel, 'Bilderna kunde inte kopieras, så delningen avbröts.') };
  }

  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Inkorgen
// ---------------------------------------------------------------------------

const lyssnare = new Set();
let antalVantande = 0;

/** Antalet väntande delningar, som det lästes senast. */
export function inkorgsAntal() {
  return antalVantande;
}

/** Prenumerera på räknaren. Anropas direkt med nuvarande värde. */
export function onInkorgChange(fn) {
  lyssnare.add(fn);
  fn(antalVantande);
  return () => lyssnare.delete(fn);
}

function sattAntal(n) {
  if (n === antalVantande) return;
  antalVantande = n;
  for (const fn of lyssnare) fn(n);
}

/**
 * Räknar om inkorgen. Anropas efter varje lyckad synk: det är den takt appen
 * redan pratar med servern i, och en delning som kommit sedan sist syns då
 * inom en minut utan en egen klocka.
 */
export async function uppdateraInkorg() {
  const epost = minEpost();
  if (!delningTillganglig() || !epost) return sattAntal(0);
  const fraga = (ny) => {
    const q = supabase.from('deck_shares').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    return ny
      ? q.or(`recipient_email.eq.${citerad(epost)},recipient_id.eq.${getUserId()}`)
      : q.eq('recipient_email', epost);
  };
  let { count, error } = await fraga(true);
  if (error && saknar0011(error)) ({ count, error } = await fraga(false));
  if (!error) sattAntal(count ?? 0);
}

const PROFIL = 'id, handle, display_name, avatar_path, updated_at';

/** Delningar som väntar på mig. Utan nyttolasten — den hämtas vid accept. */
export async function hamtaInkorg() {
  const epost = minEpost();
  if (!delningTillganglig() || !epost) return { ok: true, rader: [] };
  const fraga = (ny) => {
    const q = supabase
      .from('deck_shares')
      .select(
        ny
          ? `id, sender_email, title, card_count, image_count, source_count, created_at, expires_at, kind, sender:profiles!deck_shares_sender_profile_fkey(${PROFIL})`
          : 'id, sender_email, title, card_count, image_count, source_count, created_at, expires_at'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    return ny
      ? q.or(`recipient_email.eq.${citerad(epost)},recipient_id.eq.${getUserId()}`)
      : q.eq('recipient_email', epost);
  };
  let { data, error } = await fraga(true);
  if (error && saknar0011(error)) ({ data, error } = await fraga(false));
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta inkorgen.'), rader: [] };
  sattAntal(data?.length ?? 0);
  return { ok: true, rader: data ?? [] };
}

/** Delningar jag skickat, nyast först. */
export async function hamtaSkickade() {
  if (!delningTillganglig()) return { ok: true, rader: [] };
  const fraga = (ny) =>
    supabase
      .from('deck_shares')
      .select(
        ny
          ? `id, recipient_email, title, status, card_count, created_at, expires_at, responded_at, kind, recipient:profiles!deck_shares_recipient_id_fkey(${PROFIL})`
          : 'id, recipient_email, title, status, card_count, created_at, expires_at, responded_at'
      )
      .eq('sender_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(100);
  let { data, error } = await fraga(true);
  if (error && saknar0011(error)) ({ data, error } = await fraga(false));
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta skickade delningar.'), rader: [] };
  return { ok: true, rader: data ?? [] };
}

/**
 * Det som delats mellan mig och en annan, åt båda håll, nyast först. För
 * profilens "Delat mellan er". Kräver 0011: raderna adresseras med id.
 *
 * @param {string} userId
 */
export async function delningarMed(userId) {
  if (!delningTillganglig() || !userId) return { ok: true, rader: [] };
  const mig = getUserId();
  const { data, error } = await supabase
    .from('deck_shares')
    .select('id, kind, title, status, card_count, created_at, responded_at, sender_id, recipient_id')
    .or(`and(sender_id.eq.${mig},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${mig})`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { ok: false, fel: feltext(error, 'Kunde inte hämta delningarna.'), rader: [] };
  return { ok: true, rader: data ?? [] };
}

/**
 * Tar emot en delning: kopian skrivs in i biblioteket och synkas upp.
 *
 * Bilderna kopieras FÖRE raden svaras: när delningen är besvarad får
 * mottagaren inte längre läsa väntområdet. Källorna skrivs efter synken, för
 * de pekar på kortleksraden i molnet och den finns inte förrän utkorgen är
 * skickad. Går synken inte igenom just då stannar källorna kvar hos
 * avsändaren — kortleken finns ändå, och det sägs.
 *
 * En mapp eller ett kort läggs i en av mottagarens egna kortlekar när
 * `malDeckId` pekar på en; annars, och för hela kortlekar, blir det en ny.
 *
 * @param {string} delningsId
 * @param {{malDeckId?: string|null}} [val]
 * @returns {Promise<{ok: true, deck: object, sectionId: string|null, ny: boolean, bilderSaknas: number, kallorSaknas: number, varning: string|null}
 *   | {ok: false, fel: string}>}
 */
export async function acceptera(delningsId, { malDeckId = null } = {}) {
  if (!delningTillganglig()) return { ok: false, fel: 'Att ta emot kräver ett konto.' };

  const { data, error } = await supabase
    .from('deck_shares')
    .select('id, payload, status')
    .eq('id', delningsId)
    .maybeSingle();
  if (error || !data) return { ok: false, fel: feltext(error, 'Delningen finns inte längre.') };

  const prov = validera(data.payload);
  if (!prov.ok) return { ok: false, fel: prov.fel };

  const userId = getUserId();
  const { deck, bilder, kallor } = packaUpp(prov.varde, {
    nyttId,
    kortId: nyttKortId,
    nu: Date.now(),
  });
  const kind = prov.varde.kind ?? 'deck';
  const tillBefintlig = kind !== 'deck' && malDeckId && malDeckId !== NY_KORTLEK;
  const mal = tillBefintlig ? S.appData.decks.find((d) => d.id === malDeckId) : null;
  if (tillBefintlig && !mal) return { ok: false, fel: 'Kortleken finns inte längre.' };

  // Bilderna, var och en till sin egen mapp hos mottagaren. En som inte går
  // att kopiera lämnar ett kort utan bild — inte en delning utan kortlek.
  let bilderSaknas = 0;
  const kortPerId = new Map(deck.cards.map((c) => [c.id, c]));
  for (const { kortId, filnamn } of bilder) {
    const kort = kortPerId.get(kortId);
    if (!kort) continue;
    const till = buildStoragePath(userId, kortId, ANDELSE_TILL_MIME[andelse(filnamn)]);
    const { error: kopiefel } = await supabase.storage
      .from(BUCKET)
      .copy(stagingVag(delningsId, filnamn), till);
    if (kopiefel) bilderSaknas += 1;
    else kort.backImages.push(till);
  }

  // In i biblioteket, och upp i molnet. recordChanges körs direkt i stället
  // för att vänta på saveData:s fördröjning: källorna nedan behöver raden.
  let resultat;
  if (mal) {
    const { sectionId } = infogaIKortlek(deck, mal, { nyttId, kind });
    resultat = { deck: mal, sectionId, ny: false };
  } else {
    S.appData.decks.push(deck);
    resultat = { deck, sectionId: null, ny: true };
  }
  saveData();
  await recordChanges(S.appData);
  const synkad = await sync();

  let kallorSaknas = 0;
  if (kallor.length) {
    if (synkad === false && kallor.length) {
      kallorSaknas = kallor.length;
    } else {
      for (const k of kallor) {
        const res = await sparaKalla({ deckId: resultat.deck.id, title: k.title, text: k.text, pages: k.pages });
        if (!res.ok) kallorSaknas += 1;
      }
    }
  }

  await tomVantomrade(delningsId).catch(() => {});
  const { error: svarsfel } = await supabase.rpc('respond_to_share', { p_id: delningsId, p_accept: true });
  void uppdateraInkorg();

  return {
    ok: true,
    ...resultat,
    bilderSaknas,
    kallorSaknas,
    varning: svarsfel ? 'Delningen är mottagen, men kunde inte märkas som besvarad.' : null,
  };
}

/** Nekar en delning. Väntområdet töms först, medan mottagaren ännu får. */
export async function neka(delningsId) {
  if (!delningTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  await tomVantomrade(delningsId).catch(() => {});
  const { error } = await supabase.rpc('respond_to_share', { p_id: delningsId, p_accept: false });
  void uppdateraInkorg();
  return error ? { ok: false, fel: feltext(error, 'Kunde inte neka delningen.') } : { ok: true };
}

/** Återkallar eller städar bort en delning jag skickat. Filerna först, raden sist. */
export async function aterkalla(delningsId) {
  if (!delningTillganglig()) return { ok: false, fel: 'Kräver ett konto.' };
  await tomVantomrade(delningsId).catch(() => {});
  const { error } = await supabase.from('deck_shares').delete().eq('id', delningsId);
  return error ? { ok: false, fel: feltext(error, 'Kunde inte ta bort delningen.') } : { ok: true };
}
