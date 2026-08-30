import { describe, expect, it } from 'vitest';
import { grupperaPaHylla } from '../src/domain/hyllgruppering.js';

const objekt = (id, bookshelfId) => ({ item: { id, bookshelfId } });
const hyllor = [
    { id: 'h1', title: 'Medicin' },
    { id: 'h2', title: 'Språk' },
];

describe('grupperaPaHylla', () => {
    it('följer hyllornas ordning och lägger de lösa sist', () => {
        const grupper = grupperaPaHylla(
            [objekt('a', 'h2'), objekt('b', null), objekt('c', 'h1')],
            hyllor
        );
        expect(grupper.map((g) => g.id)).toEqual(['h1', 'h2', null]);
        expect(grupper[0].objekt.map((o) => o.item.id)).toEqual(['c']);
        expect(grupper[1].objekt.map((o) => o.item.id)).toEqual(['a']);
        expect(grupper[2].objekt.map((o) => o.item.id)).toEqual(['b']);
    });

    it('behåller ordningen objekten kom in i', () => {
        const grupper = grupperaPaHylla(
            [objekt('a', 'h1'), objekt('b', 'h1'), objekt('c', 'h1')],
            hyllor
        );
        expect(grupper[0].objekt.map((o) => o.item.id)).toEqual(['a', 'b', 'c']);
    });

    // Målet man drar till måste finnas kvar även när det är tomt.
    it('behåller en tom hylla när man inte söker', () => {
        const grupper = grupperaPaHylla([objekt('a', 'h1')], hyllor);
        expect(grupper.map((g) => g.id)).toEqual(['h1', 'h2', null]);
        expect(grupper[1].objekt).toEqual([]);
    });

    it('utelämnar hyllor utan träffar under en sökning', () => {
        const grupper = grupperaPaHylla([objekt('a', 'h1')], hyllor, { soker: true });
        expect(grupper.map((g) => g.id)).toEqual(['h1']);
    });

    // Enda stället man kan släppa för att ta ut en lek ur sin hylla.
    it('behåller de lösas grupp tom när det finns hyllor', () => {
        const grupper = grupperaPaHylla([objekt('a', 'h1')], hyllor);
        const losa = grupper.find((g) => g.id === null);
        expect(losa.objekt).toEqual([]);
    });

    it('utelämnar de lösas tomma grupp under en sökning', () => {
        const grupper = grupperaPaHylla([objekt('a', 'h1')], hyllor, { soker: true });
        expect(grupper.some((g) => g.id === null)).toBe(false);
    });

    it('utelämnar de lösas grupp helt när inga hyllor finns', () => {
        expect(grupperaPaHylla([], [])).toEqual([]);
    });

    /* Hyllan kan ha raderats på en annan enhet. Kortleken ska hamna bland de
     * lösa, inte falla ur vyn helt. */
    it('räknar en kortlek i en raderad hylla som lös', () => {
        const grupper = grupperaPaHylla([objekt('a', 'borta')], hyllor);
        const losa = grupper.find((g) => g.id === null);
        expect(losa.objekt.map((o) => o.item.id)).toEqual(['a']);
    });

    it('ger en enda grupp när inga hyllor finns', () => {
        const grupper = grupperaPaHylla([objekt('a', null), objekt('b', null)], []);
        expect(grupper).toHaveLength(1);
        expect(grupper[0].id).toBeNull();
        expect(grupper[0].objekt).toHaveLength(2);
    });

    it('ger inga grupper alls när allt är tomt', () => {
        expect(grupperaPaHylla([], [])).toEqual([]);
    });

    it('lämnar titeln åt vyn för de lösa', () => {
        const grupper = grupperaPaHylla([objekt('a', null)], hyllor);
        expect(grupper.find((g) => g.id === null).titel).toBeNull();
        expect(grupper[0].titel).toBe('Medicin');
    });
});
