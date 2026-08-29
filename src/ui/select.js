/* Egen väljare.
 *
 * Webbläsarens <select> öppnar operativsystemets egen lista: Times-liknande
 * text, blå markering, fyrkantiga hörn. Den lyder ingen av appens tokens och
 * går inte att få att lyda dem. Mitt i ett formulär som i övrigt är appens
 * blir den ett hål där en annan produkt syns igenom.
 *
 * DEN NATIVA VÄLJAREN LIGGER KVAR och är fortfarande sanningen: den håller
 * värdet, den bär alternativen, och den skickar sina change-händelser. Det
 * här är ett skal runt den. Följden är att ingen befintlig kod behöver ändras
 * — den som fyller listan med innerHTML, läser .value eller lyssnar på change
 * märker ingen skillnad.
 *
 * Samma val som diffen i synken: ett enda ställe som ser resultatet är
 * säkrare än fyrtio ställen som ska komma ihåg att anmäla sig.
 */

const OPPEN = 'is-open';

/** Den öppna listan, om någon. Bara en i taget. */
let oppen = null;

const PIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-caret">
  <path d="M6 9l6 6 6-6"/></svg>`;

/* Listan hamnar i body och inte bredvid fältet.
 *
 * Modalens innehåll rullar (overflow-y: auto), och en lista som ligger inuti
 * den klipps av vid kanten precis när den är som längst. Fri i body kan den
 * inte klippas av någon. Priset är att den måste stängas när något rullar,
 * eftersom den då inte längre står vid sitt fält. */
function placera(skal) {
  const rutan = skal.trigger.getBoundingClientRect();
  const lista = skal.lista;
  lista.style.minWidth = `${rutan.width}px`;
  lista.style.left = `${rutan.left}px`;

  // Nedåt om det får plats, annars uppåt. En lista som växer ut genom
  // underkanten går inte att nå de sista alternativen i.
  const under = window.innerHeight - rutan.bottom;
  const hojd = lista.offsetHeight;
  if (under < hojd + 8 && rutan.top > under) {
    lista.style.top = `${Math.max(8, rutan.top - hojd - 4)}px`;
  } else {
    lista.style.top = `${rutan.bottom + 4}px`;
  }
}

function stang() {
  if (!oppen) return;
  const skal = oppen;
  oppen = null;
  skal.lista.hidden = true;
  skal.rot.classList.remove(OPPEN);
  skal.trigger.setAttribute('aria-expanded', 'false');
}

function oppna(skal) {
  if (oppen === skal) return stang();
  stang();
  oppen = skal;
  skal.lista.hidden = false;
  skal.rot.classList.add(OPPEN);
  skal.trigger.setAttribute('aria-expanded', 'true');
  placera(skal);
  skal.lista.querySelector('[aria-selected="true"]')?.focus();
}

/** Ritar om alternativen ur den nativa väljaren. */
function synka(skal) {
  const select = skal.select;
  const valt = select.options[select.selectedIndex];
  skal.etikett.textContent = valt ? valt.textContent : '';
  skal.rot.classList.toggle('is-empty', !valt);

  skal.lista.innerHTML = '';
  for (const option of select.options) {
    const rad = document.createElement('button');
    rad.type = 'button';
    rad.className = 'select-option';
    rad.setAttribute('role', 'option');
    rad.setAttribute('aria-selected', String(option.selected));
    rad.textContent = option.textContent;
    rad.disabled = option.disabled;
    rad.addEventListener('click', () => {
      select.value = option.value;
      // Den nativa väljaren skickar ingen händelse när koden byter värde. Utan
      // det här skulle allt som lyssnar på fältet — kod som visar "Namn på ny
      // mapp" när man valt att skapa en — aldrig få veta att valet ändrats.
      select.dispatchEvent(new Event('change', { bubbles: true }));
      synka(skal);
      stang();
      skal.trigger.focus();
    });
    skal.lista.appendChild(rad);
  }
}

/** Piltangenter i den öppna listan. */
function listaTangent(skal, e) {
  const rader = [...skal.lista.querySelectorAll('.select-option:not(:disabled)')];
  const nu = rader.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const steg = e.key === 'ArrowDown' ? 1 : -1;
    rader[(nu + steg + rader.length) % rader.length]?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    stang();
    skal.trigger.focus();
  } else if (e.key === 'Tab') {
    stang();
  }
}

/**
 * Klär en <select> i appens egen väljare.
 *
 * @param {HTMLSelectElement} select
 */
export function initSelect(select) {
  if (!select || select.dataset.dressed) return;
  select.dataset.dressed = '1';

  /* Kortformuläret ritade sin egen pil i ett syskonelement, eftersom en nativ
   * select inte går att sätta en pil på. Skalet har en egen, och två pilar på
   * samma fält ser ut som ett fel. Den gamla tas bort här i stället för att
   * gömmas i stilmallen — den har ingen uppgift kvar. */
  select.parentElement?.querySelector(':scope > .select-arrow')?.remove();
  // Inställningarnas modellfält ritar sin pil som en naken svg i samma
  // omslag. Samma sak, annat märke.
  if (select.parentElement?.matches('.select-wrap, .select-wrapper')) {
    select.parentElement.querySelector(':scope > svg')?.remove();
  }

  const rot = document.createElement('div');
  rot.className = 'select-shell';
  select.parentNode.insertBefore(rot, select);
  rot.appendChild(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  // Fältets egen etikett pekar på den nativa väljaren med for/id. Knappen
  // ärver samma namn i stället för att lämnas namnlös för uppläsaren.
  const etikettEl = select.id && document.querySelector(`label[for="${select.id}"]`);
  if (etikettEl) trigger.setAttribute('aria-label', etikettEl.textContent.trim());

  const etikett = document.createElement('span');
  etikett.className = 'select-value';
  trigger.appendChild(etikett);
  trigger.insertAdjacentHTML('beforeend', PIL);
  rot.appendChild(trigger);

  const lista = document.createElement('div');
  lista.className = 'select-list';
  lista.setAttribute('role', 'listbox');
  lista.hidden = true;
  document.body.appendChild(lista);

  const skal = { rot, select, trigger, lista, etikett };

  trigger.addEventListener('click', () => oppna(skal));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      oppna(skal);
    }
  });
  lista.addEventListener('keydown', (e) => listaTangent(skal, e));

  /* Tre vägar in i ett nytt värde, och skalet måste se alla tre.
   *
   * change   — någon annan kod, eller en dispatch härifrån.
   * childList — listan fylldes om (mapparna i en kortlek, modellerna hos en
   *             leverantör). Alternativen är andra, alltså måste raderna om.
   * .value    — kod som sätter värdet rakt av. Den vägen skickar ingen
   *             händelse alls; utan den nedärvda sättaren nedan hade etiketten
   *             blivit stående på det gamla valet. */
  select.addEventListener('change', () => synka(skal));
  new MutationObserver(() => synka(skal)).observe(select, {
    childList: true,
    subtree: true,
  });

  const nativVarde = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() {
      return nativVarde.get.call(this);
    },
    set(v) {
      nativVarde.set.call(this, v);
      synka(skal);
    },
  });

  synka(skal);
}

export function initUiSelects() {
  for (const select of document.querySelectorAll('select')) initSelect(select);

  // Stängs av allt som gör att listan inte längre står vid sitt fält.
  document.addEventListener('pointerdown', (e) => {
    if (!oppen) return;
    if (oppen.lista.contains(e.target) || oppen.rot.contains(e.target)) return;
    stang();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stang();
  });
  // capture: rullningen sker i modalen, inte i fönstret, och bubblar inte.
  window.addEventListener('scroll', stang, true);
  window.addEventListener('resize', stang);
}
