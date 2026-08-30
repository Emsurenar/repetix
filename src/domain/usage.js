/* Summering av användningsloggen.
 *
 * Ren funktion utan DOM och utan nät, som resten av domain/. Datumen kommer in
 * som färdiga YYYY-MM-DD-strängar i stället för att räknas fram här: gränsen för
 * "denna månad" ska följa användarens lokala kalender, och den vetskapen hör
 * hemma hos anroparen — inte i en funktion som ska gå att testa utan tidszon.
 */

import { harPris, kostnad } from './pricing.js';

const lokaltDatum = (iso) => {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
};

/**
 * @param {Array<object>} rader rader ur ai_usage
 * @param {{fran?: string, till?: string}} [intervall] YYYY-MM-DD, inklusive båda ändar
 */
export function summera(rader, { fran, till } = {}) {
  let total = 0;
  let okändaModeller = false;
  const tokens = { in: 0, ut: 0 };
  const perFunktion = new Map();

  for (const r of rader ?? []) {
    const dag = lokaltDatum(r.created_at);
    if (fran && dag < fran) continue;
    if (till && dag > till) continue;

    tokens.in += (r.input_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
    tokens.ut += r.output_tokens ?? 0;

    if (!harPris(r.model)) {
      okändaModeller = true;
      continue;
    }

    const c = kostnad({
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    });
    total += c;
    perFunktion.set(r.feature, (perFunktion.get(r.feature) ?? 0) + c);
  }

  return {
    total,
    okändaModeller,
    tokens,
    perFunktion: [...perFunktion]
      .map(([feature, kostnad]) => ({ feature, kostnad }))
      .sort((a, b) => b.kostnad - a.kostnad),
  };
}

/* Åttio procent, inte nittio: varningen ska komma medan det fortfarande går att
 * ändra sig — byta modell, vänta till nästa månad — inte när pengarna redan är
 * slut. Ett tak på noll eller null betyder inget tak, inte ett omöjligt tak. */
const NARA = 0.8;

/**
 * @param {number} total månadens kostnad i dollar
 * @param {number|null} tak månadstaket i dollar
 * @returns {'ok'|'nara'|'over'}
 */
export function budgetLage(total, tak) {
  if (!tak || tak <= 0) return 'ok';
  if (total >= tak) return 'over';
  if (total >= tak * NARA) return 'nara';
  return 'ok';
}
