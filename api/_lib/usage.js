// Användningsloggen.
//
// Raden skrivs som användaren, med samma klient som resten av anropet — insert-
// policyn kräver user_id = auth.uid(), och det värdet kommer ur anroparens egen
// token. Ingen service role-nyckel behövs, som ingen annanstans i appen.

/**
 * Antecknar ett AI-anrops tokental. Kastar aldrig.
 *
 * Ett misslyckande här får inte sänka anropet. Svaret från leverantören är redan
 * betalt och ska levereras även om vi inte lyckas anteckna det — en tapp i
 * bokföringen är ett litet fel, ett tappat svar ett stort. Felet sväljs tyst
 * eftersom serverfunktionerna med flit inte loggar: en logg är det enklaste
 * sättet att av misstag skriva ut en användares nyckel.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db klient som agerar som användaren
 * @param {{userId: string, provider: string, model: string, feature: string,
 *          usage: {inputTokens: number, outputTokens: number,
 *                  cacheReadTokens: number, cacheWriteTokens: number}}} rad
 */
export async function recordUsage(db, { userId, provider, model, feature, usage }) {
  try {
    await db.from('ai_usage').insert({
      user_id: userId,
      provider,
      model,
      feature,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
    });
  } catch {
    // Se ovan: avsiktligt tyst.
  }
}
