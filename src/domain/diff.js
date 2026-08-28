// Räknar ut vad som faktiskt ändrats mellan två ögonblicksbilder av
// biblioteket, så att synken kan skicka enskilda rader i stället för allt.
//
// Varför en diff i stället för att varje ändring anmäler sig själv: appen har
// ett fyrtiotal ställen som muterar data och sedan anropar saveData(). Att
// skriva om vart och ett till att rapportera sin avsikt vore både ett stort
// ingrepp och en ny felkälla — ett glömt anrop blir en ändring som tyst aldrig
// synkas. En diff kan inte missa något, eftersom den ser resultatet.
//
// Rena funktioner utan DOM, nätverk eller tillstånd.

import { TABLES } from './model.js';

/**
 * Fälten jämförs med strikt likhet efter JSON-serialisering. Det räcker
 * eftersom raderna bara innehåller primitiver — inga datum, funktioner eller
 * nästlade objekt.
 */
function rowsEqual(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    // Fält som servern äger jämförs inte: de sätts av databasen och skulle
    // annars få varje rad att se ändrad ut vid varje synk.
    if (k === 'updated_at' || k === 'created_at' || k === 'deleted_at') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

const indexById = (rows) => new Map(rows.map((r) => [r.id, r]));

/**
 * Jämför två utplattade ögonblicksbilder och returnerar de mutationer som tar
 * `prev` till `next`.
 *
 * Raderingar är mjuka: en rad som försvunnit ur `next` blir en `delete`-mutation
 * som synken översätter till `deleted_at = now()`. En hård radering skulle
 * återuppstå från en annan enhet som inte sett den.
 *
 * @param {object} prev utplattad bild, som `flatten()` returnerar
 * @param {object} next
 * @returns {{table:string, op:'upsert'|'delete', id:string, row?:object}[]}
 */
export function diffSnapshots(prev, next) {
  const mutations = [];

  for (const table of TABLES) {
    const before = indexById(prev?.[table] ?? []);
    const after = next?.[table] ?? [];
    const seen = new Set();

    for (const row of after) {
      seen.add(row.id);
      const old = before.get(row.id);
      if (!old) {
        mutations.push({ table, op: 'upsert', id: row.id, row });
      } else if (!rowsEqual(old, row)) {
        mutations.push({ table, op: 'upsert', id: row.id, row });
      }
    }

    for (const id of before.keys()) {
      if (!seen.has(id)) mutations.push({ table, op: 'delete', id });
    }
  }

  return mutations;
}

/**
 * Slår ihop en kö av mutationer så att bara den sista per rad står kvar.
 *
 * Utan detta växer utkorgen obegränsat när användaren redigerar samma kort
 * flera gånger offline, och synken skickar mellanlägen som ändå skrivs över.
 * Ordningen mellan tabeller bevaras enligt TABLES, så att en kortlek alltid
 * skapas före sina kort.
 */
export function collapse(mutations) {
  const latest = new Map();
  for (const m of mutations) {
    latest.set(`${m.table}:${m.id}`, m);
  }
  const order = new Map(TABLES.map((t, i) => [t, i]));
  return [...latest.values()].sort((a, b) => (order.get(a.table) ?? 0) - (order.get(b.table) ?? 0));
}

/**
 * Delar upp mutationer per tabell och operation, redo att skickas som
 * batchanrop i stället för en förfrågan per rad.
 */
export function groupForSend(mutations) {
  const upserts = new Map();
  const deletes = new Map();
  for (const m of mutations) {
    const target = m.op === 'delete' ? deletes : upserts;
    if (!target.has(m.table)) target.set(m.table, []);
    target.get(m.table).push(m.op === 'delete' ? m.id : m.row);
  }
  return {
    // Föräldrar före barn vid upsert, så att främmande nycklar finns.
    upserts: TABLES.filter((t) => upserts.has(t)).map((t) => ({ table: t, rows: upserts.get(t) })),
    // Barn före föräldrar vid radering, av samma skäl i omvänd riktning.
    deletes: TABLES.filter((t) => deletes.has(t))
      .reverse()
      .map((t) => ({ table: t, ids: deletes.get(t) })),
  };
}

/**
 * Löser en konflikt mellan lokal och fjärran version av samma rad.
 * Senaste ändring vinner, avgjort på serverns `updated_at`.
 *
 * Vid exakt lika tidsstämpel vinner fjärran, eftersom den redan är det alla
 * andra enheter kommer att se — då konvergerar alla enheter på samma värde i
 * stället för att var och en behåller sin egen.
 */
export function resolve(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const l = Date.parse(local.updated_at ?? 0) || 0;
  const r = Date.parse(remote.updated_at ?? 0) || 0;
  return l > r ? local : remote;
}
