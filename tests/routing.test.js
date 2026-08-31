import { describe, expect, it } from 'vitest';
import { LATT_MODELL, arLattKandidat, valjMal } from '../api/_lib/routing.js';

/** Grundfallet: en användare som slagit på brytaren och har en Google-nyckel. */
const latt = (extra = {}) => ({
  feature: 'autofolder',
  begardProvider: '',
  begardModell: '',
  sparadProvider: 'anthropic',
  sparadModell: 'claude-opus-5',
  lattFriPa: true,
  harGoogleNyckel: true,
  ...extra,
});

describe('valjMal', () => {
  it('skickar mappgissningen till gratismodellen', () => {
    expect(valjMal(latt())).toEqual({ provider: 'google', model: 'gemini-3-flash' });
  });

  it('skickar sorteringen till gratismodellen', () => {
    expect(valjMal(latt({ feature: 'sort' }))).toEqual({
      provider: 'google',
      model: 'gemini-3-flash',
    });
  });

  it('skriver ut modellen i stället för att låta Google välja sin standard', () => {
    // Googles standard är gemini-3-pro, som inte ligger på gratisnivån. En
    // utelämnad modell hade alltså tyst börjat kosta pengar.
    expect(valjMal(latt()).model).toBe(LATT_MODELL);
    expect(LATT_MODELL).toBe('gemini-3-flash');
  });

  it('lämnar de genererande funktionerna hos vald leverantör', () => {
    expect(valjMal(latt({ feature: 'topic' }))).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
  });

  it('lämnar svarsbedömningen hos vald leverantör', () => {
    // Bedömningen matar schemaläggningen. Ett sämre omdöme där förskjuter
    // repetitionerna i veckor, till skillnad från ett missat mappförslag.
    expect(valjMal(latt({ feature: 'answer' })).provider).toBe('anthropic');
  });

  it('routar en okänd funktion som tung', () => {
    expect(valjMal(latt({ feature: 'nagot-nytt' })).provider).toBe('anthropic');
  });

  it('låter en uttrycklig leverantör i begäran vinna över routningen', () => {
    expect(valjMal(latt({ begardProvider: 'openai' })).provider).toBe('openai');
  });

  it('stänger av routningen när begäran kräver en viss modell', () => {
    // Annars hade ett Anthropic-id följt med till Google och gett ett
    // obegripligt fel från fel leverantör.
    expect(valjMal(latt({ begardModell: 'claude-haiku-4-5' }))).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
  });

  it('faller tillbaka på vald leverantör när Google-nyckeln saknas', () => {
    expect(valjMal(latt({ harGoogleNyckel: false }))).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
  });

  it('gör ingenting när brytaren är av', () => {
    expect(valjMal(latt({ lattFriPa: false })).provider).toBe('anthropic');
  });

  it('ignorerar den sparade modellen när begäran byter leverantör', () => {
    // Bevarar det som redan gällde: ett sparat id hör hemma i en annan katalog.
    expect(valjMal(latt({ feature: 'topic', begardProvider: 'openai' }))).toEqual({
      provider: 'openai',
      model: null,
    });
  });

  it('faller tillbaka på anthropic när ingen leverantör är sparad', () => {
    expect(valjMal(latt({ feature: 'topic', sparadProvider: '', sparadModell: '' }))).toEqual({
      provider: 'anthropic',
      model: null,
    });
  });
});

describe('arLattKandidat', () => {
  it('är sant bara när routningen faktiskt kan bli av', () => {
    expect(arLattKandidat(latt())).toBe(true);
  });

  it('är falskt för en tung funktion, så att ingen nyckelkoll görs i onödan', () => {
    expect(arLattKandidat(latt({ feature: 'topic' }))).toBe(false);
  });

  it('är falskt när brytaren är av', () => {
    expect(arLattKandidat(latt({ lattFriPa: false }))).toBe(false);
  });
});
