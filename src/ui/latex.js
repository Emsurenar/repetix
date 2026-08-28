// --- LATEX HELPER ---
//
// KaTeX hämtas först när ett element som faktiskt bär matematik ska renderas.
// De flesta kort har ingen, och de ska inte betala för biblioteket vid start.

const AVGRANSARE = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false }
];

/* Mönstret täcker vänsterledet i varje avgränsare ovan. Ett falskt utslag — en
 * prislapp i dollar — kostar bara en hämtning som ändå renderas oförändrad,
 * medan ett missat utslag hade lämnat formeln stående som råtext. */
const HAR_MATEMATIK = /\$|\\\(|\\\[/;

let katex = null;
let hamtning = null;

const hamtaKatex = () => {
    /* Ett enda löfte delas av alla anropare: tjugo kort i rad utlöser en
     * hämtning, inte tjugo. */
    hamtning ??= import('../app/vendor.js').then(
        (modul) => {
            katex = modul;
            return modul;
        },
        (fel) => {
            /* Appen är offline först. Misslyckas hämtningen ska nästa kort få
             * försöka igen i stället för att ärva ett trasigt löfte. */
            hamtning = null;
            throw fel;
        }
    );
    return hamtning;
};

const rendera = (modul, element) => {
    modul.renderMathInElement(element, {
        delimiters: AVGRANSARE,
        throwOnError: false
    });
};

export const renderLatex = async (element) => {
    if (!element || !HAR_MATEMATIK.test(element.textContent || '')) return;

    /* Är biblioteket redan inne renderas det innan anropet lämnar ifrån sig
     * kontrollen. Det är inte bara en optimering: lucktext.js läser
     * .katex-noderna direkt efter sitt anrop, och för alla andra är det
     * skillnaden mellan en formel som står färdig och en som byter form en
     * bildruta efter att kortet visats. */
    if (katex) {
        rendera(katex, element);
        return;
    }

    try {
        rendera(await hamtaKatex(), element);
    } catch {
        /* Källtexten står kvar och går att läsa. Ett kort ska inte bli
         * oanvändbart för att matematiken inte kunde hämtas. */
    }
};
