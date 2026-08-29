// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { safeParse } from '../src/ui/images.js';
import { isDataUrl } from '../src/core/image-compress.js';
import { renderProposedCards } from '../src/ai/proposed-cards.js';
import { S } from '../src/core/state.js';

// Vägen från text till innerHTML, prövad i en riktig DOM.
//
// Testerna kräver jsdom och inte Nodes tomma miljö: utan window kan DOMPurify
// inte parsa något och lämnar då strängen orörd, vilket hade gjort varje
// påstående här grönt utan att någonting sanerades.
//
// Två vägar in kräver inte att användaren skadar sig själv — ett AI-svar som
// följt en instruktion i kortinnehållet, och en importerad backupfil — och
// sessionen ligger i localStorage. En körd skript-tagg är därför inte en
// fulhet utan ett kontoövertagande.

/** Innehållet parsat, så påståenden kan ställas mot noder i stället för text. */
const somDom = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

/** Varje attributnamn i trädet, för att kunna leta efter on-hanterare. */
const attributnamn = (rot) =>
  [...rot.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name.toLowerCase()));

/**
 * Håller inte bara den kända nyttolasten borta utan hela klassen: ingen
 * händelsehanterare, inget skript, ingen ram. Ett test som bara letar efter
 * ordet "onerror" hade godkänt "onload".
 */
const arOfarlig = (html) => {
  const dom = somDom(html);
  expect(dom.querySelector('script')).toBeNull();
  expect(dom.querySelector('iframe')).toBeNull();
  expect(dom.querySelector('object')).toBeNull();
  expect(dom.querySelector('embed')).toBeNull();
  expect(attributnamn(dom).filter((n) => n.startsWith('on'))).toEqual([]);
  for (const el of dom.querySelectorAll('[href], [src]')) {
    const url = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
    expect(url.replace(/\s/g, '').toLowerCase().startsWith('javascript:')).toBe(false);
  }
};

describe('safeParse tar bort det som kan köras', () => {
  it('behåller bilden men inte dess onerror', () => {
    const html = safeParse('<img src=x onerror=alert(1)>');
    expect(html).toContain('<img');
    expect(html).not.toMatch(/onerror/i);
    arOfarlig(html);
  });

  it('lämnar ingen skript-tagg kvar', () => {
    arOfarlig(safeParse('<script>alert(1)</script>'));
    arOfarlig(safeParse('<img src=x><script>alert(1)</script><p>efter</p>'));
  });

  it('behåller länktexten men inte javascript-målet', () => {
    const html = safeParse('[klick](javascript:alert(1))');
    expect(html).toContain('klick');
    expect(html).not.toMatch(/javascript:/i);
    arOfarlig(html);
  });

  it('tar bort hanterare som skrivits direkt på ett element', () => {
    arOfarlig(safeParse('<div onclick="alert(1)">klick</div>'));
    arOfarlig(safeParse('<svg onload=alert(1)></svg>'));
    arOfarlig(safeParse('<body onload=alert(1)>'));
  });

  it('släpper inte igenom en ram', () => {
    arOfarlig(safeParse('<iframe src="javascript:alert(1)"></iframe>'));
  });

  // Andra vägen in: platshållarna bär tillbaka råtext efter att marked kört,
  // så en sanering före återställningen hade aldrig sett det som står här.
  it('sanerar även det som gömts mellan dollartecken', () => {
    const html = safeParse('Text $$<img src=x onerror=alert(2)>$$');
    expect(html).not.toMatch(/onerror/i);
    expect(html).toContain('$$');
    arOfarlig(html);
  });

  it('sanerar en skript-tagg inuti ett matematikblock', () => {
    arOfarlig(safeParse('$$<svg><script>alert(1)</script></svg>$$'));
    arOfarlig(safeParse('$<img src=x onerror=alert(1)>$'));
    arOfarlig(safeParse('\\[<img src=x onerror=alert(1)>\\]'));
    arOfarlig(safeParse('\\(<img src=x onerror=alert(1)>\\)'));
  });
});

describe('safeParse släpper igenom innehållet', () => {
  it('renderar markdown', () => {
    const html = safeParse('# Rubrik\n\n**fet** och *kursiv*\n\n- ett\n- två\n\n`kod`');
    expect(html).toContain('<h1>Rubrik</h1>');
    expect(html).toContain('<strong>fet</strong>');
    expect(html).toContain('<em>kursiv</em>');
    expect(html).toContain('<li>ett</li>');
    expect(html).toContain('<code>kod</code>');
  });

  it('behåller en vanlig länk och en kodruta', () => {
    expect(safeParse('[länk](https://example.com)')).toContain('href="https://example.com"');
    expect(safeParse('```js\nconst a = 1;\n```')).toContain('language-js');
  });

  it('behåller en tabell', () => {
    const html = safeParse('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(somDom(html).querySelectorAll('td')).toHaveLength(2);
  });

  it('behåller bilder, både från molnet och som inbäddad data-URL', () => {
    expect(safeParse('![alt](https://example.com/bild.png)')).toContain(
      'src="https://example.com/bild.png"'
    );
    expect(safeParse('![alt](data:image/png;base64,iVBORw0KGgo=)')).toContain(
      'src="data:image/png;base64,iVBORw0KGgo="'
    );
  });

  // KaTeX kör efter det här steget och läser texten som den står. Ändras ett
  // enda tecken mellan avgränsarna renderas formeln fel eller inte alls.
  it('lämnar matematiken ordagrann åt KaTeX', () => {
    expect(safeParse('Einstein: $$E = mc^2$$ slut')).toContain('$$E = mc^2$$');
    expect(safeParse('inline $a+b$ mitt i')).toContain('$a+b$');
    expect(safeParse('$$\\frac{a}{b}$$')).toContain('$$\\frac{a}{b}$$');
    expect(safeParse('\\[x^2\\] och \\(y^2\\)')).toContain('\\[x^2\\]');
    expect(safeParse('\\[x^2\\] och \\(y^2\\)')).toContain('\\(y^2\\)');
  });

  it('behåller MathML och SVG, formen en renderad formel har', () => {
    expect(somDom(safeParse('<math><mi>x</mi></math>')).querySelector('mi')).not.toBeNull();
    expect(
      somDom(safeParse('<svg width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>')).querySelector(
        'circle'
      )
    ).not.toBeNull();
  });
});

// Ersättningen gjordes tidigare med en sträng, och en sträng tolkar sina
// dollartecken. Varje blockformel kollapsade därmed till inline-matematik.
describe('safeParse tolkar inte dollartecknen i formeln', () => {
  it('behåller dubbla dollartecken', () => {
    expect(safeParse('$$a+b$$')).toContain('$$a+b$$');
  });

  it('behåller båda blocken när kortet har två', () => {
    const html = safeParse('Två block: $$a$$ och $$b$$');
    expect(html).toContain('$$a$$');
    expect(html).toContain('$$b$$');
  });

  it('lämnar ingen platshållare kvar när formeln innehåller $&', () => {
    expect(safeParse('Dollar $&$ tecken')).not.toContain('%%LATEX');
    expect(safeParse('$$x $& y$$')).not.toContain('%%LATEX');
  });
});

// Avgör vad som sätts rakt in i img.src. En importerad backupfil kan bära
// vilken data-URL som helst.
describe('isDataUrl kräver att det faktiskt är en bild', () => {
  it('godtar en bild', () => {
    expect(isDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isDataUrl('data:image/webp;base64,AAAA')).toBe(true);
    expect(isDataUrl('data:IMAGE/PNG;base64,AAAA')).toBe(true);
  });

  it('avvisar en data-URL som inte är en bild', () => {
    expect(isDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
    expect(isDataUrl('data:text/javascript,alert(1)')).toBe(false);
    expect(isDataUrl('data:application/json,{}')).toBe(false);
    expect(isDataUrl('data:,hej')).toBe(false);
  });

  it('avvisar en storage_path', () => {
    expect(isDataUrl('9f1c/kort-1/abc.webp')).toBe(false);
  });
});

// Textarean skyddar ingenting: `</textarea>` i svaret stänger fältet och
// resten av strängen blir markup. safeParse passeras aldrig här.
describe('AI-förslagen escapar modellens svar', () => {
  const NYTTOLAST = '</textarea><img src=x onerror=alert(1)>';

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="topic-cards-list"></div>
      <span id="topic-summary-count"></span>
      <span id="btn-save-count"></span>
    `;
  });

  it('bryter inte ut ur fältet, vare sig från framsidan eller baksidan', () => {
    S.proposedTopicCards = [
      { front: NYTTOLAST, back: 'ok' },
      { front: 'ok', back: NYTTOLAST },
    ];
    renderProposedCards();

    const lista = document.getElementById('topic-cards-list');
    expect(lista.querySelectorAll('img')).toHaveLength(0);
    expect(lista.querySelectorAll('textarea')).toHaveLength(4);
    expect(attributnamn(lista).filter((n) => n.startsWith('on'))).toEqual([]);
  });

  it('behåller texten oförändrad i fältet', () => {
    S.proposedTopicCards = [{ front: NYTTOLAST, back: 'A & B < C' }];
    renderProposedCards();

    expect(document.querySelector('.ai-card-front-input').value).toBe(NYTTOLAST);
    expect(document.querySelector('.ai-card-back-input').value).toBe('A & B < C');
  });
});
