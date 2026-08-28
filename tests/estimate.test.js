import { describe, expect, it } from 'vitest';

import { uppskattadTid } from '../src/domain/estimate.js';

describe('uppskattadTid', () => {
    it('säger ingenting om högen är för liten för att vara värd ett besked', () => {
        expect(uppskattadTid(0)).toBe('');
        expect(uppskattadTid(4)).toBe('');
    });

    it('rundar till en minut när det bara rör sig om några kort', () => {
        expect(uppskattadTid(5)).toBe('ungefär en minut');
        expect(uppskattadTid(10)).toBe('ungefär en minut');
    });

    it('räknar i hela minuter för ett vanligt pass', () => {
        expect(uppskattadTid(15)).toBe('ungefär 2 minuter');
        expect(uppskattadTid(60)).toBe('ungefär 8 minuter');
    });

    it('går över till timmar när minuterna blir för många att ta in', () => {
        expect(uppskattadTid(450)).toBe('ungefär en timme');
        expect(uppskattadTid(700)).toBe('ungefär en och en halv timme');
    });

    it('skriver halvtimmar med svenskt decimaltecken', () => {
        expect(uppskattadTid(1200)).toContain('timmar');
        expect(uppskattadTid(1200)).not.toContain('.');
    });

    it('klarar skräpvärden utan att kasta', () => {
        expect(uppskattadTid(Number.NaN)).toBe('');
        expect(uppskattadTid(undefined)).toBe('');
        expect(uppskattadTid(-10)).toBe('');
    });
});
