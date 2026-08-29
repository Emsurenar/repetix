// Bilddata i en säkerhetskopia.
//
// Efter bildmigreringen bär ett kort bara en sökväg till hinken card-images.
// En export av localStorage rakt av blev därför en fil full av pekare: den som
// tappade sitt konto, eller vars lagring försvann, hade en backup som pekade på
// ingenting. Här hämtas bilderna hem vid export och läggs som data-URL:er
// BREDVID sökvägarna, aldrig i stället för dem — så att en äldre importör
// fortfarande läser exakt samma noji_clone_data som förut, medan en ny kan
// återställa hela biblioteket utan nät och utan konto.
//
// Modulen tar sina beroenden som argument i stället för att importera dem:
// upplösaren och fetch skickas in av backup.js. Det är det som gör hela vägen —
// inklusive misslyckade hämtningar — provbar i Node utan webbläsare.

/**
 * Två frågor som ser ut som en enda, och som därför ställs var för sig här.
 *
 * `arInbaddad` svarar på "är posten redan bilddata, alltså inte en sökväg att
 * hämta?" — den bestämmer bara vad som ska hämtas hem.
 *
 * `arBilddata` svarar på "får det här skrivas in i ett kort?" och gäller värden
 * ur en fil som kommer utifrån. En importerad backup kan bära vilken data-URL
 * som helst, och posten hamnar rakt i `img.src`; `data:text/html` ska aldrig ta
 * sig in den vägen. Kravet på `image/` är alltså en spärr, inte en formsak.
 */
const arInbaddad = (v) => typeof v === 'string' && v.startsWith('data:');
const arBilddata = (v) => typeof v === 'string' && /^data:image\//i.test(v);

/**
 * Hur många sökvägar som signeras i ett anrop. Upplösningen kostar en
 * nätverksrunda oavsett antal, men en lista på tusen sökvägar är en begäran som
 * kan avvisas i sin helhet — och då hade ingen enda bild kommit med.
 */
const UPPLOSNING_KLUMP = 100;

/** Samtidiga hämtningar. Fler ger inte mer genomströmning mot en och samma värd. */
const SAMTIDIGA = 4;

/**
 * Alla molnsökvägar i biblioteket, utan dubbletter och i stabil ordning.
 *
 * Dubbletterna måste bort: två kort kan bära samma bild, och utan filtret hade
 * filen innehållit samma bytes två gånger.
 */
export function collectCloudImagePaths(appData) {
  const sokvagar = [];
  const sedda = new Set();
  for (const deck of appData?.decks ?? []) {
    for (const card of deck?.cards ?? []) {
      if (!Array.isArray(card?.backImages)) continue;
      for (const post of card.backImages) {
        if (typeof post !== 'string' || !post || arInbaddad(post)) continue;
        if (sedda.has(post)) continue;
        sedda.add(post);
        sokvagar.push(post);
      }
    }
  }
  return sokvagar;
}

const MIME_FOR_ANDELSE = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
};

/**
 * Mime-typ gissad ur sökvägens filändelse.
 *
 * Behövs som reserv när svaret saknar content-type: en data-URL renderas efter
 * sin deklarerade typ, så en gissning åt fel håll ger en bild som inte visas
 * trots att alla bytes finns i filen.
 */
export function mimeForPath(path) {
  const andelse = String(path ?? '')
    .split('.')
    .pop()
    .toLowerCase();
  return MIME_FOR_ANDELSE[andelse] ?? 'image/jpeg';
}

/**
 * Bytes till base64, i bitar.
 *
 * String.fromCharCode tar ett argument per byte. En bild på 200 kB blir alltså
 * 200 000 argument i ett svep, vilket spränger anropsstacken — och det är
 * precis storleken kortbilderna har.
 */
export function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const BIT = 0x8000;
  let binart = '';
  for (let i = 0; i < bytes.length; i += BIT) {
    binart += String.fromCharCode.apply(null, bytes.subarray(i, i + BIT));
  }
  return btoa(binart);
}

/**
 * Hämtar en bild och returnerar den som data-URL.
 *
 * @param {string} url signerad visnings-URL
 * @param {string} path sökvägen, enbart som reserv för mime-typen
 * @param {typeof fetch} hamta
 * @returns {Promise<{dataUrl: string, bytes: number}>}
 */
export async function fetchImageAsDataUrl(url, path, hamta) {
  const svar = await hamta(url);
  if (!svar || svar.ok === false) throw new Error(`Servern svarade ${svar?.status ?? 'inte'}.`);

  const buffert = await svar.arrayBuffer();
  const bytes = buffert?.byteLength ?? 0;
  // En tom kropp är ett svar, inte en bild. Utan kontrollen hade den bäddats in
  // som en giltig data-URL och felet upptäckts först vid en återställning.
  if (bytes === 0) throw new Error('Bilden var tom.');

  const uppgiven = svar.headers?.get?.('content-type') ?? '';
  const mime = uppgiven.startsWith('image/') ? uppgiven.split(';')[0].trim() : mimeForPath(path);

  return { dataUrl: `data:${mime};base64,${bytesToBase64(buffert)}`, bytes };
}

/** Kör uppgifterna med ett tak på hur många som pågår samtidigt. */
async function medTak(uppgifter, tak, kor) {
  let nasta = 0;
  // Minst en arbetare: noll hade tagit tyst slut utan att köra en enda uppgift,
  // och just här är "ingenting hände" oskiljbart från "inga bilder fanns".
  const antal = Math.max(1, Math.min(tak || 1, uppgifter.length));
  const arbetare = Array.from({ length: antal }, async () => {
    for (;;) {
      const i = nasta++;
      if (i >= uppgifter.length) return;
      await kor(uppgifter[i]);
    }
  });
  await Promise.all(arbetare);
}

/**
 * Hämtar hem varje molnbild i biblioteket.
 *
 * En bild som inte går att hämta stoppar inte de andra, men den räknas: listan
 * `missing` är hela poängen med funktionen. En export som tyst tappar bilder är
 * värre än ingen export alls, eftersom användaren tror sig ha en kopia.
 *
 * @param {object} appData
 * @param {{resolve: (paths: string[]) => Promise<Map<string, string>>,
 *          fetch: typeof fetch,
 *          onProgress?: (framsteg: {hanterade: number, totalt: number}) => void,
 *          samtidiga?: number}} deps
 *   `hanterade` räknar även de som misslyckats: raden i gränssnittet ska nå
 *   slutet även när alla bilder föll bort.
 * @returns {Promise<{images: Record<string, string>, bytes: number, total: number,
 *   missing: Array<{path: string, reason: string}>}>}
 */
export async function collectBackupImages(appData, deps) {
  const { resolve, fetch: hamta, onProgress, samtidiga = SAMTIDIGA } = deps ?? {};
  const sokvagar = collectCloudImagePaths(appData);

  const resultat = { images: {}, bytes: 0, total: sokvagar.length, missing: [] };
  if (sokvagar.length === 0) {
    onProgress?.({ hanterade: 0, totalt: 0 });
    return resultat;
  }

  let hanterade = 0;
  const rapportera = () => onProgress?.({ hanterade, totalt: sokvagar.length });
  const misslyckas = (path, reason) => {
    resultat.missing.push({ path, reason });
    hanterade += 1;
    rapportera();
  };

  rapportera();

  const urler = new Map();
  for (let i = 0; i < sokvagar.length; i += UPPLOSNING_KLUMP) {
    const klump = sokvagar.slice(i, i + UPPLOSNING_KLUMP);
    try {
      const karta = await resolve(klump);
      for (const [path, url] of karta ?? []) urler.set(path, url);
    } catch (err) {
      // Hela klumpen föll. De sökvägarna saknar adress och rapporteras nedan
      // tillsammans med dem som aldrig kom med i svaret.
      void err;
    }
  }

  const attHamta = [];
  for (const path of sokvagar) {
    const url = urler.get(path);
    if (url) attHamta.push({ path, url });
    else misslyckas(path, 'Ingen adress till bilden. Är du offline eller utloggad?');
  }

  await medTak(attHamta, samtidiga, async ({ path, url }) => {
    try {
      const { dataUrl, bytes } = await fetchImageAsDataUrl(url, path, hamta);
      resultat.images[path] = dataUrl;
      resultat.bytes += bytes;
      hanterade += 1;
      rapportera();
    } catch (err) {
      misslyckas(path, err?.message ?? String(err));
    }
  });

  return resultat;
}

/**
 * Byter ut sökvägar mot bilddata i ett bibliotek som just lästs ur en backupfil.
 *
 * Detta är vad som gör en återställning oberoende av konto och nät: efter
 * bytet är bilderna base64 i localStorage igen, precis som före migreringen, och
 * migreringen flyttar upp dem på nytt vid nästa inloggning — då under den
 * inloggades egen sökväg, vilket är det enda som fungerar om kontot är ett annat
 * än det som gjorde exporten.
 *
 * Muterar `appData`. Objektet kommer från en JSON.parse av filen och ägs av
 * anroparen; en kopia hade dubblat minnesåtgången för just den data som är stor.
 *
 * @param {object} appData
 * @param {Record<string, string>} images sökväg -> data-URL
 * @returns {{ersatta: number, kvar: number,
 *   inlagda: Array<{card: object, index: number, path: string, dataUrl: string}>}}
 *   `kvar` är sökvägar utan bilddata i filen. `inlagda` bär sökvägen kvar, så att
 *   en bild kan backas tillbaka till pekare igen när lagringen inte räcker.
 */
export function inlineBackupImages(appData, images) {
  let kvar = 0;
  const inlagda = [];
  const karta = images ?? {};
  for (const deck of appData?.decks ?? []) {
    for (const card of deck?.cards ?? []) {
      if (!Array.isArray(card?.backImages)) continue;
      card.backImages.forEach((post, index) => {
        if (typeof post !== 'string' || !post || arInbaddad(post)) return;
        const dataUrl = karta[post];
        if (arBilddata(dataUrl)) {
          card.backImages[index] = dataUrl;
          inlagda.push({ card, index, path: post, dataUrl });
        } else {
          kvar += 1;
        }
      });
    }
  }
  return { ersatta: inlagda.length, kvar, inlagda };
}

/**
 * Skriver biblioteket med så många bilder som får plats i lagringen.
 *
 * localStorage rymmer omkring fem miljoner tecken. Ett bibliotek med tjugofem
 * kortbilder blir drygt sex miljoner som inbäddad base64, alltså mer än kvoten
 * — och ett allt-eller-inget hade då gett noll bilder tillbaka ur en fil som
 * bär alla tjugofem. De minsta behålls först: det som märks är hur många kort
 * som fick sin bild tillbaka, inte hur många megabyte de vägde.
 *
 * @param {Array<{card: object, index: number, path: string, dataUrl: string}>} inlagda
 * @param {(text: string) => void} skriv kastar ett kvotfel när det inte får plats
 * @param {() => string} serialisera biblioteket som text, läst om vid varje försök
 * @param {(err: unknown) => boolean} arKvotfel
 * @returns {{behallna: number, utelamnade: number}}
 */
export function writeWithinQuota(inlagda, skriv, serialisera, arKvotfel) {
  const poster = [...inlagda].sort((a, b) => a.dataUrl.length - b.dataUrl.length);
  const satt = (antal) => {
    poster.forEach((p, i) => {
      p.card.backImages[p.index] = i < antal ? p.dataUrl : p.path;
    });
  };
  const forsok = (antal) => {
    satt(antal);
    try {
      skriv(serialisera());
      return true;
    } catch (err) {
      if (!arKvotfel(err)) throw err;
      return false;
    }
  };

  if (forsok(poster.length)) return { behallna: poster.length, utelamnade: 0 };

  // Binärsökning: ryms k bilder så ryms k-1, eftersom de minsta ligger först.
  // Sex skrivningar räcker för trettio bilder — en bild i taget hade blivit
  // trettio skrivningar av en flermegabytessträng.
  let lag = 0;
  let hog = poster.length - 1;
  let basta = -1;
  while (lag <= hog) {
    const mitt = Math.floor((lag + hog) / 2);
    if (forsok(mitt)) {
      basta = mitt;
      lag = mitt + 1;
    } else {
      hog = mitt - 1;
    }
  }

  // Den sista prövningen kan ha misslyckats, och då står ett annat antal i
  // lagringen än det bästa. Skriv om, så att det som ligger där är det kända.
  // Kastar den skrivningen ryms inte ens biblioteket utan bilder, och det felet
  // hör hemma hos anroparen.
  const behallna = Math.max(basta, 0);
  satt(behallna);
  skriv(serialisera());
  return { behallna, utelamnade: poster.length - behallna };
}

/** Storlek att läsa högt: "2,4 MB". Tusenbaserad, som filstorlekar brukar anges. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1000) return `${Math.round(n)} B`;
  const enhet = n < 1000 * 1000 ? 'kB' : 'MB';
  const tal = n < 1000 * 1000 ? n / 1000 : n / (1000 * 1000);
  return `${tal.toFixed(1).replace('.', ',')} ${enhet}`;
}
