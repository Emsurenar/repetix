import { describe, expect, it } from 'vitest';
import { valjMenyplacering } from '../src/domain/menyplacering.js';

/** En skärm 800 hög, en knapp 34 hög på angiven höjd, en meny på 111. */
const fall = (knappTop, extra = {}) =>
    valjMenyplacering({
        knappTop,
        knappBottom: knappTop + 34,
        panelHojd: 111,
        synligTop: 0,
        synligBottom: 800,
        ...extra,
    });

describe('valjMenyplacering', () => {
    it('fäller ned när det finns gott om plats', () => {
        expect(fall(100)).toEqual({ uppat: false, maxHojd: null });
    });

    it('fäller upp när menyn inte får plats nedanför', () => {
        expect(fall(700)).toEqual({ uppat: true, maxHojd: null });
    });

    /* Den gamla regeln krävde att HELA menyn fick plats ovanför. Fick den inte
     * plats på någondera sidan stod den kvar nedåt och kapades. */
    it('väljer den rymligare sidan när ingen sida räcker', () => {
        const svar = valjMenyplacering({
            knappTop: 150,
            knappBottom: 184,
            panelHojd: 300,
            synligTop: 0,
            synligBottom: 260,
        });
        expect(svar.uppat).toBe(true);
        expect(svar.maxHojd).toBe(134);
    });

    it('rullar i stället för att kapas när ingen sida rymmer menyn', () => {
        // Låg skärm: 60 px under knappen, 116 över — inget räcker till 200.
        const svar = valjMenyplacering({
            knappTop: 132,
            knappBottom: 166,
            panelHojd: 200,
            synligTop: 0,
            synligBottom: 242,
        });
        expect(svar.maxHojd).toBeLessThan(200);
        expect(svar.maxHojd).toBeGreaterThanOrEqual(96);
    });

    /* Marginalen finns för webbläsarens egen list. En meny som slutar en pixel
     * innanför kanten ligger bakom den. */
    it('räknar in luft mot kanten', () => {
        const utanLuft = fall(640, { luft: 0 });
        const medLuft = fall(640, { luft: 8 });
        expect(utanLuft.uppat).toBe(false);
        expect(medLuft.uppat).toBe(true);
    });

    it('går aldrig under sitt minsta mått', () => {
        const svar = valjMenyplacering({
            knappTop: 40,
            knappBottom: 74,
            panelHojd: 300,
            synligTop: 0,
            synligBottom: 120,
        });
        expect(svar.maxHojd).toBe(96);
    });

    /* Den synliga ytan börjar inte alltid på noll: vid pinch-zoom eller ett
     * uppfällt tangentbord är den förskjuten. */
    it('räknar mot den synliga ytan och inte mot fönstret', () => {
        const svar = valjMenyplacering({
            knappTop: 300,
            knappBottom: 334,
            panelHojd: 111,
            synligTop: 200,
            synligBottom: 420,
        });
        // 70 px under knappen mot 84 över: uppåt vinner, och taket sätts av
        // den synliga ytans överkant — inte av sidans.
        expect(svar.uppat).toBe(true);
        expect(svar.maxHojd).toBe(96);
    });

    it('lämnar taket öppet när menyn får plats exakt', () => {
        const svar = valjMenyplacering({
            knappTop: 100,
            knappBottom: 134,
            panelHojd: 100,
            synligTop: 0,
            synligBottom: 250,
        });
        expect(svar).toEqual({ uppat: false, maxHojd: null });
    });
});
