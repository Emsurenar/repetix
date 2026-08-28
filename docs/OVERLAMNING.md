# Överlämning

Skriven 2026-08-28. Läs den här före [CLAUDE.md](../CLAUDE.md) och
[specen](superpowers/specs/2026-08-28-repetix-design.md).

## Var arbetet står

Ombyggnaden är indelad i sex etapper. Fem är klara. Kvar är publiceringen.

| Etapp | Status |
|---|---|
| 1. Fundament — git, Vite, moduluppdelning, tester | **Klar** |
| 2. Molnet — Supabase, auth, offline-synk, bilder | **Klar** |
| 3. AI — leverantörsoberoende lager, serverproxy | **Klar** |
| 4. Design — hela gränssnittet | **Klar** |
| 5. Spellägena — åtta lägen ombyggda | **Klar** |
| 6. Publicering — README, licens, CI, Vercel | Ej påbörjad |

475 tester, noll lintfel, bygget går igenom.

## Nästa steg, i ordning

### 1. Designen mot mockupen — klar

Biblioteket och repetitionsvyn är ombyggda mot mockupen. Kortleksvyn, formulären
och inställningarna följer samma språk — se 3b nedan.

Åtgärdat i biblioteket:

- Sidopanelen listar kortlekarna under sin bokhylla, med fyrkantsprick och
  antal förfallna högerställt i monospace. Bokhyllan är gruppens etikett, inte
  en egen rad. Panelen ligger på `--surface-2` mot innehållsytans `--surface-0`
  — ytkontrasten är avgränsningen.
- Rutnätet är platt med tre kolumner. Rubrikraderna per bokhylla är borta;
  grupperingen bodde i två gränssnitt samtidigt.
- Kortleks-kortet har mockupens mått: titel, luft, tvåtonad framstegslinje,
  och underst "142 kort  12 förfallna" i monospace.
- Framstegslinjen har tre toner: moget (`--accent`, intervall ≥ 21 dagar),
  påbörjat (`--mark-1`), osett (spåret). En enda fylld andel kunde inte skilja
  "kan utantill" från "sett en gång".
- Nyckeltalen står i `--t-xl` under hårfina linjer. **De lodräta linjerna
  mellan talen är medvetet borta — användaren underkände dem.** Mockupen har
  dem; instruktionen gäller före mockupen.
- Brödsmulan visas bara när den har mer än en smula. I biblioteket sade den
  "Bibliotek" rakt ovanför rubriken som redan sade det.

Åtgärdat i studievyn:

- Toppslist med kortlek i halvfet, mapp i grått, tickskala och "7 av 19" i
  monospace. Vägen ut är en pil till vänster.
- Frågan och svaret är vänsterställda i en spalt på 760 px.
- Betygsknapparna har **tangentnumret** i övre högra hörnet. Streckrampen
  flyttade till `(pointer: coarse)`, där det inte finns tangentbord.
- Sekundäråtgärderna är centrerade under betygen och når kortet både före och
  efter svaret.
- Repetitionen är fokusläge: sidopanelen fälls in (`body.focus-mode`) utan att
  röra användarens egen infällning.
- Det dolda svaret är tre streck i märkestonen plus etiketten "Svaret är dolt",
  som i mobilmockupen. Diagonalrastret var en egen uppfinning.

Buggar som satt i skalet och rättades på vägen:

- `#btn-sidebar-home` hade **varken stil eller händelselyssnare**: webbläsaren
  ritade sin egen grå 3D-knapp runt logotypen, och ett tryck gjorde ingenting.
- Infällningsknappen och hamburgaren satte klasserna `collapsed`, `expanded`
  och `visible` på panelen och innehållsytan. Stilmallen känner bara till
  `body.sidebar-collapsed` och `body.sidebar-open`. Knapparna gjorde alltså
  ingenting alls.
- `.sidebar-account` fick `flex-wrap: wrap` från auth.css, ett arv från när
  foten var en rad. Med kolumnriktning bröt synkstatusen ut i en andra spalt
  och hamnade utanför panelen.
- `--deck-color` sattes på varje kort med `#4F46E5` — indigo, alltså blått —
  och lästes aldrig av någon regel.

Två medvetna avsteg från mockupen, båda för att inte tappa funktion:

- **Kortleks-kortet har en radmeny** i hörnet. Mockupen har ingen, men namnbyte,
  flytt och radering måste nås någonstans. Den ligger ovanpå hörnet i stället
  för i flödet, så att kompositionen behålls.
- **Bokhyllans åtgärder** flyttade till rubrikraden och visas bara när man står
  i en hylla. "Ändra färg" följde inte med: färgen ritades på rubrikraden som
  är borta, och en palett utanför tokens hör inte hemma i "Lugn precision".

### 2. Beskrivningsfältet — klart

Kortet har tre fält: fråga, svar och fördjupning. Fördjupningen visas när
svaret vänts fram och ingår aldrig i bedömningen.

- Ett tredje fält i både "Lägg till nytt kort" och "Redigera kort", märkt
  *valfritt* och med en lägre ruta: höjden är en uppmaning, sju rader ber om ett
  stycke och tre om en mening.
- Rendering i studievyn under svaret, i gränssnittets grotesk och en nivå
  tystare. Markdown och KaTeX går igenom samma väg som svaret.
- Tomt fält tar bort fältet i stället för att spara en tom sträng. En tom sträng
  hade synts som en ändring i diffen mot förra ögonblicksbilden och skickat en
  meningslös rad till synken vid varje sparning.
- `createCard` och `createNoteCard` flyttade från `core/backup.js` till
  `domain/model.js`. De bestämmer vilka fält ett kort har — det är domänkunskap,
  och det var enda sättet att pröva regeln "tom fördjupning blir inget fält
  alls" utan en webbläsare. `backup.js` drar in hela gränssnittet vid import.

**Kvar: användaren behöver köra migration `0003` i Supabases SQL Editor.** Utan
den finns kolumnen inte i molnet, och en synk av ett kort med fördjupning
avvisas. Lokalt fungerar allt utan den.

### 3. Importera och Exportera i Inställningar — klart

Användarens beslut: de ska inte finnas i biblioteket alls. De ligger under
Inställningar → Data, och bibliotekets åtgärdsrad bär bara Skapa ny, Dagbok och
Repetera allt.

### 3b. Etapp 4 — vyerna mockupen inte visar — klart

- **Kortlekens ingång** är en panel med etikett, mening och en riktig knapp,
  samma form som "Dagens mapp". Den var en `div` med `role="button"` och en
  inline-`onclick`, alltså en klickyta som behövde eget tangentbordsstöd.
- **Verktygsraden har inga ikoner**, som bibliotekets åtgärdsrad.
- **AI-panelerna** var också `div`-ar med `role="button"` och inline-`onclick`.
  Handlingen är nu en knapp inuti panelen, och texten säger vad som händer i
  stället för att man ska klicka.
- **Inga inline-`onclick` kvar i `index.html`** — en punkt som stod under
  etapp 6.
- **Färgväljaren är borttagen.** Två väljare med åtta hårdkodade färger,
  varav standardvärdet `#4F46E5` är indigo — alltså blått. Färgen ritades ut på
  rubrikrader som inte finns längre; kontrollen ändrade ett värde ingen kunde
  se. Kolumnen finns kvar i databasen för äldre data.
- **AI-förslagens rader** bar sin egen lila, sin egen radie och sin egen
  bakgrund direkt i markupen. Nu klasser och tokens.
- **Inställningarnas dubbla utgång** — brödsmulan och en egen tillbakaknapp —
  är nere på en.

### 4. Etapp 5 — spellägena — klart

Spelhallen följer sektion 06 i mockupen: inlärningsläget som tre tal och en
tvåtonad linje, aktivitetskartan i tolv veckokolumner, åtta lägen i ett
fyrkolumnersrutnät med mockupens märken, namn och beskrivningar.

Alla åtta lägen är ombyggda. Spelytan var ett mörkt biografrum med svarta
bardukar, oskärpa och vit text; nu är den appens egen: ljus botten, hårfina
linjer, en accent. Den gemensamma arenan ligger i
`src/styles/views/games.css` och lägena flyttas dit ett i taget — Sudden Death,
Jeopardy, Dammiga kort och Fritext bygger redan helt på den.

Mätbart efter etappen:

| | Före | Efter |
|---|---|---|
| Hårdkodade färger i spelen | 216 | **0** |
| `!important` i `games-legacy.css` | 170 | **0** |
| Rader i `games-legacy.css` | 3 063 | **2 159** |
| Skuggor och glöd | 79 | **0** |
| Dekorfonter | 5 | **0** |
| Inline-`onclick` i `index.html` | 3 | **0** |

Åtgärdat i övrigt:

- **Lägena är knappar.** De var `<a>` utan `href` — omöjliga att nå med
  tangentbord, och ett avstängt läge gick inte att stänga av på riktigt.
- **Knappen till spelhallen var aldrig kopplad**; den fungerade bara via en
  inline-`onclick` i sidopanelens träd.
- **Aktivitetskartan ritades i Googles blå**, hårdkodad i markupen.
- **Transportbandet går att spela med fingret.** Korgarna är knappar med
  `aria-label`; ett tryck siktar och släpper. Korgarna hade dessutom var sin
  färg, vilket antydde att färgen betydde något — nu skiljer siffran dem åt och
  accenten pekar ut den man siktar mot.
- **`_legacy-fritext.js` borttagen** (241 rader) med sin oåtkomliga gren i
  `flashcard.js`.
- 81 fasta rem-grader upp till 3,5 rem mappade till den strikta skalan.

Kontrollerat: alla åtta lägen öppnade, med en kontrastmätning per läge — noll
element under 3:1 och ingen genomskinlig arena. Sudden Death och
Transportbandet är dessutom provspelade, det senare med enbart klick.

Kvar att göra om någon vill:

- `games-legacy.css` är fortfarande 2 159 rader. Lucktext, Action, Dragkampen
  och Transportbandet ritar sin markup med inline-stilar och har inte flyttat
  till `.arena`-klasserna; de ser rätt ut men bär kvar sin egen layout.
- Touch är granskat för Transportbandet. Övriga sju har knappar och fungerar
  med tryck, men ingen har provspelats på en riktig telefon.

### 5. Etapp 6 — publicering

README, licens, CI, säkerhetsgenomgång, Vercel-deploy. Paketet är cirka 800 kB
och behöver kodsplittas — mest KaTeX. Tre inline-`onclick` finns kvar i
`index.html`.

## Öppna punkter som kräver användaren

- **Migration 0003** är inte körd.
- **AI-rundturen är overifierad.** Användaren har inte lagt in någon API-nyckel
  än och sa att det får vänta. Allt är enhetstestat men ingen riktig prompt har
  gått ut till en leverantör.
- **Backupfilen är inte längre självbärande.** Efter bildmigreringen innehåller
  en export sökvägar till molnlagringen, inte bildbytes. Behöver lösas innan
  publicering.

## Fällor som redan kostat tid

- **`switchView` hade en kapplöpning** som visade två vyer samtidigt. Rättad,
  men samma mönster kan finnas på fler ställen: undvik `setTimeout` för att
  synkronisera DOM-tillstånd.
- **Webbläsarpanelens skärmbilder blir ibland gamla.** Verifiera hellre med
  `get_page_text` eller `javascript_tool`; en `resize_window` tvingar omritning.
- **`[hidden]` slås ut av `display`.** Ett element med `display: flex` visas
  trots attributet. `base.css` har en regel för det.
- **Agenter driver från designen om briefen beskriver en riktning.** Ge dem
  konkreta avvikelser att åtgärda och kräv att de jämför mot mockupen.
- **Vitest kör inte Vite-pluginen**, så serverns miljövariabler finns inte i
  testerna. Det är avsiktligt.

## Beslut som är fattade och inte ska tas om

| Fråga | Beslut |
|---|---|
| Målgrupp | Publik app, öppen registrering |
| AI-kostnad | Användaren tar med egen nyckel. Ingen serverside-nyckel |
| Frontend | Vanilla JS i ES-moduler. Ingen React |
| Backend | Supabase. **Ingen service role-nyckel** |
| Språk | Enbart svenska, ingen språkfil |
| Spellägen | Alla åtta behålls, men byggs om |
| Design | "Lugn precision", enbart ljust läge, verdigris-grönt. Aldrig blått |
| Nyckeltalen | **Inga lodräta linjer mellan talen.** Användaren underkände dem, trots att mockupen har dem. Återinför dem inte |
| Repetitionen | Fokusläge: sidopanelen fälls in medan passet pågår |
| Mobil | Tolkningen "stram komposition", inte den gestledda |
| Namn | Repetix |
