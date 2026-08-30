# Användningsmätare — design

Datum: 2026-08-29

Visa vad AI-anropen faktiskt kostar, inne i appen, i stället för att behöva
läsa av leverantörens konsol. Räknar och varnar — stoppar aldrig.

## Mål

1. Se vad den här månaden och idag har kostat, i dollar.
2. Se vilken funktion pengarna gick till, eftersom det är den siffran som går
   att göra något åt.
3. Ett månadstak som varnar när man närmar sig det.
4. Ingen ny extern tjänst, ingen service role-nyckel, inget extra AI-anrop.

## Beslut

| Fråga | Beslut | Varför |
|---|---|---|
| Räkna, varna eller stoppa? | Räkna och varna | Ett hårt tak kräver att kostnaden uppskattas före anropet, vilket är ett extra API-anrop per fråga. Varningen räcker tills mätningar visar annat. |
| Var lagras loggen? | På servern | Servern är det enda stället som ser de verkliga tokentalen. En lokal logg missar allt som görs från en annan enhet. |
| Lagra kostnad eller tokental? | Tokental | Priser ändras; tokental är fakta. Samma delning som `reviews` och streak: det härledda räknas fram vid visning och lagras aldrig. |
| Valuta? | Dollar | Det leverantören debiterar. En kronkurs hade krävt ett fält som driftar, och summan hade inte längre gått att stämma av mot fakturan. |
| Uppdelning i panelen? | Totalt och per funktion | Svarar på "vad är det som kostar". Modell lagras men visas inte — den finns i raden den dag den behövs. |
| Var syns varningen? | Statusraden i sidopanelen | Appens etablerade plats för ett tillstånd som gäller hela tiden. En varning som bara står i Inställningar ser man aldrig. |

## Utgångsläge

Alla AI-anrop går genom `callAI()` i `src/ai/call.js` och vidare till
`POST /api/ai`. Leverantörerna returnerar tokental i svaret, men
[api/ai.js:97](../../../api/ai.js) svarar `{ text, provider, model }` och
kastar bort `usage` helt. Siffran finns alltså redan och passerar en enda
punkt — den behöver bara tas om hand.

Adaptrarna i `api/_lib/providers.js` har redan `extractText(data)` per
leverantör. Tokentalen heter olika hos var och en (`input_tokens` mot
`prompt_tokens` mot `promptTokenCount`), vilket är exakt det adaptermönstret
finns för.

## Datamodell

Migration `0007_ai_usage.sql` (numret blev 0007 sedan 0006 tagits av en
parallell migration). Tabellen är **append-only**, byggd som
`reviews`: select och insert, aldrig update eller delete. Ingen
`updated_at`-trigger och ingen `deleted_at` — en bokföringsrad ändras inte och
raderas inte.

```sql
create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null,
  model              text not null,
  feature            text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ai_usage_user_time
  on public.ai_usage (user_id, created_at desc);
```

Radnivåsäkerhet med samma två policys som `reviews`:

```sql
alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated with check (user_id = (select auth.uid()));
```

Månadstaket är en preferens och bor i `user_settings`, som redan bär leverantör
och modell:

```sql
alter table public.user_settings
  add column if not exists ai_monthly_budget numeric;
```

`null` betyder inget tak, vilket är förvalet.

### Värdena i `feature`

Appen har **elva** anrop till `callAI()`, och de är elva olika saker:

| `feature` | Ställe | Vad |
|---|---|---|
| `topic` | `topic-generator.js` | Kort ur ett ämne eller inklistrad text |
| `diary` | `diary.js` | Kort ur en dagboksanteckning |
| `regenerate` | `proposed-cards.js` | Gör om ett föreslaget kort |
| `sort` | `sort.js` | Sortera lösa kort i mappar |
| `autofolder` | `wiring/ai-actions.js` | Välj mapp åt ett enskilt kort |
| `answer` | `wiring/ai-actions.js` | Generera svar till en fråga |
| `summary` | `deck-insights.js` | Sammanfatta kortleken |
| `suggest` | `deck-insights.js` | Föreslå ett kort |
| `explain` | `card-ai.js` | Fördjupa ett kort |
| `testquestion` | `card-ai.js` | Testfråga på ett kort |
| `tutor` | `study-ai.js` | Fråga under repetition |

Kolumnen är `text` utan `check`, så att ett nytt läge inte kräver en migration;
ett okänt värde visas som sitt eget namn i panelen.

## Fångst

I `api/ai.js`, efter att leverantören svarat och innan svaret skickas vidare.

Varje adapter får en `extractUsage(data)` bredvid sin `extractText(data)`, som
returnerar `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`
med nollor för det leverantören inte rapporterar.

Servern skriver raden **som användaren**, genom klienten som redan finns i
`requireUser()`. Insert-policyn kräver `user_id = auth.uid()`, som kommer ur
anroparens egen token. Ingen service role-nyckel, som resten av appen.

**Misslyckas skrivningen returneras svaret ändå.** En bokföringsrad får aldrig
sänka det användaren faktiskt bad om. Felet sväljs tyst — serverfunktionerna
loggar med flit ingenting.

### Kontraktsändring

`docs/api-contract.md` ändras först, enligt regeln i CLAUDE.md.

```jsonc
// Begäran till POST /api/ai — nytt fält
{ "feature": "topic", ... }

// Svar 200 — nytt fält
{ "text": "...", "provider": "anthropic", "model": "claude-opus-5",
  "usage": { "inputTokens": 12040, "outputTokens": 830,
             "cacheReadTokens": 0, "cacheWriteTokens": 0 } }
```

`feature` måste komma från klienten, eftersom bara den vet varför anropet görs.
Det ger ett argument till i `callAI()` och en rad ändrad på vart och ett av de
elva anropsställena. Det är den enda delen av arbetet som rör många filer.

`usage` i svaret används inte av panelen — den läser tabellen — men gör anropet
självförklarande och går att visa direkt efter en generering senare.

## Kostnadsberäkning

Ny modul `src/ai/pricing.js`. Priser per miljon tokens, per modell:

```js
{ 'claude-opus-5': { in: 5, out: 25 }, ... }
```

Cachad läsning kostar 0,1 × input och cachad skrivning 1,25 × input, vilket
räknas fram ur `in` i stället för att skrivas som egna tal — annars är det två
tal att hålla i synk per modell.

Kartan innehåller från början **endast Anthropics modeller**, eftersom det är de
priser som gått att verifiera. OpenAI, Google och OpenRouter faller därmed på
regeln nedan och visar tokental utan kostnad tills deras priser lagts in mot
respektive prislista. Det är avsiktligt: en påhittad prislapp är värre än ingen.

**En okänd modell ger tokental men ingen kostnad**, och panelen skriver ut att
priset saknas. Användaren kan skriva in vilket modell-id som helst, och en
gissad prislapp vore sämre än en ärlig lucka.

Rena funktioner, inget DOM, inget nät — testas som `domain/`.

## Panelen

Eget avsnitt i Inställningar, under AI:

```
Användning
  Denna månad      $4.21        128 400 in · 31 200 ut
  Idag             $0.34

  Kortgenerering   $3.10
  Handledare       $0.81
  Sortering        $0.30

  Månadstak        [ 10.00 ] $
```

Klienten hämtar månadens rader med supabase-klienten och summerar i JS. Några
hundra rader per månad — ingen vy och ingen aggregering i databasen behövs, och
den dagen volymen motiverar det är det en ändring på ett ställe.

**Månadsgränsen följer lokal tid**, via `getLocalDateString()` i
`src/domain/stats.js` — samma funktion som streaken redan använder. `created_at`
är `timestamptz`, så utan det hade "denna månad" bytt dag vid midnatt UTC och
inte stämt med kalendern man har framför sig.

Utan konto visas avsnittet inte alls: mätaren mäter molnanrop, och lokalt läge
gör inga.

## Varningen

När månadens summa passerar 80 % av taket får sidopanelens statusrad en rad i
samma form som "Kunde inte synka" och "Lokalt läge". Vid 100 % byter den ton men
blockerar ingenting.

Taket sätts i panelen ovan. Är det `null` finns ingen rad.

## Vad som inte byggs

- Ingen förhandsuppskattning med `count_tokens`. Det är ett extra API-anrop per
  fråga för att lösa ett problem varningen redan täcker.
- Ingen blockering.
- Ingen valutaomräkning.
- Ingen graf. Spelhallen har heatmapen; det här är en avläsning, inte en
  instrumentpanel.
- Ingen uppdelning per modell i gränssnittet.

## Begränsningar

Två saker som ska stå i README:n, inte upptäckas:

- **Mätaren börjar på noll den dag den driftsätts.** Den kan inte veta vad som
  gjorts tidigare; den historiken finns bara hos leverantören.
- **Den räknar bara det som går genom appen.** Används samma nyckel någon
  annanstans syns det inte här, och summan stämmer då inte mot fakturan.

## Verifiering

| Vad | Hur |
|---|---|
| `extractUsage` per leverantör | Rena funktioner mot riktiga svarsformer, i `tests/providers.test.js` |
| Kostnadsberäkning | Rena funktioner mot kända tokental, inklusive cachade och okänd modell |
| Insert-vägen | Som synken testas: en falsk supabase-klient, och ett fall där skrivningen kastar och anropet ändå lyckas |
| Summering och gruppering | Ren funktion från rader till `{ total, perFeature }` |
| Migrationen | Körs för hand i SQL Editor, idempotent som de fem föregående |

Panelen och statusraden verifieras i webbläsaren, som övriga vyer.

## Etapper

1. Migration `0007`, körd och verifierad.
2. Kontraktet i `docs/api-contract.md`.
3. `extractUsage` per adapter, med tester.
4. `feature` genom `callAI()` och de sju anropsställena.
5. Skrivningen i `api/ai.js`.
6. `src/ai/pricing.js` med tester.
7. Panelen i Inställningar.
8. Taket och statusraden.

Varje etapp går att driftsätta för sig. Efter 5 samlas data även om ingenting
visar den ännu, vilket gör att panelen har något att visa när den kommer.
