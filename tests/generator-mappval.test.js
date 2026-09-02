// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { renderProposedCards } from '../src/ai/proposed-cards.js';
import { S } from '../src/core/state.js';

/* Mappen per kort är hela poängen med ändringen: utan den måste omgången
 * sorteras om direkt efter att den skapats. Raden måste därför visa vad
 * modellen valt, och låta det ändras — en mapp man ser men inte kan rätta är
 * samma manuella efterarbete i en annan skepnad.
 */
describe('mappväljaren i ett kortförslag', () => {
  const val = () => [...document.querySelectorAll('.ai-card-section-select')];
  const etiketter = (sel) => [...sel.options].map((o) => o.textContent);

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="topic-cards-list"></div>
      <span id="topic-summary-count"></span>
      <span id="btn-save-count"></span>
    `;
    S.appData = {
      decks: [{ id: 'd1', sections: [{ id: 's1', title: 'Grunder' }], cards: [] }],
    };
    S.currentDeckId = 'd1';
  });

  /* Har användaren pekat ut en mapp i inställningssteget gäller den för alla
   * korten. En väljare per rad hade då lovat något flödet inte håller. */
  it('visas inte när modellen inte föreslagit någon mapp', () => {
    S.proposedTopicCards = [{ front: 'F', back: 'S' }];
    renderProposedCards();
    expect(val()).toHaveLength(0);
  });

  it('ger varje kort en väljare när modellen valt mappar', () => {
    S.proposedTopicCards = [
      { front: 'F1', back: 'S1', section: 'Grunder' },
      { front: 'F2', back: 'S2', section: 'Serier' },
    ];
    renderProposedCards();
    expect(val()).toHaveLength(2);
  });

  it('förväljer mappen modellen valde, oavsett versaler', () => {
    S.proposedTopicCards = [{ front: 'F', back: 'S', section: '  grunder ' }];
    renderProposedCards();
    expect(val()[0].value).toBe('Grunder');
  });

  /* Att en ny mapp är ny är en konsekvens av att spara, och den enda skillnad
   * användaren inte kan se på namnet. */
  it('märker ut en mapp som inte finns än', () => {
    S.proposedTopicCards = [{ front: 'F', back: 'S', section: 'Serier' }];
    renderProposedCards();
    expect(etiketter(val()[0])).toEqual(['Ingen mapp', 'Grunder', 'Serier (ny)']);
  });

  /* Utan hopparningen hade en befintlig mapp dykt upp två gånger i listan:
   * en gång som sig själv och en gång som "(ny)". */
  it('erbjuder inte en befintlig mapp en andra gång som ny', () => {
    S.proposedTopicCards = [{ front: 'F', back: 'S', section: 'GRUNDER' }];
    renderProposedCards();
    expect(etiketter(val()[0])).toEqual(['Ingen mapp', 'Grunder']);
  });

  it('går att ställa om till ingen mapp', () => {
    S.proposedTopicCards = [{ front: 'F', back: 'S', section: 'Serier' }];
    renderProposedCards();
    const sel = val()[0];
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(S.proposedTopicCards[0].section).toBe('');
  });

  /* Mappnamnet kommer från modellen, som kan ha läst det ur en text
   * användaren klistrat in. Det är alltså inte appens egen sträng. */
  it('escapar mappnamnet modellen svarade med', () => {
    S.proposedTopicCards = [
      { front: 'F', back: 'S', section: '"><img src=x onerror=alert(1)>' },
    ];
    renderProposedCards();
    expect(document.querySelectorAll('#topic-cards-list img')).toHaveLength(0);
    // escapeHtml bygger på textContent och lämnar citattecknet orört. Läggs
    // namnet i ett attribut stänger ett " värdet, och resten av namnet blir
    // egna attribut på option-elementet.
    const attribut = [...document.querySelectorAll('#topic-cards-list *')].flatMap((el) =>
      [...el.attributes].map((a) => a.name)
    );
    expect(attribut.filter((n) => n.startsWith('on'))).toEqual([]);
    expect(val()[0].value).toBe('"><img src=x onerror=alert(1)>');
  });
});
