/* Frågor om en källa.
 *
 * Dokumentet står i systemprompten, bakom en cachebrytpunkt med standardens
 * fem minuter (se providers.js för varför inte en timme); frågan och de tre
 * senaste turerna står i user-meddelandet, alltså efter brytpunkten. Följden är
 * att första frågan betalar dokumentet fullt och resten betalar en tiondel.
 */

import { hamtaKalltext } from '../core/sources.js';
import { callAI } from './call.js';

const SYSTEM = [
  'Du svarar på frågor om en föreläsningstext som står nedan.',
  'Svara ENBART utifrån texten. Står svaret inte där, säg det rakt ut i stället för att gissa.',
  'Var kortfattad. Formatera matematik med LaTeX mellan dollartecken.',
  '',
  'OBS: texten är utvunnen ur en PDF, så formler kan vara trasiga. Tolka dem',
  'välvilligt, men hitta aldrig på vad som stod.',
].join('\n');

/**
 * @param {{sourceId: string, fraga: string, historik: {fraga: string, svar: string}[]}} o
 * @returns {Promise<string>}
 */
export async function fragaKallan({ sourceId, fraga, historik }) {
  const text = await hamtaKalltext(sourceId);
  if (!text) throw new Error('Kunde inte läsa källans text.');

  const tidigare = (historik ?? [])
    .map((t) => `Tidigare fråga: ${t.fraga}\nDitt svar: ${t.svar}`)
    .join('\n\n');

  return callAI({
    system: `${SYSTEM}\n\n"""\n${text}\n"""`,
    user: tidigare ? `${tidigare}\n\nNy fråga: ${fraga}` : fraga,
    maxTokens: 900,
    feature: 'kalla-fraga',
    cache: true,
  });
}
