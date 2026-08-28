import { describe, expect, it } from 'vitest';

import { ticksHtml } from '../src/ui/ticks.js';

/** Räknar streck per klass i den genererade skalan. */
const räkna = (html) => ({
    total: (html.match(/<i/g) || []).length,
    on: (html.match(/class="is-on"/g) || []).length,
    now: (html.match(/class="is-now"/g) || []).length,
});

describe('ticksHtml', () => {
    it('ritar ett streck per kort', () => {
        expect(räkna(ticksHtml(19, 0)).total).toBe(19);
    });

    it('färgar de avklarade och markerar det man står på', () => {
        const { on, now, total } = räkna(ticksHtml(19, 7));
        expect(on).toBe(7);
        expect(now).toBe(1);
        expect(total).toBe(19);
    });

    it('lämnar ingen markör när allt är avklarat', () => {
        const { on, now } = räkna(ticksHtml(9, 9));
        expect(on).toBe(9);
        expect(now).toBe(0);
    });

    it('komprimerar långa köer i stället för att växa', () => {
        const { total, on } = räkna(ticksHtml(100, 50));
        expect(total).toBe(24);
        // Andelen bevaras: hälften avklarat ger hälften tända streck.
        expect(on).toBe(12);
    });

    it('ger ingenting för en tom kö', () => {
        expect(ticksHtml(0, 0)).toBe('');
        expect(ticksHtml(-3, 0)).toBe('');
        expect(ticksHtml(Number.NaN, 0)).toBe('');
    });

    it('markerar aldrig fler streck än det finns', () => {
        const { on, now, total } = räkna(ticksHtml(5, 99));
        expect(on).toBe(5);
        expect(now).toBe(0);
        expect(total).toBe(5);
    });
});
