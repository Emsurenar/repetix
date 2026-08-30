// Tolkning av AI-svar som ska vara JSON.
//
// Sex ställen i appen bad modellen om JSON och körde JSON.parse rakt av. När
// svaret inte gick att tolka kastades ett SyntaxError, och när det tolkades
// men hade fel form kastade nästa rad ett TypeError. Inget av dem är ett
// AiError, så aiErrorMessage föll tillbaka på "Något gick fel med AI-anropet."
// — en mening som beskriver ett avhugget svar, ett svar i fel form och ett
// kort utan baksida exakt lika illa. Anropet var dessutom redan betalt.
//
// Modulen är ren och rör inget DOM: det som är värt att pröva här är formen på
// svaret, och den behöver ingen webbläsare.

import { AiError } from './call.js';

/** Modellen ombeds svara med naken JSON men lägger ibland på ett kodblock. */
const stripFence = (text) => {
  const t = text.trim();
  if (t.startsWith('```json')) return t.replace(/^```json/, '').replace(/```$/, '').trim();
  if (t.startsWith('```')) return t.replace(/^```/, '').replace(/```$/, '').trim();
  return t;
};

/**
 * Klipper ut det yttersta JSON-värdet ur ett svar som bär prat runt omkring.
 *
 * @param {string} text
 * @param {'['|'{'} oppning
 */
const klippUt = (text, oppning) => {
  const stangning = oppning === '[' ? ']' : '}';
  const start = text.indexOf(oppning);
  const slut = text.lastIndexOf(stangning);
  if (start === -1) return text;
  return slut > start ? text.slice(start, slut + 1) : text.slice(start);
};

/**
 * Var den sista KOMPLETTA posten i en avhuggen JSON-array slutar.
 *
 * Ett snitt vid "sista }" räcker inte: korten bär LaTeX, och `\frac{1}{2}`
 * har klamrar inuti en sträng. Därför räknas djup, och tecken inuti strängar
 * räknas inte alls — med escape-hantering, eftersom `\"` inte avslutar något.
 *
 * @param {string} raw
 * @returns {number} index efter postens avslutande }, eller -1
 */
const sistaHelaPosten = (raw) => {
  let djup = 0;
  let iStrang = false;
  let escaped = false;
  let sista = -1;

  for (let i = 0; i < raw.length; i++) {
    const tecken = raw[i];

    if (iStrang) {
      if (escaped) escaped = false;
      else if (tecken === '\\') escaped = true;
      else if (tecken === '"') iStrang = false;
      continue;
    }

    if (tecken === '"') iStrang = true;
    else if (tecken === '{' || tecken === '[') djup++;
    else if (tecken === '}' || tecken === ']') {
      djup--;
      // Djup 1 igen efter ett } betyder att en post i den yttre arrayen
      // stängdes. Just där går det att kapa och sätta dit ett ].
      if (djup === 1 && tecken === '}') sista = i + 1;
    }
  }
  return sista;
};

const tolka = (raw) => {
  try {
    return { ok: true, varde: JSON.parse(raw) };
  } catch {
    return { ok: false, varde: null };
  }
};

const felForOtolkat = (truncated) =>
  truncated
    ? new AiError('Modellen hann inte skriva klart svaret innan tokentaket tog slut.', 'provider_error')
    : new AiError('Modellen svarade med något annat än JSON.', 'provider_error');

/**
 * Tolkar ett svar som ska vara en lista, vad listan än innehåller.
 *
 * Sorteringen ber om {cardId, section} och kortgeneratorn om {front, back} —
 * räddningen av ett avhugget svar är densamma för båda, och den ska bara
 * finnas på ett ställe.
 *
 * @param {string} text
 * @param {{truncated?: boolean}} [omstandigheter]
 * @returns {{poster: any[], avhugget: boolean}}
 * @throws {AiError}
 */
export function parseLista(text, { truncated = false } = {}) {
  const raw = klippUt(stripFence(String(text ?? '')), '[');

  let { ok, varde } = tolka(raw);
  let avhugget = false;

  /* Räddningen. Ett avhugget svar är redan betalt, och korten före snittet är
   * hela och fullt brukbara — att kasta dem också hade gjort ett halvt
   * resultat till inget resultat. */
  if (!ok) {
    const snitt = sistaHelaPosten(raw);
    if (snitt !== -1) {
      const forsok = tolka(`${raw.slice(0, snitt)}]`);
      if (forsok.ok) {
        varde = forsok.varde;
        ok = true;
        avhugget = true;
      }
    }
  }

  if (!ok) throw felForOtolkat(truncated);

  /* En array som packats in i ett objekt. Modellen ombeds svara med en naken
   * array, men gör den inte det är listan ändå där — och att leta rätt på den
   * kostar mindre än att kasta hela satsen. */
  let lista = varde;
  if (!Array.isArray(lista) && lista && typeof lista === 'object') {
    lista = Object.values(lista).find(Array.isArray) ?? lista;
  }
  if (!Array.isArray(lista)) {
    throw new AiError('Modellen svarade inte med en lista.', 'provider_error');
  }
  if (lista.length === 0) {
    throw truncated || avhugget
      ? new AiError('Modellen hann inte skriva klart en enda hel post.', 'provider_error')
      : new AiError('Modellen svarade med en tom lista.', 'provider_error');
  }

  return { poster: lista, avhugget: avhugget || truncated };
}

/**
 * Samma sak, men för en lista med kort: poster utan både fråga och svar
 * faller bort i stället för att döda hela satsen.
 *
 * fixLatexInCards anropade .replace på c.front, så ETT kort utan framsida
 * kastade ett TypeError som tog med sig alla de andra — och användaren hade
 * redan betalat för hela listan.
 *
 * @param {string} text
 * @param {{truncated?: boolean}} [omstandigheter]
 * @returns {{kort: Array<{front: string, back: string}>, bortfall: number, avhugget: boolean}}
 * @throws {AiError}
 */
export function parseKortlista(text, omstandigheter = {}) {
  const { poster, avhugget } = parseLista(text, omstandigheter);

  const arText = (v) => typeof v === 'string' && v.trim() !== '';
  const kort = poster.filter((k) => k && arText(k.front) && arText(k.back));

  if (kort.length === 0) {
    throw avhugget
      ? new AiError('Modellen hann inte skriva klart ett enda helt kort.', 'provider_error')
      : new AiError('Inget av korten modellen svarade med hade både fråga och svar.', 'provider_error');
  }

  return { kort, bortfall: poster.length - kort.length, avhugget };
}

/**
 * Tolkar ett svar som ska vara ett enda objekt.
 *
 * Ingen räddning här: ett halvt objekt är inte ett halvt svar, utan en nyckel
 * utan värde.
 *
 * @param {string} text
 * @param {{truncated?: boolean}} [omstandigheter]
 * @returns {object}
 * @throws {AiError}
 */
export function parseObjekt(text, { truncated = false } = {}) {
  const raw = klippUt(stripFence(String(text ?? '')), '{');
  const { ok, varde } = tolka(raw);

  if (!ok) throw felForOtolkat(truncated);
  if (!varde || typeof varde !== 'object' || Array.isArray(varde)) {
    throw new AiError('Modellen svarade i en annan form än den ombads om.', 'provider_error');
  }
  return varde;
}
