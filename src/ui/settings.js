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
import { cloudConfigured, getUser, getUserId, onAuthChange, supabase } from '../core/supabase.js';
import { openAuth } from './auth.js';
import { updateBreadcrumb } from './breadcrumb.js';
import { showConfirmModal } from './modals.js';
import { renderSidebar } from './modals-wiring.js';
import { onViewChange } from './router.js';

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
    return { ok: false, code, error: felText(code) ?? data?.error ?? 'Något gick fel på servern.' };
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
 * @returns {Promise<{provider: string, model: string}|null>}
 */
async function laddaVal() {
  const userId = getUserId();
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from('user_settings')
    .select('ai_provider, ai_model')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return { provider: data.ai_provider ?? '', model: data.ai_model ?? '' };
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
const PROVIDER_MARKS = {
  // Solstrålen: åtta ekrar ut från en öppen mitt.
  anthropic: `<path d="M12 2.5V8M12 16v5.5M2.5 12H8M16 12h5.5M5.3 5.3l3.9 3.9M14.8 14.8l3.9 3.9M18.7 5.3l-3.9 3.9M5.3 18.7l3.9-3.9"/>`,
  // Rosetten: tre kapslar vridna 60 grader ger sex flikar runt en sluten mitt.
  openai: `<rect x="7.9" y="2.6" width="8.2" height="18.8" rx="4.1"/><rect x="7.9" y="2.6" width="8.2" height="18.8" rx="4.1" transform="rotate(60 12 12)"/><rect x="7.9" y="2.6" width="8.2" height="18.8" rx="4.1" transform="rotate(-60 12 12)"/>`,
  // G:et: ringen bryts uppe till höger där tvärslån går in mot mitten.
  google: `<path d="M18.96 7.12A8.5 8.5 0 1 0 20.5 12H12.8"/>`,
  // Växeln: en väg in, flera vidare — vilket är hela tjänsten. Noderna är
  // fyllda; en ring på fyra pixlar blir ändå bara en prick med ett hål i.
  openrouter: `<path d="M2.5 12h6.9c2.2 0 2.4-5.4 5.3-5.4h2.3"/><path d="M2.5 12h6.9c2.2 0 2.4 5.4 5.3 5.4h2.3"/><circle cx="19.4" cy="6.6" r="2.4" fill="currentColor" stroke="none"/><circle cx="19.4" cy="17.4" r="2.4" fill="currentColor" stroke="none"/>`,
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
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mark}</svg>`;
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
  if (!notice) return;

  const inloggad = Boolean(getUserId());

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
    'btn-settings-save-model',
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

async function onSparaVal() {
  if (busy) return;
  const provider = valdLeverantor();
  const model = valdModell();

  if (!model) {
    visaMeddelande('Skriv in ett modell-id, eller välj en modell ur listan.', 'fel');
    el('settings-model-custom')?.focus();
    return;
  }

  const btn = el('btn-settings-save-model');
  setBusy(btn, true, 'Sparar...');
  const res = await sparaVal(provider, model);
  setBusy(btn, false);

  if (!res.ok) visaMeddelande(res.error, 'fel');
  else visaMeddelande(`Valet sparat: ${providerLabel(provider)}, ${model}.`, 'ok');
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

  // På mobil ligger sidopanelen över innehållet och måste stängas, annars
  // skulle ett tryck på Inställningar se ut att inte göra någonting.
  document.getElementById('sidebar')?.classList.remove('open');

  window.scrollTo(0, 0);
  updateBreadcrumb([
    { label: 'Bibliotek', action: "renderLibrary();switchView('library');renderSidebar();" },
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

  el('settings-provider')?.addEventListener('change', () => {
    const providerId = valdLeverantor();
    renderaModeller(providerId, defaultModelFor(providerId));
    renderaNyckelstatus();
    doljMeddelande();
  });

  el('settings-model')?.addEventListener('change', () => {
    const customField = el('settings-model-custom-field');
    const isCustom = el('settings-model').value === CUSTOM_MODEL;
    if (customField) customField.hidden = !isCustom;
    if (isCustom) el('settings-model-custom')?.focus();
    doljMeddelande();
  });

  el('btn-settings-save-model')?.addEventListener('click', () => void onSparaVal());
  el('btn-settings-save-key')?.addEventListener('click', () => void onSparaNyckel());
  el('btn-settings-delete-key')?.addEventListener('click', () => void onTaBortNyckel());
  el('btn-settings-signin')?.addEventListener('click', () => openAuth());
  el('btn-settings-signout')?.addEventListener('click', () => void signOutAndClear());

  // Routern känner inte till den här vyn, så den kan inte dölja den åt oss.
  onViewChange(() => stangSettings());

  // Anropas direkt med nuvarande läge, vilket ger den första renderingen.
  onAuthChange(() => {
    renderaInloggningslage();
    if (!view.classList.contains('hidden')) void uppdatera();
  });

  window.openSettings = openSettings;
}
