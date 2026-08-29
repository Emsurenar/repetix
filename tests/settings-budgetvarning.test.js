// @vitest-environment jsdom
//
// Regressionstest för buggen där sidopanelens budgetvarning bara ritades om
// användaren själv öppnat Inställningar. #view-settings ligger dold redan i
// index.html, och uppdatera() kördes tidigare bara när vyn var synlig — så
// varningen syntes aldrig vid appstart, precis det specen pekar ut som skälet
// till att lägga varningen i sidopanelen i första hand.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: null,
  fromImpl: null,
  authCallback: null,
}));

vi.mock('../src/core/supabase.js', () => ({
  supabase: { from: (...args) => state.fromImpl(...args) },
  getUserId: () => state.userId,
  cloudConfigured: true,
  getUser: () => (state.userId ? { email: 'a@exempel.se' } : null),
  deleteAccount: vi.fn(),
  onAuthChange: (fn) => {
    state.authCallback = fn;
    fn(state.userId);
    return () => {};
  },
}));

// De här modulerna rörs inte av testet men importeras transitivt av
// settings.js. Verkliga implementationer räcker (samma som
// felmeddelande.test.js redan visar fungerar utan mockning).
const { initSettings, uppdateraBudgetvarning } = await import('../src/ui/settings.js');

function falskSupabase({ tak, rader }) {
  return (table) => {
    if (table === 'user_settings') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ai_provider: 'anthropic', ai_model: 'claude-opus-5', ai_monthly_budget: tak },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'ai_usage') {
      return {
        select: () => ({
          gte: () => ({
            order: async () => ({ data: rader, error: null }),
          }),
        }),
      };
    }
    throw new Error(`oväntad tabell: ${table}`);
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="view-settings" class="view hidden"></div>
    <span id="budget-status" class="sync-status" data-state="warn" role="status" hidden></span>
  `;
  state.userId = null;
  state.fromImpl = falskSupabase({ tak: null, rader: [] });
  state.authCallback = null;
});

describe('budgetvarningen i sidopanelen', () => {
  it('ritas vid inloggning även när Inställningar aldrig öppnats', async () => {
    initSettings();
    expect(document.getElementById('view-settings').classList.contains('hidden')).toBe(true);

    // Simulerar inloggning med en användare långt över sitt månadstak.
    state.userId = 'user-1';
    state.fromImpl = falskSupabase({
      tak: 1,
      rader: [
        {
          model: 'claude-opus-5',
          feature: 'tutor',
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await state.authCallback(state.userId);
    // uppdateraBudgetvarning körs asynkront från lyssnaren; invänta dess DOM-skrivning.
    await vi.waitFor(() => {
      expect(document.getElementById('budget-status').hidden).toBe(false);
    });

    const node = document.getElementById('budget-status');
    expect(node.dataset.state).toBe('error');
    expect(node.textContent).toContain('Månadstaket passerat');

    // Vyn stod hela tiden dold — varningen kom alltså inte via uppdatera().
    expect(document.getElementById('view-settings').classList.contains('hidden')).toBe(true);
  });

  it('döljer raden igen efter utloggning', async () => {
    initSettings();
    state.userId = 'user-1';
    state.fromImpl = falskSupabase({ tak: 1, rader: [] });
    await uppdateraBudgetvarning();

    state.userId = null;
    await uppdateraBudgetvarning();
    expect(document.getElementById('budget-status').hidden).toBe(true);
  });
});
