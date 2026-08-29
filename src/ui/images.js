import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { compressDataUrl, isDataUrl } from '../core/image-compress.js';
import { imageCloudReady, resolveMany, uploadImage } from '../core/image-store.js';
import { S } from '../core/state.js';

// Kortbilder finns i två former och båda måste kunna visas samtidigt: gamla
// poster är base64-strängar i localStorage, nya är storage_paths till hinken
// card-images. Migreringen flyttar dem en i taget och kan stå halvvägs, så
// åtskillnaden görs på prefixet "data:" vid varje rendering i stället för att
// någon flagga någonstans lovar vilken form som gäller.

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/**
 * Läser en bildfil och returnerar en nedskalad, omkodad data-URL.
 *
 * Komprimeringen sitter här, i det enda stället som läser in bildfiler, hellre
 * än hos varje anropare: en okomprimerad mobilbild är flera megabyte och kan på
 * egen hand spränga localStorage-kvoten. Misslyckas omkodningen behålls
 * originalet — en stor bild är bättre än ingen bild.
 */
export const fileToDataUrl = async (file) => {
  const original = await readFileAsDataUrl(file);
  try {
    const { dataUrl } = await compressDataUrl(original);
    return dataUrl;
  } catch {
    return original;
  }
};

/**
 * Laddar upp de poster som fortfarande är base64 och returnerar listan med
 * storage_paths i stället. Anropas när ett kort sparas, eftersom kortets id
 * behövs för sökvägen.
 *
 * Går uppladdningen inte igenom — offline, utloggad, molnet inte konfigurerat —
 * behålls base64-posten oförändrad. Bilden får aldrig försvinna för att molnet
 * strular; det som blir kvar lokalt plockas upp av migrateLocalImages senare.
 */
export const uploadCardImages = async (images, cardId) => {
  if (!Array.isArray(images) || !imageCloudReady()) return images ?? [];
  return Promise.all(
    images.map(async (post) => {
      if (!isDataUrl(post)) return post;
      try {
        return await uploadImage(post, cardId);
      } catch {
        return post;
      }
    })
  );
};

const visaSomSaknad = (img) => {
  img.classList.add('image-missing');
  img.alt = 'Bilden kunde inte hämtas';
};

/**
 * Sätter src på en samling img-element utifrån deras post.
 *
 * Data-URL:er sätts direkt. Sökvägarna löses upp i ETT anrop för hela
 * samlingen, inte ett per bild: varje signerad URL kostar en nätverksrunda, och
 * ett kort kan ha flera bilder.
 *
 * @param {Array<{img: HTMLElement, entry: string}>} bindningar
 */
const bindImageSources = (bindningar) => {
  const kvar = [];
  for (const { img, entry } of bindningar) {
    if (isDataUrl(entry)) img.src = entry;
    else if (typeof entry === 'string' && entry) kvar.push({ img, entry });
  }
  if (kvar.length === 0) return;

  resolveMany(kvar.map((b) => b.entry))
    .then((urler) => {
      for (const { img, entry } of kvar) {
        const url = urler.get(entry);
        if (url) img.src = url;
        else visaSomSaknad(img);
      }
    })
    .catch(() => {
      for (const { img } of kvar) visaSomSaknad(img);
    });
};

export const renderImagePreviews = (containerEl, imagesArr, onDelete) => {
    containerEl.innerHTML = '';
    const bindningar = [];
    imagesArr.forEach((post, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'image-preview-thumb';
        const img = document.createElement('img');
        img.alt = 'Bild ' + (idx + 1);
        bindningar.push({ img, entry: post });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'thumb-delete';
        delBtn.innerHTML = '';
        delBtn.title = 'Ta bort bild';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onDelete(idx);
        });
        thumb.appendChild(img);
        thumb.appendChild(delBtn);
        containerEl.appendChild(thumb);
    });
    bindImageSources(bindningar);
};

export const renderCardBackImages = (parentEl, images) => {
    // Remove any existing image block
    const existing = parentEl.querySelector('.card-back-images');
    if (existing) existing.remove();
    if (!images || images.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'card-back-images';
    const bindningar = [];
    images.forEach(post => {
        const img = document.createElement('img');
        img.alt = 'Kortbild';
        bindningar.push({ img, entry: post });
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            // Läses vid klicket, inte när elementet skapas: en storage_path har
            // ännu ingen src när kortet ritas.
            if (img.src) openLightbox(img.src);
        });
        wrapper.appendChild(img);
    });
    parentEl.appendChild(wrapper);
    bindImageSources(bindningar);
};

const openLightbox = (src) => {
    const lb = document.createElement('div');
    lb.className = 'image-lightbox';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Förstoring';
    lb.appendChild(img);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
};

/**
 * Vad saneringen får släppa igenom.
 *
 * MathML och SVG står med vid sidan av html därför att det är formen en
 * renderad formel har — KaTeX bygger båda. Idag renderas matematiken efter det
 * här steget, men den dagen redan renderad text tar vägen hit ska saneringen
 * inte vara det som tömmer formeln.
 */
const SANERING = { USE_PROFILES: { html: true, mathMl: true, svg: true } };

// Protect LaTeX blocks from Marked.js mangling backslashes
export const safeParse = (text) => {
    const placeholders = [];
    // Protect $$...$$ blocks first (display math)
    let safe = text.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Protect $...$ blocks (inline math)
    safe = safe.replace(/\$([^\$]+?)\$/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Protect \[...\] and \(...\) blocks
    safe = safe.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    safe = safe.replace(/\\\([\s\S]*?\\\)/g, (match) => {
        placeholders.push(match);
        return `%%LATEX_${placeholders.length - 1}%%`;
    });
    // Run Marked on the safe text
    let html = marked.parse(safe);
    // Restore LaTeX blocks
    placeholders.forEach((original, i) => {
        /* Funktionsform, inte sträng: en sträng som ersättning tolkar sina
         * dollartecken som mönsterreferenser. `$$a+b$$` blev `$a+b$` — varje
         * blockformel kollapsade till inline-matematik — och ett `$&` i
         * formeln lade tillbaka platshållaren i texten. */
        html = html.replace(`%%LATEX_${i}%%`, () => original);
    });
    /* Sanering allra sist. Formlerna ovan är råtext som marked aldrig såg, och
     * hade den här raden legat före återställningen vore just de oskyddade —
     * `$$<img src=x onerror=...>$$` är en egen väg in, oberoende av markdown. */
    return DOMPurify.sanitize(html, SANERING);
};

export const fixLatexInCards = (cards) => {
    return cards.map(c => ({
        ...c,
        front: c.front.replace(/\\\\([a-zA-Z])/g, '\\$1'),
        back: c.back.replace(/\\\\([a-zA-Z])/g, '\\$1')
    }));
};

export function initUiImages() {

  // Bilder under pågående redigering. Posterna är antingen komprimerade
  // data-URL:er eller storage_paths, beroende på om användaren är inloggad.
  S.addCardImages = [];
  S.editCardImages = [];
}
