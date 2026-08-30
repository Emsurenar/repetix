import { describe, expect, it } from 'vitest';
import { TURER, laggTill } from '../src/domain/fragehistorik.js';

/* Historiken ligger EFTER cachebrytpunkten, så den byts ut utan att dokumentet
 * tappar cachen. Att den är begränsad är därför inte en cachefråga utan en
 * kostnadsfråga: utan tak växer varje anrop med samtalet. */
describe('laggTill', () => {
  it('lägger turen sist', () => {
    expect(laggTill([], 'f1', 's1')).toEqual([{ fraga: 'f1', svar: 's1' }]);
  });

  it('behåller högst TURER turer och släpper den äldsta', () => {
    let h = [];
    for (let i = 1; i <= TURER + 2; i++) h = laggTill(h, `f${i}`, `s${i}`);

    expect(h).toHaveLength(TURER);
    expect(h[0].fraga).toBe(`f3`);
    expect(h.at(-1).fraga).toBe(`f${TURER + 2}`);
  });

  it('muterar inte det den fick', () => {
    const h = [{ fraga: 'f1', svar: 's1' }];
    laggTill(h, 'f2', 's2');
    expect(h).toHaveLength(1);
  });
});
