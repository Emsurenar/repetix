# Repetix — design

Datum: 2026-08-28

Omvandling av en lokal envägsapp (15 000 rader vanilla JS/CSS/HTML, all data i
localStorage, API-nyckel serverad som statisk fil) till en publik, molnlagrad,
mobilanpassad app på Vercel.

## Mål

1. Publicerbar på GitHub: professionell kod, inga hårdkodade nycklar.
2. Deployad på Vercel med konton och ett backend-API.
3. All data i molnet, åtkomlig från mobil, med fungerande offline-läge.
4. Leverantörsoberoende AI-lager med modellval i inställningarna.
5. Genomarbetad design, ljust läge, mobilanpassad.

## Beslut

| Fråga | Beslut |
|---|---|
| Målgrupp | Publik app, öppen registrering |
| AI-kostnad | Användaren tar med egen nyckel (BYOK). Ingen serverside-nyckel |
| Frontend | ES-moduler + Vite. Vanilla JS behålls, ingen React |
| Backend | Supabase: Postgres, auth, radnivå-säkerhet |
| Synk | Offline först, utkorg av mutationer, senaste ändring vinner per rad |
| Språk | Enbart svenska, ingen språkfil |
| Spellägen | Alla åtta behålls och byggs om ordentligt |
| Design | "Lugn precision", enbart ljust läge, verdigris-grön accent |
| Namn | Repetix |

## Utgångsläge

Kartlagt av tre granskningsagenter. Det som styr designen:

- `script.js` är 9 784 rader, `style.css` 4 819, `index.html` 880.
- 11 kopierade `fetch`-anrop mot Anthropic. Ingen delad anropsfunktion.
  Modellsträngen hårdkodad 11 gånger, svarsformen `data.content[0].text`
  upprepad 11 gånger.
- API-nyckeln hämtas med `fetch('.env')` — nyckeln serveras som statisk fil.
- Bilder lagras som okomprimerad base64 i localStorage. En mobilbild kan
  spränga 5 MB-kvoten. `saveData()` visar då bara en toast och tappar
  skrivningen; `beforeunload` sväljer felet helt tyst.
- Streak och statistik härleds ur `card.lastReviewed`, som skrivs över vid varje
  ny repetition. Historik raderar sig själv bakåt i tiden.
- Jeopardy-läget filtreras bort ur återskrivningen och loggar därför aldrig
  någon repetition.
- SM-2-fälten migreras inte i `loadData()`. Gammal data utan `easeFactor` ger
  `NaN` som sedan sparas.
- Kontextmenyer ligger bakom `opacity: 0` plus `:hover` och är därför
  oåtkomliga på touch — det gäller Redigera, Flytta och Radera för kort,
  kortlekar, bokhyllor och mappar.
- Transportbandet har enbart tangentbordsstyrning och är ospelbart på mobil.
- `fritextReveal` är 235 rader död kod som aldrig nås.
- 65 % av CSS:en överger designsystemet: 250 hårdkodade hexvärden,
  200 `!important`, 8 typsnittsfamiljer.

## Arkitektur

```
Webbläsare                        Vercel                    Supabase
──────────                        ──────                    ────────
Vite-byggd statisk app  ──────────────────────────────────► Postgres (RLS)
  IndexedDB (lokal spegel)                                  Auth
  Utkorg (köade mutationer)                                 Storage (bilder)
        │
        └── AI-anrop ──────────► /api/ai ──────────────────► vald leverantör
                                 (dekrypterar användarens nyckel)
```

Klienten pratar direkt med Supabase för all data. Radnivå-säkerhet garanterar
isolering mellan användare även om klientkoden har en bugg. Den enda
serverfunktionen som behövs är AI-proxyn, eftersom användarens nyckel aldrig
får nå webbläsaren.

## Datamodell

Postgres. Alla tabeller har `user_id`, `created_at`, `updated_at`, `deleted_at`
och en RLS-policy `user_id = auth.uid()`.

| Tabell | Innehåll |
|---|---|
| `profiles` | Konto, visningsnamn |
| `bookshelves` | id, title, color, position |
| `decks` | id, title, color, bookshelf_id, position |
| `sections` | id, deck_id, title, position |
| `cards` | id, deck_id, section_id, front, back, is_long_form, type, samt SM-2-fälten repetition, interval, ease_factor, next_review_date, lapses, last_reviewed |
| `card_images` | id, card_id, storage_path, position |
| `notebooks` / `notes` | oförändrad struktur, normaliserad |
| `reviews` | **append-only.** id, card_id, rating, reviewed_at, interval_before, interval_after, mode |
| `user_settings` | ai_provider, ai_model, preferenser |
| `user_ai_keys` | provider, krypterad nyckel, senast verifierad |

### Varför `reviews` är egen tabell

Dagens statistik härleds ur `card.lastReviewed`, ett fält som skrivs över. En
append-only logg gör streak, heatmap och rekord korrekta för all framtid, gör
att alla spellägen kan logga utan att röra SM-2-schemat, och kan aldrig
konflikta vid synk eftersom rader bara läggs till.

### Migrering av befintlig data

Högsta risken i projektet. Ordning:

1. Exportera nuvarande localStorage till JSON (funktionen finns redan).
2. Importera i den nya appen bakom en explicit knapp, aldrig automatiskt.
3. Migreringen normaliserar, sätter SM-2-defaults där fält saknas, tvättar bort
   skräpfält som `originalDeckId` och `_sectionTitle`, laddar upp base64-bilder
   till Storage och ersätter dem med URL:er.
4. Syntetiska `reviews`-rader skapas ur `lastReviewed` för de kort som har det,
   så att historiken inte börjar om från noll.
5. Migreringen är idempotent och rapporterar antal före och efter.

Personbästa-nycklarna (`spaced_rep_*_pb_*`) ingår, till skillnad från idag där
de saknas i `BACKUP_KEYS` och försvinner vid varje import.

## Synk

- **Lokalt:** IndexedDB speglar hela biblioteket. Appen läser aldrig från nätet
  i det kritiska flödet.
- **Skrivning:** varje mutation läggs i en utkorg med klienttidsstämpel och
  skickas när nätet finns.
- **Konflikt:** senaste ändring vinner per rad via `updated_at`. Repetitioner
  konfliktar aldrig eftersom de bara läggs till.
- **Läsning:** inkrementell hämtning med `updated_at`-markör.
- **Radering:** mjuk radering via `deleted_at`, annars kan en radering på en
  enhet återuppstå från en annan.

## AI-lager

Hela ytan täcks av ett gränssnitt, eftersom alla elva anrop idag är
single-turn utan tools eller streaming:

```js
callAI({ system, user, maxTokens, json }) -> string
```

Fyra adaptrar under det: Anthropic, OpenAI, Google, OpenRouter. Varje adapter
översätter det som skiljer — `system` som toppnivåparameter eller som
meddelande, `max_tokens` mot `max_completion_tokens` mot `maxOutputTokens`,
samt svarsformen.

Anropet går till `/api/ai` på Vercel. Funktionen slår upp användarens
krypterade nyckel, dekrypterar den i minnet, anropar leverantören och
returnerar texten. Nyckeln når aldrig webbläsaren.

I inställningarna väljer användaren leverantör och modell, kan skriva in ett
eget modell-id, och kan testa anslutningen. Utan nyckel är AI-funktionerna
avstängda men appen fullt användbar.

Förbättringar som följer med: gemensam timeout, gemensam retry med
`Retry-After`, ett enda felmeddelandemönster i stället för dagens tre
(`alert`, `showToast`, inline-DOM), och avbrytbara anrop — dagens
`deckInsightsAbort` är deklarerad men används aldrig.

## Modulstruktur

```
src/
  core/       state, storage (IndexedDB), sync, supabase, events
  domain/     srs, cards, decks, stats, migration
  ui/         library, deck, study, notebook, playground, settings,
              components/, modals/
  games/      shell + action, lucktext, fritext, jeopardy, dammiga,
              suddendeath, transportbandet, dragkampen
  ai/         index, providers/, prompts/
  styles/     tokens, base, components, views
api/          ai.js (Vercel-funktion)
```

Regler: ingen modul över ~400 rader. DOM-manipulation isoleras från logik.
`domain/` importerar aldrig från `ui/`. Inga `window.*`-exporter — inline
`onclick` ersätts av delegerade lyssnare.

## Design

Riktning "Lugn precision", enbart ljust läge.

- Neutral varm gråskala i fyra ytnivåer, två linjenivåer.
- En accent: verdigris `#0E6A5E`. Aldrig blått.
- Serif för kortinnehåll, grotesk för gränssnitt, monospace för alla siffror.
- Djup skapas av ytkontrast och 1px-linjer. Inga skuggor.
- Mobil enligt tolkningen "stram komposition": repetitionsvyn delad i
  namngivna band (Fråga, Svar, Betyg), dolt svar som medvetet övertäckt ark,
  betyg som 2×2 i tumzonen.
- **Knappar:** de primära i mockupen är för blockiga. Knappformerna definieras
  en gång i designsystemet med lättare vikt, stramare höjd och mindre massa.
- Alla tryckytor minst 44×44. Inga hover-beroende funktioner — varje åtgärd
  nåbar med ett finger.
- WCAG AA för all brödtext. Dagens `--text-secondary` ger 3,4:1 och underkänns.

## Säkerhet

- `.gitignore` skapas före `git init`. `.env` får aldrig committas.
- Den befintliga `ANTHROPIC_API_KEY` betraktas som läckt och ska återkallas.
- Ingen serverside-AI-nyckel existerar i den nya arkitekturen.
- Användarnycklar krypteras i vila och dekrypteras enbart i serverfunktionen.
- RLS på varje tabell.
- Rate limiting på `/api/ai` per användare.
- Inga SRI-lösa CDN-beroenden — marked och KaTeX flyttas till npm och byggs in.
  Idag laddas `marked` helt utan pinnad version.

## Etapper

1. **Fundament** — git, `.gitignore`, Vite, moduluppdelning, designsystem,
   testuppsättning. Noll funktionsändringar.
2. **Molnet** — Supabase, auth, schema, RLS, migrering, offline-synk.
3. **AI** — generiskt lager, adaptrar, serverproxy, inställningsvy.
4. **Design** — hela gränssnittet enligt Lugn precision och Mobil 1.
5. **Spelen** — åtta lägen ombyggda med touch och tangentbord.
6. **Publicering** — README, licens, CI, säkerhetsgenomgång, Vercel-deploy.

## Verifiering

Ingen testsvit finns idag. Etapp 1 lägger Vitest och täcker det som är rent
räknande och därmed farligast att bryta: SM-2-formeln, statistikhärledningen,
datamigreringen och synkens konfliktlösning. Gränssnittet verifieras i
webbläsaren, inklusive mobilbredd, efter varje etapp.
