globalThis.__falskSupabase = {
  __logg: [],
  __svar: { error: null },
  __svarPerTabell: null,
  from(tabell) {
    const self = this;
    const svar = () => self.__svarPerTabell?.[tabell] ?? self.__svar;
    return {
      insert: async (rad) => {
        self.__logg.push({ tabell, op: 'insert', rad });
        return svar();
      },
      delete() {
        return {
          eq: async () => {
            self.__logg.push({ tabell, op: 'delete' });
            return { error: null };
          },
        };
      },
    };
  },
};

import { describe, expect, it, vi } from 'vitest';

const session = { value: { user: { id: 'u1' } } };
vi.mock('../src/core/supabase.js', () => ({
  supabase: globalThis.__falskSupabase,
  getUserId: () => session.value?.user?.id ?? null,
}));

const { sparaKalla } = await import('../src/core/sources.js');

/* Två tabeller skrivs i följd, och den andra kan misslyckas efter att den
 * första lyckats. Utan städning blir raden i sources en källa utan text —
 * synlig i listan, omöjlig att använda. */
describe('sparaKalla', () => {
  it('skriver metadata och text, och ger tillbaka källan', async () => {
    const skrivet = [];
    globalThis.__falskSupabase.__svar = { error: null };
    globalThis.__falskSupabase.__logg = skrivet;

    const res = await sparaKalla({ deckId: 'd1', title: 'F1', text: 'hej', pages: 3 });

    expect(res.ok).toBe(true);
    expect(skrivet[0].tabell).toBe('sources');
    expect(skrivet[0].rad).toMatchObject({ user_id: 'u1', deck_id: 'd1', title: 'F1', pages: 3, chars: 3 });
    expect(skrivet[1].tabell).toBe('source_texts');
    expect(skrivet[1].rad).toMatchObject({ user_id: 'u1', text: 'hej' });
    expect(skrivet[1].rad.source_id).toBe(skrivet[0].rad.id);
  });

  it('städar bort metadataraden när texten inte gick att spara', async () => {
    const skrivet = [];
    globalThis.__falskSupabase.__logg = skrivet;
    globalThis.__falskSupabase.__svarPerTabell = {
      sources: { error: null },
      source_texts: { error: { message: 'nekad' } },
    };

    const res = await sparaKalla({ deckId: 'd1', title: 'F1', text: 'hej', pages: 1 });

    expect(res.ok).toBe(false);
    expect(skrivet.some((s) => s.tabell === 'sources' && s.op === 'delete')).toBe(true);
  });
});
