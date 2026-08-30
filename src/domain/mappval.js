// Att para ihop modellens mappnamn med en riktig mapp.
//
// Modellen svarar med ett NAMN, inte ett id — den känner inga id:n. Utan en
// hopparning skulle varje kortförslag skapa en ny mapp med nästan samma namn
// som en som redan finns, och kortleken fyllas med "Grunder", "grunder" och
// "Grunder ".

/**
 * Mappen som heter så, eller null.
 *
 * Versaler och blanksteg ignoreras: modellen skriver som den vill, och en
 * annan skiftläge är inte ett annat svar.
 *
 * @param {Array<{id: string, title?: string}>} sektioner
 * @param {unknown} namn
 * @returns {{id: string, title?: string}|null}
 */
export function hittaMapp(sektioner, namn) {
  const sokt = typeof namn === 'string' ? namn.trim().toLowerCase() : '';
  if (!sokt) return null;
  return (sektioner ?? []).find((s) => (s?.title ?? '').trim().toLowerCase() === sokt) ?? null;
}
