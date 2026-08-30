# Användningsmätare — implementationsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visa vad AI-anropen kostat, per månad och per funktion, inne i appen — och varna vid ett självsatt månadstak.

**Architecture:** Leverantörernas tokental fångas i `api/ai.js`, den enda punkt alla AI-anrop passerar, och skrivs som en append-only-rad i `ai_usage` av användarens egen klient (ingen service role-nyckel). Kostnad lagras aldrig — den räknas fram vid visning ur en prislista i klienten, eftersom priser ändras men tokental är fakta.

**Tech Stack:** Vanilla JS i ES-moduler, Vite, Vitest, Supabase Postgres med radnivåsäkerhet, serverfunktioner i Node på Vercel.

**Spec:** [docs/superpowers/specs/2026-08-29-anvandningsmatare-design.md](../specs/2026-08-29-anvandningsmatare-design.md)

## Global Constraints

- Gränssnittet är på svenska. Kommentarer förklarar **varför**, aldrig vad.
- Commit-meddelanden på **engelska**, Conventional Commits, ingen attribution-rad. Repot är publikt — se `## Commits` i CLAUDE.md.
- `src/domain/` importerar aldrig från `src/ui/`. Rena funktioner testas utan webbläsare.
- Inga hårdkodade färger, radier eller avstånd utanför `src/styles/tokens.css`. Noll `!important`. Aldrig blått.
- `api/` har `no-console: error` — serverfunktionerna loggar med flit ingenting.
- Appen behöver **ingen** Supabase service role-nyckel. Serverfunktionerna arbetar med anroparens egen token.
- Migrationer körs för hand i Supabases SQL Editor, i nummerordning, och ska vara idempotenta.
- Kontraktet i `docs/api-contract.md` ändras **före** implementationen.
- Efter varje task: `npm run lint` (0 fel) och `npm test` (allt grönt).

---

### Task 1: Migration 0007 — tabellen och taket

**Files:**
- Create: `supabase/migrations/0007_ai_usage.sql`

**Interfaces:**
- Consumes: inget.
- Produces: tabellen `public.ai_usage` med kolumnerna `id, user_id, provider, model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at`; kolumnen `public.user_settings.ai_monthly_budget numeric`.

- [ ] **Step 1: Skriv migrationen**

```sql
-- Repetix — användningslogg för AI-anrop
--
-- Kör detta i Supabase SQL Editor efter 0005. Idempotent.
--
-- Tabellen är append-only, byggd som reviews: select och insert, aldrig update
-- eller delete. En bokföringsrad ändras inte och raderas inte, och därför finns
-- varken updated_at-trigger eller deleted_at här.
--
-- Endast tokental lagras, aldrig kostnad. Priser ändras; tokental är fakta.
-- Kostnaden räknas fram vid visning, precis som streak härleds ur reviews i
-- stället för att lagras.

create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null,
  model              text not null,
  -- Vilken funktion i appen som gjorde anropet. Avsiktligt utan check: ett nytt
  -- AI-läge ska inte kräva en migration, och ett okänt värde visas som sitt eget
  -- namn i panelen.
  feature            text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  created_at         timestamptz not null default now()
);

-- Driver panelens enda fråga: den här användarens rader för innevarande månad.
create index if not exists idx_ai_usage_user_time
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select on public.ai_usage;
drop policy if exists ai_usage_insert on public.ai_usage;

create policy ai_usage_select on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- with check hindrar en klient från att skriva någon annans user_id.
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Månadstaket är en preferens och hör hemma bland de andra. null = inget tak.
alter table public.user_settings
  add column if not exists ai_monthly_budget numeric;
```

- [ ] **Step 2: Kör den i Supabase SQL Editor**

Kör hela filen. Kör den sedan **en gång till** — den ska gå igenom utan fel, eftersom varje sats är idempotent.

- [ ] **Step 3: Verifiera att policyn hindrar främmande rader**

Kör i SQL Editor:

```sql
select tablename, policyname, cmd from pg_policies where tablename = 'ai_usage';
```

Förväntat: exakt två rader, `ai_usage_select` (SELECT) och `ai_usage_insert` (INSERT). Inga UPDATE- eller DELETE-policys — det är det som gör loggen append-only även för sin ägare.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0007_ai_usage.sql
git commit -m "feat(db): append-only table for AI usage, and a monthly budget field

Token counts only, never money: prices change and token counts are facts,
so cost is derived at display time the way a streak is derived from the
review log rather than stored.

Select and insert policies, no update or delete — the log stays
append-only even for the user who owns it, like reviews."
```

---

### Task 2: Kontraktet

**Files:**
- Modify: `docs/api-contract.md`

**Interfaces:**
- Consumes: inget.
- Produces: kontraktets beskrivning av `feature` i begäran och `usage` i svaret. Task 3–5 implementerar det som står här.

- [ ] **Step 1: Uppdatera POST /api/ai i kontraktet**

Ersätt begäran- och svarsexemplen under `## POST /api/ai` med:

````markdown
```jsonc
// Begäran
{
  "system": "...",
  "user": "...",
  "maxTokens": 1024,
  "json": false,
  "provider": "anthropic",
  "model": "claude-opus-5",
  // Vilken funktion i appen som frågar. Loggas i ai_usage så att panelen kan
  // visa vad pengarna gick till. Servern kan inte härleda det — bara klienten
  // vet varför anropet görs.
  "feature": "topic"
}

// Svar 200
{
  "text": "...",
  "provider": "anthropic",
  "model": "claude-opus-5",
  // Leverantörens egna tokental. Fält som leverantören inte rapporterar är 0.
  "usage": {
    "inputTokens": 12040,
    "outputTokens": 830,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0
  }
}
```

`feature` är obligatoriskt och högst 40 tecken. Värdet lagras som det kommer,
utan lista över tillåtna värden: ett nytt AI-läge ska inte kräva en migration.

`usage` skrivs också till `ai_usage`. Misslyckas den skrivningen returneras
svaret ändå — en bokföringsrad får aldrig sänka det användaren bad om.
````

- [ ] **Step 2: Commit**

```bash
git add docs/api-contract.md
git commit -m "docs(api): add the feature field and the usage response

The contract changes before either implementation does, per CLAUDE.md.
feature has to come from the client because only the client knows why a
call is being made; usage comes back so a caller can show what a single
generation cost without querying the table."
```

---

### Task 3: `extractUsage` per leverantör

**Files:**
- Modify: `api/_lib/providers.js`
- Test: `tests/providers.test.js`

**Interfaces:**
- Consumes: inget.
- Produces: `providers.<id>.extractUsage(data)` för alla fyra leverantörer, som returnerar `{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }`. Alla fält är alltid tal, aldrig `undefined`.

- [ ] **Step 1: Skriv de fallerande testerna**

Lägg till sist i `tests/providers.test.js`:

```js
/* Tokentalen heter olika hos varje leverantör, och ett fält som saknas ska bli
 * noll och aldrig undefined: summeringen i panelen adderar dem rakt av, och en
 * enda undefined hade gjort hela månadssumman till NaN.
 *
 * Formen för de tre icke-Anthropic-leverantörerna är antagen och inte
 * verifierad mot ett riktigt svar. Därför är noll det säkra utfallet: gissar vi
 * fel fält får vi nollor, inte påhittade tal. */
describe('extractUsage', () => {
  it('läser Anthropics fält, cache inräknad', () => {
    expect(
      providers.anthropic.extractUsage({
        usage: {
          input_tokens: 1200,
          output_tokens: 340,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 8000,
        },
      })
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheWriteTokens: 900,
      cacheReadTokens: 8000,
    });
  });

  it('läser OpenAI:s fält', () => {
    expect(
      providers.openai.extractUsage({
        usage: { prompt_tokens: 500, completion_tokens: 120 },
      })
    ).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('läser Googles fält', () => {
    expect(
      providers.google.extractUsage({
        usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 90 },
      })
    ).toEqual({
      inputTokens: 700,
      outputTokens: 90,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('läser OpenRouters fält', () => {
    expect(
      providers.openrouter.extractUsage({
        usage: { prompt_tokens: 60, completion_tokens: 10 },
      })
    ).toEqual({
      inputTokens: 60,
      outputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('ger nollor när svaret saknar usage helt', () => {
    for (const id of providerIds) {
      expect(providers[id].extractUsage({})).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
      expect(providers[id].extractUsage(null)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
    }
  });
});
```

- [ ] **Step 2: Kör testet och se att det fallerar**

```bash
npx vitest run tests/providers.test.js
```

Förväntat: FAIL, `providers.anthropic.extractUsage is not a function`.

- [ ] **Step 3: Lägg till hjälparen och de fyra metoderna**

Lägg hjälparen i `api/_lib/providers.js`, ovanför `export const providers`:

```js
/**
 * Ett tal, eller noll.
 *
 * Leverantörernas svar är inte kontrakt vi äger: ett fält kan saknas, byta namn
 * eller komma som null. Summeringen i panelen adderar de här talen rakt av, och
 * en enda undefined hade gjort hela månadssumman till NaN.
 */
const tal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
```

Lägg sedan `extractUsage` i varje adapter, direkt efter dess `extractText`:

```js
// anthropic — enda leverantören som rapporterar cache separat
extractUsage(data) {
  const u = data?.usage;
  return {
    inputTokens: tal(u?.input_tokens),
    outputTokens: tal(u?.output_tokens),
    cacheWriteTokens: tal(u?.cache_creation_input_tokens),
    cacheReadTokens: tal(u?.cache_read_input_tokens),
  };
},
```

```js
// openai
extractUsage(data) {
  const u = data?.usage;
  return {
    inputTokens: tal(u?.prompt_tokens),
    outputTokens: tal(u?.completion_tokens),
    cacheWriteTokens: 0,
    cacheReadTokens: tal(u?.prompt_tokens_details?.cached_tokens),
  };
},
```

```js
// google
extractUsage(data) {
  const u = data?.usageMetadata;
  return {
    inputTokens: tal(u?.promptTokenCount),
    outputTokens: tal(u?.candidatesTokenCount),
    cacheWriteTokens: 0,
    cacheReadTokens: tal(u?.cachedContentTokenCount),
  };
},
```

```js
// openrouter — OpenAI-kompatibelt svar
extractUsage(data) {
  const u = data?.usage;
  return {
    inputTokens: tal(u?.prompt_tokens),
    outputTokens: tal(u?.completion_tokens),
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
},
```

- [ ] **Step 4: Kör testerna**

```bash
npx vitest run tests/providers.test.js && npm run lint
```

Förväntat: alla gröna, 0 lint-fel.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/providers.js tests/providers.test.js
git commit -m "feat(api): read the token counts each provider reports

Every provider names them differently, which is what the adapter pattern
is for — extractUsage sits beside the extractText that was already there.

A missing field becomes zero, never undefined: the panel adds these
numbers directly and one undefined would turn a whole month into NaN. It
also makes a wrong guess safe — the three non-Anthropic shapes are
assumed rather than verified against a live response, and guessing wrong
yields zeros instead of invented numbers."
```

---

### Task 4: `feature` genom kontraktet och de elva anropsställena

**Files:**
- Modify: `api/ai.js` (läs och validera `body.feature`)
- Modify: `src/ai/call.js` (nytt argument, skickas i kroppen)
- Modify: `src/ai/topic-generator.js`, `src/ai/diary.js`, `src/ai/proposed-cards.js`, `src/ai/sort.js`, `src/ai/deck-insights.js`, `src/ai/card-ai.js`, `src/ai/study-ai.js`, `src/ui/wiring/ai-actions.js`
- Test: `tests/call.test.js`

**Interfaces:**
- Consumes: inget.
- Produces: `callAI({ ..., feature })` skickar `feature` i kroppen till `/api/ai`; servern läser det som ett obligatoriskt textfält på högst 40 tecken och har det tillgängligt som `feature` i `handler`.

- [ ] **Step 1: Skriv det fallerande testet**

Lägg till i `tests/call.test.js`:

Filen mockar redan `../src/core/supabase.js` och har hjälparen `svar(status, body)`
högst upp. Testet nedan använder båda:

```js
it('skickar med feature i kroppen', async () => {
  const skickat = [];
  globalThis.fetch = async (url, init) => {
    skickat.push(JSON.parse(init.body));
    return svar(200, { text: 'ett svar' });
  };

  await callAI({ user: 'hej', feature: 'tutor' });

  expect(skickat).toHaveLength(1);
  expect(skickat[0].feature).toBe('tutor');
});
```

- [ ] **Step 2: Kör och se att det fallerar**

```bash
npx vitest run tests/call.test.js
```

Förväntat: FAIL, `expected undefined to be 'tutor'`.

- [ ] **Step 3: Skicka fältet från klienten**

I `src/ai/call.js`, ändra signaturen och kroppen:

```js
export async function callAI({ system, user, maxTokens, json, provider, model, feature, signal } = {}) {
```

```js
        body: JSON.stringify({ system, user, maxTokens, json, provider, model, feature }),
```

- [ ] **Step 4: Läs och validera fältet på servern**

I `api/ai.js`, lägg konstanten bredvid de andra fältgränserna:

```js
/* Funktionens namn är vårt eget och kort. Taket finns av samma skäl som de
 * andra: ett obegränsat fält gör slutpunkten till en väg att skriva godtycklig
 * mängd data till databasen. */
const MAX_FEATURE_CHARS = 40;
```

Och i `handler`, direkt efter raden som läser `system`:

```js
  const feature = readTextField(body.feature, {
    name: 'feature',
    max: MAX_FEATURE_CHARS,
    required: true,
  });
```

- [ ] **Step 5: Skicka `feature` från alla elva anropsställen**

Lägg `feature: '<värde>'` i objektet till `callAI` på varje rad nedan. Värdena är hämtade ur specens tabell:

| Fil och rad | `feature` |
|---|---|
| `src/ai/topic-generator.js:84` | `'topic'` |
| `src/ai/diary.js:24` | `'diary'` |
| `src/ai/proposed-cards.js:164` | `'regenerate'` |
| `src/ai/sort.js:34` | `'sort'` |
| `src/ui/wiring/ai-actions.js:22` | `'autofolder'` |
| `src/ui/wiring/ai-actions.js:130` | `'answer'` |
| `src/ai/deck-insights.js:53` | `'suggest'` |
| `src/ai/deck-insights.js:136` | `'summary'` |
| `src/ai/card-ai.js:16` | `'explain'` |
| `src/ai/card-ai.js:63` | `'testquestion'` |
| `src/ai/study-ai.js:15` | `'tutor'` |

Kontrollera att inget ställe missats:

```bash
grep -rn "callAI({" src/ | grep -v "src/ai/call.js" | wc -l   # ska vara 11
grep -rn -A 8 "callAI({" src/ | grep -c "feature:"            # ska vara 11
```

- [ ] **Step 6: Kör allt**

```bash
npm run lint && npm test
```

Förväntat: 0 lint-fel, alla tester gröna.

- [ ] **Step 7: Commit**

```bash
git add api/ai.js src/ai/ src/ui/wiring/ai-actions.js tests/call.test.js
git commit -m "feat(ai): say which feature is asking on every AI call

The server cannot derive this — only the caller knows why a call is being
made — so it travels in the request body and every one of the eleven call
sites names itself.

Validated as an ordinary text field with a 40-character ceiling, for the
same reason the others have one: an unbounded field is a way to write
arbitrary data to the database."
```

---

### Task 5: Skriv raden

**Files:**
- Modify: `api/ai.js`
- Create: `api/_lib/usage.js`
- Test: `tests/usage.test.js`

**Interfaces:**
- Consumes: `providers.<id>.extractUsage` (Task 3), `feature` i `handler` (Task 4).
- Produces: `recordUsage(db, { userId, provider, model, feature, usage })` från `api/_lib/usage.js`, som aldrig kastar. `callProvider` returnerar nu `{ text, usage }`.

- [ ] **Step 1: Skriv de fallerande testerna**

Skapa `tests/usage.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { recordUsage } from '../api/_lib/usage.js';

const falskDb = (utfall) => ({
  from(tabell) {
    this.tabell = tabell;
    return {
      insert: async (rad) => {
        this.rad = rad;
        return utfall;
      },
    };
  },
});

describe('recordUsage', () => {
  it('skriver en rad med tokentalen', async () => {
    const db = falskDb({ error: null });
    await recordUsage(db, {
      userId: 'u1',
      provider: 'anthropic',
      model: 'claude-opus-5',
      feature: 'tutor',
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 1 },
    });
    expect(db.tabell).toBe('ai_usage');
    expect(db.rad).toMatchObject({
      user_id: 'u1',
      provider: 'anthropic',
      model: 'claude-opus-5',
      feature: 'tutor',
      input_tokens: 10,
      output_tokens: 2,
      cache_read_tokens: 5,
      cache_write_tokens: 1,
    });
  });

  /* En bokföringsrad får aldrig sänka det användaren faktiskt bad om: svaret
   * från leverantören är redan betalt och ska levereras även om vi inte lyckas
   * anteckna det. */
  it('kastar inte när databasen svarar med fel', async () => {
    const db = falskDb({ error: { message: 'nekad' } });
    await expect(
      recordUsage(db, {
        userId: 'u1',
        provider: 'anthropic',
        model: 'm',
        feature: 'tutor',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })
    ).resolves.toBeUndefined();
  });

  it('kastar inte när klienten själv exploderar', async () => {
    const trasigDb = {
      from() {
        throw new Error('ingen uppkoppling');
      },
    };
    await expect(
      recordUsage(trasigDb, {
        userId: 'u1',
        provider: 'anthropic',
        model: 'm',
        feature: 'tutor',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Kör och se att det fallerar**

```bash
npx vitest run tests/usage.test.js
```

Förväntat: FAIL, modulen `api/_lib/usage.js` finns inte.

- [ ] **Step 3: Skriv modulen**

Skapa `api/_lib/usage.js`:

```js
// Användningsloggen.
//
// Raden skrivs som användaren, med samma klient som resten av anropet — insert-
// policyn kräver user_id = auth.uid(), och det värdet kommer ur anroparens egen
// token. Ingen service role-nyckel behövs, som ingen annanstans i appen.

/**
 * Antecknar ett AI-anrops tokental. Kastar aldrig.
 *
 * Ett misslyckande här får inte sänka anropet. Svaret från leverantören är redan
 * betalt och ska levereras även om vi inte lyckas anteckna det — en tapp i
 * bokföringen är ett litet fel, ett tappat svar ett stort. Felet sväljs tyst
 * eftersom serverfunktionerna med flit inte loggar: en logg är det enklaste
 * sättet att av misstag skriva ut en användares nyckel.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db klient som agerar som användaren
 * @param {{userId: string, provider: string, model: string, feature: string,
 *          usage: {inputTokens: number, outputTokens: number,
 *                  cacheReadTokens: number, cacheWriteTokens: number}}} rad
 */
export async function recordUsage(db, { userId, provider, model, feature, usage }) {
  try {
    await db.from('ai_usage').insert({
      user_id: userId,
      provider,
      model,
      feature,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
    });
  } catch {
    // Se ovan: avsiktligt tyst.
  }
}
```

- [ ] **Step 4: Kör testet**

```bash
npx vitest run tests/usage.test.js
```

Förväntat: PASS.

- [ ] **Step 5: Låt `callProvider` lämna ifrån sig tokentalen**

I `api/ai.js`, byt slutet av `callProvider` (raderna som idag returnerar `text`):

```js
  const data = await res.json().catch(() => null);
  const text = provider.extractText(data);
  if (!text) {
    throw new ApiError(502, 'provider_error', 'Leverantören svarade utan någon text.');
  }
  return { text, usage: provider.extractUsage(data) };
```

- [ ] **Step 6: Skriv raden och skicka med `usage` i svaret**

I `handler`, byt de två sista raderna i `try`-blocket:

```js
    const { text, usage } = await callProvider(provider, request);

    // Efter att svaret säkrats, före att det skickas. Skrivningen kan inte
    // kasta, så ordningen kostar ingenting.
    await recordUsage(db, { userId, provider: providerName, model, feature, usage });

    sendJson(res, 200, { text, provider: providerName, model, usage });
```

Lägg importen högst upp bland de andra:

```js
import { recordUsage } from './_lib/usage.js';
```

- [ ] **Step 7: Kör allt**

```bash
npm run lint && npm test
```

- [ ] **Step 8: Verifiera mot den riktiga databasen**

Starta `preview_start` med namnet `repetix`, logga in, gör ett AI-anrop (t.ex. Sammanfatta kortleken). Kör sedan i Supabase SQL Editor:

```sql
select feature, model, input_tokens, output_tokens, created_at
from public.ai_usage order by created_at desc limit 5;
```

Förväntat: en rad med rätt `feature` och tokental som inte är noll.

- [ ] **Step 9: Commit**

```bash
git add api/ai.js api/_lib/usage.js tests/usage.test.js
git commit -m "feat(api): record what each AI call actually used

The counts already passed through this one point and were dropped here.
They are now written as the user — the insert policy checks
user_id = auth.uid(), which comes from the caller's own token, so no
service role key is involved.

recordUsage never throws. The provider's answer is already paid for and
must be delivered even when we fail to note it down: a gap in the ledger
is a small fault, a lost answer a large one."
```

---

### Task 6: Prislistan

**Files:**
- Create: `src/ai/pricing.js`
- Test: `tests/pricing.test.js`

**Interfaces:**
- Consumes: inget.
- Produces: `kostnad({ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })` → `number | null` (dollar; `null` när modellen saknar pris), och `harPris(model)` → `boolean`.

- [ ] **Step 1: Skriv de fallerande testerna**

Skapa `tests/pricing.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { harPris, kostnad } from '../src/ai/pricing.js';

describe('kostnad', () => {
  it('räknar input och output per miljon tokens', () => {
    // Opus 5: $5 in, $25 ut per Mtok.
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(5, 6);
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 100_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(2.5, 6);
  });

  /* Cachad läsning är en tiondel av input och cachad skrivning en och en
   * kvarts. Det är hela poängen med att grunda en PDF i kontexten, så det ska
   * synas som en egen post och inte döljas i input. */
  it('prissätter cachad läsning och skrivning ur input', () => {
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      })
    ).toBeCloseTo(0.5, 6);
    expect(
      kostnad({
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
      })
    ).toBeCloseTo(6.25, 6);
  });

  /* Användaren kan skriva in vilket modell-id som helst, och leverantörerna
   * släpper nya modeller oftare än appen uppdateras. En gissad prislapp vore
   * sämre än en ärlig lucka: null betyder "vet inte", inte "gratis". */
  it('ger null för en modell utan pris', () => {
    expect(
      kostnad({
        model: 'gpt-något-nytt',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    ).toBeNull();
    expect(harPris('gpt-något-nytt')).toBe(false);
    expect(harPris('claude-opus-5')).toBe(true);
  });

  it('kan alla modeller appen listar för Anthropic', () => {
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-fable-5']) {
      expect(harPris(m)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Kör och se att det fallerar**

```bash
npx vitest run tests/pricing.test.js
```

Förväntat: FAIL, modulen finns inte.

- [ ] **Step 3: Skriv modulen**

Skapa `src/ai/pricing.js`:

```js
/* Prislista, i dollar per miljon tokens.
 *
 * Kostnad lagras aldrig — den räknas fram här, ur tokentalen i ai_usage. Det är
 * samma delning som mellan repetitionsloggen och streaken: det som mätts sparas,
 * det som härleds beräknas. Ändrar en leverantör sitt pris räknas historiken om
 * i stället för att bli fel.
 *
 * Listan innehåller bara Anthropics modeller, eftersom det är de priser som
 * gått att verifiera. Övriga leverantörer faller på regeln i kostnad(): tokental
 * visas, kostnaden lämnas tom. En påhittad prislapp vore sämre än en ärlig lucka.
 */
const PRISER = {
  'claude-opus-5': { in: 5, ut: 25 },
  'claude-opus-4-8': { in: 5, ut: 25 },
  'claude-sonnet-5': { in: 2, ut: 10 },
  'claude-haiku-4-5': { in: 1, ut: 5 },
  'claude-fable-5': { in: 10, ut: 50 },
};

/* Cachade tokens prissätts ur input i stället för som egna tal. Skrevs de ut
 * per modell vore det fyra tal att hålla i synk i stället för två, och den
 * dagen ett pris ändras är det två av dem som glöms. */
const CACHE_LAS = 0.1;
const CACHE_SKRIV = 1.25;

const MILJON = 1_000_000;

/** Finns ett pris för modellen? */
export function harPris(model) {
  return Object.hasOwn(PRISER, String(model));
}

/**
 * Vad ett anrop kostade, i dollar.
 *
 * @returns {number|null} null när modellen saknar pris — "vet inte", inte "gratis".
 */
export function kostnad({ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  const pris = PRISER[String(model)];
  if (!pris) return null;

  return (
    ((inputTokens ?? 0) * pris.in +
      (outputTokens ?? 0) * pris.ut +
      (cacheReadTokens ?? 0) * pris.in * CACHE_LAS +
      (cacheWriteTokens ?? 0) * pris.in * CACHE_SKRIV) /
    MILJON
  );
}
```

- [ ] **Step 4: Kör testet**

```bash
npx vitest run tests/pricing.test.js && npm run lint
```

Förväntat: PASS, 0 lint-fel.

- [ ] **Step 5: Commit**

```bash
git add src/ai/pricing.js tests/pricing.test.js
git commit -m "feat(ai): work out what a call cost from its token counts

Cost is derived, never stored — the same split the app already makes
between the review log and a streak. When a provider changes its prices
the history is recomputed instead of becoming wrong.

Only Anthropic's models are listed, because those are the prices that
could be verified. Everything else returns null, which the panel prints
as a gap: an invented price would be worse than an honest one."
```

---

### Task 7: Summering och panelen

**Files:**
- Create: `src/domain/usage.js`
- Test: `tests/usage-summary.test.js`
- Modify: `index.html` (nytt avsnitt i inställningsvyn)
- Modify: `src/ui/settings.js`
- Modify: `src/styles/views/settings.css`

**Interfaces:**
- Consumes: `kostnad`, `harPris` (Task 6); tabellen `ai_usage` (Task 1).
- Produces: `summera(rader, { fran, till })` → `{ total: number, okändaModeller: boolean, tokens: {in: number, ut: number}, perFunktion: Array<{feature: string, kostnad: number}> }`, sorterad fallande på kostnad.

- [ ] **Step 1: Skriv de fallerande testerna**

Skapa `tests/usage-summary.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { summera } from '../src/domain/usage.js';

const rad = (over) => ({
  model: 'claude-opus-5',
  feature: 'tutor',
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  created_at: '2026-08-15T10:00:00.000Z',
  ...over,
});

describe('summera', () => {
  it('summerar kostnad och tokental', () => {
    const r = summera([
      rad({ input_tokens: 1_000_000 }),
      rad({ output_tokens: 100_000 }),
    ]);
    expect(r.total).toBeCloseTo(7.5, 6);
    expect(r.tokens).toEqual({ in: 1_000_000, ut: 100_000 });
  });

  it('grupperar per funktion, dyrast först', () => {
    const r = summera([
      rad({ feature: 'tutor', input_tokens: 100_000 }),
      rad({ feature: 'topic', input_tokens: 1_000_000 }),
    ]);
    expect(r.perFunktion.map((p) => p.feature)).toEqual(['topic', 'tutor']);
    expect(r.perFunktion[0].kostnad).toBeCloseTo(5, 6);
  });

  /* En modell utan pris får inte tyst räknas som noll — då hade summan sett
   * komplett ut medan den saknade poster. Flaggan låter panelen säga det. */
  it('flaggar när någon rad saknar pris', () => {
    const r = summera([rad({ model: 'okänd-modell', input_tokens: 1000 })]);
    expect(r.okändaModeller).toBe(true);
    expect(r.total).toBe(0);
  });

  it('filtrerar på datumintervall i lokal tid', () => {
    const rader = [
      rad({ created_at: '2026-08-01T00:00:00.000Z', input_tokens: 1_000_000 }),
      rad({ created_at: '2026-07-31T00:00:00.000Z', input_tokens: 1_000_000 }),
    ];
    const r = summera(rader, { fran: '2026-08-01', till: '2026-08-31' });
    expect(r.total).toBeCloseTo(5, 6);
  });
});
```

- [ ] **Step 2: Kör och se att det fallerar**

```bash
npx vitest run tests/usage-summary.test.js
```

Förväntat: FAIL, modulen finns inte.

- [ ] **Step 3: Skriv domänmodulen**

Skapa `src/domain/usage.js`:

```js
/* Summering av användningsloggen.
 *
 * Ren funktion utan DOM och utan nät, som resten av domain/. Datumen kommer in
 * som färdiga YYYY-MM-DD-strängar i stället för att räknas fram här: gränsen för
 * "denna månad" ska följa användarens lokala kalender, och den vetskapen hör
 * hemma hos anroparen — inte i en funktion som ska gå att testa utan tidszon.
 */

import { harPris, kostnad } from '../ai/pricing.js';

const lokaltDatum = (iso) => {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
};

/**
 * @param {Array<object>} rader rader ur ai_usage
 * @param {{fran?: string, till?: string}} [intervall] YYYY-MM-DD, inklusive båda ändar
 */
export function summera(rader, { fran, till } = {}) {
  let total = 0;
  let okändaModeller = false;
  const tokens = { in: 0, ut: 0 };
  const perFunktion = new Map();

  for (const r of rader ?? []) {
    const dag = lokaltDatum(r.created_at);
    if (fran && dag < fran) continue;
    if (till && dag > till) continue;

    tokens.in += (r.input_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
    tokens.ut += r.output_tokens ?? 0;

    if (!harPris(r.model)) {
      okändaModeller = true;
      continue;
    }

    const c = kostnad({
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    });
    total += c;
    perFunktion.set(r.feature, (perFunktion.get(r.feature) ?? 0) + c);
  }

  return {
    total,
    okändaModeller,
    tokens,
    perFunktion: [...perFunktion]
      .map(([feature, kostnad]) => ({ feature, kostnad }))
      .sort((a, b) => b.kostnad - a.kostnad),
  };
}
```

- [ ] **Step 4: Kör testet**

```bash
npx vitest run tests/usage-summary.test.js
```

Förväntat: PASS.

- [ ] **Step 5: Lägg avsnittet i markup**

I `index.html`, direkt efter `</section>` som avslutar Data-avsnittet och före Konto-avsnittet:

```html
            <!-- Användning. Visas bara med konto: mätaren mäter molnanrop, och
                 lokalt läge gör inga. -->
            <section class="settings-section" id="settings-usage-section" aria-labelledby="settings-usage-title" hidden>
                <div class="settings-section-head">
                    <h2 id="settings-usage-title" class="settings-section-title">Användning</h2>
                </div>

                <div class="set-row">
                    <div class="set-label">Denna månad</div>
                    <div class="set-field">
                        <div class="set-inline">
                            <p id="usage-month" class="usage-sum num">–</p>
                            <p id="usage-month-tokens" class="set-hint num"></p>
                        </div>
                    </div>
                </div>

                <div class="set-row">
                    <div class="set-label">Idag</div>
                    <div class="set-field">
                        <p id="usage-today" class="usage-sum num">–</p>
                    </div>
                </div>

                <div class="set-row" id="usage-breakdown-row" hidden>
                    <div class="set-label">Per funktion</div>
                    <div class="set-field">
                        <ul id="usage-breakdown" class="usage-list"></ul>
                    </div>
                </div>

                <div class="set-row">
                    <label class="set-label" for="settings-budget">Månadstak</label>
                    <div class="set-field">
                        <div class="set-inline">
                            <input type="number" id="settings-budget" class="field" min="0" step="1" inputmode="decimal" placeholder="Inget tak">
                            <button type="button" id="btn-settings-save-budget" class="btn">Spara tak</button>
                        </div>
                    </div>
                </div>
            </section>
```

- [ ] **Step 6: Fyll panelen**

I `src/ui/settings.js`, lägg till importerna:

```js
import { summera } from '../domain/usage.js';
import { getLocalDateString } from '../domain/stats.js';
```

Lägg funktionerna nedan bland de andra render-funktionerna. Anropa dem när vyn
öppnas, direkt efter `await laddaNyckelstatus();` (i dag rad 522):

```js
  await laddaNyckelstatus();
  await renderaAnvandning();
```


```js
/** Namnen på funktionerna, för panelen. Okända värden visas som de står. */
const FUNKTIONSNAMN = {
  topic: 'Kort ur ämne eller text',
  diary: 'Kort ur dagbok',
  regenerate: 'Gör om kort',
  sort: 'Sortering',
  autofolder: 'Välj mapp',
  answer: 'Generera svar',
  summary: 'Sammanfattning',
  suggest: 'Föreslå kort',
  explain: 'Fördjupning',
  testquestion: 'Testfråga',
  tutor: 'Handledare',
};

/* Två decimaler räcker och en tredje ljuger: ett enskilt anrop kan kosta mindre
 * än en cent, men det är månadssumman panelen finns för. */
const dollar = (n) => `$${n.toFixed(2)}`;

async function renderaAnvandning() {
  const sektion = el('settings-usage-section');
  if (!sektion) return;

  const userId = getUserId();
  sektion.hidden = !userId;
  if (!userId) return;

  const idag = getLocalDateString();
  const manadsstart = `${idag.slice(0, 7)}-01`;

  const { data, error } = await supabase
    .from('ai_usage')
    .select('model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at')
    .gte('created_at', `${manadsstart}T00:00:00.000Z`)
    .order('created_at', { ascending: false });

  if (error) {
    el('usage-month').textContent = 'Kunde inte läsa';
    return;
  }

  const manad = summera(data, { fran: manadsstart, till: idag });
  const dag = summera(data, { fran: idag, till: idag });

  el('usage-month').textContent = dollar(manad.total);
  el('usage-today').textContent = dollar(dag.total);
  el('usage-month-tokens').textContent =
    `${manad.tokens.in.toLocaleString('sv-SE')} in · ${manad.tokens.ut.toLocaleString('sv-SE')} ut` +
    (manad.okändaModeller ? ' · någon modell saknar pris' : '');

  const rad = el('usage-breakdown-row');
  const lista = el('usage-breakdown');
  rad.hidden = manad.perFunktion.length === 0;
  lista.innerHTML = '';
  for (const post of manad.perFunktion) {
    const li = document.createElement('li');
    li.className = 'usage-item';
    const namn = document.createElement('span');
    namn.textContent = FUNKTIONSNAMN[post.feature] ?? post.feature;
    const belopp = document.createElement('span');
    belopp.className = 'num';
    belopp.textContent = dollar(post.kostnad);
    li.append(namn, belopp);
    lista.appendChild(li);
  }
}
```

- [ ] **Step 7: Stil**

Lägg sist i `src/styles/views/settings.css`:

```css
/* Summan är ett tal man läser, inte en rubrik. Samma steg som fältens text,
 * med sifferfonten som resten av appens tal. */
#view-settings .usage-sum {
  margin: 0;
  font-size: var(--t-md);
  color: var(--text-1);
}

#view-settings .usage-list {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Namn till vänster, belopp till höger. Beloppen står då i en kolumn och går
 * att jämföra utan att läsas ett i taget. */
#view-settings .usage-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s4);
  font-size: var(--t-sm);
  color: var(--text-2);
}
```

- [ ] **Step 8: Verifiera i webbläsaren**

Starta `preview_start` med namnet `repetix`. Logga in, gör några AI-anrop av olika slag, öppna Inställningar. Kontrollera: månads- och dagssumma i dollar, uppdelningen sorterad med dyrast överst, och att avsnittet är dolt när man är utloggad.

- [ ] **Step 9: Commit**

```bash
git add src/domain/usage.js tests/usage-summary.test.js index.html src/ui/settings.js src/styles/views/settings.css
git commit -m "feat(installningar): show what this month's AI calls cost

Summing is a pure function in domain/ and takes its date range as plain
YYYY-MM-DD strings rather than working them out itself: the boundary for
'this month' has to follow the user's own calendar, and that knowledge
belongs to the caller, not to a function that should be testable without
a timezone.

A model with no price is counted in tokens but not in money, and the
panel says so. Counting it as zero would make the total look complete
while it was missing entries."
```

---

### Task 8: Taket och varningen

**Files:**
- Modify: `src/ui/settings.js` (spara och läsa taket)
- Modify: `index.html` (statusraden i sidopanelen)
- Modify: `src/app/cloud.js` (visa varningen)
- Modify: `src/styles/layout.css`
- Test: `tests/usage-summary.test.js` (utökas)

**Interfaces:**
- Consumes: `summera` (Task 7), `ai_monthly_budget` i `user_settings` (Task 1).
- Produces: `budgetLage(total, tak)` → `'ok' | 'nara' | 'over'` från `src/domain/usage.js`.

- [ ] **Step 1: Skriv det fallerande testet**

Lägg till i `tests/usage-summary.test.js`:

```js
import { budgetLage } from '../src/domain/usage.js';

/* Åttio procent, inte nittio: varningen ska komma medan det fortfarande går att
 * ändra sig. Utan tak finns inget läge att varna om. */
describe('budgetLage', () => {
  it('är ok under åttio procent', () => {
    expect(budgetLage(7.9, 10)).toBe('ok');
  });
  it('är nära från åttio procent', () => {
    expect(budgetLage(8, 10)).toBe('nara');
    expect(budgetLage(9.99, 10)).toBe('nara');
  });
  it('är över från hundra procent', () => {
    expect(budgetLage(10, 10)).toBe('over');
  });
  it('är ok när inget tak är satt', () => {
    expect(budgetLage(1000, null)).toBe('ok');
    expect(budgetLage(1000, 0)).toBe('ok');
  });
});
```

- [ ] **Step 2: Kör och se att det fallerar**

```bash
npx vitest run tests/usage-summary.test.js
```

Förväntat: FAIL, `budgetLage is not a function`.

- [ ] **Step 3: Skriv funktionen**

Lägg till sist i `src/domain/usage.js`:

```js
/* Åttio procent, inte nittio: varningen ska komma medan det fortfarande går att
 * ändra sig — byta modell, vänta till nästa månad — inte när pengarna redan är
 * slut. Ett tak på noll eller null betyder inget tak, inte ett omöjligt tak. */
const NARA = 0.8;

/**
 * @param {number} total månadens kostnad i dollar
 * @param {number|null} tak månadstaket i dollar
 * @returns {'ok'|'nara'|'over'}
 */
export function budgetLage(total, tak) {
  if (!tak || tak <= 0) return 'ok';
  if (total >= tak) return 'over';
  if (total >= tak * NARA) return 'nara';
  return 'ok';
}
```

- [ ] **Step 4: Kör testet**

```bash
npx vitest run tests/usage-summary.test.js
```

Förväntat: PASS.

- [ ] **Step 5: Lägg raden i sidopanelen**

I `index.html`, direkt efter `<span id="sync-status" ...>`:

```html
            <!-- Egen rad, inte samma som synkstatusen: de två tillstånden är
                 oberoende och kan behöva synas samtidigt. -->
            <span id="budget-status" class="sync-status" data-state="warn" role="status" hidden></span>
```

- [ ] **Step 6: Visa varningen**

Lägg till i `src/ui/settings.js`, och anropa den sist i `renderaAnvandning()`:

```js
/* Varningen hör hemma där man ser den. Panelen i inställningarna öppnar man
 * sällan; sidopanelen står framme hela tiden, och det är där appen redan säger
 * "Lokalt läge" och "Kunde inte synka". */
function visaBudgetvarning(total, tak) {
  const node = el('budget-status');
  if (!node) return;
  const lage = budgetLage(total, tak);
  node.hidden = lage === 'ok';
  node.dataset.state = lage === 'over' ? 'error' : 'warn';
  node.textContent =
    lage === 'over'
      ? `Månadstaket passerat: ${dollar(total)} av ${dollar(tak)}`
      : `${dollar(total)} av månadstaket ${dollar(tak)}`;
}
```

Importera `budgetLage` bredvid `summera`.

- [ ] **Step 7: Spara och läsa taket**

Utöka `sparaVal` i `src/ui/settings.js` med en egen funktion bredvid den:

```js
/** Sparar månadstaket. Tomt fält betyder inget tak. */
async function sparaTak(varde) {
  const userId = getUserId();
  if (!supabase || !userId) return { ok: false, error: 'Du är inte inloggad.' };

  const tal = varde === '' ? null : Number(varde);
  if (tal !== null && (!Number.isFinite(tal) || tal < 0)) {
    return { ok: false, error: 'Taket måste vara ett positivt tal.' };
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: userId, ai_monthly_budget: tal, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  return error ? { ok: false, error: 'Kunde inte spara taket.' } : { ok: true };
}
```

Utöka `laddaVal` så att taket kommer med. Ändra dess select (i dag rad 194) och
returraden:

```js
    .select('ai_provider, ai_model, ai_monthly_budget')
```

```js
  return {
    provider: data.ai_provider ?? '',
    model: data.ai_model ?? '',
    tak: data.ai_monthly_budget ?? null,
  };
```

Fyll fältet i `renderaAnvandning()`, före summeringen, och skicka taket vidare
till varningen:

```js
  const val = await laddaVal();
  el('settings-budget').value = val?.tak ?? '';
```

Koppla sedan knappen i `initSettings`:

```js
  el('btn-settings-save-budget')?.addEventListener('click', async () => {
    const res = await sparaTak(el('settings-budget').value.trim());
    if (!res.ok) return visaMeddelande(res.error, 'fel');
    visaMeddelande('Månadstaket sparat.', 'ok');
    void renderaAnvandning();
  });
```

- [ ] **Step 8: Stil för varningsraden**

Lägg i `src/styles/layout.css`, bredvid de befintliga `.sync-status`-reglerna:

```css
/* Varningen lånar synkstatusens form. Ingen ny färg införs: accenten bär
   tillstånd i hela appen, och den röda är redan den som betyder konsekvens.
   En egen varningsgul hade varit en fjärde ton i en palett med tre. */
.sync-status[data-state='warn'] {
  color: var(--accent);
}
```

`--danger` används redan av `[data-state='error']`, som `over` sätter — inget
behöver läggas till i `tokens.css`.

- [ ] **Step 9: Kör allt och verifiera i webbläsaren**

```bash
npm run lint && npm test && npm run build
```

Sätt ett lågt tak (t.ex. `0.01`) i Inställningar och kontrollera att raden dyker upp i sidopanelen, att den byter ton vid passerat tak, och att den försvinner när taket tas bort.

- [ ] **Step 10: Commit**

```bash
git add src/domain/usage.js tests/usage-summary.test.js index.html src/ui/settings.js src/styles/
git commit -m "feat(installningar): warn in the sidebar when the monthly budget runs low

At eighty percent, not ninety: the warning should arrive while there is
still room to act — switch models, wait for the month to turn — not once
the money is gone.

Its own line rather than the sync status, because the two states are
independent and may need to show at the same time. A cap of zero or null
means no cap, not an impossible one."
```

---

## Efter sista task

Lägg till de två begränsningarna i README:ns AI-avsnitt, som specen kräver:

- Mätaren börjar på noll den dag den driftsätts; äldre historik finns bara hos leverantören.
- Den räknar bara anrop som går genom appen; samma nyckel använd någon annanstans syns inte.
