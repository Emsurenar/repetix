// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'user-1', fromImpl: null }));

vi.mock('../src/core/supabase.js', () => ({
  supabase: { from: (...args) => state.fromImpl(...args) },
  getUserId: () => state.userId,
  cloudConfigured: true,
  getUser: () => null,
  deleteAccount: vi.fn(),
  onAuthChange: () => () => {},
}));

const { renderaAnvandning } = await import('../src/ui/settings.js');

function falskSupabase({ tak = null, rader = [], usageError = null } = {}) {
  return (table) => {
    if (table === 'user_settings') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ai_provider: 'openai', ai_model: 'gpt-5.1', ai_monthly_budget: tak },
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
            order: async () => ({ data: rader, error: usageError }),
          }),
        }),
      };
    }
    throw new Error(`oväntad tabell: ${table}`);
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <section id="settings-usage-section" hidden>
      <p id="usage-month"></p>
      <p id="usage-month-tokens"></p>
      <p id="usage-today"></p>
      <div id="usage-breakdown-row" hidden><ul id="usage-breakdown"></ul></div>
      <input id="settings-budget" />
    </section>
    <span id="budget-status" hidden></span>
  `;
  state.userId = 'user-1';
});

describe('renderaAnvandning', () => {
  /* Minor 4: OpenAI, Google och OpenRouter saknar prisdata med flit (specens
   * "ärliga lucka"). "$0.00" påstår att anropen var gratis; sanningen är att
   * kostnaden är okänd, och ett streck säger det ärligt. */
  it('visar ett streck i stället för $0.00 när ingen modell i loggen har ett pris', async () => {
    state.fromImpl = falskSupabase({
      rader: [
        {
          model: 'gpt-5.1',
          feature: 'tutor',
          input_tokens: 1000,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await renderaAnvandning();

    expect(document.getElementById('usage-month').textContent).toBe('–');
    expect(document.getElementById('usage-today').textContent).toBe('–');
  });

  /* Utan tak (förvalet — de flesta sätter aldrig ett) hade den gamla
   * visaBudgetvarning fortfarande försökt formatera taket som dollar och
   * kastat på null.toFixed. Det är det vanligaste läget av alla, så det
   * måste gå att rendera utan att panelen kraschar. */
  it('kraschar inte när inget månadstak är satt', async () => {
    state.fromImpl = falskSupabase({
      tak: null,
      rader: [
        {
          model: 'claude-opus-5',
          feature: 'tutor',
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await expect(renderaAnvandning()).resolves.toBeUndefined();
    expect(document.getElementById('budget-status').hidden).toBe(true);
  });

  it('visar dollarbelopp som vanligt när modellen har ett känt pris', async () => {
    state.fromImpl = falskSupabase({
      rader: [
        {
          model: 'claude-opus-5',
          feature: 'tutor',
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await renderaAnvandning();

    expect(document.getElementById('usage-month').textContent).toBe('$5.00');
  });

  /* Minor 5: ett fel fick tidigare bara #usage-month säga "Kunde inte läsa"
   * medan resten av panelen visade förra lyckade renderingens siffror — en
   * live-felrad blandad med gammal, stillastående data. */
  it('blankar hela panelen vid ett frågefel, i stället för att blanda in gamla siffror', async () => {
    // Första, lyckade rendering fyller panelen med riktiga siffror.
    state.fromImpl = falskSupabase({
      tak: 5,
      rader: [
        {
          model: 'claude-opus-5',
          feature: 'tutor',
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          created_at: new Date().toISOString(),
        },
      ],
    });
    await renderaAnvandning();
    expect(document.getElementById('usage-month').textContent).toBe('$5.00');
    expect(document.getElementById('budget-status').hidden).toBe(false);

    // Andra rendering: frågan mot ai_usage misslyckas.
    state.fromImpl = falskSupabase({ usageError: { message: 'nekad' } });
    await renderaAnvandning();

    expect(document.getElementById('usage-month').textContent).toBe('Kunde inte läsa');
    expect(document.getElementById('usage-today').textContent).toBe('');
    expect(document.getElementById('usage-month-tokens').textContent).toBe('');
    expect(document.getElementById('usage-breakdown-row').hidden).toBe(true);
    expect(document.getElementById('budget-status').hidden).toBe(true);
  });
});
