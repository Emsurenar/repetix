/* Källdokument per kortlek.
 *
 * Direkta anrop mot supabase, utanför synken — som user_settings och ai_usage.
 * Synken är en diff mot S.appData, inte en tabellista, och att ta in källor där
 * hade krävt ändringar i appdatan, i flatten(), i diffen och i utkorgen. För en
 * funktion som ändå kräver nät är det fel pris.
 *
 * Metadata och text ligger i var sin tabell. Texten är hundra kilobyte per
 * föreläsning och hämtas bara när den faktiskt ska läsas.
 */

import { getUserId, supabase } from './supabase.js';
import { nyttId } from './utils.js';

/**
 * Sparar en inläst källa.
 *
 * Två skrivningar i följd, och den andra kan misslyckas efter att den första
 * lyckats. Då städas den första bort: en rad i sources utan rad i source_texts
 * är en källa som syns i listan men inte går att använda, och den sortens
 * halvtillstånd är värre än ett fel användaren ser direkt.
 */
export async function sparaKalla({ deckId, title, text, pages }) {
  const userId = getUserId();
  if (!supabase || !userId) return { ok: false, error: 'Du är inte inloggad.' };

  const id = nyttId();
  const rad = {
    id,
    user_id: userId,
    deck_id: deckId,
    title,
    pages: pages ?? 0,
    chars: text.length,
  };

  const { error: metafel } = await supabase.from('sources').insert(rad);
  if (metafel) return { ok: false, error: 'Kunde inte spara källan.' };

  const { error: textfel } = await supabase
    .from('source_texts')
    .insert({ source_id: id, user_id: userId, text });

  if (textfel) {
    await supabase.from('sources').delete().eq('id', id);
    return { ok: false, error: 'Kunde inte spara källans text.' };
  }

  return { ok: true, source: rad };
}

/** Kortlekens källor, nyast först. Utan texten. */
export async function hamtaKallor(deckId) {
  const userId = getUserId();
  if (!supabase || !userId) return [];

  const { data, error } = await supabase
    .from('sources')
    .select('id, title, pages, chars, created_at')
    .eq('deck_id', deckId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return error ? [] : (data ?? []);
}

/** Texten till en källa. Hämtas först när den ska läsas. */
export async function hamtaKalltext(sourceId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('source_texts')
    .select('text')
    .eq('source_id', sourceId)
    .maybeSingle();

  return error ? null : (data?.text ?? null);
}

/** Mjuk radering, som allt annat användaren äger. */
export async function taBortKalla(sourceId) {
  if (!supabase) return { ok: false };
  const { error } = await supabase
    .from('sources')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sourceId);
  return { ok: !error };
}
