// Vad ett synkfel betyder, och vad man kan göra åt det.
//
// Synken fångade felet, sparade dess text i sitt tillstånd — och visade sedan
// en fast sträng: "Kunde inte synka". Orsaken fanns i handen och kastades
// bort. Ägaren såg meddelandet ofta och kunde inte veta om det var nätet, en
// utgången inloggning, eller en rad servern vägrade ta emot. De tre kräver tre
// olika svar, och bara det första går över av sig självt.
//
// Ren funktion: tar ett fel, ger en klass och en mening. Ingen DOM, inget nät.

/**
 * @typedef {'natverk'|'session'|'rattighet'|'data'|'server'|'okant'} Felklass
 */

/** SQLSTATE-koder som betyder att raden i sig avvisades — inte nätet, inte
 *  sessionen. Sådana fel går inte över av sig själva: samma rad avvisas
 *  varje gång. */
const DATAKODER = new Set([
  '23503', // främmande nyckel saknas
  '23505', // unik nyckel krockar
  '23514', // check-villkor
  '23502', // not null
  '22P02', // ogiltig text för typen
  '22001', // för lång sträng
  '42703', // kolumnen finns inte: en migration är inte körd
  '42P01', // tabellen finns inte: en migration är inte körd
]);

const text = (v) => (typeof v === 'string' ? v : '');

/**
 * Klassar ett fel från synken.
 *
 * @param {unknown} err ett Error, ett PostgrestError, eller något annat
 * @returns {{typ: Felklass, text: string, kod: string|null}}
 */
export function klassaSyncfel(err) {
  const meddelande = text(err?.message) || (typeof err === 'string' ? err : '');
  const kod = text(err?.code) || null;
  const status = Number(err?.status ?? err?.statusCode) || null;

  // Nätet. fetch kastar TypeError utan kod: "Failed to fetch" i Chrome,
  // "Load failed" i Safari, "NetworkError" i Firefox. navigator.onLine säger
  // ofta "uppkopplad" ändå — ett tappat VPN eller en portal som kräver
  // inloggning räknas som nät — så meddelandet är det som avgör.
  if (
    (err instanceof TypeError && !kod) ||
    /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(
      meddelande
    )
  ) {
    return { typ: 'natverk', kod, text: 'Ingen kontakt med servern. Ändringarna skickas när nätet är tillbaka.' };
  }

  // Sessionen. Token har gått ut och förnyelsen misslyckades — typiskt efter
  // att telefonen legat en natt.
  if (
    status === 401 ||
    kod === 'PGRST301' ||
    /jwt|token|expired|invalid claim|not authenticated|refresh/i.test(meddelande)
  ) {
    return { typ: 'session', kod, text: 'Inloggningen har gått ut. Logga in igen så fortsätter synken.' };
  }

  // Rättighet. Radnivåsäkerheten sade nej: raden bär fel ägare, eller en
  // policy saknas i det körda projektet.
  if (status === 403 || kod === '42501') {
    return { typ: 'rattighet', kod, text: 'Servern nekade åtkomst till en rad. Kontrollera att alla migrationer är körda.' };
  }

  if (kod && DATAKODER.has(kod)) {
    const migration = kod === '42703' || kod === '42P01';
    return {
      typ: 'data',
      kod,
      text: migration
        ? `Databasen saknar en kolumn eller tabell som appen skriver till (fel ${kod}). Kör den senaste migrationen.`
        : `Servern avvisade en ändring (fel ${kod}). Den försöks igen, men stoppar inte resten.`,
    };
  }

  if ((status && status >= 500) || /^PGRST/.test(kod ?? '') || /5\d\d|unavailable|timeout|timed out/i.test(meddelande)) {
    return { typ: 'server', kod, text: 'Servern svarade inte som väntat. Nytt försök om en stund.' };
  }

  return {
    typ: 'okant',
    kod,
    text: meddelande ? `Synken stannade: ${meddelande}` : 'Synken stannade av okänd anledning.',
  };
}

/**
 * Väntetid innan nästa försök efter ett misslyckande, i millisekunder.
 *
 * Tre täta försök, sedan noll — då tar den periodiska synken över. Ett fel i
 * data eller rättigheter försöks inte om alls i förtid: samma rad avvisas
 * likadant om fem sekunder, och varje försök är ett anrop till ingen nytta.
 *
 * @param {number} misslyckanden antal misslyckanden i följd, från 1
 * @param {Felklass} typ
 * @returns {number} 0 betyder inget förtida försök
 */
export function vantetid(misslyckanden, typ) {
  if (typ === 'data' || typ === 'rattighet' || typ === 'session') return 0;
  const steg = [5_000, 15_000, 45_000];
  return steg[misslyckanden - 1] ?? 0;
}
