// Var användaren stod, och om det går att komma tillbaka dit.
//
// Appen har ingen routing: switchView växlar CSS-klasser och uppstarten
// slutade alltid i biblioteket, så en omladdning mitt i en kortlek kastade
// bort var man var. Det som saknades var inte URL:er utan ett svar på två
// frågor — får den här vyn sparas, och finns det den pekar på kvar? Båda är
// rena beslut och testas utan webbläsare.

/**
 * Vyer som går att återskapa ur enbart ett id.
 *
 * Repetitionen är inte med. Passets tillstånd — vilka kort som lottats fram
 * och var i högen man står — finns bara i minnet, så en återställning dit
 * hade landat i en vy utan kort. Formulärvyerna är samma sak från andra
 * hållet: det man skrivit är ändå borta, och ett tomt formulär i stället för
 * biblioteket hjälper ingen.
 */
const RESTAURERBARA = new Set(['deck', 'notebook', 'playground']);

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Platsen som ska sparas, eller null när vyn inte är värd att spara.
 *
 * @param {{vy?: string, deckId?: string|null, sectionId?: string|null, notebookId?: string|null}} lage
 * @returns {object|null}
 */
export function platsAttSpara({ vy, deckId, sectionId, notebookId } = {}) {
  if (!RESTAURERBARA.has(vy)) return null;

  if (vy === 'deck') {
    const id = text(deckId);
    return id ? { vy, deckId: id, sectionId: text(sectionId) } : null;
  }
  if (vy === 'notebook') {
    const id = text(notebookId);
    return id ? { vy, notebookId: id } : null;
  }
  return { vy };
}

/**
 * Platsen att faktiskt öppna, eller null för biblioteket.
 *
 * Värdet kommer ur lagringen och kan vara vad som helst: en äldre version, en
 * handredigerad rad, eller skräp. Det prövas därför mot appdatan i stället
 * för att litas på — en vy som pekar på en raderad kortlek är sämre än
 * biblioteket, inte bättre.
 *
 * @param {unknown} sparad
 * @param {{decks?: Array<{id: string, sections?: Array<{id: string}>}>, notebooks?: Array<{id: string}>}} appData
 * @returns {object|null}
 */
export function platsAttOppna(sparad, appData) {
  if (!sparad || typeof sparad !== 'object') return null;
  const { vy } = sparad;
  if (!RESTAURERBARA.has(vy)) return null;

  if (vy === 'playground') return { vy };

  if (vy === 'deck') {
    const deck = (appData?.decks ?? []).find((d) => d.id === sparad.deckId);
    if (!deck) return null;

    /* En raderad mapp tar inte med sig kortleken. Leken finns, och det är den
     * man var i — att kasta hela platsen för en mapp som försvunnit vore att
     * straffa användaren för någon annans städning. */
    const sectionId = (deck.sections ?? []).some((s) => s.id === sparad.sectionId)
      ? sparad.sectionId
      : null;
    return { vy, deckId: deck.id, sectionId };
  }

  const notebook = (appData?.notebooks ?? []).find((n) => n.id === sparad.notebookId);
  return notebook ? { vy, notebookId: notebook.id } : null;
}
