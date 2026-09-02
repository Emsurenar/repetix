import { describe, expect, it } from 'vitest';
import { klassaSyncfel, vantetid } from '../src/domain/syncfel.js';

/* Synken visade "Kunde inte synka" oavsett orsak. De tre vanliga orsakerna
 * kräver tre olika svar av användaren, och bara nätet går över av sig självt. */
describe('klassaSyncfel', () => {
  it('känner igen ett tappat nät på fetch-felets form', () => {
    expect(klassaSyncfel(new TypeError('Failed to fetch')).typ).toBe('natverk');
    expect(klassaSyncfel(new TypeError('Load failed')).typ).toBe('natverk');
    expect(klassaSyncfel({ message: 'NetworkError when attempting to fetch resource.' }).typ).toBe('natverk');
  });

  it('känner igen en utgången session', () => {
    expect(klassaSyncfel({ message: 'JWT expired', status: 401 }).typ).toBe('session');
    expect(klassaSyncfel({ message: 'Invalid Refresh Token' }).typ).toBe('session');
    expect(klassaSyncfel({ code: 'PGRST301', message: 'x' }).typ).toBe('session');
  });

  it('skiljer rättighet från data', () => {
    expect(klassaSyncfel({ code: '42501', message: 'new row violates row-level security' }).typ).toBe('rattighet');
    expect(klassaSyncfel({ code: '23503', message: 'foreign key' }).typ).toBe('data');
    expect(klassaSyncfel({ code: '23514', message: 'check' }).typ).toBe('data');
  });

  /* En saknad kolumn är en migration som inte körts. Meddelandet ska säga det
   * rakt ut, för det är det enda felet användaren själv kan laga. */
  it('pekar på migrationen när en kolumn saknas', () => {
    const fel = klassaSyncfel({ code: '42703', message: 'column cards.description does not exist' });
    expect(fel.typ).toBe('data');
    expect(fel.text).toContain('migration');
    expect(fel.text).toContain('42703');
  });

  it('behåller serverns eget meddelande när inget annat passar', () => {
    const fel = klassaSyncfel(new Error('något konstigt'));
    expect(fel.typ).toBe('okant');
    expect(fel.text).toContain('något konstigt');
  });

  it('tål vad som helst som fel', () => {
    expect(klassaSyncfel(null).typ).toBe('okant');
    expect(klassaSyncfel('sträng').text).toContain('sträng');
  });
});

describe('vantetid', () => {
  it('försöker tre gånger tätt efter ett nätfel och lämnar sedan över', () => {
    expect(vantetid(1, 'natverk')).toBe(5_000);
    expect(vantetid(2, 'natverk')).toBe(15_000);
    expect(vantetid(3, 'natverk')).toBe(45_000);
    expect(vantetid(4, 'natverk')).toBe(0);
  });

  /* Samma rad avvisas likadant om fem sekunder. */
  it('gör inga förtida försök när datan eller sessionen är felet', () => {
    expect(vantetid(1, 'data')).toBe(0);
    expect(vantetid(1, 'session')).toBe(0);
    expect(vantetid(1, 'rattighet')).toBe(0);
  });
});
