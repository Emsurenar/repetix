// Modaler: fokusfälla, generiska dialoger och tangentbordsstöd.
//
// Granskningen hittade att ingen av appens arton modaler höll kvar fokus. Tab
// gick rakt ut i sidan bakom, och när dialogen stängdes hamnade fokus på
// <body> — en tangentbordsanvändare fick börja om från appens början efter
// varje bekräftelse. Fällan nedan löser det en gång för alla arton.
//
// Den är medvetet byggd runt en MutationObserver i stället för runt ett
// open()/close()-API. Modalerna öppnas och stängs från ett tjugotal olika
// ställen i kodbasen genom att klassen "hidden" läggs till eller tas bort, och
// flera av de filerna byggs om parallellt. Att observera tillståndet i stället
// för att kräva att varje anropsställe ropar på oss gör att fällan gäller
// direkt, även för kod som ännu inte känner till den.

/** Överlägg som ska hålla fokus. Spelhallens helskärmslägen ingår inte. */
const OVERLAY_SELECTOR = '.modal, .auth-overlay';

/**
 * Element som kan ta emot fokus. Listan är avsiktligt bred: den ska fånga
 * även de element som fått tabindex på sig i JS.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  'summary',
].join(',');

/**
 * Knappen som redan äger stängningen av respektive modal.
 *
 * Escape får inte bara dölja överlägget: showConfirmModal och showPromptModal
 * lämnar ut ett löfte som aldrig skulle infrias, och flera modaler städar upp
 * tillstånd i sin avbryt-hanterare. Genom att klicka på knappen går Escape
 * exakt samma väg som ett musklick.
 *
 * Saknas en post här faller vi tillbaka på att dölja överlägget, vilket är
 * rätt beteende för de dialoger som inte har någon annan uppstädning.
 */
const CLOSE_BUTTONS = {
  'modal-create-options': 'btn-cancel-create-options',
  'modal-new-deck': 'btn-cancel-deck',
  'modal-new-bookshelf': 'btn-cancel-bookshelf',
  'modal-confirm': 'btn-confirm-cancel',
  'modal-prompt': 'btn-prompt-cancel',
  'modal-new-section': 'btn-cancel-section',
  'modal-delete-bookshelf': 'btn-cancel-delete-bookshelf',
  'modal-note-card': 'btn-cancel-note-card',
  'modal-edit-card': 'btn-cancel-edit-card',
  'modal-move-card': 'btn-cancel-move-card',
  'modal-move-item': 'btn-cancel-move-item',
  'modal-move-section': 'btn-cancel-move-section',
  'modal-card-details': 'btn-close-card-modal',
  'modal-topic-generator': 'btn-close-topic-modal-top',
  'modal-diary': 'btn-close-diary-top',
  'modal-ai-sort': 'btn-cancel-ai-sort',
};

/**
 * Överlägg som Escape inte får stänga. Inloggningen är ingen dialog man råkar
 * öppna; vägen förbi den heter "Fortsätt utan konto" och ska väljas medvetet.
 */
const NOT_DISMISSIBLE = new Set(['auth-overlay']);

/**
 * Stapel av öppna överlägg, äldst först. Modaler kan ligga ovanpå varandra —
 * inställningarna öppnar till exempel bekräftelsedialogen — och då är det
 * bara det översta som ska fånga tangenterna.
 *
 * @type {{overlay: HTMLElement, restoreTo: Element|null}[]}
 */
const stack = [];

let observer = null;

/** Sant när ett överlägg är synligt just nu. */
const isVisible = (node) =>
  node.isConnected && !node.hidden && !node.classList.contains('hidden');

/**
 * Fokuserbara element inuti ett överlägg, i tabbordning.
 *
 * Dolda element sorteras bort: modalerna har gott om knappar som ligger bakom
 * [hidden] eller .hidden i väntan på ett AI-svar, och att tabba till dem hade
 * sett ut som att fokus försvann.
 *
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0
  );
}

/** Flyttar in fokus i ett nyöppnat överlägg. */
function enter(overlay) {
  // Har något redan tagit fokus inuti — ett fält som fokuseras av den kod som
  // öppnade dialogen — lämnar vi det i fred.
  if (overlay.contains(document.activeElement)) return;

  const first = focusables(overlay)[0];
  if (first) {
    first.focus();
    return;
  }

  // Ett överlägg utan kontroller måste ändå ta emot fokus, annars står
  // användaren kvar i sidan bakom och kan tabba runt i den.
  const panel = overlay.firstElementChild ?? overlay;
  panel.setAttribute('tabindex', '-1');
  panel.focus();
}

/**
 * Lämnar tillbaka fokus till elementet som öppnade överlägget.
 *
 * Bara om fokus fortfarande sitter i det stängda överlägget eller har ramlat
 * ut på <body>. Har appen medvetet flyttat fokus någon annanstans — en modal
 * som öppnar nästa modal — ska vi inte rycka tillbaka det.
 */
function restore(entry) {
  const active = document.activeElement;
  const loose = !active || active === document.body || entry.overlay.contains(active);
  if (!loose) return;

  const target = entry.restoreTo;
  const synlig = target?.isConnected && target.getClientRects().length > 0;
  if (synlig && typeof target.focus === 'function') {
    target.focus();
    return;
  }

  // Ingen öppnare att gå tillbaka till — dialogen kan ha startats av kod, och
  // knappen kan ha ritats om under tiden. Fokus får då inte bli kvar på ett
  // element som just blivit dolt: nästa Tab hade utgått från ingenstans.
  if (active && typeof active.blur === 'function') active.blur();
}

/** Räknar om stapeln efter en förändring i DOM:en. */
function sync() {
  const open = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(isVisible);

  // Stängda överlägg plockas bort uppifrån och ned, så att fokus vandrar
  // tillbaka i samma ordning som det vandrade in.
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (!open.includes(stack[i].overlay)) {
      const [entry] = stack.splice(i, 1);
      restore(entry);
    }
  }

  for (const overlay of open) {
    if (stack.some((entry) => entry.overlay === overlay)) continue;
    // document.activeElement är fortfarande knappen som öppnade dialogen:
    // observatören körs som en mikrouppgift direkt efter klickhanteraren.
    const trigger = document.activeElement;
    stack.push({ overlay, restoreTo: trigger === document.body ? null : trigger });
    enter(overlay);
  }
}

/** Det översta öppna överlägget, eller null. */
function top() {
  return stack.length ? stack[stack.length - 1].overlay : null;
}

/**
 * Stänger det översta öppna överlägget på samma sätt som dess avbryt-knapp
 * hade gjort. Exporteras så att den globala Escape-hanteringen i app/init.js
 * inte behöver känna till någon av modalerna.
 *
 * @returns {boolean} sant om något stängdes
 */
export function closeTopModal() {
  const overlay = top();
  if (!overlay || NOT_DISMISSIBLE.has(overlay.id)) return false;

  const button = document.getElementById(CLOSE_BUTTONS[overlay.id] ?? '');
  // En knapp som ligger bakom .hidden hör till ett annat steg i dialogen och
  // har ingen hanterare som gäller nu; då är det ärligare att bara stänga.
  if (button && !button.disabled && button.offsetParent !== null) {
    button.click();
  } else {
    overlay.classList.add('hidden');
  }
  return true;
}

/** Tab och Shift+Tab cirkulerar inuti det översta överlägget. */
function trapTab(event) {
  const overlay = top();
  if (!overlay) return;

  const items = focusables(overlay);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = overlay.contains(active);

  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event) {
  if (stack.length === 0) return;

  if (event.key === 'Tab') {
    trapTab(event);
    return;
  }

  if (event.key === 'Escape') {
    // Stoppas här, annars hinner de äldre Escape-lyssnarna i appen dölja
    // modalen bakom ryggen på oss och avbryt-knappens uppstädning uteblir.
    if (closeTopModal()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

/**
 * Enter och mellanslag på element som fått role="button".
 *
 * Sjutton klickbara div- och span-element saknade tangentbordsväg helt. De som
 * inte gick att göra om till riktiga knappar — för att de sitter i markup som
 * andra etapper äger, eller för att de är en option i en listbox — har fått
 * role="button" och tabindex, och den här hanteraren gör dem användbara.
 */
function onActivationKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.getAttribute('role') !== 'button') return;
  // Riktiga knappar och fält sköter sig själva.
  if (target.matches('button, a[href], input, select, textarea')) return;

  event.preventDefault();
  target.click();
}

/**
 * Speglar öppet/stängt läge till skärmläsaren.
 *
 * Bryts ut hit för att alla utfällbara ytor ska säga samma sak: knappen bär
 * aria-expanded, inte panelen.
 *
 * @param {Element|null|undefined} trigger
 * @param {boolean} expanded
 */
export function setExpanded(trigger, expanded) {
  if (trigger) trigger.setAttribute('aria-expanded', String(expanded));
}

/**
 * Startar fokusfällan. Anropas en gång, från initUiModalsWiring.
 */
export function initModalA11y() {
  if (observer) return;

  // Capture-fasen: fällan ska hinna före de äldre tangentlyssnarna i appen,
  // och före de fält som svarar på Escape på egen hand.
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keydown', onActivationKey);

  observer = new MutationObserver((records) => {
    const rort = records.some(
      (record) =>
        record.type === 'childList' ||
        (record.target instanceof Element && record.target.matches(OVERLAY_SELECTOR))
    );
    if (rort) sync();
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'hidden'],
    childList: true,
    subtree: true,
  });

  sync();
}

// --- GENERIC MODAL HELPERS ---

/**
 * Bekräftelsedialog. Löftet infrias med true eller false, aldrig med
 * ingenting: Escape och avbryt-knappen går samma väg.
 *
 * @param {string} title
 * @param {string} message
 * @param {string} [okLabel]
 * @param {boolean} [destructive] färgar bekräftelseknappen som en radering
 * @returns {Promise<boolean>}
 */
export const showConfirmModal = (title, message, okLabel = 'OK', destructive = false) => {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    const okBtn = document.getElementById('btn-confirm-ok');
    okBtn.textContent = okLabel;
    // Tidigare skrevs färgen hit som ett hexvärde i JS, vilket gjorde att en
    // ändring i designsystemet inte nådde hit. Nu är det knappens egen
    // varningsvariant som väljs.
    okBtn.classList.toggle('danger', destructive);
    okBtn.classList.toggle('primary', !destructive);
    modal.classList.remove('hidden');

    const cancelBtn = document.getElementById('btn-confirm-cancel');
    const cleanup = (result) => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
};

/**
 * Fritextdialog. Löftet infrias med texten, eller med null om användaren
 * avbröt.
 *
 * @param {string} title
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
export const showPromptModal = (title, defaultValue = '') => {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-prompt');
    document.getElementById('prompt-modal-title').textContent = title;
    const input = document.getElementById('prompt-modal-input');
    input.value = defaultValue;
    modal.classList.remove('hidden');
    // Efter att fokusfällan flyttat in fokus: markeringen ska ligga kvar så
    // att man kan skriva över det gamla namnet direkt.
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    const form = document.getElementById('form-prompt-modal');
    const cancelBtn = document.getElementById('btn-prompt-cancel');
    const cleanup = (result) => {
      modal.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      cleanup(input.value.trim());
    };
    const onCancel = () => cleanup(null);
    form.addEventListener('submit', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
  });
};
