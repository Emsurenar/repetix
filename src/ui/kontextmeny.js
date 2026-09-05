// En meny vid pekaren.
//
// Radmenyerna i biblioteket och kortleksvyn är <details> som sitter i sitt
// kort och öppnas på kortets hörn. Sidopanelens rader har inget hörn att
// hänga en meny på — de är 30 pixlar höga och fulla av text — så där öppnas
// samma val vid pekaren i stället. Menyn bygger på samma stilar som
// .row-menu-items, med samma val i samma ordning som kortets tre punkter:
// den som lärt sig menyn på ett ställe ska känna igen den på det andra.
//
// En meny i taget. Den stängs av ett klick var som helst, av Escape, av att
// sidan rullar och av att fönstret ändrar storlek — allt som flyttar på det
// den pekar på.

let oppen = null;
let stadare = null;

const stang = () => {
  if (!oppen) return;
  oppen.remove();
  oppen = null;
  stadare?.();
  stadare = null;
};

/**
 * Öppnar en meny vid en punkt på skärmen.
 *
 * @param {object} arg
 * @param {number} arg.x   clientX
 * @param {number} arg.y   clientY
 * @param {Array<{text: string, danger?: boolean, onClick: () => void}>} arg.val
 */
export function oppnaKontextmeny({ x, y, val }) {
  stang();
  if (!val?.length) return;

  const meny = document.createElement('div');
  meny.className = 'kontextmeny';
  meny.setAttribute('role', 'menu');

  for (const post of val) {
    const knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.setAttribute('role', 'menuitem');
    knapp.textContent = post.text;
    if (post.danger) knapp.classList.add('danger');
    knapp.addEventListener('click', (e) => {
      e.stopPropagation();
      stang();
      post.onClick();
    });
    meny.appendChild(knapp);
  }

  document.body.appendChild(meny);
  oppen = meny;

  /* Placeras efter att den mätts: en meny som öppnas nära högerkanten eller
   * nederkanten flyttas in, så att inget val hamnar utanför skärmen. Den
   * synliga ytan och inte fönstret — på telefon räknar innerHeight med ytan
   * bakom webbläsarens egen list. */
  const vv = window.visualViewport;
  const bredd = vv?.width ?? window.innerWidth;
  const hojd = vv?.height ?? window.innerHeight;
  const ram = meny.getBoundingClientRect();
  const marginal = 8;
  const vanster = Math.max(marginal, Math.min(x, bredd - ram.width - marginal));
  const topp = Math.max(marginal, Math.min(y, hojd - ram.height - marginal));
  meny.style.left = `${vanster}px`;
  meny.style.top = `${topp}px`;

  const paKlick = (e) => {
    if (!meny.contains(e.target)) stang();
  };
  const paTangent = (e) => {
    if (e.key === 'Escape') stang();
  };
  const paRorelse = () => stang();

  /* Lyssnarna sätts i nästa varv: högerklicket som öppnade menyn avslutas
   * med en click-händelse i vissa webbläsare, och den hade stängt menyn i
   * samma ögonblick som den öppnades. */
  setTimeout(() => {
    if (oppen !== meny) return;
    document.addEventListener('click', paKlick, true);
    document.addEventListener('contextmenu', paKlick, true);
    document.addEventListener('keydown', paTangent);
    window.addEventListener('scroll', paRorelse, true);
    window.addEventListener('resize', paRorelse);
  }, 0);

  stadare = () => {
    document.removeEventListener('click', paKlick, true);
    document.removeEventListener('contextmenu', paKlick, true);
    document.removeEventListener('keydown', paTangent);
    window.removeEventListener('scroll', paRorelse, true);
    window.removeEventListener('resize', paRorelse);
  };

  /* Första valet får fokus, så att pil ned och Enter fungerar direkt och en
   * skärmläsare läser upp menyn. Bara med tangentbord eller mus: på
   * pekskärm är fokus i en knapp inget problem, men det är ändå inte där
   * den här menyn öppnas. */
  meny.querySelector('button')?.focus({ preventScroll: true });

  meny.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const knappar = [...meny.querySelectorAll('button')];
    const i = knappar.indexOf(document.activeElement);
    const steg = e.key === 'ArrowDown' ? 1 : -1;
    knappar[(i + steg + knappar.length) % knappar.length]?.focus();
  });
}

/** Stänger menyn om en är öppen. */
export function stangKontextmeny() {
  stang();
}
