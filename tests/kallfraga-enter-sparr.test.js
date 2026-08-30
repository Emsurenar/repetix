// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Regression för granskningsfyndet: Enter kan hamras i klump medan ett svar
 * väntas in. Utan spärren startar varje tryck ett eget anrop som kapplöper
 * mot den pågående cacheskrivningen och betalar för hela dokumentet igen.
 * Testet mockar fragaKallan för att styra exakt när anropet "svarar". */

const state = vi.hoisted(() => ({
  fragaCalls: 0,
  resolveFraga: null,
  kallor: [],
}));

vi.mock('../src/ai/kallfraga.js', () => ({
  fragaKallan: vi.fn(() => {
    state.fragaCalls += 1;
    return new Promise((resolve) => {
      state.resolveFraga = resolve;
    });
  }),
}));

vi.mock('../src/core/sources.js', () => ({
  hamtaKallor: vi.fn(async () => state.kallor),
  taBortKalla: vi.fn(async () => ({ ok: true })),
}));

const { S } = await import('../src/core/state.js');
const { renderaKallor, initUiKallfraga } = await import('../src/ui/deck.js');

beforeEach(() => {
  document.body.innerHTML = `
    <ul id="deck-kallor" hidden></ul>
    <section id="deck-kallfraga" class="hidden">
      <p id="deck-kallfraga-kalla"></p>
      <div id="deck-kallfraga-svar"></div>
      <input id="deck-kallfraga-input">
      <button id="btn-kallfraga"></button>
    </section>
  `;
  state.fragaCalls = 0;
  state.resolveFraga = null;
  state.kallor = [{ id: 'kalla-a', title: 'Källa A', pages: 1, chars: 10 }];
  S.currentDeckId = 'deck-1';
  initUiKallfraga();
});

describe('frågepanelen och Enter under ett pågående anrop', () => {
  it('startar inte ett nytt anrop förrän knappen är återaktiverad', async () => {
    await renderaKallor('deck-1');
    document.querySelector('[data-kalla-handling="fraga"]').click();

    const falt = document.getElementById('deck-kallfraga-input');
    falt.value = 'Vad handlar A om?';

    // Tre Enter i rad medan svaret väntar — bara det första ska räknas.
    falt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    falt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    falt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();

    expect(state.fragaCalls).toBe(1);

    state.resolveFraga('Svaret om A');
    await Promise.resolve();
    await Promise.resolve();

    // Knappen är återaktiverad, så nu ska en ny fråga gå igenom.
    falt.value = 'En till fråga';
    falt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();

    expect(state.fragaCalls).toBe(2);
  });
});
