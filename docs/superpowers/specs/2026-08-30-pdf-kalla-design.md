# PDF-källa — design

Datum: 2026-08-30

Läs in en föreläsnings-PDF i en kortlek, generera kort ur den, och ställ frågor
som är grundade i just den texten. Textutvinningen sker i webbläsaren utan AI.

## Mål

1. Dra in en PDF i en kortlek och se den utvunna texten innan något kostar.
2. Generera kort ur källan, med samma inställningar som redan finns.
3. Ställa frågor om dokumentet, med minne av de tre föregående turerna.
4. En föreläsning ska kosta i storleksordningen en krona, inte tio.

## Beslut

| Fråga | Beslut | Varför |
|---|---|---|
| RAG eller hela texten i kontexten? | Hela texten | En föreläsning är 20–30k tokens och kontextfönstret 1M. Vektorisering löser ett problem som inte finns, och kostar en databas, sämre svar och en ny felkälla. |
| Var utvinns texten? | I webbläsaren, med pdf.js | Noll AI, noll serverkostnad, ingen ny serverfunktion. PDF:en lämnar aldrig datorn. |
| Var hör en källa hemma? | På kortleken | En lek per ämne, en källa per föreläsning. Mappar skapas och raderas löst; en källa som försvinner vid mappstädning vore en överraskning. |
| Synkas texten? | Nej, bara metadata | Texten behövs bara när AI:n ska läsa den, och då krävs nätet ändå. Lokalt köper den ingenting och gör varje synk tyngre. |
| Sparas PDF-filen? | Nej | Bara den utvunna texten. Filen har användaren redan; en fil till i molnet är en sak till att radera och härda. |
| Ett steg eller två? | Två | Extraktionen är gratis och tar en sekund. Att se att texten blev läsbar innan man betalar spelar roll här, eftersom LaTeX-matematik kommer ut trasig. |
| Frågeform? | En fråga, tre turers minne | Appen har ingen chattyta, och en sådan är en ny vy att bygga. Tre turer gör "utveckla det där" möjligt utan att kostnaden växer med samtalet. |
| Batch-API för 50 % rabatt? | Nej | Det är den enda leveran som kräver riktigt arbete — en asynkron gren med pollning i en app som är helt synkron. 50 % av femtio öre motiverar den inte. |

## Vad som faktiskt kostar

Mätt, inte gissat: **utdata dominerar, inte dokumentet.** Utdata kostar fem
gånger mer per token än indata ($25 mot $5 per Mtok hos Opus 5).

| Vid inläsning + kort, 25k-dokument | Tokens | Kostnad |
|---|---|---|
| Dokumentet in | 25 000 | $0,125 |
| Korten ut, plus tänkande | ~8 000 | $0,20 |

Cachning rör bara indata och hjälper därför **knappt** vid generering. För
frågorna är förhållandet omvänt — 25k in mot ~500 ut — och där är cachning
precis rätt lever.

Två levrar byggs in:

1. **Modellvalet**, som redan finns i inställningarna. Haiku 4.5 kostar en
   femtedel av Opus på både in och ut, och att plocka kort ur en text
   användaren själv gett är närmare extraktion än resonemang.
2. **`effort`**, nytt valfritt fält i AI-lagret. Opus 5 har adaptivt tänkande
   på som förval och det debiteras som utdata; `low` skär bort merparten.
   **Får inte skickas till `claude-haiku-4-5`** — modellen avvisar parametern.
   Haiku behöver den heller inte.

   Värdet är **`low` och fast**, inte en inställning. Det gäller **bara
   kortgenereringen ur en källa**, där tänkandet dominerar utdatan; frågorna
   svarar kort och påverkas knappt. En inställning till hade varit ett val att
   förklara för en besparing modellväljaren redan täcker bättre.

En tredje lever övervägdes och **finns inte**: att hoppa över kortens
fördjupningsfält. `topic-generator.js` genererar redan bara `front` och `back`,
med `maxTokens: 3500` som tak.

| | Inläsning + kort |
|---|---|
| Opus 5, `effort` förvalt | ~3,40 kr |
| Opus 5, `effort: low` | ~2,40 kr |
| Haiku 4.5 | ~0,50 kr |
| Varje fråga, cachad | 0,10–0,60 kr |

Siffrorna är uppskattningar. Efter första riktiga föreläsningen står det i
Inställningar → Användning vad den faktiskt kostade.

## Textutvinning

`pdf.js` från npm, i en lazy laddad chunk som KaTeX redan ligger i — den som
aldrig läser in en PDF laddar den inte.

Taket är **200 000 tecken** (≈50k tokens). En hel kursbok spränger både
kontexten och plånboken; gränsen säger det innan något skickas. Överskrids den
visas hur mycket som fattas, och inläsningen avbryts.

**LaTeX-matematik kommer ut trasig.** Ett LaTeX-satt PDF har ett riktigt
textlager för brödtext, men formler sätts som enskilda glyfer med egna
teckenkodningar. Det är därför inläsningen är ett eget steg: användaren ser
resultatet innan ett anrop görs. Ingen OCR, inga skannade dokument.

## Datamodell

Migration `0008_kallor.sql`. Två tabeller, inte en:

```sql
create table if not exists public.sources (
  -- text, inte uuid, och utan default: källan skapas i webbläsaren när texten
  -- utvunnits, precis som en kortlek eller ett kort, och id:t kommer därför ur
  -- nyttId() i klienten. ai_usage kunde ha uuid med default eftersom SERVERN
  -- skapar de raderna.
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Främmande nyckel med ägarskap, som migration 0005 kräver av varje ny
  -- koppling: en källa ska inte kunna peka på någon annans kortlek.
  deck_id    text not null references public.decks(id) on delete cascade,
  title      text not null,
  pages      integer not null default 0,
  chars      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.source_texts (
  source_id text primary key references public.sources(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  text      text not null
);
```

`sources` läggs till i synkens `TABLES`. **`source_texts` gör det inte**, och
det är hela poängen med uppdelningen: `pull()` gör `select('*')` per tabell, så
en textkolumn i en synkad tabell hade dragit med varenda inläst föreläsning vid
varje synk. Med två tabeller behöver synkkoden inte röras alls.

Radnivåsäkerhet: `own_rows` på båda, samma mönster som `cards`. Mjuk radering
via `deleted_at` på `sources`; `source_texts` följer med genom sin främmande
nyckel. Kontoradering täcks av `user_id`-kaskaden.

## Cachning

Bara på frågevägen, där den gör nytta.

Dokumentet läggs i `system` med en cachebrytpunkt; frågan och de tre turernas
historik i `messages`, alltså **efter** brytpunkten. Historiken byts då ut utan
att dokumentet tappar cachen. TTL en timme, vilket täcker ett pluggpass.

Det kräver två nya valfria fält i `buildRequest`: ett för cachning och ett för
`effort`. **Bara Anthropic-adaptern läser dem**; de andra tre ignorerar dem
tyst. En gren i en adapter, inte en läcka genom abstraktionen. Kontraktet i
`docs/api-contract.md` ändras först.

Frågornas historik lever i minnet och sparas inte: det är ett läge i den öppna
vyn, inte något som hör till kortleken.

## Gränssnitt

**Inläsningen** sker från kortlekens åtgärdsrad, bredvid `Nytt kort` och
`AI-generera`. Efter extraktionen står källan i en rad under raden med
åtgärder, med sidantal, teckenantal och två knappar: generera kort, ställ en
fråga.

**Kortgenerering** återanvänder AI-generera-modalen. Dess källväljare har redan
två segment — *Ämne / Koncept* och *Klistra in text* — och källan blir ett
tredje. Antal, svårighetsgrad, inlärningsfokus och målmapp fungerar som idag.
Ingen ny modal.

**Frågepanelen** ligger i kortleksvyn under `deck-ai-insights`, som idag är ett
tvåkolumnsrutnät med `Sammanfattning` och `Rekommenderat kort`. Panelen läggs
som en **egen rad under** det rutnätet, i full bredd — inte som en tredje
kolumn: ett svar är löpande text och behöver rader, inte en smal spalt. Ett
fält, ett svar, och de tre senaste turerna kvar ovanför.

Ingen ny mörk yta, ingen ny färg, ingen ny radie. Kontrollhöjd ur `--control-h`
som allt annat.

## Mätaren

Två nya `feature`-värden: `kalla-kort` och `kalla-fraga`. De blir egna rader i
Inställningar → Användning, så kostnaden för dokumenten går att skilja från
resten. Inget behöver ändras i mätaren — kolumnen är avsiktligt utan `check`.

## Vad som inte byggs

- Ingen RAG och ingen vektordatabas.
- Ingen chattvy.
- Ingen lagring av PDF-filen.
- Ingen OCR, inga skannade dokument.
- Ingen batch-väg.
- Ingen delning av en källa mellan flera kortlekar.

## Verifiering

| Vad | Hur |
|---|---|
| Textutvinning | Ren funktion från pdf.js-utdata till text, testad mot en fixtur; teckentaket testat vid gränsen |
| Frågehistoriken | Ren funktion som klipper till tre turer, testad över fler turer än så |
| `effort` per modell | Adaptertest: fältet finns i kroppen för Opus, saknas för Haiku |
| Cachebrytpunkten | Adaptertest: dokumentet ligger i `system` med `cache_control`, frågan i `messages` |
| Migrationen | Körs för hand, idempotent, `pg_policies` ska ge fyra rader för de två tabellerna |
| Panelerna | I webbläsaren, som övriga vyer |

## Etapper

1. Migration `0008`, körd och verifierad.
2. Kontraktet: `cache` och `effort` i `POST /api/ai`.
3. Textutvinning med pdf.js, med tak och test.
4. Lagring: skriv och läs en källa.
5. Källan i kortleksvyn, med de två knapparna.
6. Kortgenerering ur källan, som tredje segment i modalen.
7. `effort` genom AI-lagret, med adaptertest.
8. Frågepanelen med cachning och tre turers minne.

Efter etapp 6 går det att generera kort ur en PDF. Frågorna kommer i 8, och
etapp 7 gör genereringen billigare oavsett om 8 byggs.
