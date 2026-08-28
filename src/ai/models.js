// Leverantörer och modellkatalog.
//
// Katalogen ligger i en egen modul, utan beroenden åt något håll, eftersom två
// olika lager behöver samma sanning: inställningsvyn fyller sina väljare med
// den, och klientlagret behöver kunna falla tillbaka på en standardmodell när
// användaren inte valt någon. Att duplicera listan på båda ställena skulle
// garantera att de glider isär.
//
// Listan är en bekvämlighet, aldrig en begränsning. Leverantörerna släpper nya
// modeller betydligt oftare än den här appen uppdateras, så varje leverantör
// får också ta emot ett fritt modell-id från användaren. Därför validerar vi
// aldrig ett modell-id mot katalogen — bara leverantörsnamnet, som adaptrarna
// på serversidan faktiskt måste känna igen.

/**
 * @typedef {object} Leverantor
 * @property {string} id        Skickas till servern som `provider`.
 * @property {string} label     Visas i gränssnittet.
 * @property {string[]} models  Kända modell-id. Får vara tom.
 * @property {string} defaultModel  Används när användaren inte valt något.
 * @property {string} placeholder   Exempel i fritextfältet för eget modell-id.
 */

/** @type {Leverantor[]} */
export const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-fable-5',
    ],
    defaultModel: 'claude-opus-5',
    placeholder: 'claude-opus-5',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5'],
    defaultModel: 'gpt-5.1',
    placeholder: 'gpt-5.1',
  },
  {
    id: 'google',
    label: 'Google',
    models: ['gemini-3-pro', 'gemini-3-flash'],
    defaultModel: 'gemini-3-pro',
    placeholder: 'gemini-3-pro',
  },
  {
    // OpenRouter förmedlar vidare till hundratals modeller hos andra
    // leverantörer. En katalog vore meningslös och inaktuell inom en vecka, så
    // här är fritext det enda rimliga. Formatet är leverantör/modell.
    id: 'openrouter',
    label: 'OpenRouter',
    models: [],
    defaultModel: '',
    placeholder: 'anthropic/claude-opus-5',
  },
];

/** Leverantören som används när användaren inte valt någon. */
export const DEFAULT_PROVIDER = 'anthropic';

/** Modellen som används när användaren inte valt någon. */
export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Slår upp en leverantör på id.
 *
 * @param {string} id
 * @returns {Leverantor|null}
 */
export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Känner servern igen leverantören? Används innan vi sparar ett val, så att en
 * gammal eller manipulerad inställning inte tyst blir ett anrop som ändå
 * misslyckas.
 *
 * @param {string} id
 */
export function isKnownProvider(id) {
  return PROVIDERS.some((p) => p.id === id);
}

/**
 * Kända modell-id för en leverantör. Tom lista betyder att leverantören bara
 * tar fritext, inte att den saknar modeller.
 *
 * @param {string} providerId
 * @returns {string[]}
 */
export function modelsFor(providerId) {
  return getProvider(providerId)?.models ?? [];
}

/**
 * Standardmodellen för en leverantör. Tom sträng betyder att användaren måste
 * skriva in ett modell-id själv.
 *
 * @param {string} providerId
 * @returns {string}
 */
export function defaultModelFor(providerId) {
  return getProvider(providerId)?.defaultModel ?? '';
}

/**
 * Namnet som visas för användaren. Faller tillbaka på id:t, så att en
 * leverantör som lagts till på serversidan men inte här ändå går att läsa.
 *
 * @param {string} providerId
 * @returns {string}
 */
export function providerLabel(providerId) {
  return getProvider(providerId)?.label ?? providerId;
}
