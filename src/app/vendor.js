// Tredjepartsbibliotek. Tidigare laddades dessa från CDN i index.html — marked
// helt utan pinnad version, vilket innebar att en ny utgåva när som helst kunde
// ändra hur korten renderas. Nu byggs de in från npm med låsta versioner.
//
// Den befintliga koden når dem via globaler (`marked.parse`,
// `window.renderMathInElement`), så de exponeras här i stället för att varje
// anropsställe skrivs om. Det städas bort när renderingen görs om.
import { marked } from 'marked';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

window.marked = marked;
window.renderMathInElement = renderMathInElement;
