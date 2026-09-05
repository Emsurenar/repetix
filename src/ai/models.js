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
 * leverantören ska bo på ett ställe. Den är skriven för någon som aldrig
 * sett en utvecklarkonsol: vad man behöver ha framme, vad man gör i den
 * ordning man gör det, vad det kostar, och det som brukar gå fel — inget
 * saldo på kontot, en nyckel som bara visas en gång, en halv nyckel som
 * kopierats. Leverantörernas sidor byter namn på sina menyval ibland; stegen
 * säger därför vad man letar efter, inte var knappen står i pixlar.
 *
 * @typedef {object} Nyckelguide
 * @property {string[]} behover    Det man har framme innan man börjar.
 * @property {{rubrik: string, text: string}[]} steg  I den ordning man gör dem.
 * @property {string} kostnad      Vad det kostar och hur det betalas.
 * @property {{rubrik: string, text: string}[]} problem  Det som brukar gå fel, och vad man gör åt det.
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
      behover: [
        'En e-postadress (eller ett Google-konto) att skapa kontot med.',
        'Ett betalkort. Nyckeln fungerar inte förrän det finns pengar på kontot.',
        'Tio minuter.',
      ],
      steg: [
        {
          rubrik: 'Skapa ett konto i Anthropic Console',
          text: 'Gå till console.anthropic.com (länken nedan) och välj Sign up. Det går att logga in med Google eller med e-post och ett engångskod som skickas till dig. Har du redan ett konto hos Claude.ai är det INTE samma sak — Console är för utvecklare och har egen betalning, så du kan behöva skapa ett konto här också.',
        },
        {
          rubrik: 'Lägg in pengar på kontot',
          text: 'Leta upp Billing (ibland Plans & Billing) i menyn. Lägg in ett betalkort och köp ett saldo, minst fem dollar. Anthropic tar betalt i förskott: varje anrop dras från saldot, och tar det slut slutar nyckeln svara tills du fyller på. Fem dollar räcker till flera hundra kort.',
        },
        {
          rubrik: 'Skapa nyckeln',
          text: 'Leta upp API keys under Settings. Tryck Create Key, ge den ett namn så att du känner igen den senare — till exempel Repetix — och bekräfta. Har Console frågat dig om en workspace, välj Default.',
        },
        {
          rubrik: 'Kopiera hela nyckeln direkt',
          text: 'Nyckeln visas EN gång, i en ruta med en kopieringsknapp. Tryck på den, eller markera hela raden från sk-ant- till slutet. Stänger du rutan går den inte att se igen; då skapar du en ny.',
        },
        {
          rubrik: 'Klistra in den här',
          text: 'Gå tillbaka hit, klistra in nyckeln i fältet API-nyckel ovanför och tryck Spara nyckel. Repetix provar nyckeln mot Anthropic direkt och säger till om den inte fungerar.',
        },
      ],
      kostnad:
        'Förskottsbetalt saldo. Ett vanligt AI-anrop i Repetix — ett svar, en sortering, en sammanfattning — kostar en bråkdel av en krona med Claude Sonnet och något mer med Claude Opus. Under Inställningar → Användning ser du vad varje anrop kostat.',
      problem: [
        {
          rubrik: 'Nyckeln sparas men anropen misslyckas',
          text: 'Nästan alltid: inget saldo. Öppna Billing och kontrollera att det finns pengar, och att köpet gått igenom.',
        },
        {
          rubrik: '"Nyckeln avvisades" när du sparar',
          text: 'Kontrollera att hela nyckeln kom med — den börjar med sk-ant- och är lång. Skapades den i en särskild workspace kan den behöva skapas om i workspacen Default.',
        },
        {
          rubrik: 'Du hittar inte API keys',
          text: 'Den ligger under Settings, ofta med en kugghjulsikon. Länken Skapa nyckel nedan går rakt dit när du är inloggad.',
        },
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://console.anthropic.com/settings/keys' },
        { label: 'Fyll på saldo', url: 'https://console.anthropic.com/settings/billing' },
        { label: 'Anthropic Console', url: 'https://console.anthropic.com/' },
      ],
      format: 'Nyckeln börjar med sk-ant- och är ungefär hundra tecken lång.',
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5'],
    defaultModel: 'gpt-5.1',
    placeholder: 'gpt-5.1',
    nyckelguide: {
      behover: [
        'En e-postadress eller ett Google-, Microsoft- eller Apple-konto.',
        'Ett betalkort. API:et betalas för sig, även om du redan betalar för ChatGPT Plus.',
        'Tio minuter.',
      ],
      steg: [
        {
          rubrik: 'Logga in på OpenAI Platform',
          text: 'Gå till platform.openai.com (länken nedan). Har du ett ChatGPT-konto kan du logga in med det; annars väljer du Sign up. Platform är utvecklarsidan och skiljer sig från chatten: prenumerationen på ChatGPT ger INGA anrop här.',
        },
        {
          rubrik: 'Lägg in pengar på kontot',
          text: 'Leta upp Billing i inställningarna (Settings → Billing). Tryck Add payment details, lägg in kortet och köp ett saldo — minst fem dollar. Utan saldo avvisas varje anrop med ett fel om quota. Det kan ta några minuter efter köpet innan saldot syns.',
        },
        {
          rubrik: 'Skapa nyckeln',
          text: 'Leta upp API keys i menyn och tryck Create new secret key. Ge den ett namn, till exempel Repetix. Frågar sidan om projekt eller behörighet: välj förvalet (Default project, All permissions).',
        },
        {
          rubrik: 'Kopiera hela nyckeln direkt',
          text: 'Nyckeln visas EN gång. Tryck på kopieringsknappen i rutan. Stänger du rutan går den inte att se igen — då skapar du en ny och tar bort den gamla.',
        },
        {
          rubrik: 'Klistra in den här',
          text: 'Gå tillbaka hit, klistra in nyckeln i fältet API-nyckel ovanför och tryck Spara nyckel. Repetix provar nyckeln mot OpenAI direkt.',
        },
      ],
      kostnad:
        'Förskottsbetalt saldo, som hos Anthropic. Ett anrop i Repetix kostar en bråkdel av en krona med gpt-5.1-mini och något mer med gpt-5.1. Under Inställningar → Användning ser du tokenåtgången per anrop; OpenAI visar summan i sin egen Usage-sida.',
      problem: [
        {
          rubrik: '"Insufficient quota" eller anropen misslyckas',
          text: 'Inget saldo, eller så har det inte hunnit registreras. Kontrollera Billing. Ett nytt konto kan behöva några minuter efter första köpet.',
        },
        {
          rubrik: 'Nyckeln avvisas när du sparar',
          text: 'Kontrollera att hela nyckeln kom med. Den börjar med sk- (ofta sk-proj-) och är lång. En nyckel som tagits bort på OpenAI-sidan fungerar inte längre.',
        },
        {
          rubrik: 'Du har flera organisationer',
          text: 'Nyckeln hör till den organisation och det projekt den skapades i. Se till att saldot ligger i samma organisation, annars räknas det inte.',
        },
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://platform.openai.com/api-keys' },
        { label: 'Fyll på saldo', url: 'https://platform.openai.com/settings/organization/billing/overview' },
        { label: 'OpenAI Platform', url: 'https://platform.openai.com/' },
      ],
      format: 'Nyckeln börjar med sk- eller sk-proj- och är över hundra tecken lång.',
    },
  },
  {
    id: 'google',
    label: 'Google',
    models: ['gemini-3-pro', 'gemini-3-flash'],
    defaultModel: 'gemini-3-pro',
    placeholder: 'gemini-3-pro',
    nyckelguide: {
      behover: [
        'Ett Google-konto (Gmail räcker).',
        'Inget betalkort. Gratisnivån räcker långt för en person.',
        'Fem minuter.',
      ],
      steg: [
        {
          rubrik: 'Logga in på Google AI Studio',
          text: 'Gå till aistudio.google.com (länken nedan) och logga in med ditt Google-konto. Första gången får du godkänna användarvillkoren.',
        },
        {
          rubrik: 'Skapa nyckeln',
          text: 'Tryck Get API key eller Create API key. Google frågar vilket projekt nyckeln ska höra till — välj att skapa ett nytt om du inte har något; namnet spelar ingen roll. Nyckeln skapas direkt.',
        },
        {
          rubrik: 'Kopiera hela nyckeln',
          text: 'Nyckeln visas i en ruta med en kopieringsknapp. Hos Google går det att se den igen senare på samma sida, så här är det inte lika bråttom.',
        },
        {
          rubrik: 'Klistra in den här',
          text: 'Gå tillbaka hit, klistra in nyckeln i fältet API-nyckel ovanför och tryck Spara nyckel. Repetix provar nyckeln mot Google direkt.',
        },
        {
          rubrik: 'Vill du ha mer: slå på fakturering',
          text: 'Gratisnivån har ett tak på antal anrop per minut och per dag. Räcker det inte kopplar du ett betalkort till projektet i Google Cloud (länken Priser och gränser förklarar hur). Då betalar du per anrop, i efterskott.',
        },
      ],
      kostnad:
        'Gratis upp till dagsgränsen, och gratisnivån får användas för personligt bruk. Med fakturering påslagen kostar ett anrop en bråkdel av en krona med Gemini Flash. Tänk på att Google kan använda det du skickar på gratisnivån för att förbättra sina modeller; på betalnivån gör de det inte.',
      problem: [
        {
          rubrik: 'Anropen fungerar en stund och slutar sedan',
          text: 'Du har nått gratisnivåns gräns för minuten eller dagen. Vänta, eller slå på fakturering.',
        },
        {
          rubrik: '"API key not valid"',
          text: 'Hela nyckeln kom inte med, eller så har den tagits bort i AI Studio. Kopiera om den från sidan API keys.',
        },
        {
          rubrik: 'Du ombeds välja projekt och förstår inte frågan',
          text: 'Ett projekt är bara en mapp hos Google som nyckeln hör till. Välj Create project och gå vidare.',
        },
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://aistudio.google.com/apikey' },
        { label: 'Priser och gränser', url: 'https://ai.google.dev/pricing' },
        { label: 'Google AI Studio', url: 'https://aistudio.google.com/' },
      ],
      format: 'Nyckeln börjar med AIza och är 39 tecken lång.',
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
      behover: [
        'Ett Google- eller GitHub-konto, eller en e-postadress.',
        'Ett betalkort, om du vill använda annat än de kostnadsfria modellerna.',
        'Tio minuter.',
      ],
      steg: [
        {
          rubrik: 'Skapa ett konto på OpenRouter',
          text: 'Gå till openrouter.ai (länken nedan) och välj Sign in. Det går med Google, GitHub eller e-post. OpenRouter är en förmedlare: en nyckel här ger tillgång till modeller från Anthropic, OpenAI, Google och många fler, och du betalar allt på ett ställe.',
        },
        {
          rubrik: 'Lägg in ett saldo',
          text: 'Leta upp Credits i menyn och tryck Add credits. Lägg in kortet och köp ett saldo, gärna fem eller tio dollar. Modeller med tillägget :free kostar ingenting men har begränsningar; alla andra dras från saldot.',
        },
        {
          rubrik: 'Skapa nyckeln',
          text: 'Leta upp Keys (API Keys) och tryck Create Key. Ge den ett namn, till exempel Repetix. Frågar sidan om en spending limit kan du sätta ett tak för hur mycket just den här nyckeln får kosta — ett bra skydd.',
        },
        {
          rubrik: 'Kopiera hela nyckeln direkt',
          text: 'Nyckeln visas EN gång. Tryck på kopieringsknappen. Stänger du rutan går den inte att se igen; då skapar du en ny.',
        },
        {
          rubrik: 'Klistra in den här, och välj modell',
          text: 'Klistra in nyckeln i fältet API-nyckel ovanför och tryck Spara nyckel. Skriv sedan modellens id i fältet Eget modell-id på formen leverantör/modell, till exempel anthropic/claude-opus-5 eller google/gemini-3-flash. Listan Modeller nedan visar alla id:n.',
        },
      ],
      kostnad:
        'Förskottsbetalt saldo. Priset är modellens eget pris plus ett litet påslag från OpenRouter. Fördelen är att en och samma nyckel ger dig alla modeller, och att du kan byta modell i Repetix utan att skaffa en ny nyckel.',
      problem: [
        {
          rubrik: 'Anropen misslyckas med ett fel om credits',
          text: 'Saldot är slut, eller så valde du en modell som inte är gratis utan att ha fyllt på. Kontrollera Credits.',
        },
        {
          rubrik: '"Modellen finns inte"',
          text: 'Modell-id:t är felstavat. Det ska vara på formen leverantör/modell, exakt som det står i listan Modeller — små bokstäver och inget mellanslag.',
        },
        {
          rubrik: 'Nyckeln har slutat fungera',
          text: 'Den kan ha nått sin spending limit, eller ha tagits bort på sidan Keys. Kontrollera där, och skapa en ny om det behövs.',
        },
      ],
      lankar: [
        { label: 'Skapa nyckel', url: 'https://openrouter.ai/settings/keys' },
        { label: 'Fyll på saldo', url: 'https://openrouter.ai/settings/credits' },
        { label: 'Modeller', url: 'https://openrouter.ai/models' },
      ],
      format: 'Nyckeln börjar med sk-or- och är lång.',
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
