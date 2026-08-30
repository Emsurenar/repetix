// Vilken bild varje panel får, när de ska vara olika.
//
// Bilden räknades tidigare ur panelens nyckel ensam. En ren funktion av ett id
// kan omöjligt veta vad de andra fick, så två paneler bredvid varandra kunde
// hamna på samma bakgrund — med trettio bilder och åtta kortlekar är chansen
// för minst en krock ungefär 65 %. Bakgrunden finns för att skilja lekarna åt,
// och två likadana gör precis tvärtom.
//
// Lösningen kräver att valet ser hela mängden, vilket gör det till ett beslut
// om en lista snarare än om ett id. Det är rent och prövas utan webbläsare.

/* FNV-1a. Kortlekens id kan vara 'd1' eller en tidsstämpel på tretton
 * siffror; en hash som bara tittar på längden eller sista tecknet hade gett
 * samma bild till alla lekar som skapades samma sekund. */
export const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * Ger varje nyckel ett bildnummer, olika så länge de får plats.
 *
 * Varje nyckel räknar fram den bild den helst vill ha, precis som förut. Är
 * den redan tagen sonderas framåt till nästa lediga. Att listan gås igenom i
 * sin ordning är hela poängen med stabiliteten: en ny kortlek läggs sist och
 * tar en ledig plats utan att rubba någon som redan fått sin.
 *
 * Fler nycklar än bilder går inte att lösa. Då slutar sonderingen och var och
 * en får den bild den helst ville ha — hellre en krock än en panel utan
 * bakgrund, och valet blir detsamma nästa gång.
 *
 * @param {Iterable<string>} nycklar i stabil ordning
 * @param {number} antal antal bilder att välja mellan
 * @returns {Map<string, number>} nyckel → bildnummer, 1..antal
 */
export function tilldelaBilder(nycklar, antal) {
  const ut = new Map();
  if (!nycklar || antal < 1) return ut;

  const tagna = new Set();
  for (const nyckel of nycklar) {
    if (typeof nyckel !== 'string' || nyckel === '' || ut.has(nyckel)) continue;

    const onskad = hash(nyckel) % antal;
    let vald = onskad;

    // Sondera bara så länge det finns något ledigt att sondera efter.
    if (tagna.size < antal) {
      let steg = 0;
      while (tagna.has(vald) && steg < antal) {
        vald = (vald + 1) % antal;
        steg++;
      }
    }

    tagna.add(vald);
    ut.set(nyckel, vald + 1);
  }
  return ut;
}
