import { describe, expect, it } from 'vitest';

import { platsAttOppna, platsAttSpara } from '../src/domain/senaste-plats.js';

const appData = {
  decks: [{ id: 'd1', title: 'Analys', sections: [{ id: 's1', title: 'Envariabel' }], cards: [] }],
  notebooks: [{ id: 'n1', title: 'Anteckningar', notes: [] }],
};

/* Appen hade ingen routing alls: switchView växlade CSS-klasser och
 * uppstarten slutade alltid i biblioteket. En omladdning mitt i en kortlek
 * kastade alltså bort var man var.
 */
describe('platsAttSpara', () => {
  it('sparar kortleken, med mappen om en är öppen', () => {
    expect(platsAttSpara({ vy: 'deck', deckId: 'd1', sectionId: 's1' })).toEqual({
      vy: 'deck',
      deckId: 'd1',
      sectionId: 's1',
    });
  });

  it('sparar anteckningsboken', () => {
    expect(platsAttSpara({ vy: 'notebook', notebookId: 'n1' })).toEqual({
      vy: 'notebook',
      notebookId: 'n1',
    });
  });

  /* Repetitionen får inte sparas. Passets tillstånd — vilka kort som lottats
   * fram och var i högen man står — ligger bara i minnet, så en återställning
   * dit hade landat i en vy utan kort. Formulären är samma sak: det man
   * skrivit är ändå borta, och att öppna ett tomt formulär i stället för
   * biblioteket hjälper ingen. */
  it('sparar inte de vyer som inte går att återskapa', () => {
    for (const vy of ['study', 'complete', 'addCard', 'addNote', 'library']) {
      expect(platsAttSpara({ vy, deckId: 'd1' }), vy).toBeNull();
    }
  });

  it('sparar inte en kortlek utan id', () => {
    expect(platsAttSpara({ vy: 'deck', deckId: null })).toBeNull();
  });
});

describe('platsAttOppna', () => {
  it('öppnar en kortlek som finns kvar', () => {
    expect(platsAttOppna({ vy: 'deck', deckId: 'd1', sectionId: 's1' }, appData)).toEqual({
      vy: 'deck',
      deckId: 'd1',
      sectionId: 's1',
    });
  });

  /* Kortleken kan vara raderad på en annan enhet, eller så har ett annat
   * konto loggat in. Då ska appen börja i biblioteket utan att säga något —
   * inte öppna en vy som pekar på ingenting. */
  it('faller tillbaka när kortleken inte finns', () => {
    expect(platsAttOppna({ vy: 'deck', deckId: 'borta' }, appData)).toBeNull();
  });

  /* En raderad mapp ska inte ta hela kortleken med sig: leken finns, och det
   * är den man var i. */
  it('behåller kortleken men släpper en mapp som är borta', () => {
    expect(platsAttOppna({ vy: 'deck', deckId: 'd1', sectionId: 'borta' }, appData)).toEqual({
      vy: 'deck',
      deckId: 'd1',
      sectionId: null,
    });
  });

  it('öppnar en anteckningsbok som finns kvar', () => {
    expect(platsAttOppna({ vy: 'notebook', notebookId: 'n1' }, appData)).toEqual({
      vy: 'notebook',
      notebookId: 'n1',
    });
  });

  it('faller tillbaka när anteckningsboken är borta', () => {
    expect(platsAttOppna({ vy: 'notebook', notebookId: 'borta' }, appData)).toBeNull();
  });

  it('öppnar spelhallen, som inte hänger på någon data', () => {
    expect(platsAttOppna({ vy: 'playground' }, appData)).toEqual({ vy: 'playground' });
  });

  /* Det som ligger i lagringen kommer utifrån och kan vara vad som helst:
   * en gammal version, en handredigerad rad, eller skräp. */
  it('tål skräp i lagringen utan att kasta', () => {
    for (const skrap of [null, undefined, 'deck', 42, {}, { vy: 'study' }, { vy: 'deck' }]) {
      expect(platsAttOppna(skrap, appData), JSON.stringify(skrap) ?? 'undefined').toBeNull();
    }
  });

  it('tål att appdatan saknas', () => {
    expect(platsAttOppna({ vy: 'deck', deckId: 'd1' }, null)).toBeNull();
    expect(platsAttOppna({ vy: 'deck', deckId: 'd1' }, {})).toBeNull();
  });
});
