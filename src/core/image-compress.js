// Komprimering av kortbilder.
//
// En bild från en modern mobilkamera blir 4-7 MB som base64-sträng och
// localStorage rymmer omkring 5 MB totalt. Utan omkodning räcker alltså en
// enda bild för att spränga kvoten, och då förloras hela skrivningen — inte
// bara bilden. Nedskalning till 1600 px och omkodning till WebP eller JPEG tar
// samma bild till ett par hundra kilobyte.
//
// Funktionerna i första halvan är rena och testas i Node. Själva omkodningen
// kräver canvas och körs bara i webbläsaren.

/** Längsta sida efter nedskalning. Räcker för fullskärm på en näthinneskärm. */
export const MAX_SIDE = 1600;

/** JPEG- och WebP-kvalitet. Under 0.75 syns artefakter i text på skärmdumpar. */
export const QUALITY = 0.82;

// ---------------------------------------------------------------------------
// Rena hjälpfunktioner
// ---------------------------------------------------------------------------

/**
 * Skiljer en gammal base64-post från en ny storage_path. Detta är hela
 * åtskillnaden appen behöver: migreringen kan stå halvvägs, så båda formerna
 * förekommer i samma `backImages`-array.
 *
 * Kravet på `image/` är en spärr, inte en formalitet: svaret avgör vad som
 * sätts rakt in i `img.src`, och en importerad backupfil eller ett AI-svar kan
 * bära vilken data-URL som helst. Ett prefixtest på bara `data:` hade släppt
 * igenom `data:text/html`.
 */
export const isDataUrl = (value) => typeof value === 'string' && /^data:image\//i.test(value);

/**
 * Delar upp en data-URL i mime-typ och nyttolast.
 * Returnerar null för allt som inte är en data-URL.
 *
 * Prövar prefixet själv i stället för att gå via isDataUrl: den här funktionen
 * beskriver formen på en data-URL, medan isDataUrl avgör om innehållet får
 * visas. Den skillnaden ska inte smälta ihop.
 */
export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const komma = dataUrl.indexOf(',');
  if (komma < 0) return null;
  const huvud = dataUrl.slice('data:'.length, komma);
  const base64 = /(^|;)base64$/i.test(huvud);
  const mime = huvud.split(';')[0].toLowerCase() || 'application/octet-stream';
  return { mime, base64, payload: dataUrl.slice(komma + 1) };
}

/**
 * Storleken på det avkodade innehållet i en data-URL, i byte.
 *
 * Räknas ur base64-längden i stället för att avkoda strängen: vid migrering
 * mäts tusentals bilder, och att avkoda dem bara för att väga dem hade
 * fördubblat minnesåtgången i onödan.
 */
export function dataUrlByteLength(dataUrl) {
  const delar = parseDataUrl(dataUrl);
  if (!delar) return 0;
  if (!delar.base64) return delar.payload.length;
  const tecken = delar.payload.replace(/[\s=]/g, '').length;
  return Math.floor((tecken * 3) / 4);
}

const MIME_TILL_ANDELSE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
};

/**
 * Filändelse för en mime-typ. Ändelsen styr ingen logik i appen, men gör
 * lagringshinken läsbar när man felsöker den i Supabases gränssnitt.
 */
export function extensionForMime(mime) {
  return MIME_TILL_ANDELSE[String(mime ?? '').toLowerCase()] ?? 'bin';
}

/**
 * Vilket format bilden ska kodas om till, eller null för "låt den vara".
 *
 * WebP väljs när webbläsaren kan koda det: det ger ungefär en tredjedel mindre
 * fil än JPEG vid samma upplevda kvalitet och behåller alfakanalen.
 *
 * GIF och SVG lämnas orörda. En canvas hade platttat en animerad GIF till dess
 * första bildruta och rastrerat en SVG till en större fil än originalet — i
 * båda fallen en försämring, inte en besparing.
 */
export function pickOutputMime(sourceMime, canEncodeWebp) {
  const mime = String(sourceMime ?? '').toLowerCase();
  if (mime === 'image/gif' || mime === 'image/svg+xml') return null;
  return canEncodeWebp ? 'image/webp' : 'image/jpeg';
}

/**
 * Måtten nedskalade så att längsta sidan blir högst `maxSide`.
 * Skalar aldrig upp: en liten bild ska inte bli en stor fil av att passera här.
 */
export function fitWithin(width, height, maxSide) {
  const b = Math.max(0, Math.round(width) || 0);
  const h = Math.max(0, Math.round(height) || 0);
  if (!b || !h) return { width: b, height: h };

  const langsta = Math.max(b, h);
  if (!Number.isFinite(maxSide) || maxSide <= 0 || langsta <= maxSide) return { width: b, height: h };

  const skala = maxSide / langsta;
  return { width: Math.max(1, Math.round(b * skala)), height: Math.max(1, Math.round(h * skala)) };
}

// ---------------------------------------------------------------------------
// Omkodning (kräver webbläsare)
// ---------------------------------------------------------------------------

/**
 * Data-URL till Blob via fetch. Webbläsaren avkodar base64 internt, vilket är
 * både snabbare och snålare med minne än att gå via atob och en Uint8Array.
 */
export async function dataUrlToBlob(dataUrl) {
  const svar = await fetch(dataUrl);
  return svar.blob();
}

let webpStod = null;

/** Kan canvas koda WebP här? Svaret ändras inte under sessionen, så det mäts en gång. */
function stoderWebp() {
  if (webpStod !== null) return webpStod;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpStod = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpStod = false;
  }
  return webpStod;
}

/**
 * Laddar bilden som en ritbar källa.
 *
 * createImageBitmap med imageOrientation 'from-image' tillämpar EXIF-rotationen,
 * annars hamnar porträttbilder från mobilen liggande på kortet. Känd
 * begränsning: i fallet nedan, ett vanligt img-element, styrs rotationen av
 * webbläsaren. Nyare Chrome, Firefox och Safari roterar rätt vid drawImage,
 * äldre gör det inte, och att läsa EXIF själv hade krävt ett externt bibliotek.
 */
async function laddaRitbar(dataUrl) {
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
    try {
      const blob = await dataUrlToBlob(dataUrl);
      return await window.createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Formatet kan vara ett som createImageBitmap inte klarar. img-elementet nedan är mer förlåtande.
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bilden gick inte att läsa.'));
    img.src = dataUrl;
  });
}

/**
 * Skalar ned och kodar om en bild.
 *
 * Returnerar alltid en användbar data-URL: blir omkodningen inte mindre än
 * originalet — vilket händer för redan hårt komprimerade småbilder — behålls
 * originalet, eftersom en omkodning som växer bara kostar kvalitet.
 *
 * @param {string} dataUrl
 * @param {{maxSide?:number, quality?:number}} [options]
 * @returns {Promise<{dataUrl:string, mime:string, width:number, height:number,
 *   bytes:number, originalBytes:number, komprimerad:boolean}>}
 */
export async function compressDataUrl(dataUrl, options = {}) {
  const { maxSide = MAX_SIDE, quality = QUALITY } = options;
  const kalla = parseDataUrl(dataUrl);
  if (!kalla) throw new Error('compressDataUrl kräver en data-URL.');

  const originalBytes = dataUrlByteLength(dataUrl);
  const utMime = pickOutputMime(kalla.mime, stoderWebp());
  const oforandrad = {
    dataUrl,
    mime: kalla.mime,
    width: 0,
    height: 0,
    bytes: originalBytes,
    originalBytes,
    komprimerad: false,
  };
  if (!utMime) return oforandrad;

  const ritbar = await laddaRitbar(dataUrl);
  const kallBredd = ritbar.width;
  const kallHojd = ritbar.height;
  const { width, height } = fitWithin(kallBredd, kallHojd, maxSide);

  let ut;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas är inte tillgänglig.');

    // JPEG saknar alfakanal och hade gjort genomskinliga ytor svarta. Vit botten
    // är det som liknar hur en skärmdump eller ett diagram såg ut från början.
    if (utMime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(ritbar, 0, 0, width, height);
    ut = canvas.toDataURL(utMime, quality);
  } finally {
    ritbar.close?.();
  }

  const bytes = dataUrlByteLength(ut);
  if (bytes >= originalBytes) return { ...oforandrad, width: kallBredd, height: kallHojd };

  // Mime-typen läses ur resultatet i stället för att antas: toDataURL faller
  // tyst tillbaka på PNG för format webbläsaren inte kan koda, och då hade en
  // antagen typ gett fel filändelse i lagringen.
  const mime = parseDataUrl(ut)?.mime ?? utMime;
  return { dataUrl: ut, mime, width, height, bytes, originalBytes, komprimerad: true };
}
