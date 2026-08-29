
// --- UTILS ---
export const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

export const fisherYatesShuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// fetchWithRetry bodde här tidigare. Den fanns bara för Anthropic-anropen, och
// omförsöken sitter numera i src/ai/call.js där de kan ta hänsyn till
// felkoden och leverantörens Retry-After.

/**
 * Id för en kortlek, bokhylla, mapp eller ett anteckningsblock.
 *
 * Var tidigare `Date.now().toString()`. Servern har id:t som primärnyckel
 * ENSAMT, alltså i en namnrymd delad av alla konton — och värdet var en ren
 * millisekundstämpel. Vem som helst kunde registrera ett konto och lägga
 * beslag på en hel timmes id:n (3,6 miljoner rader), varpå varje användare som
 * skapade en kortlek den timmen fick ett upptaget id. Utkorgens upsert krockar
 * då med angriparens rad, radnivåsäkerheten nekar, anropet kastar — och
 * eftersom utkorgen skickas först i synken stannade allt. Offrets synk var
 * permanent låst, utan felmeddelande som förklarade varför.
 *
 * Samma sak inträffade av misstag så snart två användare råkade skapa en
 * kortlek under samma millisekund.
 *
 * Kort har egna id:n med slump i sig och rörs inte: deras inledande
 * tidsstämpel läses av spelhallen för att sortera fram de dammigaste korten.
 *
 * Reservvägen behövs eftersom randomUUID saknas på osäkra ursprung (http).
 */
export const nyttId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const slumpad = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (tecken) => {
    const v = tecken === 'x' ? slumpad() : ((Math.floor(Math.random() * 4) + 8).toString(16));
    return v;
  });
};
