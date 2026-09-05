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
 * @property {Nyckelguide} nyckelguide  Hur man skaffar en nyckel hos leverantören.
 */

/**
 * Vägen till en nyckel, steg för steg, med länkarna som tar en dit.
 *
 * Guiden ligger i katalogen och inte i inställningsvyn av samma skäl som
 * modellistan: den beskriver leverantören, och det som beskriver
 * leverantören ska bo på ett ställe. Stegen är skrivna för någon som aldrig
 * sett en utvecklarkonsol — vad man ska göra, i den ordning man gör det, och
 * det som brukar gå fel (inget saldo, nyckeln som bara visas en gång).
 *
 * @typedef {object} Nyckelguide
 * @property {string[]} steg       I den ordning man gör dem.
 * @property {{label: string, url: string}[]} lankar  Öppnas i ny flik.
 * @property {string} format       Hur nyckeln ser ut, så att man vet att man kopierat rätt sak.
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
    nyckelguide: {
      steg: [
        'Skapa ett konto på console.anthropic.com, eller logga in med det du har.',
        'Lägg in ett saldo under Billing. Nyckeln svarar inte utan pengar på kontot, och fem dollar räcker till hundratals kort.',
        'Öppna API keys, tryck Create Key och döp den till Repetix.',
        'Kopiera nyckeln medan den visas — den går inte att se igen — och klistra in den i fältet ovan.',
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://console.anthropic.com/settings/keys' },
        { label: 'Fyll på saldo', url: 'https://console.anthropic.com/settings/billing' },
      ],
      format: 'Nyckeln börjar med sk-ant-.',
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5'],
    defaultModel: 'gpt-5.1',
    placeholder: 'gpt-5.1',
    nyckelguide: {
      steg: [
        'Skapa ett konto på platform.openai.com. Det är inte samma sak som ChatGPT Plus — API:et betalas för sig.',
        'Lägg in ett saldo under Billing. Utan saldo avvisas varje anrop.',
        'Öppna API keys och tryck Create new secret key.',
        'Kopiera nyckeln medan den visas — den går inte att se igen — och klistra in den i fältet ovan.',
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://platform.openai.com/api-keys' },
        { label: 'Fyll på saldo', url: 'https://platform.openai.com/settings/organization/billing/overview' },
      ],
      format: 'Nyckeln börjar med sk-.',
    },
  },
  {
    id: 'google',
    label: 'Google',
    models: ['gemini-3-pro', 'gemini-3-flash'],
    defaultModel: 'gemini-3-pro',
    placeholder: 'gemini-3-pro',
    nyckelguide: {
      steg: [
        'Logga in med ditt Google-konto på Google AI Studio.',
        'Tryck Create API key. Ett projekt skapas åt dig om du inte har något.',
        'Kopiera nyckeln och klistra in den i fältet ovan.',
        'Gratisnivån räcker långt för en person. Vill du ha högre gränser kopplar du fakturering till projektet i Google Cloud.',
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://aistudio.google.com/apikey' },
        { label: 'Priser och gränser', url: 'https://ai.google.dev/pricing' },
      ],
      format: 'Nyckeln börjar med AIza.',
    },
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
    nyckelguide: {
      steg: [
        'Skapa ett konto på openrouter.ai — det går med Google eller GitHub.',
        'Lägg in ett saldo under Credits. En del modeller är gratis, de flesta drar av saldot.',
        'Öppna Keys och tryck Create Key.',
        'Kopiera nyckeln och klistra in den i fältet ovan. Skriv sedan modellens id på formen leverantör/modell, till exempel anthropic/claude-opus-5.',
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://openrouter.ai/settings/keys' },
        { label: 'Fyll på saldo', url: 'https://openrouter.ai/settings/credits' },
        { label: 'Modeller', url: 'https://openrouter.ai/models' },
      ],
      format: 'Nyckeln börjar med sk-or-.',
    },
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
 * Guiden för att skaffa en nyckel hos leverantören, eller null.
 *
 * @param {string} providerId
 * @returns {Nyckelguide|null}
 */
export function nyckelguideFor(providerId) {
  return getProvider(providerId)?.nyckelguide ?? null;
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
