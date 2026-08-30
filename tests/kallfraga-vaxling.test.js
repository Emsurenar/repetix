// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Regression för fyndet i granskningen: ett svar som är på väg tillbaka ska
 * inte landa i en annan källas historik om panelen hunnit bytas medan
 * anropet väntade. Testet mockar fragaKallan för att kunna styra exakt när
 * anropet "svarar", och hamtaKallor för att slippa ett riktigt Supabase-anrop. */

const state = vi.hoisted(() => ({
  fragaCalls: [],
  resolveFraga: null,
  kallor: [],
}));

vi.mock('../src/ai/kallfraga.js', () => ({
  fragaKallan: vi.fn(({ sourceId }) => {
    state.fragaCalls.push(sourceId);
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
  state.fragaCalls = [];
  state.resolveFraga = null;
  state.kallor = [
    { id: 'kalla-a', title: 'Källa A', pages: 1, chars: 10 },
    { id: 'kalla-b', title: 'Källa B', pages: 1, chars: 10 },
  ];
  S.currentDeckId = 'deck-1';
  initUiKallfraga();
});

describe('frågepanelen och en källbytning mitt i ett svar', () => {
  it('skriver inte ett sent svar in i en annan källas historik', async () => {
    await renderaKallor('deck-1');

    const knappar = document.querySelectorAll('[data-kalla-handling="fraga"]');
    expect(knappar).toHaveLength(2);

    // Öppna panelen för källa A och ställ en fråga. Anropet hänger kvar
    // obesvarat — det är precis det läge där ett källbyte kan ske.
    knappar[0].click();
    const falt = document.getElementById('deck-kallfraga-input');
    falt.value = 'Vad handlar A om?';
    document.getElementById('btn-kallfraga').click();

    expect(state.fragaCalls).toEqual(['kalla-a']);
    const svaraA = state.resolveFraga;
    expect(svaraA).toBeTypeOf('function');

    // Användaren byter till källa B innan A hunnit svara.
    knappar[1].click();
    expect(document.getElementById('deck-kallfraga-kalla').textContent).toBe('Källa B');

    // A:s svar kommer nu, försent.
    svaraA('Svaret om A');
    await Promise.resolve();
    await Promise.resolve();

    // Panelen ska fortfarande visa B, orörd av A:s svar.
    expect(document.getElementById('deck-kallfraga-kalla').textContent).toBe('Källa B');
    expect(document.getElementById('deck-kallfraga-svar').innerHTML).toBe('');

    // Och en ny fråga i B:s panel ska gå till B, inte hänga kvar på A.
    falt.value = 'Vad handlar B om?';
    document.getElementById('btn-kallfraga').click();
    expect(state.fragaCalls).toEqual(['kalla-a', 'kalla-b']);
  });
});
