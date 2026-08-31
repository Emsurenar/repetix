// @vitest-environment jsdom
//
// settings.js importgraf når src/ui/dom.js, som läser document vid
// inläsning — jsdom finns här bara för att modulen ska gå att importera alls,
// precis som i felmeddelande.test.js.

import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'user-1' }));

/* Bara det laddaVal faktiskt rör mockas: getUserId och supabase. Övriga
 * exporter behöver bara finnas, eftersom resten av modulen aldrig anropas i
 * det här testet. */
vi.mock('../src/core/supabase.js', () => ({
  supabase: { from: (...args) => state.fromImpl(...args) },
  getUserId: () => state.userId,
  cloudConfigured: true,
  getUser: () => null,
  deleteAccount: vi.fn(),
  onAuthChange: () => () => {},
}));

const { laddaVal } = await import('../src/ui/settings.js');

describe('laddaVal', () => {
  it('läser leverantör, modell, tak och brytaren när kolumnerna finns', async () => {
    state.fromImpl = (table) => {
      expect(table).toBe('user_settings');
      return {
        select: (kolumner) => {
          expect(kolumner).toBe('ai_provider, ai_model, ai_monthly_budget, ai_light_free');
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  ai_provider: 'openai',
                  ai_model: 'gpt-5.1',
                  ai_monthly_budget: 10,
                  ai_light_free: true,
                },
                error: null,
              }),
            }),
          };
        },
      };
    };

    await expect(laddaVal()).resolves.toEqual({
      provider: 'openai',
      model: 'gpt-5.1',
      tak: 10,
      lattFri: true,
    });
  });

  /* Migration 0009 kan vara okörd när koden distribueras. Brytaren ska då vara
   * av — inte hindra att leverantör och modell läses. */
  it('läser brytaren som av när ai_light_free saknas i raden', async () => {
    state.fromImpl = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { ai_provider: 'openai', ai_model: 'gpt-5.1', ai_monthly_budget: null },
            error: null,
          }),
        }),
      }),
    });

    await expect(laddaVal()).resolves.toMatchObject({ lattFri: false });
  });

  /* Regressionen: PostgREST avvisar HELA frågan (42703) om ai_monthly_budget
   * inte finns än, eftersom migration 0006 inte är körd. Utan reträtten
   * kollapsade laddaVal till null, och uppdatera() tolkade det som "inget
   * sparat" — användarens verkliga OpenAI-val visades som standardvalet
   * Anthropic, och ett tryck på Spara hade skrivit över det på riktigt. */
  it('faller tillbaka på den gamla kolumnuppsättningen när en ny kolumn saknas', async () => {
    let försök = 0;
    state.fromImpl = (table) => {
      expect(table).toBe('user_settings');
      försök += 1;
      if (försök === 1) {
        return {
          select: (kolumner) => {
            expect(kolumner).toBe('ai_provider, ai_model, ai_monthly_budget, ai_light_free');
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: '42703', message: 'column "ai_light_free" does not exist' },
                }),
              }),
            };
          },
        };
      }
      return {
        select: (kolumner) => {
          expect(kolumner).toBe('ai_provider, ai_model');
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: { ai_provider: 'openai', ai_model: 'gpt-5.1' },
                error: null,
              }),
            }),
          };
        },
      };
    };

    await expect(laddaVal()).resolves.toEqual({
      provider: 'openai',
      model: 'gpt-5.1',
      tak: null,
      lattFri: false,
    });
    expect(försök).toBe(2);
  });

  it('ger null om även reträtten misslyckas', async () => {
    state.fromImpl = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'nekad' } }),
        }),
      }),
    });

    await expect(laddaVal()).resolves.toBeNull();
  });

  it('läser inget utan inloggad användare', async () => {
    state.userId = null;
    state.fromImpl = () => {
      throw new Error('ska aldrig anropas utan användare');
    };

    await expect(laddaVal()).resolves.toBeNull();
    state.userId = 'user-1';
  });
});
