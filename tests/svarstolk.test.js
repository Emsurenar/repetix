import { describe, expect, it } from 'vitest';

import { AiError } from '../src/ai/call.js';
import { parseKortlista, parseLista, parseObjekt } from '../src/ai/svarstolk.js';

const kort = (f, b) => ({ front: f, back: b });

/* Anropet lyckas, pengarna dras, och sedan går allt sönder på klienten.
 *
 * JSON.parse kastar SyntaxError och fixLatexInCards kastar TypeError. Inget av
 * dem är ett AiError, så aiErrorMessage föll tillbaka på "Något gick fel med
 * AI-anropet." — en mening som beskriver ett avhugget svar, ett svar i fel
 * form och ett kort utan baksida exakt lika illa.
 */
describe('parseKortlista', () => {
  it('tar en ren array', () => {
    const ut = parseKortlista('[{"front":"F","back":"S"}]');
    expect(ut.kort).toEqual([kort('F', 'S')]);
    expect(ut.avhugget).toBe(false);
    expect(ut.bortfall).toBe(0);
  });

  it('tar en array i ett markdown-block', () => {
    expect(parseKortlista('```json\n[{"front":"F","back":"S"}]\n```').kort).toEqual([kort('F', 'S')]);
  });

  it('tar en array med prat före och efter', () => {
    const ut = parseKortlista('Här kommer korten:\n[{"front":"F","back":"S"}]\nHoppas de duger!');
    expect(ut.kort).toEqual([kort('F', 'S')]);
  });

  /* Modellen ombeds svara med en naken array men packar ibland in den. Att
   * plocka ut den kostar ingenting och sparar hela satsen. */
  it('packar upp en array som lagts i ett objekt', () => {
    expect(parseKortlista('{"cards":[{"front":"F","back":"S"}]}').kort).toEqual([kort('F', 'S')]);
  });

  /* Kärnan i "pengar dras men inget produceras": svaret slog i taket mitt i
   * ett kort. De färdiga korten före snittet är betalda och fullt brukbara. */
  it('räddar de färdiga korten ur ett avhugget svar', () => {
    const avhugget = '[{"front":"A","back":"1"},{"front":"B","back":"2"},{"front":"C","back":"halv';
    const ut = parseKortlista(avhugget, { truncated: true });
    expect(ut.kort).toEqual([kort('A', '1'), kort('B', '2')]);
    expect(ut.avhugget).toBe(true);
  });

  /* Det svåra fallet. LaTeX i svaren betyder klamrar INUTI strängar, och ett
   * snitt vid "sista }" hade landat mitt i en formel. Snittet måste räkna
   * djup och veta när det står i en sträng. */
  it('klipper rätt trots klamrar i LaTeX-strängar', () => {
    const avhugget =
      '[{"front":"Vad är $\\\\frac{1}{2}$?","back":"$\\\\frac{1}{2} = 0.5$"},{"front":"Nästa {';
    const ut = parseKortlista(avhugget, { truncated: true });
    expect(ut.kort).toHaveLength(1);
    expect(ut.kort[0].back).toContain('0.5');
  });

  /* Ett kort utan baksida dödade hela satsen: fixLatexInCards anropade
   * .replace på undefined. Nu faller det enskilda kortet bort. */
  it('kastar bara det trasiga kortet, inte hela satsen', () => {
    const ut = parseKortlista('[{"front":"A","back":"1"},{"front":"B"},{"back":"3"},{"front":"C","back":"3"}]');
    expect(ut.kort).toEqual([kort('A', '1'), kort('C', '3')]);
    expect(ut.bortfall).toBe(2);
  });

  it('säger att svaret inte är JSON när det inte är det', () => {
    expect(() => parseKortlista('Tyvärr kan jag inte hjälpa till med det.')).toThrow(AiError);
    expect(() => parseKortlista('Tyvärr kan jag inte hjälpa till med det.')).toThrow(/JSON/i);
  });

  it('säger att svaret avbröts när ingenting gick att rädda', () => {
    expect(() => parseKortlista('[{"front":"halv', { truncated: true })).toThrow(/avbr|klart/i);
  });

  it('säger ifrån när inget kort hade både fråga och svar', () => {
    expect(() => parseKortlista('[{"front":"A"},{"back":"1"}]')).toThrow(AiError);
  });

  it('tål tomma och ogiltiga indata utan att kasta något annat än AiError', () => {
    for (const dåligt of ['', '   ', 'null', '[]', '{}']) {
      expect(() => parseKortlista(dåligt), dåligt).toThrow(AiError);
    }
  });
});

describe('parseObjekt', () => {
  it('tar ett rent objekt', () => {
    expect(parseObjekt('{"action":"new","folderTitle":"Analys"}')).toEqual({
      action: 'new',
      folderTitle: 'Analys',
    });
  });

  it('tar ett objekt i ett markdown-block, med prat runt', () => {
    expect(parseObjekt('Såhär:\n```json\n{"a":1}\n```\nKlart!')).toEqual({ a: 1 });
  });

  /* Ett avhugget objekt går inte att rädda — halva nycklar är inte halva
   * svar — men felet ska säga vad som hände i stället för ingenting. */
  it('säger att svaret avbröts', () => {
    expect(() => parseObjekt('{"front":"halv', { truncated: true })).toThrow(/avbr|klart/i);
  });

  it('säger att svaret inte är JSON', () => {
    expect(() => parseObjekt('inget json här')).toThrow(/JSON/i);
  });

  /* Ett ensamt objekt som lagts i en array packas upp — samma räddningstanke
   * som för listorna, och svaret är redan betalt. Gränsen går vid flera:
   * då finns inget att välja på utan att gissa, och då ska det säga ifrån. */
  it('packar upp ett ensamt objekt som lagts i en array', () => {
    expect(parseObjekt('[{"a":1}]')).toEqual({ a: 1 });
  });

  it('gissar inte när arrayen bär flera objekt', () => {
    expect(() => parseObjekt('[{"a":1},{"b":2}]')).toThrow(AiError);
  });
});

/* Sorteringen ber om {cardId, section} och inte om kort, men räddningen av ett
 * avhugget svar är densamma — och ska därför bara finnas på ett ställe. */
describe('parseLista', () => {
  it('bryr sig inte om vad posterna innehåller', () => {
    const ut = parseLista('[{"cardId":"a","section":"Analys"},{"cardId":"b","section":"Analys"}]');
    expect(ut.poster).toHaveLength(2);
    expect(ut.poster[0].cardId).toBe('a');
    expect(ut.avhugget).toBe(false);
  });

  it('räddar de färdiga posterna ur ett avhugget svar', () => {
    const ut = parseLista('[{"cardId":"a","section":"Analys"},{"cardId":"b","sec', { truncated: true });
    expect(ut.poster).toHaveLength(1);
    expect(ut.avhugget).toBe(true);
  });

  it('säger ifrån på en tom lista i stället för att låtsas att den lyckades', () => {
    expect(() => parseLista('[]')).toThrow(AiError);
  });
});
