import { describe, expect, it } from 'vitest';

import { fordjupningsPrompt, saknasForFordjupning } from '../src/ai/fordjupning.js';
import { medTankeutrymme } from '../src/ai/tak.js';

/* Fördjupningen är inte samma sak som förklaringen under repetitionen.
 *
 * Förklaringen (card-ai.js) är flyktig och beställs i stunden. Fördjupningen
 * sparas PÅ kortet och står under svaret varje gång kortet dyker upp, och
 * ingår aldrig i bedömningen. Den ska därför inte upprepa svaret — då hade
 * kortet burit sitt svar två gånger, en gång i det fält man ska kunna
 * återkalla och en gång i det man läser efteråt.
 */
describe('saknasForFordjupning', () => {
  it('kräver en fråga', () => {
    expect(saknasForFordjupning({ front: '', back: 'ett svar' })).toContain('fråga');
  });

  /* Fördjupningen fördjupar svaret. Utan svar finns ingenting att gå djupare
   * än, och modellen hade fått hitta på vad kortet handlar om. */
  it('kräver ett svar, inte bara en fråga', () => {
    const fel = saknasForFordjupning({ front: 'Vad är entropi?', back: '' });
    expect(fel).toBeTruthy();
    expect(fel).toContain('svar');
  });

  it('räknar blanktecken som tomt', () => {
    expect(saknasForFordjupning({ front: '  \n ', back: 'svar' })).toBeTruthy();
    expect(saknasForFordjupning({ front: 'fråga', back: '   ' })).toBeTruthy();
  });

  it('säger ingenting när båda fälten är ifyllda', () => {
    expect(saknasForFordjupning({ front: 'fråga', back: 'svar' })).toBeNull();
  });
});

describe('fordjupningsPrompt', () => {
  const kort = { front: 'Vad är entropi?', back: 'Ett mått på oordning.' };

  it('ger modellen både frågan och svaret', () => {
    const { user } = fordjupningsPrompt(kort);
    expect(user).toContain('Vad är entropi?');
    expect(user).toContain('Ett mått på oordning.');
  });

  it('säger uttryckligen att svaret inte ska upprepas', () => {
    expect(fordjupningsPrompt(kort).system.toLowerCase()).toContain('upprepa');
  });

  /* Fältet är kort med flit, och en fördjupning man inte orkar läsa är samma
   * sak som ingen fördjupning. Det är texten som hålls kort: taket rymmer
   * dessutom modellens tänkande, som annars äter av samma budget och kapar
   * fördjupningen mitt i en mening. */
  it('håller svaret kort', () => {
    expect(fordjupningsPrompt(kort).maxTokens).toBe(medTankeutrymme(700));
  });

  it('tar med kortlekens kontext när den finns', () => {
    const { user } = fordjupningsPrompt({ ...kort, deckContext: '\nKortlek: Termodynamik' });
    expect(user).toContain('Termodynamik');
  });

  /* Utan kontext ska ingenting hängas på — varken "undefined" eller en tom
   * rad som ser ut som ett bortglömt fält. */
  it('hänger inte på något när kontexten saknas', () => {
    const { user } = fordjupningsPrompt(kort);
    expect(user).not.toContain('undefined');
    expect(user.endsWith('\n')).toBe(false);
  });

  it('trimmar fälten', () => {
    const { user } = fordjupningsPrompt({ front: '  fråga \n', back: '\n svar  ' });
    expect(user).toContain('fråga');
    expect(user).not.toContain('  fråga');
  });
});
