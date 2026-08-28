import { describe, expect, it } from 'vitest';
import {
  MIN_EASE,
  RATING,
  initialSchedule,
  isDue,
  maturity,
  nextReviewAt,
  previewInterval,
  schedule,
  withScheduleDefaults,
} from '../src/domain/srs.js';

const nyttKort = () => ({ repetition: 0, interval: 0, easeFactor: 2.5 });
const DAG = 24 * 60 * 60 * 1000;

describe('schedule', () => {
  it('ger ett nytt kort intervall 1 dag vid Bra', () => {
    expect(schedule(nyttKort(), RATING.GOOD)).toEqual({
      repetition: 1,
      interval: 1,
      easeFactor: 2.5,
    });
  });

  it('ger andra Bra-betyget hoppet till 6 dagar', () => {
    const efterForsta = schedule(nyttKort(), RATING.GOOD);
    expect(schedule(efterForsta, RATING.GOOD).interval).toBe(6);
  });

  it('multiplicerar med ease factor från tredje repetitionen', () => {
    let s = schedule(nyttKort(), RATING.GOOD);
    s = schedule(s, RATING.GOOD);
    expect(schedule(s, RATING.GOOD).interval).toBeCloseTo(6 * 2.5, 10);
  });

  it('nollstaller repetition och intervall vid Igen', () => {
    const moget = { repetition: 5, interval: 40, easeFactor: 2.5 };
    expect(schedule(moget, RATING.AGAIN)).toEqual({
      repetition: 0,
      interval: 0,
      easeFactor: 2.3,
    });
  });

  it('sanker ease med 0,2 vid Igen och 0,15 vid Svart', () => {
    expect(schedule(nyttKort(), RATING.AGAIN).easeFactor).toBeCloseTo(2.3, 10);
    expect(schedule(nyttKort(), RATING.HARD).easeFactor).toBeCloseTo(2.35, 10);
  });

  it('hojer ease med 0,15 vid Latt', () => {
    expect(schedule(nyttKort(), RATING.EASY).easeFactor).toBeCloseTo(2.65, 10);
  });

  it('later aldrig ease falla under golvet', () => {
    let s = { repetition: 3, interval: 10, easeFactor: MIN_EASE };
    for (let i = 0; i < 20; i++) s = schedule(s, RATING.AGAIN);
    expect(s.easeFactor).toBe(MIN_EASE);
  });

  it('muterar inte indata', () => {
    const fore = nyttKort();
    const kopia = { ...fore };
    schedule(fore, RATING.EASY);
    expect(fore).toEqual(kopia);
  });

  it('ger Latt pa ett nytt kort 4 dagar', () => {
    expect(schedule(nyttKort(), RATING.EASY).interval).toBe(4);
  });

  it('ger Svart pa ett nytt kort en halv dag', () => {
    expect(schedule(nyttKort(), RATING.HARD).interval).toBe(0.5);
  });
});

describe('nextReviewAt', () => {
  const NU = 1_700_000_000_000;

  it('lagger Igen en minut fram, inte en dag', () => {
    const next = schedule(nyttKort(), RATING.AGAIN);
    expect(nextReviewAt(next, RATING.AGAIN, NU)).toBe(NU + 60_000);
  });

  it('raknar om intervallet till millisekunder for ovriga betyg', () => {
    const next = schedule(nyttKort(), RATING.GOOD);
    expect(nextReviewAt(next, RATING.GOOD, NU)).toBe(NU + DAG);
  });
});

describe('withScheduleDefaults', () => {
  it('fyller i saknade falt sa att rakningen aldrig ger NaN', () => {
    // Detta ar exakt den data som gammal export och tidiga kort innehaller:
    // inga SM-2-falt alls. Utan defaults blev easeFactor undefined och
    // intervallet NaN, som sedan sparades till disk.
    const gammalt = { id: '1', front: 'a', back: 'b' };
    const fixat = withScheduleDefaults(gammalt, 0);
    expect(fixat.easeFactor).toBe(2.5);
    const next = schedule(fixat, RATING.GOOD);
    expect(Number.isFinite(next.interval)).toBe(true);
    expect(next.interval).toBe(1);
  });

  it('ror inte falt som redan finns', () => {
    const kort = { repetition: 4, interval: 12, easeFactor: 1.9, nextReviewDate: 5 };
    expect(withScheduleDefaults(kort, 0)).toMatchObject(kort);
  });

  it('behandlar noll som ett giltigt varde, inte som saknat', () => {
    const kort = { repetition: 0, interval: 0, easeFactor: 2.5, nextReviewDate: 0 };
    expect(withScheduleDefaults(kort, 999).nextReviewDate).toBe(0);
  });
});

describe('previewInterval', () => {
  it('visar samma intervall som betyget faktiskt ger', () => {
    // Den gamla forhandsvisningen raknade interval * ease med den GAMLA
    // ease-faktorn, medan Svart och Latt andrar ease i samma steg. Knappen
    // visade darfor ett annat tal an det kortet fick.
    const kort = { repetition: 3, interval: 10, easeFactor: 2.5 };
    for (const betyg of [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY]) {
      expect(previewInterval(kort, betyg)).toBe(schedule(kort, betyg).interval);
    }
  });

  it('skiljer sig fran den gamla formeln for Latt', () => {
    const kort = { repetition: 3, interval: 10, easeFactor: 2.5 };
    const gammalFormel = kort.interval * kort.easeFactor * 1.3; // 32.5
    expect(previewInterval(kort, RATING.EASY)).toBeCloseTo(10 * 2.65 * 1.3, 10);
    expect(previewInterval(kort, RATING.EASY)).not.toBeCloseTo(gammalFormel, 10);
  });
});

describe('isDue och maturity', () => {
  it('ar forfallet nar nextReviewDate passerat', () => {
    expect(isDue({ nextReviewDate: 100 }, 200)).toBe(true);
    expect(isDue({ nextReviewDate: 300 }, 200)).toBe(false);
  });

  it('saknad nextReviewDate raknas som forfallen', () => {
    expect(isDue({}, 200)).toBe(true);
  });

  it('klassar kort efter repetition och intervall', () => {
    expect(maturity({ repetition: 0, interval: 0 })).toBe('new');
    expect(maturity({ repetition: 2, interval: 6 })).toBe('learning');
    expect(maturity({ repetition: 9, interval: 21 })).toBe('mastered');
  });
});

describe('initialSchedule', () => {
  it('ger ett kort som ar forfallet direkt', () => {
    const s = initialSchedule(1000);
    expect(isDue(s, 1000)).toBe(true);
    expect(s.easeFactor).toBe(2.5);
  });
});
