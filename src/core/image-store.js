// Kortbilder i Supabase Storage.
//
// Bilderna låg tidigare som okomprimerad base64 inuti kortobjektet i
// localStorage. En enda mobilbild sprängde då kvoten på omkring 5 MB, och när
// det hände förlorades hela skrivningen — alla kort som ändrats sedan förra
// sparningen, inte bara bilden. Det var appens största risk för dataförlust.
//
// Här ligger bilderna i stället i hinken `card-images` och kortet bär bara en
// sökväg på några tiotal tecken.
//
// Hela modulen är valfri: utan konfigurerat moln eller inloggad användare
// fortsätter appen att spara base64 lokalt precis som förut, och migreringen
// väntar tills det finns någonstans att flytta bilderna.

import {
  compressDataUrl,
  dataUrlByteLength,
  dataUrlToBlob,
  extensionForMime,
  isDataUrl,
  parseDataUrl,
} from './image-compress.js';
import { getUserId, supabase } from './supabase.js';

const BUCKET = 'card-images';

/** Livslängd på en signerad URL. Längre än ett rimligt studiepass. */
const SIGNERAD_LIVSLANGD_S = 60 * 60;

/** Förnya innan utgång, så att en bild aldrig hinner bli ogiltig mitt i ett pass. */
const FORNYA_MARGINAL_MS = 5 * 60 * 1000;

/**
 * Signerade URL:er per sökväg.
 *
 * Utan cache skulle varje omrendering av ett kort — och studievyn ritar om vid
 * varje betyg — begära en ny signerad URL per bild, vilket både kostar en
 * nätverksrunda och gör att webbläsarens bildcache aldrig träffar, eftersom
 * URL:en är ny varje gång.
 */
const signeradeUrler = new Map();

/** Sant när bilder kan lagras i molnet just nu. */
export function imageCloudReady() {
  return Boolean(supabase && getUserId());
}

/** Tömmer URL-cachen. Anropas vid utloggning så att nästa användares bilder hämtas på nytt. */
export function clearUrlCache() {
  signeradeUrler.clear();
}

// ---------------------------------------------------------------------------
// Sökvägar
// ---------------------------------------------------------------------------

/** Snålt tecken-urval: sökvägen ska överleva både URL-kodning och Supabases nyckelregler. */
const sanera = (del) => String(del ?? '').replace(/[^A-Za-z0-9._-]/g, '-') || 'okant';

const nyttId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Bygger lagringssökvägen för en bild.
 *
 * Första mappnivån MÅSTE vara user-id. Lagringspolicyn i
 * supabase/migrations/0001_init.sql jämför just den nivån mot auth.uid(), så en
 * sökväg som börjar med något annat avvisas av databasen — och en sökväg utan
 * user-id hade dessutom gjort det möjligt att gissa sig till andras bilder.
 *
 * Filnamnet är slumpat i stället för härlett ur innehållet: två kort kan bära
 * samma bild, och då ska en radering av det ena inte släcka det andra.
 */
export function buildStoragePath(userId, cardId, mime, randomId = nyttId()) {
  return `${sanera(userId)}/${sanera(cardId)}/${sanera(randomId)}.${extensionForMime(mime)}`;
}

// ---------------------------------------------------------------------------
// Uppladdning och radering
// ---------------------------------------------------------------------------

/**
 * Laddar upp en data-URL och returnerar dess storage_path.
 * Komprimerar inte — anroparen avgör det, eftersom migreringen vill mäta
 * besparingen och gränssnittet redan har komprimerat vid inläsningen.
 *
 * @param {string} dataUrl
 * @param {string} cardId
 * @returns {Promise<string>} storage_path
 */
export async function uploadImage(dataUrl, cardId) {
  if (!supabase) throw new Error('Molnlagring är inte konfigurerad.');
  const userId = getUserId();
  if (!userId) throw new Error('Ingen är inloggad, bilden kan inte laddas upp.');
  if (!isDataUrl(dataUrl)) throw new Error('uploadImage kräver en data-URL.');

  const blob = await dataUrlToBlob(dataUrl);
  const mime = blob.type || parseDataUrl(dataUrl)?.mime;
  const path = buildStoragePath(userId, cardId, mime);

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mime || undefined,
    // Filnamnet är slumpat, så en krock betyder att något är fel snarare än att
    // vi vill skriva över någon annans fil.
    upsert: false,
    // Innehållet på en sökväg ändras aldrig, bara sökvägen byts ut.
    cacheControl: '31536000',
  });
  if (error) throw error;

  return path;
}

/** Raderar en bild ur hinken. */
export async function deleteImage(storagePath) {
  if (!supabase) throw new Error('Molnlagring är inte konfigurerad.');
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
  signeradeUrler.delete(storagePath);
}

/**
 * Alla bilder användaren äger, i en enda radering.
 *
 * Används av kontoraderingen. Databasraderna försvinner ändå av kaskaden från
 * auth.users, men en rad som tas bort med SQL tar inte alltid själva filen med
 * sig — därför går den här vägen genom lagrings-API:et. En radering som lämnar
 * kvar användarens bilder hos leverantören är ingen radering.
 *
 * @returns {Promise<number>} antal raderade filer
 */
export async function deleteAllMyImages() {
  if (!supabase) return 0;
  const userId = getUserId();
  if (!userId) return 0;

  let borttagna = 0;
  // Listningen är sidindelad; en användare kan ha fler bilder än ett svar bär.
  for (let sida = 0; ; sida++) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: 100, offset: sida * 100 });
    if (error) throw error;
    if (!data?.length) break;

    const vagar = data.map((fil) => `${userId}/${fil.name}`);
    const { error: felVidRadering } = await supabase.storage.from(BUCKET).remove(vagar);
    if (felVidRadering) throw felVidRadering;
    for (const vag of vagar) signeradeUrler.delete(vag);
    borttagna += vagar.length;

    // Listningen börjar om från noll när raderna försvinner under oss, så
    // offseten får inte räknas upp — nästa varv hämtar de hundra som nu ligger
    // först. Slingan tar slut när listan är tom.
    sida = -1;
    if (borttagna > 10000) break; // haveriskydd mot en oändlig slinga
  }
  return borttagna;
}

// ---------------------------------------------------------------------------
// Visning
// ---------------------------------------------------------------------------

/**
 * Signerade URL:er för flera sökvägar i ETT anrop.
 *
 * Ett kort kan ha flera bilder och en vy flera kort. En signerad URL per bild
 * hade blivit lika många nätverksrundor innan något visas.
 *
 * Poster som redan är data-URL:er hoppas över: de behöver ingen upplösning och
 * har inget i ett lagringsanrop att göra.
 *
 * @param {string[]} paths
 * @returns {Promise<Map<string,string>>} sökväg -> visnings-URL
 */
export async function resolveMany(paths) {
  const resultat = new Map();
  if (!supabase || !Array.isArray(paths) || paths.length === 0) return resultat;

  const nu = Date.now();
  const saknas = [];
  for (const path of paths) {
    if (typeof path !== 'string' || !path || isDataUrl(path)) continue;
    const cachad = signeradeUrler.get(path);
    if (cachad && cachad.gallerTill - FORNYA_MARGINAL_MS > nu) resultat.set(path, cachad.url);
    else if (!saknas.includes(path)) saknas.push(path);
  }
  if (saknas.length === 0) return resultat;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(saknas, SIGNERAD_LIVSLANGD_S);
  if (error) throw error;

  const gallerTill = Date.now() + SIGNERAD_LIVSLANGD_S * 1000;
  for (const post of data ?? []) {
    if (!post?.signedUrl || post.error) continue;
    signeradeUrler.set(post.path, { url: post.signedUrl, gallerTill });
    resultat.set(post.path, post.signedUrl);
  }
  return resultat;
}

/**
 * Visnings-URL för en enskild bild, eller null om den inte gick att hämta.
 * Hinken är privat, så detta är en signerad URL med begränsad livslängd.
 */
export async function getDisplayUrl(storagePath) {
  const karta = await resolveMany([storagePath]);
  return karta.get(storagePath) ?? null;
}

// ---------------------------------------------------------------------------
// Migrering av befintliga bilder
// ---------------------------------------------------------------------------

/**
 * Alla base64-poster som ännu inte flyttats.
 *
 * Att urvalet ligger i en egen funktion är det som gör migreringen
 * återupptagbar: en post som redan bytts mot en storage_path syns inte här
 * längre, så en omkörning laddar aldrig upp samma bild två gånger. Någon
 * separat bokföring över vad som är klart behövs alltså inte — datat är
 * bokföringen.
 *
 * Posterna bär en referens till kortobjektet, eftersom flytten skriver tillbaka
 * i samma träd som appen visar.
 */
export function collectPendingImages(appData) {
  const uppgifter = [];
  for (const deck of appData?.decks ?? []) {
    for (const card of deck?.cards ?? []) {
      if (!Array.isArray(card?.backImages)) continue;
      card.backImages.forEach((post, index) => {
        if (!isDataUrl(post)) return;
        uppgifter.push({
          card,
          cardId: card.id,
          index,
          dataUrl: post,
          bytes: dataUrlByteLength(post),
          tecken: post.length,
        });
      });
    }
  }
  return uppgifter;
}

/**
 * Flyttar alla base64-bilder i biblioteket till lagringshinken.
 *
 * Ordningen per bild är komprimera, ladda upp, och FÖRST därefter ersätt
 * posten. Originalet släpps aldrig innan servern bekräftat uppladdningen, så
 * ett avbrott eller ett nätverksfel kan i värsta fall lämna en oanvänd fil i
 * hinken — aldrig ett kort utan sin bild.
 *
 * En bild som misslyckas stoppar inte de andra. Den ligger kvar som base64 och
 * plockas upp nästa gång migreringen körs.
 *
 * @param {object} appData
 * @param {(framsteg:{klara:number, totalt:number, sparadeBytes:number}) => void} [onProgress]
 * @param {{signal?:AbortSignal, persist?:() => (void|Promise<void>),
 *          maxSide?:number, quality?:number}} [options]
 *   `persist` sparar biblioteket och anropas efter varje flyttad bild, så att
 *   ett avbrott behåller det som hunnit bli klart.
 * @returns {Promise<{totalt:number, klara:number, misslyckade:number,
 *   sparadeBytes:number, originalBytes:number, uppladdadeBytes:number,
 *   avbruten:boolean, orsak:string|null, fel:Array<object>}>}
 */
export async function migrateLocalImages(appData, onProgress, options = {}) {
  const { signal, persist, maxSide, quality } = options;
  const uppgifter = collectPendingImages(appData);

  const sammanfattning = {
    totalt: uppgifter.length,
    klara: 0,
    misslyckade: 0,
    // Tecken som lämnat localStorage. Det är det måttet som avgör om kvoten
    // spricker, inte hur mycket bilden krympte av komprimeringen.
    sparadeBytes: 0,
    originalBytes: 0,
    uppladdadeBytes: 0,
    avbruten: false,
    orsak: null,
    fel: [],
  };

  const rapportera = () =>
    onProgress?.({
      klara: sammanfattning.klara,
      totalt: sammanfattning.totalt,
      sparadeBytes: sammanfattning.sparadeBytes,
    });

  if (uppgifter.length === 0) {
    rapportera();
    return sammanfattning;
  }

  if (!imageCloudReady()) {
    sammanfattning.avbruten = true;
    sammanfattning.orsak = 'Ingen molnlagring att flytta bilderna till.';
    rapportera();
    return sammanfattning;
  }

  rapportera();

  for (const uppgift of uppgifter) {
    if (signal?.aborted) {
      sammanfattning.avbruten = true;
      sammanfattning.orsak = 'Avbruten.';
      break;
    }

    try {
      // Misslyckad omkodning får inte stoppa flytten: en stor bild i molnet är
      // fortfarande oändligt mycket bättre än en stor bild i localStorage.
      const komprimerad = await compressDataUrl(uppgift.dataUrl, { maxSide, quality }).catch(
        () => null
      );
      const attLadda = komprimerad?.dataUrl ?? uppgift.dataUrl;

      const path = await uploadImage(attLadda, uppgift.cardId);

      // Originalet släpps först här, när uppladdningen är bekräftad.
      uppgift.card.backImages[uppgift.index] = path;

      sammanfattning.klara += 1;
      sammanfattning.sparadeBytes += Math.max(0, uppgift.tecken - path.length);
      sammanfattning.originalBytes += uppgift.bytes;
      sammanfattning.uppladdadeBytes += komprimerad?.bytes ?? uppgift.bytes;

      // Sparas efter varje bild, inte på slutet: avbryts migreringen mitt i är
      // det som hunnit flyttas redan ute ur localStorage, och nästa körning
      // börjar där den slutade.
      await persist?.();
    } catch (err) {
      sammanfattning.misslyckade += 1;
      sammanfattning.fel.push({
        cardId: uppgift.cardId,
        index: uppgift.index,
        message: err?.message ?? String(err),
      });
    }

    rapportera();
  }

  return sammanfattning;
}
