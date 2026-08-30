// @vitest-environment jsdom
//
// Samma skäl som i felmeddelande.test.js: settings.js importgraf når
// src/ui/dom.js, som läser document vid inläsning. Testet rör inget DOM.

import { describe, expect, it } from 'vitest';

import { valetSomSkaSparas } from '../src/ui/settings.js';

const EGET = '__eget__';

/* Utan sparaknapp finns inget ögonblick där användaren säger "nu".
 *
 * Varje ändring måste därför själv avgöra om den är ett färdigt val. Den
 * farliga kanten är fritextfältet: att välja "Eget modell-id" tömmer fältet,
 * och sparades det läget hade modellen försvunnit ur kontot i samma stund som
 * användaren trodde att hen började lägga till en.
 */
describe('valetSomSkaSparas', () => {
  it('sparar en modell ur listan direkt', () => {
    expect(valetSomSkaSparas({ selectValue: 'claude-opus-5', customValue: '' })).toEqual({
      spara: true,
      model: 'claude-opus-5',
    });
  });

  it('sparar inte medan fritextfältet är tomt', () => {
    expect(valetSomSkaSparas({ selectValue: EGET, customValue: '' }).spara).toBe(false);
    expect(valetSomSkaSparas({ selectValue: EGET, customValue: '   ' }).spara).toBe(false);
  });

  it('sparar fritexten när den fått ett värde', () => {
    expect(valetSomSkaSparas({ selectValue: EGET, customValue: 'openai/gpt-5.1' })).toEqual({
      spara: true,
      model: 'openai/gpt-5.1',
    });
  });

  /* Ett id klistras in, och urklipp bär ofta med sig blanksteg. */
  it('trimmar det inklistrade id:t', () => {
    expect(valetSomSkaSparas({ selectValue: EGET, customValue: '  gemini-3-pro \n' }).model).toBe(
      'gemini-3-pro'
    );
  });

  /* Fritexten får inte läcka in i ett listval, och tvärtom. Väljaren och
   * fältet lever samtidigt i DOM:en — bara det ena är sant åt gången. */
  it('läser bara det fält som valet pekar ut', () => {
    expect(valetSomSkaSparas({ selectValue: 'gpt-5.1', customValue: 'skräp' }).model).toBe('gpt-5.1');
    expect(valetSomSkaSparas({ selectValue: EGET, customValue: 'gpt-5' }).model).toBe('gpt-5');
  });

  it('sparar ingenting när väljaren är tom', () => {
    expect(valetSomSkaSparas({ selectValue: '', customValue: '' }).spara).toBe(false);
    expect(valetSomSkaSparas({ selectValue: undefined, customValue: undefined }).spara).toBe(false);
  });
});
