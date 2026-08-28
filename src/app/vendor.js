// KaTeX och dess stilmall, avskilda i en egen modul enbart för att bygget ska
// lägga dem i ett eget paket. Modulen importeras dynamiskt av src/ui/latex.js
// och når därför aldrig en användare vars kort saknar matematik.
//
// Mätt: startpaketet gick från 820 till 563 kB (gzip 228 -> 152) och dess CSS
// från 192 till 163 kB. KaTeX väger 261 kB för sig, plus de sextio
// typsnittsfilerna som nu också hämtas först vid behov.
//
// Stilmallen ligger här och inte bland stilarna i main.js av samma skäl: en
// statisk import hade dragit in den i startpaketets CSS igen. Att den laddas
// efter appens egna regler spelar ingen roll, eftersom appens KaTeX-regler är
// mer specifika och rör egenskaper KaTeX inte sätter.
//
// Här bodde tidigare `window.marked` och `window.renderMathInElement`, ett arv
// från när biblioteken kom från CDN. Ingen läste dem längre.
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

export { renderMathInElement };
