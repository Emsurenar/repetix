// Bibliotekets indelning i bokhyllor.
//
// Ren funktion utan DOM: vilka grupper som ska ritas, i vilken ordning, och
// vilka som får utebli. Sorteringen inuti en grupp är redan gjord av den som
// anropar — den regeln (färdigrepeterat sjunker) hör till vyn, inte till
// indelningen.

/**
 * Delar objekten i en grupp per bokhylla, plus en sista för dem som inte
 * ligger i någon.
 *
 * En tom hylla är kvar när man inte söker. Den är målet man drar en kortlek
 * till, och en hylla som försvinner så fort den tömts går inte att fylla igen.
 * Under en sökning är den däremot bara en etikett utan träffar, och tio sådana
 * begraver de fem träffar man letade efter.
 *
 * @param {Array<{item: {bookshelfId?: string|null}}>} objekt redan filtrerade och sorterade
 * @param {Array<{id: string, title: string}>} bokhyllor i visningsordning
 * @param {{soker?: boolean}} [val]
 * @returns {Array<{id: string|null, titel: string|null, objekt: Array}>}
 */
export function grupperaPaHylla(objekt, bokhyllor, { soker = false } = {}) {
    const finnsHylla = new Set(bokhyllor.map((h) => h.id));

    const grupper = bokhyllor
        .map((hylla) => ({
            id: hylla.id,
            titel: hylla.title,
            objekt: objekt.filter((o) => o.item.bookshelfId === hylla.id),
        }))
        .filter((grupp) => !soker || grupp.objekt.length > 0);

    /* Pekar hyllan på något som inte finns hamnar objektet här i stället för
     * att försvinna. Hyllan kan ha raderats på en annan enhet efter att den
     * här enheten senast synkade, och en kortlek som ingen vy visar är värre
     * än en kortlek på fel plats. */
    const losa = objekt.filter(
        (o) => !o.item.bookshelfId || !finnsHylla.has(o.item.bookshelfId)
    );

    /* De lösas grupp står kvar tom av samma skäl som en tom hylla gör det: den
     * är enda stället man kan släppa en kortlek för att ta ut den ur sin
     * hylla. Utan hyllor finns däremot ingen indelning att stå utanför.
     *
     * Titeln lämnas åt vyn: "Utan bokhylla" är ord, och orden bor i
     * gränssnittet. */
    if (losa.length || (!soker && bokhyllor.length > 0)) {
        grupper.push({ id: null, titel: null, objekt: losa });
    }

    return grupper;
}
