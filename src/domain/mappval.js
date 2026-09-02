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

/**
 * Fördelar modellens mappnamn — ett per kort — på befintliga och nya mappar.
 *
 * Genereringen låter modellen välja mapp per kort, och en omgång pekar därför
 * ofta på både mappar som finns och mappar som inte gör det. Att låta varje
 * kort lösa sitt namn för sig hade gett en ny mapp per kort: tjugo kort om
 * "Serier" blir tjugo mappar som heter "Serier". Fördelningen görs därför för
 * hela omgången på en gång, och nya namn dedupas mot varandra på samma villkor
 * som hittaMapp jämför mot befintliga.
 *
 * Inga id skapas här. Ett id är inte en egenskap hos fördelningen utan hos
 * kortleken som tar emot den, och en ren funktion som slumpar fram id:n går
 * inte att pröva. Anroparen skapar en mapp per namn i `nya` och slår upp
 * kortets `nyttNamn` bland dem.
 *
 * @param {Array<{id: string, title?: string}>} sektioner kortlekens mappar
 * @param {unknown[]} namnPerKort modellens svar, i kortens ordning
 * @returns {{
 *   tilldelning: Array<{sektionId: string|null, nyttNamn: string|null}>,
 *   nya: string[]
 * }} en post per kort, plus de nya mappnamnen i den ordning de dök upp
 */
export function fordelaMappar(sektioner, namnPerKort) {
  /** Normaliserat namn → skrivningen som första kortet använde. */
  const sedda = new Map();
  const nya = [];

  const tilldelning = (namnPerKort ?? []).map((namn) => {
    const befintlig = hittaMapp(sektioner, namn);
    if (befintlig) return { sektionId: befintlig.id, nyttNamn: null };

    const rent = typeof namn === 'string' ? namn.trim() : '';
    // Utan namn är kortet osorterat. Det är ett giltigt utfall, inte ett fel:
    // modellen ska kunna låta bli att gissa hellre än att gissa fel.
    if (!rent) return { sektionId: null, nyttNamn: null };

    const nyckel = rent.toLowerCase();
    if (!sedda.has(nyckel)) {
      sedda.set(nyckel, rent);
      nya.push(rent);
    }
    return { sektionId: null, nyttNamn: sedda.get(nyckel) };
  });

  return { tilldelning, nya };
}
