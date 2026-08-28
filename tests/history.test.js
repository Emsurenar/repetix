import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  dailyCounts,
  heatmap,
  localDateKey,
  longestStreak,
  summarise,
} from '../src/domain/history.js';

/** Bygger en logg av repetitioner på angivna lokala datum. */
const logg = (...poster) =>
  poster.flatMap(([datum, antal = 1]) =>
    Array.from({ length: antal }, (_, i) => ({
      // Middagstid, så att testet inte blir tidszonskänsligt.
      reviewed_at: new Date(`${datum}T12:00:00`).toISOString(),
      id: `${datum}-${i}`,
    }))
  );

const den = (datum) => new Date(`${datum}T12:00:00`);

describe('localDateKey', () => {
  it('anvander lokal tid, inte UTC', () => {
    // En repetition sent pa kvallen ar gjord i dag. Med UTC hade den halva
    // aret hamnat pa morgondagen och brutit en streak som holl.
    const sent = new Date(2026, 2, 15, 23, 30);
    expect(localDateKey(sent)).toBe('2026-03-15');
  });

  it('nollutfyller manad och dag', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});

describe('dailyCounts', () => {
  it('raknar repetitioner per dag', () => {
    const counts = dailyCounts(logg(['2026-03-10', 3], ['2026-03-11', 1]));
    expect(counts.get('2026-03-10')).toBe(3);
    expect(counts.get('2026-03-11')).toBe(1);
  });

  it('ger en tom karta for en tom logg', () => {
    expect(dailyCounts([]).size).toBe(0);
  });
});

describe('currentStreak', () => {
  it('raknar sammanhangande dagar bakat fran idag', () => {
    const counts = dailyCounts(
      logg(['2026-03-13'], ['2026-03-14'], ['2026-03-15'])
    );
    expect(currentStreak(counts, den('2026-03-15'))).toBe(3);
  });

  it('bryts av en lucka', () => {
    const counts = dailyCounts(logg(['2026-03-11'], ['2026-03-14'], ['2026-03-15']));
    expect(currentStreak(counts, den('2026-03-15'))).toBe(2);
  });

  it('nollstaller inte streaken bara for att man inte repeterat an idag', () => {
    // Dagen ar inte slut. Hade vi nollstallt har skulle appen pasta att
    // streaken var forlorad varje morgon.
    const counts = dailyCounts(logg(['2026-03-13'], ['2026-03-14']));
    expect(currentStreak(counts, den('2026-03-15'))).toBe(2);
  });

  it('ar noll nar varken idag eller igar har nagon repetition', () => {
    const counts = dailyCounts(logg(['2026-03-10']));
    expect(currentStreak(counts, den('2026-03-15'))).toBe(0);
  });

  it('ar noll for en tom logg', () => {
    expect(currentStreak(dailyCounts([]), den('2026-03-15'))).toBe(0);
  });

  it('overlever manadsskifte', () => {
    const counts = dailyCounts(logg(['2026-02-28'], ['2026-03-01'], ['2026-03-02']));
    expect(currentStreak(counts, den('2026-03-02'))).toBe(3);
  });

  it('overlever skottdag', () => {
    const counts = dailyCounts(logg(['2024-02-28'], ['2024-02-29'], ['2024-03-01']));
    expect(currentStreak(counts, den('2024-03-01'))).toBe(3);
  });

  it('overlever arsskifte', () => {
    const counts = dailyCounts(logg(['2025-12-31'], ['2026-01-01']));
    expect(currentStreak(counts, den('2026-01-01'))).toBe(2);
  });
});

describe('longestStreak', () => {
  it('hittar den langsta serien, inte den senaste', () => {
    const counts = dailyCounts(
      logg(
        ['2026-01-01'], ['2026-01-02'], ['2026-01-03'], ['2026-01-04'],
        ['2026-03-14'], ['2026-03-15']
      )
    );
    expect(longestStreak(counts)).toBe(4);
  });

  it('ar noll for en tom logg', () => {
    expect(longestStreak(dailyCounts([]))).toBe(0);
  });

  it('ar ett for en enda dag', () => {
    expect(longestStreak(dailyCounts(logg(['2026-03-15'])))).toBe(1);
  });

  it('historiken raderar sig inte sjalv nar kort repeteras om', () => {
    // Detta ar hela poangen med loggen. Med den gamla metoden, som laste
    // card.lastReviewed, forsvann de tidigare dagarna sa fort samma kort
    // repeterades igen. Har finns bada dagarna kvar.
    const counts = dailyCounts([
      { reviewed_at: new Date('2026-03-10T12:00:00').toISOString(), card_id: 'k1' },
      { reviewed_at: new Date('2026-03-11T12:00:00').toISOString(), card_id: 'k1' },
    ]);
    expect(counts.get('2026-03-10')).toBe(1);
    expect(counts.get('2026-03-11')).toBe(1);
    expect(longestStreak(counts)).toBe(2);
  });
});

describe('heatmap', () => {
  it('ger ratt antal celler', () => {
    expect(heatmap(dailyCounts([]), { weeks: 12, today: den('2026-03-15') })).toHaveLength(84);
  });

  it('slutar pa en sondag sa att raderna borjar pa mandag', () => {
    const celler = heatmap(dailyCounts([]), { weeks: 4, today: den('2026-03-11') });
    const sista = new Date(`${celler.at(-1).date}T12:00:00`);
    expect(sista.getDay()).toBe(0);
    const forsta = new Date(`${celler[0].date}T12:00:00`);
    expect(forsta.getDay()).toBe(1);
  });

  it('markerar framtida dagar', () => {
    const celler = heatmap(dailyCounts([]), { weeks: 2, today: den('2026-03-11') });
    expect(celler.some((c) => c.future)).toBe(true);
    expect(celler.find((c) => c.date === '2026-03-11').future).toBe(false);
  });

  it('fyller i antal fran loggen', () => {
    const counts = dailyCounts(logg(['2026-03-10', 5]));
    const celler = heatmap(counts, { weeks: 4, today: den('2026-03-11') });
    expect(celler.find((c) => c.date === '2026-03-10').count).toBe(5);
  });
});

describe('summarise', () => {
  it('sammanfattar loggen', () => {
    const s = summarise(
      logg(['2026-03-13', 2], ['2026-03-14', 7], ['2026-03-15', 3]),
      den('2026-03-15')
    );
    expect(s.total).toBe(12);
    expect(s.today).toBe(3);
    expect(s.activeDays).toBe(3);
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
    expect(s.bestDay).toEqual({ date: '2026-03-14', count: 7 });
  });

  it('klarar en tom logg utan att kasta', () => {
    const s = summarise([], den('2026-03-15'));
    expect(s).toMatchObject({ total: 0, today: 0, activeDays: 0, currentStreak: 0 });
    expect(s.bestDay.date).toBeNull();
  });
});
