/* Textutvinning ur en PDF, i webbläsaren.
 *
 * Ingen AI och inget serveranrop: ett LaTeX-satt PDF har ett riktigt textlager,
 * och att läsa det kostar ingenting. Filen lämnar aldrig datorn — bara den
 * utvunna texten skickas vidare, och först när användaren ber om något.
 *
 * MATEMATIKEN KOMMER UT TRASIG. Formler sätts som enskilda glyfer med egna
 * teckenkodningar, och det finns ingen väg runt det här. Därför visas texten
 * för användaren innan något AI-anrop görs.
 */

import { sammanfogaSidor } from '../domain/kalltext.js';

/* pdf.js läser i en worker. Utan den här raden kastar biblioteket vid första
 * dokumentet — och felet ("No GlobalWorkerOptions.workerSrc specified") pekar
 * inte på att det är Vite-uppsättningen som saknas. ?url ger Vite:s hashade
 * sökväg i stället för en väg som bara råkar stämma i utveckling. */
let pdfjs = null;

async function ladda() {
  if (pdfjs) return pdfjs;
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjs = lib;
  return pdfjs;
}

/**
 * Läser en PDF och ger dess text.
 *
 * @param {File} file
 * @returns {Promise<{text: string, pages: number, chars: number}>}
 */
export async function laesPdf(file) {
  const lib = await ladda();
  const buffer = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buffer }).promise;

  const sidor = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    sidor.push(content.items.map((post) => post.str ?? '').join(' '));
  }

  const text = sammanfogaSidor(sidor);
  return { text, pages: doc.numPages, chars: text.length };
}
