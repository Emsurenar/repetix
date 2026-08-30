// Inställningsvyn.
//
// Två sorters inställningar bor här, och de sparas medvetet på olika sätt:
//
//   Leverantör och modell är vanliga preferenser. De skrivs direkt till
//   tabellen user_settings via supabase-klienten, där radnivåsäkerheten redan
//   sköter isoleringen. Ingen serverfunktion behövs för något som användaren
//   ändå får läsa och skriva själv.
//
//   API-nyckeln går aldrig den vägen. Den skickas till POST /api/ai-key, som
//   verifierar den mot leverantören och lagrar den krypterad. Klienten får
//   sedan bara tillbaka en ledtråd på några tecken. Poängen är att en
//   XSS-bugg här inte ska kunna läsa ut nyckeln — därför skrivs den varken
//   till user_settings, till localStorage eller till någon modulvariabel som
//   överlever anropet.

import { signOutAndClear } from '../app/cloud.js';
import {
  PROVIDERS,
  defaultModelFor,
  getProvider,
  isKnownProvider,
  modelsFor,
  providerLabel,
} from '../ai/models.js';
import { S } from '../core/state.js';
import { cloudConfigured, deleteAccount, getUser, getUserId, onAuthChange, supabase } from '../core/supabase.js';
import { getLocalDateString } from '../domain/stats.js';
import { budgetLage, summera } from '../domain/usage.js';
import { openAuth } from './auth.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { renderLibrary } from './library.js';
import { showConfirmModal } from './modals.js';
import { showToast } from './toast.js';
import { renderSidebar } from './modals-wiring.js';
import { onViewChange, switchView } from './router.js';

/** Värdet i modellväljaren som betyder "jag skriver in id:t själv". */
const CUSTOM_MODEL = '__eget__';

const el = (id) => document.getElementById(id);

/**
 * Nyckelstatus per leverantör, som den såg ut vid senaste hämtningen från
 * GET /api/ai-key. Innehåller aldrig någon nyckel, bara ledtråd och tidpunkt.
 * @type {Map<string, {hint: string, lastVerified: string|null}>}
 */
const keyStatus = new Map();

/** Sant medan ett anrop pågår, så att dubbelklick inte skickar två gånger. */
let busy = false;

/** Så länge "Sparat" står kvar innan det tonar bort. */
const KVITTO_MS = 2500;

/** @type {ReturnType<typeof setTimeout>|undefined} */
let kvittoTimer;

// ---------------------------------------------------------------------------
// Felmeddelanden
// ---------------------------------------------------------------------------

/**
 * Kontraktets felkoder översatta till något användaren kan agera på. Servern
 * skickar visserligen med en svensk text, men den beskriver felet ur serverns
 * synvinkel; här vet vi dessutom vad användaren just försökte göra.
 *
 * @param {string} code
 * @returns {string|null} null när koden är okänd, så att serverns egen text får gälla.
 */
function felText(code) {
  const map = {
    unauthorized: 'Din inloggning har gått ut. Logga in igen och försök på nytt.',
    no_key: 'Ingen nyckel finns sparad för den här leverantören.',
    invalid_key: 'Leverantören avvisade nyckeln. Kontrollera att hela nyckeln kom med.',
    rate_limited: 'Leverantören stoppade tillfälligt fler försök. Vänta en stund och prova igen.',
    provider_error: 'Leverantören svarade med ett fel. Prova igen om en liten stund.',
    timeout: 'Leverantören svarade inte i tid. Prova igen.',
    bad_request: 'Servern förstod inte begäran. Kontrollera leverantör och modell.',
    natverk: 'Ingen kontakt med servern. Kontrollera din uppkoppling.',
  };
  return map[code] ?? null;
}

/**
 * Koder där serverns egen text säger något klienten omöjligt kan veta: vilken
 * statuskod leverantören faktiskt svarade med.
 *
 * Den texten kastades tidigare bort så fort felText kände igen koden, och det
 * gjorde felet omöjligt att spåra. "Leverantören svarade med ett fel" är samma
 * mening oavsett om krediterna tagit slut (429), om leverantören ligger nere
 * (500) eller om vi ringer fel adress (404) — och serverfunktionerna loggar
 * med flit ingenting, eftersom en logg är det enklaste sättet att av misstag
 * skriva ut en användares nyckel. Utan statuskoden i meddelandet finns alltså
 * ingen kvar någonstans.
 *
 * Serverns beskrivning står först, eftersom den säger vad som hände.
 * Uppmaningen står sist, eftersom den säger vad man gör åt det.
 */
const SERVERN_VET_MER = new Set(['provider_error', 'bad_request']);

export function felmeddelande(code, serverText) {
  const servern = typeof serverText === 'string' ? serverText.trim() : '';

  /* När servern vet mer får den tala till punkt, utan påhängd uppmaning.
   *
   * Här stod tidigare "Prova igen om en liten stund". Det rådet gäller ett
   * avbrott eller en överbelastad leverantör — det gällde inte det fel som tog
   * längst tid att hitta: ett 400 där Anthropic förklarade att nyckeln krävde
   * ett workspace-id. Den begäran hade misslyckats likadant hur många gånger
   * som helst, och rådet skickade användaren i cirklar.
   *
   * För koder där klienten vet mer om SAMMANHANGET — vad användaren just
   * försökte göra — gäller fortfarande klientens text: "din inloggning har
   * gått ut" är mer användbart än serverns "din session gäller inte längre". */
  if (servern && SERVERN_VET_MER.has(code)) return servern;

  // Tom sträng är inte nullish och skulle passera ?? som ett giltigt
  // meddelande — alltså en ruta med ingenting i.
  return felText(code) || servern || 'Något gick fel på servern.';
}

// ---------------------------------------------------------------------------
// Anrop mot serverfunktionerna
// ---------------------------------------------------------------------------

/**
 * Hämtar en färsk Supabase-token. Den läses vid varje anrop i stället för att
 * sparas undan, eftersom klienten förnyar den i bakgrunden och en gammal token
 * skulle ge ett onödigt 401.
 *
 * @returns {Promise<string|null>}
 */
async function accessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * Anropar en av serverfunktionerna med användarens token.
 *
 * Kastar aldrig: varje anropsställe ska ändå visa felet i gränssnittet, så
 * resultatet är alltid `{ ok, data }` eller `{ ok: false, code, error }`.
 *
 * @param {string} path
 * @param {{method?: string, body?: object}} [options]
 */
async function apiFetch(path, options = {}) {
  const token = await accessToken();
  if (!token) {
    return { ok: false, code: 'unauthorized', error: felText('unauthorized') };
  }

  const headers = { Authorization: `Bearer ${token}` };
  if (options.body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Nätverksfel skiljer sig från ett avvisat svar: användaren ska förstå att
    // ingenting nådde fram, inte tro att nyckeln var fel.
    return { ok: false, code: 'natverk', error: felText('natverk') };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Ett svar utan JSON-kropp är i sig inte ett fel för DELETE, så vi låter
    // statuskoden avgöra nedan.
  }

  if (!res.ok) {
    const code = data?.code ?? 'unknown';
    return { ok: false, code, error: felmeddelande(code, data?.error) };
  }
  return { ok: true, data: data ?? {} };
}

// ---------------------------------------------------------------------------
// Läs och skriv user_settings
// ---------------------------------------------------------------------------

/**
 * Läser användarens sparade val. Saknas raden är det inget fel — den skapas
 * först när användaren sparar något.
 *
 * @returns {Promise<{provider: string, model: string, tak: number|null}|null>}
 */
export async function laddaVal() {
  const userId = getUserId();
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from('user_settings')
    .select('ai_provider, ai_model, ai_monthly_budget')
    .eq('user_id', userId)
    .maybeSingle();

  if (!error) return data ? tolkaVal(data) : null;

  /* PostgREST avvisar HELA frågan (42703, okänd kolumn) om ai_monthly_budget
   * inte finns än — migrationen som lägger till den kan vara okörd. Utan den
   * här reträtten föll svaret bort, och uppdatera() tolkade det som "inget
   * sparat": användarens riktiga leverantör och modell ersattes tyst av
   * standardvärden i gränssnittet, och ett tryck på Spara skrev över dem på
   * riktigt i databasen. Att förlora taket i det läget är ofarligt — det
   * går bara inte att visa förrän kolumnen finns. Att gissa bort leverantören
   * är det inte. */
  const gammal = await supabase
    .from('user_settings')
    .select('ai_provider, ai_model')
    .eq('user_id', userId)
    .maybeSingle();

  if (gammal.error || !gammal.data) return null;
  return { ...tolkaVal(gammal.data), tak: null };
}

function tolkaVal(data) {
  return {
    provider: data.ai_provider ?? '',
    model: data.ai_model ?? '',
    tak: data.ai_monthly_budget ?? null,
  };
}

/**
 * Sparar leverantör och modell.
 *
 * user_id skickas med eftersom kolumnen är primärnyckel utan default. Det är
 * ofarligt till skillnad från i API-anropen: radnivåsäkerheten jämför värdet
 * mot auth.uid() och avvisar varje försök att skriva på någon annans rad.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sparaVal(provider, model) {
  const userId = getUserId();
  if (!supabase || !userId) return { ok: false, error: 'Du är inte inloggad.' };
  if (!isKnownProvider(provider)) return { ok: false, error: 'Okänd leverantör.' };

  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      ai_provider: provider,
      // Tom modell lagras som null, så att servern kan falla tillbaka på sin
      // egen standard i stället för att skicka en tom sträng till leverantören.
      ai_model: model || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    return { ok: false, error: 'Kunde inte spara valet. Kontrollera din uppkoppling.' };
  }
  return { ok: true };
}

/** Sparar månadstaket. Tomt fält betyder inget tak. */
async function sparaTak(varde) {
  const userId = getUserId();
  if (!supabase || !userId) return { ok: false, error: 'Du är inte inloggad.' };

  const tal = varde === '' ? null : Number(varde);
  if (tal !== null && (!Number.isFinite(tal) || tal < 0)) {
    return { ok: false, error: 'Taket måste vara ett positivt tal.' };
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: userId, ai_monthly_budget: tal, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  return error ? { ok: false, error: 'Kunde inte spara taket.' } : { ok: true };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Visar ett resultat för användaren.
 *
 * @param {string} text
 * @param {'ok'|'fel'|'info'} [tone]
 */
function visaMeddelande(text, tone = 'info') {
  const node = el('settings-message');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = !text;
}

function doljMeddelande() {
  const node = el('settings-message');
  if (node) node.hidden = true;
}

/**
 * Formaterar en tidsstämpel från servern. Ett ogiltigt datum får hellre
 * utebli än visas som "Invalid Date".
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function formateraTid(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* Leverantören är fyra brickor, inte en meny: alla alternativ syns samtidigt,
 * och det man valt går att jämföra med det man inte valt. Läsning och skrivning
 * går genom de tre hjälparna här, så att resten av filen slipper veta att
 * kontrollen är fyra radioknappar. */
function valdLeverantor() {
  return document.querySelector('#settings-provider input:checked')?.value ?? PROVIDERS[0].id;
}

function valjLeverantor(id) {
  const input = document.querySelector(`#settings-provider input[value="${id}"]`);
  if (input) input.checked = true;
}

function sattLeverantorLast(last) {
  document.querySelectorAll('#settings-provider input').forEach((i) => {
    i.disabled = last;
  });
}

/**
 * Leverantörernas märken, ritade som inline-SVG.
 *
 * De ligger här och inte i models.js, eftersom katalogen är delad med
 * anropslagret och inte ska känna till hur något ser ut. Tre saker gör dem
 * till märken och inte bilder: de är ritade i currentColor, så att en bricka
 * kan färga sitt eget märke efter sitt tillstånd; de kostar inget nätverksanrop
 * och kan därför inte utebli offline; och de bär samma streckspråk som resten
 * av appens ikoner — samma tjocklek, samma runda ändar.
 *
 * En leverantör utan märke ritas som enbart sitt namn. Brickan faller alltså
 * inte sönder den dag katalogen får en femte rad.
 */
/* Leverantörernas egna märken.
 *
 * Vektordata från Simple Icons (CC0). Märkena ritades tidigare för hand, och
 * två av fyra blev approximationer: OpenAI:s knut var en förenkling och
 * OpenRouter hade ett påhittat glyf. Ett märke som inte är leverantörens eget
 * hjälper ingen att känna igen den.
 *
 * De är fyllda former, inte streckteckningar som appens övriga ikoner. Det är
 * med flit: en bricka visar ett varumärke, inte en handling, och ett märke som
 * ritats om i en främmande penna slutar vara märket.
 */
const PROVIDER_MARKS = {
  anthropic: `<path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/>`,
  openai: `<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>`,
  google: `<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>`,
  openrouter: `<path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z"/>`,
};

/**
 * Märket som en färdig svg-tagg, eller tom sträng för en okänd leverantör.
 *
 * @param {string} id
 * @returns {string}
 */
function providerMark(id) {
  const mark = PROVIDER_MARKS[id];
  if (!mark) return '';
  return `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${mark}</svg>`;
}

/** Fyller leverantörsväljaren. Görs en gång, listan är statisk. */
function renderaLeverantorer() {
  const grupp = el('settings-provider');
  if (!grupp) return;
  // Etiketten omsluter både radioknappen och namnet, så att namnet blir
  // knappens tillgängliga namn. Ett eget aria-label ovanpå det hade bara gett
  // skärmläsaren samma ord två gånger.
  grupp.innerHTML = PROVIDERS.map(
    (p, i) => `<label class="provider-option">
        <input type="radio" name="settings-provider" value="${p.id}" ${i === 0 ? 'checked' : ''}>
        <span class="provider-face">${providerMark(p.id)}<span class="provider-name">${p.label}</span></span>
      </label>`
  ).join('');
}

/**
 * Fyller modellväljaren för vald leverantör och ställer in fritextfältet.
 *
 * @param {string} providerId
 * @param {string} [valdModell] modell som ska förväljas, om någon
 */
function renderaModeller(providerId, valdModell = '') {
  const select = el('settings-model');
  const customField = el('settings-model-custom-field');
  const customInput = el('settings-model-custom');
  if (!select || !customField || !customInput) return;

  const kanda = modelsFor(providerId);
  select.innerHTML = '';
  for (const m of kanda) {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m;
    select.appendChild(option);
  }

  // Sista alternativet finns alltid. Det är hela anledningen till att
  // katalogen får vara ofullständig utan att blockera användaren.
  const eget = document.createElement('option');
  eget.value = CUSTOM_MODEL;
  eget.textContent = kanda.length ? 'Eget modell-id...' : 'Eget modell-id';
  select.appendChild(eget);

  const finnsIListan = valdModell && kanda.includes(valdModell);
  select.value = finnsIListan ? valdModell : CUSTOM_MODEL;

  // En leverantör utan katalog, eller ett sparat id vi inte känner igen,
  // hamnar direkt i fritextfältet med värdet kvar.
  customInput.placeholder = getProvider(providerId)?.placeholder ?? '';
  customInput.value = finnsIListan ? '' : valdModell;
  customField.hidden = finnsIListan;
}

/**
 * Avgör om ett val ska sparas, och vilken modell det i så fall är.
 *
 * Funktionen finns för att beslutet har fler kanter än det ser ut att ha, och
 * alla dyker upp när sparaknappen är borta. Utan knapp finns inget ögonblick
 * där användaren säger "nu": varje ändring måste själv avgöra om den är ett
 * färdigt val. Ett tomt fritextfält är det inte — det är någon som just valt
 * "Eget modell-id" och ännu inte hunnit skriva, och att spara tomt där hade
 * tagit bort modellen ur kontot medan användaren trodde att hen lade till en.
 *
 * @param {{selectValue: string, customValue: string}} lage
 * @returns {{spara: boolean, model: string}}
 */
export function valetSomSkaSparas({ selectValue, customValue }) {
  if (selectValue !== CUSTOM_MODEL) {
    const model = (selectValue ?? '').trim();
    return { spara: Boolean(model), model };
  }
  const model = (customValue ?? '').trim();
  return { spara: Boolean(model), model };
}

/** Modell-id:t som användaren just nu har valt, oavsett hur det valdes. */
function valdModell() {
  const select = el('settings-model');
  if (!select) return '';
  if (select.value === CUSTOM_MODEL) return (el('settings-model-custom')?.value ?? '').trim();
  return select.value;
}

/** Ritar om nyckelstatusen för vald leverantör. */
function renderaNyckelstatus() {
  const statusNode = el('settings-key-status');
  const ovrigaNode = el('settings-key-others');
  const deleteBtn = el('btn-settings-delete-key');
  if (!statusNode || !ovrigaNode || !deleteBtn) return;

  const providerId = valdLeverantor();
  const status = keyStatus.get(providerId);

  if (!getUserId()) {
    // Statusraden rapporterar läget. Vad man gör åt det står i notisen överst,
    // där knappen som gör det också sitter.
    statusNode.textContent = 'Ingen nyckel. Kräver ett konto.';
    statusNode.dataset.tone = 'info';
    ovrigaNode.hidden = true;
    deleteBtn.hidden = true;
    return;
  }

  if (status) {
    const tid = formateraTid(status.lastVerified);
    statusNode.textContent = tid
      ? `Nyckel sparad: ${status.hint}. Senast verifierad ${tid}.`
      : `Nyckel sparad: ${status.hint}. Ännu inte verifierad.`;
    statusNode.dataset.tone = 'ok';
  } else {
    statusNode.textContent = `Ingen nyckel sparad för ${providerLabel(providerId)}.`;
    statusNode.dataset.tone = 'info';
  }
  deleteBtn.hidden = !status;

  // Att se vilka andra leverantörer som redan har en nyckel besvarar frågan
  // "har jag lagt in den här förut?" utan att användaren behöver klicka runt.
  const ovriga = [...keyStatus.keys()]
    .filter((id) => id !== providerId)
    .map((id) => providerLabel(id));
  ovrigaNode.textContent = ovriga.length ? `Nycklar finns även för: ${ovriga.join(', ')}.` : '';
  ovrigaNode.hidden = ovriga.length === 0;
}

/**
 * Speglar inloggningsläget i vyn.
 *
 * Utan konto finns ingen server att lagra nyckeln hos, och utan konfiguration
 * finns inte ens en inloggning. Båda fallen ska förklaras, inte kraschas på.
 */
function renderaInloggningslage() {
  const notice = el('settings-signed-out');
  const noticeText = el('settings-notice-text');
  const signInBtn = el('btn-settings-signin');
  const emailNode = el('settings-account-email');
  const signOutBtn = el('btn-settings-signout');
  const deleteRow = el('settings-delete-row');
  if (!notice) return;

  const inloggad = Boolean(getUserId());
  // Utan konto finns ingenting att radera, och raden vore bara skrämmande.
  if (deleteRow) deleteRow.hidden = !inloggad;

  if (noticeText && signInBtn) {
    if (!cloudConfigured) {
      noticeText.textContent =
        'Installationen saknar molnkonfiguration. AI-inställningarna går inte att använda; appen fungerar i övrigt lokalt.';
      signInBtn.hidden = true;
    } else {
      noticeText.textContent =
        'AI kräver ett konto. Nyckeln knyts till kontot och följer med mellan dina enheter.';
      signInBtn.hidden = false;
    }
  }
  notice.hidden = inloggad;

  // Kontrollerna stängs av i stället för att döljas, så att användaren ser vad
  // som väntar efter inloggningen.
  for (const id of [
    'settings-model',
    'settings-model-custom',
    'settings-api-key',
    'btn-settings-save-key',
    'btn-settings-delete-key',
  ]) {
    const node = el(id);
    if (node) node.disabled = !inloggad;
  }
  sattLeverantorLast(!inloggad);

  if (emailNode) {
    emailNode.textContent = inloggad
      ? (getUser()?.email ?? 'Inloggad')
      : 'Du är inte inloggad. Appen kör mot lokal lagring.';
  }
  if (signOutBtn) signOutBtn.hidden = !inloggad;
}

// ---------------------------------------------------------------------------
// Hämtning
// ---------------------------------------------------------------------------

/** Läser in val och nyckelstatus. Anropas när vyn öppnas och vid inloggning. */
async function uppdatera() {
  renderaInloggningslage();

  if (!getUserId()) {
    // Utan konto finns inget sparat val att läsa. Vi visar leverantörens
    // standardmodell så att vyn ser ut som den kommer att göra efter
    // inloggning, i stället för att öppna fritextfältet i onödan.
    keyStatus.clear();
    const providerId = valdLeverantor();
    renderaModeller(providerId, defaultModelFor(providerId));
    renderaNyckelstatus();
    return;
  }

  const val = await laddaVal();
  valjLeverantor(isKnownProvider(val?.provider) ? val.provider : PROVIDERS[0].id);
  const providerId = valdLeverantor();
  renderaModeller(providerId, val?.model || defaultModelFor(providerId));

  await laddaNyckelstatus();
  await renderaAnvandning();
}

/** Hämtar vilka leverantörer som har en nyckel. Svaret bär aldrig nyckeln. */
async function laddaNyckelstatus() {
  const statusNode = el('settings-key-status');
  if (statusNode) {
    statusNode.textContent = 'Hämtar status...';
    statusNode.dataset.tone = 'info';
  }

  const res = await apiFetch('/api/ai-key');
  keyStatus.clear();
  if (!res.ok) {
    if (statusNode) {
      statusNode.textContent = `Kunde inte hämta nyckelstatus. ${res.error}`;
      statusNode.dataset.tone = 'fel';
    }
    const deleteBtn = el('btn-settings-delete-key');
    if (deleteBtn) deleteBtn.hidden = true;
    return;
  }

  for (const rad of res.data.providers ?? []) {
    if (!rad?.provider) continue;
    keyStatus.set(rad.provider, {
      hint: rad.hint ?? 'okänd',
      lastVerified: rad.lastVerified ?? null,
    });
  }
  renderaNyckelstatus();
}

/** Namnen på funktionerna, för panelen. Okända värden visas som de står. */
const FUNKTIONSNAMN = {
  topic: 'Kort ur ämne eller text',
  diary: 'Kort ur dagbok',
  regenerate: 'Gör om kort',
  sort: 'Sortering',
  autofolder: 'Välj mapp',
  answer: 'Generera svar',
  summary: 'Sammanfattning',
  suggest: 'Föreslå kort',
  /* Förklaring och fördjupning är två olika saker och får inte heta samma:
   * förklaringen beställs mitt i en repetition och försvinner, fördjupningen
   * sparas på kortet. Slogs de ihop i panelen gick det inte att se vilken av
   * dem som kostade. Se src/ai/fordjupning.js. */
  explain: 'Förklaring under repetition',
  fordjupning: 'Fördjupning på kort',
  testquestion: 'Testfråga',
  tutor: 'Handledare',
};

/* Två decimaler räcker och en tredje ljuger: ett enskilt anrop kan kosta mindre
 * än en cent, men det är månadssumman panelen finns för. */
const dollar = (n) => `$${n.toFixed(2)}`;

/* Varningen hör hemma där man ser den. Panelen i inställningarna öppnar man
 * sällan; sidopanelen står framme hela tiden, och det är där appen redan säger
 * "Lokalt läge" och "Kunde inte synka". */
function visaBudgetvarning(total, tak) {
  const node = el('budget-status');
  if (!node) return;
  const lage = budgetLage(total, tak);
  node.hidden = lage === 'ok';
  // En dold rad behöver ingen text. Det är också nödvändigt: utan tak (det
  // vanliga läget — de flesta sätter aldrig ett) är `tak` null, och lage blir
  // "ok" innan det finns något belopp att formatera.
  if (lage === 'ok') return;

  node.dataset.state = lage === 'over' ? 'error' : 'warn';
  node.textContent =
    lage === 'over'
      ? `Månadstaket passerat: ${dollar(total)} av ${dollar(tak)}`
      : `${dollar(total)} av månadstaket ${dollar(tak)}`;
}

/**
 * Hämtar användarens val och månadens ai_usage-rader.
 *
 * Delas av renderaAnvandning (panelen i Inställningar) och
 * uppdateraBudgetvarning (sidopanelens statusrad), så att frågan mot
 * ai_usage bara finns skriven på ett ställe.
 *
 * @returns {Promise<{val: object|null, data: Array<object>|null, error: object|null, idag: string, manadsstart: string}>}
 */
async function hamtaManadensAnvandning() {
  const val = await laddaVal();

  const idag = getLocalDateString();
  const manadsstart = `${idag.slice(0, 7)}-01`;
  // Ingen "Z" här: manadsstart är ett lokalt kalenderdatum. Skrivs den ut som
  // UTC-midnatt hamnar gränsen fel med tidszonens antal timmar och tappar
  // rader från månadens första timmar. Utan zonbeteckning tolkar Date-parsern
  // strängen som lokal tid, precis som getLocalDateString byggde den.
  const manadsstartIso = new Date(`${manadsstart}T00:00:00`).toISOString();

  const { data, error } = await supabase
    .from('ai_usage')
    .select('model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at')
    .gte('created_at', manadsstartIso)
    .order('created_at', { ascending: false });

  return { val, data, error, idag, manadsstart };
}

/**
 * Uppdaterar sidopanelens budgetvarning.
 *
 * Anropas villkorslöst från auth-lyssnaren i initSettings, även när
 * Inställningar aldrig öppnats — se kommentaren där. Utan konto, eller om
 * frågan misslyckas, döljs raden hellre än att visa ett läge som kan vara fel.
 */
export async function uppdateraBudgetvarning() {
  const node = el('budget-status');
  if (!getUserId()) {
    if (node) node.hidden = true;
    return;
  }

  const { val, data, error, idag, manadsstart } = await hamtaManadensAnvandning();
  if (error) {
    if (node) node.hidden = true;
    return;
  }

  const manad = summera(data, { fran: manadsstart, till: idag });
  visaBudgetvarning(manad.total, val?.tak ?? null);
}

/* "$0.00" påstår att inget kostat något. När ingen modell i loggen har ett
 * pris är sanningen att vi inte VET vad det kostade — samma ärliga-lucka-regel
 * som redan gäller kostnadsberäkningen. Ett streck säger det rakt av i stället
 * för att låtsas ett facit panelen saknar. */
const beloppEllerOkant = (total, okändaModeller) => (total === 0 && okändaModeller ? '–' : dollar(total));

/** Hämtar månadens ai_usage-rader och fyller Användning-panelen. Dold utan konto. */
export async function renderaAnvandning() {
  const sektion = el('settings-usage-section');
  if (!sektion) return;

  const userId = getUserId();
  sektion.hidden = !userId;
  if (!userId) return;

  const { val, data, error, idag, manadsstart } = await hamtaManadensAnvandning();
  el('settings-budget').value = val?.tak ?? '';

  if (error) {
    el('usage-month').textContent = 'Kunde inte läsa';
    // Annars blandas ett aktuellt fel med förra lyckade renderingens siffror —
    // halva panelen hade fortsatt påstå att den fortfarande gällde.
    el('usage-today').textContent = '';
    el('usage-month-tokens').textContent = '';
    el('usage-breakdown-row').hidden = true;
    el('budget-status').hidden = true;
    return;
  }

  const manad = summera(data, { fran: manadsstart, till: idag });
  const dag = summera(data, { fran: idag, till: idag });

  el('usage-month').textContent = beloppEllerOkant(manad.total, manad.okändaModeller);
  el('usage-today').textContent = beloppEllerOkant(dag.total, dag.okändaModeller);
  el('usage-month-tokens').textContent =
    `${manad.tokens.in.toLocaleString('sv-SE')} in · ${manad.tokens.ut.toLocaleString('sv-SE')} ut` +
    (manad.okändaModeller ? ' · någon modell saknar pris' : '');

  const rad = el('usage-breakdown-row');
  const lista = el('usage-breakdown');
  rad.hidden = manad.perFunktion.length === 0;
  lista.innerHTML = '';
  for (const post of manad.perFunktion) {
    const li = document.createElement('li');
    li.className = 'usage-item';
    const namn = document.createElement('span');
    namn.textContent = FUNKTIONSNAMN[post.feature] ?? post.feature;
    const belopp = document.createElement('span');
    belopp.className = 'num';
    belopp.textContent = dollar(post.kostnad);
    li.append(namn, belopp);
    lista.appendChild(li);
  }

  visaBudgetvarning(manad.total, val?.tak ?? null);
}

// ---------------------------------------------------------------------------
// Åtgärder
// ---------------------------------------------------------------------------

/**
 * Låser en knapp under pågående anrop och återställer texten efteråt.
 *
 * @param {HTMLElement|null} btn
 * @param {boolean} pagar
 * @param {string} [text] text att visa medan anropet pågår
 */
function setBusy(btn, pagar, text) {
  busy = pagar;
  if (!btn) return;
  if (pagar) {
    btn.dataset.label = btn.textContent;
    btn.textContent = text ?? 'Ett ögonblick...';
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
  btn.disabled = pagar;
}

/**
 * Kvittot på modellraden.
 *
 * "Sparat" tonar bort av sig själv: det är en bekräftelse, och en bekräftelse
 * som ligger kvar slutar betyda något. Ett fel står kvar tills nästa försök,
 * eftersom det är det enda av lägena som kräver något av användaren.
 *
 * @param {string} text tom sträng rensar kvittot
 * @param {'ok'|'fel'} [tone]
 */
function visaKvitto(text, tone = 'ok') {
  const nod = el('settings-model-receipt');
  if (!nod) return;

  clearTimeout(kvittoTimer);
  nod.textContent = text;
  if (text) nod.dataset.tone = tone;
  else delete nod.dataset.tone;

  if (text && tone === 'ok') {
    kvittoTimer = setTimeout(() => {
      nod.textContent = '';
      delete nod.dataset.tone;
    }, KVITTO_MS);
  }
}

/**
 * Sparar leverantör och modell så fort valet ändras.
 *
 * Sista skrivningen vinner. Ett eget lås per anrop hade kunnat lämna kontot på
 * det näst sista valet om två ändringar följde tätt på varandra, och det valet
 * är inte det användaren ser i väljaren.
 */
async function sparaValetNu() {
  const provider = valdLeverantor();
  const { spara, model } = valetSomSkaSparas({
    selectValue: el('settings-model')?.value ?? '',
    customValue: el('settings-model-custom')?.value ?? '',
  });

  // Tomt fritextfält är inget val ännu. Tyst, eftersom användaren är mitt i
  // en handling och inte har gjort något fel.
  if (!spara) {
    visaKvitto('');
    return;
  }

  const res = await sparaVal(provider, model);
  if (res.ok) visaKvitto('Sparat');
  else visaKvitto(res.error, 'fel');
}

async function onSparaNyckel() {
  if (busy) return;
  const input = el('settings-api-key');
  const nyckel = (input?.value ?? '').trim();
  const provider = valdLeverantor();

  if (!nyckel) {
    visaMeddelande('Klistra in en nyckel först.', 'fel');
    input?.focus();
    return;
  }

  const btn = el('btn-settings-save-key');
  setBusy(btn, true, 'Verifierar...');
  const res = await apiFetch('/api/ai-key', { method: 'POST', body: { provider, key: nyckel } });
  setBusy(btn, false);

  if (!res.ok) {
    visaMeddelande(res.error, 'fel');
    return;
  }

  // Fältet töms direkt. Nyckeln finns nu bara krypterad på servern, och ska
  // inte ligga kvar i en DOM-nod som en skärmdump eller ett tillägg kan läsa.
  if (input) input.value = '';

  // En nyckel för en leverantör som kontot inte är inställt på vore
  // verkningslös, så valet följer med i samma steg.
  const modell = valdModell();
  const valRes = modell ? await sparaVal(provider, modell) : { ok: true };

  const grund = res.data.verified === false
    ? 'Nyckeln sparades, men leverantören hann inte bekräfta den.'
    : 'Nyckeln sparades och verifierades.';
  if (valRes.ok) {
    visaMeddelande(
      modell
        ? `${grund} ${providerLabel(provider)} och ${modell} används nu.`
        : `${grund} Välj en modell och spara valet.`,
      'ok'
    );
  } else {
    visaMeddelande(`${grund} Men valet av leverantör kunde inte sparas: ${valRes.error}`, 'fel');
  }

  await laddaNyckelstatus();
}

async function onTaBortNyckel() {
  if (busy) return;
  const provider = valdLeverantor();
  const ok = await showConfirmModal(
    'Ta bort nyckeln?',
    `Nyckeln för ${providerLabel(provider)} raderas från servern. AI-funktionerna slutar fungera tills du lägger in en ny.`,
    'Ta bort',
    true
  );
  if (!ok) return;

  const btn = el('btn-settings-delete-key');
  setBusy(btn, true, 'Tar bort...');
  const res = await apiFetch(`/api/ai-key?provider=${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
  setBusy(btn, false);

  if (!res.ok) {
    visaMeddelande(res.error, 'fel');
    return;
  }
  visaMeddelande(`Nyckeln för ${providerLabel(provider)} är borttagen.`, 'ok');
  await laddaNyckelstatus();
}

// ---------------------------------------------------------------------------
// Navigering
// ---------------------------------------------------------------------------

/**
 * Visar inställningsvyn.
 *
 * Vyn ligger avsiktligt utanför switchView: routern har en fast karta över
 * sina vyer, och att bygga ut den skulle beröra filer som andra etapper
 * arbetar i. I stället döljer vi allt annat här, och lyssnar på routern för
 * att stänga oss själva när användaren navigerar vidare.
 */
export function openSettings() {
  const view = el('view-settings');
  if (!view) return;

  S.currentViewName = 'settings';
  for (const node of document.querySelectorAll('.view')) {
    node.classList.add('hidden');
    node.classList.remove('active');
  }
  view.classList.remove('hidden');

  /* På mobil ligger sidopanelen över innehållet och måste stängas, annars ser
   * ett tryck på Inställningar ut att inte göra någonting.
   *
   * Raden gjorde exakt det den skulle förhindra: den tog bort klassen `open`
   * från PANELEN, medan läget bärs av `sidebar-open` på <body>. Den har alltså
   * aldrig stängt något. Vyn går inte genom switchView — den finns inte i
   * routerns vy-tabell — så den kan inte förlita sig på stängningen där. */
  document.body.classList.remove('sidebar-open');

  window.scrollTo(0, 0);
  updateBreadcrumb([
    { label: 'Bibliotek', action: () => { renderLibrary(); switchView('library'); renderSidebar(); } },
    { label: 'Inställningar' },
  ]);
  renderSidebar();

  doljMeddelande();
  void uppdatera();
}

function stangSettings() {
  el('view-settings')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Uppkoppling
// ---------------------------------------------------------------------------

export function initSettings() {
  const view = el('view-settings');
  if (!view) return;

  renderaLeverantorer();

  el('btn-open-settings')?.addEventListener('click', () => openSettings());

  el('btn-settings-back')?.addEventListener('click', () => {
    // Routern äger vybytet; vår egen lyssnare nedan döljer den här vyn.
    window.renderLibrary?.();
    window.switchView?.('library');
  });

  /* Byte av leverantör sparar också.
   *
   * Leverantör och modell är ett enda val i två delar. Sparade bara modellen
   * sig själv skulle halva valet ligga kvar och vänta på ingenting, och
   * väljaren hade visat en modell som kontot inte kände till. */
  el('settings-provider')?.addEventListener('change', () => {
    const providerId = valdLeverantor();
    renderaModeller(providerId, defaultModelFor(providerId));
    renderaNyckelstatus();
    doljMeddelande();
    void sparaValetNu();
  });

  el('settings-model')?.addEventListener('change', () => {
    const customField = el('settings-model-custom-field');
    const isCustom = el('settings-model').value === CUSTOM_MODEL;
    if (customField) customField.hidden = !isCustom;
    if (isCustom) el('settings-model-custom')?.focus();
    doljMeddelande();
    void sparaValetNu();
  });

  /* Fritextfältet sparar när det lämnas, inte medan det skrivs.
   *
   * change utlöses vid blur och bara om värdet ändrats, vilket är precis rätt
   * tillfälle: ett id som sparades per tangenttryck hade lagt varje halvskrivet
   * prefix i kontot, och mellan två tangenttryck är värdet alltid fel. Enter
   * finns för den som skriver klart och förväntar sig att det tog. */
  el('settings-model-custom')?.addEventListener('change', () => void sparaValetNu());
  el('settings-model-custom')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void sparaValetNu();
  });
  el('btn-settings-save-key')?.addEventListener('click', () => void onSparaNyckel());
  el('btn-settings-save-budget')?.addEventListener('click', async () => {
    const res = await sparaTak(el('settings-budget').value.trim());
    if (!res.ok) return visaMeddelande(res.error, 'fel');
    visaMeddelande('Månadstaket sparat.', 'ok');
    void renderaAnvandning();
  });
  el('btn-settings-delete-key')?.addEventListener('click', () => void onTaBortNyckel());
  el('btn-settings-signin')?.addEventListener('click', () => openAuth());
  el('btn-settings-signout')?.addEventListener('click', () => void signOutAndClear());

  /* Kontoraderingen. Två steg med flit: den första frågan säger vad som
   * försvinner, den andra kräver att man skriver sin egen e-post. Ett andra
   * klick är ingen spärr — att skriva något är det, för det går inte att göra
   * av misstag. */
  el('btn-settings-delete-account')?.addEventListener('click', async () => {
    const epost = getUser()?.email;
    if (!epost) return;

    const forstaSteget = await showConfirmModal(
      'Radera kontot?',
      'Alla kortlekar, kort, bilder, repetitioner och din API-nyckel tas bort ur molnet. Det går inte att ångra.',
      'Fortsätt',
      true
    );
    if (!forstaSteget) return;

    // eslint-disable-next-line no-alert
    const skrivet = window.prompt(`Skriv ${epost} för att bekräfta raderingen.`);
    if (skrivet?.trim().toLowerCase() !== epost.toLowerCase()) {
      if (skrivet !== null) showToast('E-posten stämde inte. Kontot är orört.');
      return;
    }

    const knapp = el('btn-settings-delete-account');
    knapp.disabled = true;
    knapp.textContent = 'Raderar...';
    const { error } = await deleteAccount();
    if (error) {
      knapp.disabled = false;
      knapp.textContent = 'Radera kontot';
      showToast(error);
      return;
    }
    // Kontot finns inte längre; den lokala spegeln får inte ligga kvar och
    // låtsas att det gör det.
    await signOutAndClear({ tyst: true });
  });

  // Routern känner inte till den här vyn, så den kan inte dölja den åt oss.
  onViewChange(() => stangSettings());

  // Anropas direkt med nuvarande läge, vilket ger den första renderingen.
  onAuthChange(() => {
    renderaInloggningslage();
    if (!view.classList.contains('hidden')) void uppdatera();

    // Körs VILLKORSLÖST, utanför gissningen ovan om vyn är synlig. #view-settings
    // ligger dold vid appstart, och den gissningen gjorde tidigare att
    // sidopanelens budgetvarning aldrig ritades förrän användaren själv öppnat
    // Inställningar — precis den plats specen avfärdade ("En varning som bara
    // står i Inställningar ser man aldrig") som skäl att lägga den i sidopanelen.
    void uppdateraBudgetvarning();
  });

  window.openSettings = openSettings;
}
