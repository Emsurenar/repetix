// Statistik härledd ur repetitionsloggen.
//
// Tidigare räknades streak ur `card.lastReviewed`, ett fält som skrivs över
// vid varje ny repetition. Ett kort som repeterats om bar därför bara sitt
// senaste datum, och alla tidigare dagar försvann. Streaken raderade sig själv
// bakåt i tiden, och en dag vars alla kort sedan repeterats om räknades inte
// längre som studerad.
//
// Loggen är append-only, så samma beräkning ur den är korrekt för all framtid.
//
// Rena funktioner utan DOM, nätverk eller tillstånd.

/**
 * Datum som `YYYY-MM-DD` i användarens egen tidszon.
 *
 * Måste vara lokal tid, inte UTC: en repetition klockan 23:30 svensk tid är
 * gjord i dag, men skulle med UTC hamna på morgondagen halva året och bryta
 * en streak som faktiskt höll.
 */
export function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  const år = d.getFullYear();
  const månad = String(d.getMonth() + 1).padStart(2, '0');
  const dag = String(d.getDate()).padStart(2, '0');
  return `${år}-${månad}-${dag}`;
}

/** Antal repetitioner per dag, ur loggen. */
export function dailyCounts(reviews) {
  const counts = new Map();
  for (const r of reviews) {
    const key = localDateKey(r.reviewed_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const dagFöre = (key) => {
  const [å, m, d] = key.split('-').map(Number);
  const datum = new Date(å, m - 1, d);
  datum.setDate(datum.getDate() - 1);
  return localDateKey(datum);
};

/**
 * Nuvarande streak i dagar.
 *
 * Har man inte repeterat i dag är streaken inte bruten än — dagen är ju inte
 * slut. Räkningen börjar därför på gårdagen i det fallet, i stället för att
 * nollställa en streak som användaren fortfarande kan rädda.
 */
export function currentStreak(counts, today = new Date()) {
  const idag = localDateKey(today);
  let key = counts.get(idag) ? idag : dagFöre(idag);
  let streak = 0;
  while (counts.get(key)) {
    streak += 1;
    key = dagFöre(key);
  }
  return streak;
}

/** Längsta sammanhängande serie av studerade dagar i hela loggen. */
export function longestStreak(counts) {
  const dagar = [...counts.keys()].filter((k) => counts.get(k) > 0).sort();
  let längst = 0;
  let nuvarande = 0;
  let föregående = null;
  for (const dag of dagar) {
    nuvarande = föregående && dagFöre(dag) === föregående ? nuvarande + 1 : 1;
    längst = Math.max(längst, nuvarande);
    föregående = dag;
  }
  return längst;
}

/**
 * Rutnät för aktivitetskartan: `veckor` veckor bakåt, justerat så att varje
 * rad börjar på en måndag.
 */
export function heatmap(counts, { weeks = 12, today = new Date() } = {}) {
  const slut = new Date(today);
  // Måndag som veckostart: getDay() ger 0 för söndag, som alltså är dag 7.
  const veckodag = (slut.getDay() + 6) % 7;
  slut.setDate(slut.getDate() + (6 - veckodag));

  const celler = [];
  const dagar = weeks * 7;
  for (let i = dagar - 1; i >= 0; i--) {
    const datum = new Date(slut);
    datum.setDate(datum.getDate() - i);
    const key = localDateKey(datum);
    celler.push({ date: key, count: counts.get(key) ?? 0, future: datum > today });
  }
  return celler;
}

/**
 * Väver in dagsräkningar från tiden före repetitionsloggen.
 *
 * Befintliga användare har ingen logg — deras historik finns bara som
 * dagsräkningar i `pg_records`. Utan detta skulle streaken nollställas i det
 * ögonblick appen uppgraderas, vilket vore både fel och demoraliserande.
 * Loggen vinner för de dagar den täcker, eftersom den är exakt.
 */
export function mergeLegacyCounts(counts, legacy = {}) {
  const merged = new Map(counts);
  for (const [dag, antal] of Object.entries(legacy)) {
    if (!merged.has(dag) && antal > 0) merged.set(dag, antal);
  }
  return merged;
}

/** Sammanfattande siffror för Spelhallen. */
export function summarise(reviews, today = new Date()) {
  const counts = dailyCounts(reviews);
  const idag = localDateKey(today);
  return {
    counts,
    today: counts.get(idag) ?? 0,
    total: reviews.length,
    activeDays: [...counts.values()].filter((n) => n > 0).length,
    currentStreak: currentStreak(counts, today),
    longestStreak: longestStreak(counts),
    bestDay: [...counts.entries()].reduce(
      (bäst, [dag, antal]) => (antal > bäst.count ? { date: dag, count: antal } : bäst),
      { date: null, count: 0 }
    ),
  };
}
