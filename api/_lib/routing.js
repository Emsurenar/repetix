// Vilken leverantör och modell ett anrop ska gå till.
//
// Egen modul, och en ren funktion, av två skäl. Regeln kombinerar fyra källor
// — begäran, användarens sparade val, brytaren och nyckelläget — och rätt
// ordning mellan dem är inte självklar av att läsa koden; den behöver provas.
// Och den behöver provas utan databas, annars provas den inte alls.
//
// Kontraktet står i docs/api-contract.md under "Lätta funktioner".

/**
 * Funktioner som får köras på den svagare gratismodellen.
 *
 * Båda sorterar in i fack, och ett missat förslag kostar ett klick att rätta.
 * Listan är avsiktligt kort och sluten. `answer` ligger utanför trots att den
 * är minst lika billig: den betygsätter användarens svar och matar
 * schemaläggningen, så ett sämre omdöme där förskjuter repetitionerna i veckor
 * i stället för att kosta ett klick.
 */
const LATTA_FUNKTIONER = new Set(['autofolder', 'sort']);

/** Leverantören de lätta funktionerna går till när brytaren är på. */
export const LATT_LEVERANTOR = 'google';

/**
 * Modellen skrivs ut och hämtas aldrig ur leverantörens standard.
 *
 * Googles standard är gemini-3-pro, som togs bort från gratisnivån. Att luta
 * sig mot standarden hade alltså tyst börjat kosta pengar — raka motsatsen till
 * vad brytaren betyder för den som slog på den.
 */
export const LATT_MODELL = 'gemini-3-flash';

/** Leverantören som gäller när användaren aldrig valt någon. */
const STANDARD_LEVERANTOR = 'anthropic';

/**
 * Kan det här anropet över huvud taget routas till gratismodellen?
 *
 * Skild från valjMal eftersom svaret avgör om det är värt en extra fråga till
 * databasen efter nyckelläget. För alla andra anrop kostar routningen därmed
 * ingenting.
 *
 * @param {object} arg
 * @param {string} arg.feature
 * @param {string} [arg.begardProvider] leverantör som begäran kräver
 * @param {string} [arg.begardModell] modell som begäran kräver
 * @param {boolean} [arg.lattFriPa] användarens brytare
 * @returns {boolean}
 */
export function arLattKandidat({ feature, begardProvider, begardModell, lattFriPa }) {
  if (!lattFriPa) return false;
  // Ett anropsställe som kräver en viss leverantör eller modell har ett skäl,
  // och en inställning ska inte kunna åsidosätta ett krav. Modellen räknas här
  // av ett handfastare skäl också: ett id ur en annan katalog hade följt med
  // till Google och gett ett obegripligt fel från fel leverantör.
  if (begardProvider || begardModell) return false;
  return LATTA_FUNKTIONER.has(feature);
}

/**
 * Vilken leverantör och modell gäller för anropet?
 *
 * Modellen `null` betyder att leverantörens egen standard ska användas.
 *
 * @param {object} arg
 * @param {string} arg.feature
 * @param {string} [arg.begardProvider]
 * @param {string} [arg.begardModell]
 * @param {string} [arg.sparadProvider]
 * @param {string} [arg.sparadModell]
 * @param {boolean} [arg.lattFriPa]
 * @param {boolean} [arg.harGoogleNyckel]
 * @returns {{provider: string, model: string|null}}
 */
export function valjMal({
  feature,
  begardProvider,
  begardModell,
  sparadProvider,
  sparadModell,
  lattFriPa,
  harGoogleNyckel,
}) {
  // Reträtten finns för dagen nyckeln tas bort från en annan enhet. Utan den
  // slutar mappgissningen och sorteringen fungera medan allt annat rullar
  // vidare, och `no_key` från just två funktioner ser ut som en bugg.
  if (harGoogleNyckel && arLattKandidat({ feature, begardProvider, begardModell, lattFriPa })) {
    return { provider: LATT_LEVERANTOR, model: LATT_MODELL };
  }

  const provider = begardProvider || sparadProvider || STANDARD_LEVERANTOR;
  // Byter begäran leverantör hör det sparade id:t hemma i en annan katalog och
  // hade bara gett ett obegripligt fel från leverantören.
  const sparadGaller = provider === sparadProvider ? sparadModell : null;
  return { provider, model: begardModell || sparadGaller || null };
}
