# Överlämning

Skriven 2026-08-28. Läs den här före [CLAUDE.md](../CLAUDE.md) och
[specen](superpowers/specs/2026-08-28-repetix-design.md).

## Var arbetet står

Ombyggnaden är indelad i sex etapper. Alla sex är klara utom själva
Vercel-deployen, som ägaren gör själv.

| Etapp | Status |
|---|---|
| 1. Fundament — git, Vite, moduluppdelning, tester | **Klar** |
| 2. Molnet — Supabase, auth, offline-synk, bilder | **Klar** |
| 3. AI — leverantörsoberoende lager, serverproxy | **Klar** |
| 4. Design — hela gränssnittet | **Klar** |
| 5. Spellägena — åtta lägen ombyggda | **Klar** |
| 6. Publicering — README, licens, CI, säkerhet | **Klar utom deploy** |

541 tester, noll lintfel, bygget går igenom.

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

Alla åtta delar nu toppslist, tal och knappspråk. Sudden Death, Jeopardy,
Dammiga kort, Fritext och Dragkampen bygger helt på `.arena`-klasserna;
Lucktext, Action och Transportbandet behåller sina egna spelplaner — ett kort
som faller mot fyra korgar går inte att pressa in i arenans kolumn — men har
samma slist och samma sätt att skriva tal.

Kvar att göra om någon vill:

- `games-legacy.css` är fortfarande 2 159 rader, och spelen bär 111
  inline-stilar. De flesta är funktionella (animeringstider, textstorlek som
  skalar med svarets längd), men inte alla.
- Touch är provspelat för Transportbandet. Övriga sju har knappar och fungerar
  med tryck, men ingen har provspelats på en riktig telefon.

### 4b. Referensdriven polering — klart (2026-08-28, kväll)

Ägaren gav tre referenser i följd — Wispr Flow (kurvatur, luft, feta
småtitlar, suddig bild som bakgrund), en nästan svart knapp ("jag älskar
den") — och underkände korsövertoningen och de instruerande texterna.
Ledbilden var **"en bra frisör": dörren öppnas, inget är ansträngt, sidan
ska kännas som att den bryr sig om en.**

- Radieskalan är 6/10/16. Knappar och fält ligger på `--r-md`, paneler och
  kort på `--r-lg` — hörnet är knappt en tredjedel av kontrollhöjden, som
  referensknappen.
- **Primärknappen är bläck** (`--ink`), inte accentfylld. Accenten behåller
  tal, tillstånd och länkar.
- Små titlar — kortlekskort, panelerna, mapparna — bär vikt 600.
- `.hero-wash` i components.css är "den suddiga bilden": ägaren gav ett foto
  av ett mörkt biblioteksvalv och bad om det blurrat fullt ut bakom "Dagens
  mapp". Bilden fanns bara i konversationen, aldrig som fil — men fullt
  utblurrad är ett foto inte längre ett foto, utan sex färgfält. De ritas
  som gradienter efter bildens egen ljusfördelning: valvets mörker, lamporna
  längs väggarna, kupolens kalla dager, boksidornas kräm. Panelerna är
  därmed **mörka ytor**, och allt i dem vänder (`--on-wash-*`).
  - **Överskjutet är pixlar, inte procent.** Med `inset: -30%` växer
    pseudoelementet med panelens bredd; på en bred banderoll blev det 60 %
    bredare än panelen och lamporna hamnade utanför bild.
  - **Vinjetten måste vara hög.** En ellips på 120 % av en 117 px hög panel
    slukar hela ytan.
  - **Skärmen till vänster är inte dekor.** Utan den står rubriken över
    lampornas ljusaste punkt: 4,2:1. Med den 10:1.
  - **Verdigris bär inte mot valvet** (2,8:1). Panelens tal använder
    `--on-wash-accent`, den ljusa systern, med 10:1.
  - Tysta lägen dämpas med `saturate`/`brightness` på pseudoelementet — inte
    med `opacity` på panelen, som hade tagit texten med sig.
  - Vill man byta till ett riktigt fotografi: lägg filen i `public/`, sätt
    den som `background-image` på `.hero-wash::before` och behåll skärmen
    och `--on-wash-*`. Inget annat behöver ändras.
- **Knappar och navigering bär halvfetstil** (600): `.btn`, `.chip` och
  sidopanelens fot. Kortleksraderna i trädet står kvar i normal vikt —
  viktskillnaden är det som skiljer appens egna vägar från innehållet
  användaren lagt in.

### 4c. En kurvatur, och en bild per kortlek — klart (2026-08-28, sen kväll)

- **`--r-md` och `--r-lg` är båda 16px.** Ägaren pekade ut hörnet på "Dagens
  mapp" och sa att exakt alla knappar ska ha det. Knappar, fält, väljare,
  ikonknappar, kort och paneler delar därmed hörn. `--r-sm` (10px) är kvar
  enbart för listrader, menyval och tangentmärken — 16px hade gjort en 30px
  hög rad till en kapsel. **Ändra aldrig det ena av md/lg utan det andra.**
- **Trettio bilder i `public/wash/`**, nedskalade till 40 px breda. Uppskalade
  till panelens bredd *är* de oskärpan — en gaussisk suddning av ett foto och
  en uppskalning av dess miniatyr ger samma yta, och den senare väger 1,4 kB.
  Hela basen är 120 kB. Fem av dem är ägarens egna bilder, resten hämtade
  från Picsum (Unsplash-licens).
- `src/ui/wash.js` väljer bild ur en FNV-hash av kortlekens id, så samma lek
  får alltid samma bild. Spelhallens åtta kort använder samma maskineri med
  nyckeln `spel:<id>`.
- **Skärmen är inte dekor.** Den ligger mellan bild och innehåll, tyngst till
  vänster där texten står. Utan den beror läsbarheten på vilken kortlek man
  råkar ha öppnat — en skog i motljus hade lämnat rubriken oläslig.
- Formulärets valrad (Bild / Stil / Mapp) talar ett språk: tre kontroller med
  samma höjd, kant och hörn, och etiketter i samma stil som Fråga och Svar.
  Långformat var en naken kryssruta mellan två ramade kontroller — radens
  tydligaste skavank, och det ägaren kallade inkonsekvent.
- Formulärvyerna (`#view-add-card`, `#view-add-note`) är centrerade spalter
  på 46 rem. Vyn heter "Nytt kort" som knappen som ledde dit, fälten heter
  Fråga och Svar utan parenteser, och fokus står redan i första fältet.
- **Instruerande texter är borttagna**: dagbokens inledning ("Skriv fritt
  vad du lärt dig idag…"), AI-guidens två fälttips, fördjupningens
  förklaring, och AI-förslagens "Anpassa eller välj…". Etiketten bär
  betydelsen. Statusrader och varningar med konsekvens (Inställningar → Data)
  står kvar.
- `npm run dev` läser numera `$PORT` med 5173 som standard, så att två
  sessioner kan köra var sin server (`autoPort` i launch.json).

### 4d. Spellägena byggda för att sugas in i — klart (2026-08-28, natt)

Nio agenter parallellt: en per läge plus en för inställningssidan, var och en
med **exakt två egna filer** som ingen annan fick röra. Uppdraget var ägarens
ord: *"Spelen ska hooka en. Man ska VILJA spela."*

Varje läge har nu en egen `src/styles/games/<namn>.css` som laddas sist och
vinner över den gamla stilmallen utan `!important`.

**Tre lägen hade fel som gjorde dem meningslösa:**

- **Action mätte handleden, inte minnet.** Det var ett rytmspel påklistrat på
  ett flashcard — svaret avslöjades ord för ord och man tryckte i takt med en
  ring. Man kunde maxa ett kort man aldrig sett. Nu äger klockan skärmen,
  betyget härleds ur hur lång tid återkallandet tog, och rundan kan förloras.
- **Sudden Death slutade efter 20 kort** trots att det hette "tre liv". Liven
  var pynt och det fanns inget rekord att jaga. Rundan tar nu slut när livet
  gör det.
- **Transportbandet stannade efter varje kort** tills man tryckte mellanslag —
  en flervalsfråga med nedräkning. Nu driver två klockor spelet, och en
  växande kö är rundans enda dödssätt.

**Buggar som satt i det gamla och rättades:**

| Läge | Fel |
|---|---|
| Dragkampen | `showEndScreen` letade `.cinema-content` men markupen har `.arena` — **varje avslutad match kastade TypeError**, slutskärmen renderades aldrig |
| Dragkampen | Falska påståenden togs utan textjämförelse: två kort med samma svar gav ett "falskt" påstående som var sant. `Cmd+F` svarade "Falskt" |
| Lucktext | Omstart bytte `S.currentStudyCards` mot en ny array medan spelet höll den gamla — **`processRating` skrev fel SRS-data** |
| Dammiga | `rateKH` togs bara bort vid tangentbetyg. Klickade man låg den kvar och satte betyg på **nästa, olästa kort** |
| Sudden Death | `showEndScreen` anropade `cleanup()` som tog bort tangentlyssnaren — Enter för att spela igen fungerade inte |
| Transportbandet | `renderLives()` satte tom sträng för både fyllt och tomt liv — **liven var osynliga** |
| Flera | Läckta `keydown`-lyssnare som svarade långt efter att ytan var borta |

**Bokföringen var trasig i fyra riktningar samtidigt.** `processRating` bokför
redan varje betyg i `S.playgroundSessionStats`; därtill skrev lägena sina egna
tal i samma fält. Ett räknade varje kort dubbelt, ett skrev poängsumman i
fältet för antal rätt och påstod "340 kort sorterade", ett skrev aldrig och sa
"0 av 0 rätt".

**Den generiska resultatvyn är pensionerad.** Alla åtta lägen bygger nu egna
slutbilder med jämförelse mot personligt rekord, och den generiska visades
*ovanpå* dem. `updatePersonalRecords` visade sig dessutom **ignorera båda sina
argument** — statistiken hade alltså ingen annan konsument. Objektet finns kvar
eftersom study.js skriver till det, men **lita inte på dess innehåll**:
betydelsen skiljer sig mellan lägen.

**Städat efteråt:**

- `games-legacy.css` **1 900 → 813 rader** (den var 3 063 när ombyggnaden
  började). 152 regelblock bort, hittade genom att pröva varje klass mot
  faktisk användning i stället för att lita på radnummer.
- Den gamla banderollen `.dagens-mapp-banner` / `.btn-dagens-action` — 21 block
  död kod som dessutom innehöll `var(--in-oklch)`, en felskrivning av
  gradient-syntaxen `in oklch`.
- Segmentväljaren i `auth.css` och dess spår i `motion.css`.
- Den sista instruerande meningen: `#backup-status` sa "klicka Exportera" bredvid
  en knapp som redan heter Exportera.
- **Noll odefinierade tokens** i hela kodbasen. Två lägen använde
  `var(--radius-md)` som aldrig funnits — hörnen renderades fyrkantiga utan att
  något klagade. Sådana fel är tysta: webbläsaren kastar hela deklarationen.

**Kontrollerat i webbläsare:** alla åtta lägen öppnade och renderade, Action
provspelat ett kort, inga nya konsolfel. Rörelsen i Transportbandet och
Dragkampen är sedd men inte provspelad med finger.

### 5. Etapp 6 — publicering — klar utom själva deployen

`README.md`, `LICENSE` (MIT) och `.github/workflows/ci.yml` finns. CI kör lint,
test och bygge på push och pull request. **Ägaren gör Vercel-deployen själv** —
se lanseringschecklistan sist i det här avsnittet.

**Startpaketet: 820 → 563 kB** (gzip 228 → 152), CSS 192 → 163 kB. KaTeX (261
kB plus sextio typsnittsfiler) hämtas nu först när ett kort faktiskt bär
matematik. `renderLatex` är därmed asynkron; alla anropare utom en struntar i
returvärdet, vilket är rätt för något som renderar in i DOM:en. Undantaget är
lucktext, som går igenom noderna efter `.katex` för att hålla matematik utanför
luckorna — utan `await` blev en renderad formel en lucka man ombads skriva av,
men bara på första kortet med matematik.

**Noll inline-`onclick`** i hela kodbasen (påståendet om tre i `index.html` var
föråldrat; de var noll där men åtta i JS-genererad markup). Det var
förutsättningen för CSP:n i `vercel.json`, som kan sättas med `script-src
'self'` utan `unsafe-inline` eftersom bygget bara lägger en extern modul i
HTML:en.

#### Säkerhetsgenomgången

Tre granskningar: serverfunktionerna, konto- och dataåtkomst, samt injektion i
klienten. **Kryptering, autentisering, SSRF-skydd och radnivåsäkerhet håller** —
det verifierades i detalj och ska inte tas om. Inga hemligheter finns i repot
eller i git-historiken (alla 405 blobbar genomsökta).

Det som **inte** höll, och nu är åtgärdat:

| Fynd | Vad som hände |
|---|---|
| **Ingen HTML-sanering alls** | `safeParse` skyddade bara LaTeX mot markdown. `marked` v14 släpper igenom rå HTML, och resultatet går till `innerHTML` på 48 ställen. Ett kort med `<img src=x onerror=…>` körde kod. Sessionen ligger i localStorage → kontoövertagande. LaTeX-platshållarna återställdes dessutom **efter** `marked`, en andra oberoende väg in. Båda saneras nu med DOMPurify |
| **Brödsmulan** | Byggde ett `onclick` av kortlekens id och renderade titeln rått. Ett id kan komma från en importerad backupfil och kunde skriva om vad strängen gjorde |
| **AI-svar i en `<textarea>`** | `proposed-cards.js` la modellens svar oescapat inuti elementet. `</textarea><img src=x onerror=…>` bröt ut. Promptinjektion via kortinnehåll är en färdig väg dit |
| **Id ur klockan** | Kortlekar m.fl. fick `Date.now().toString()`, och id är primärnyckel **ensamt** — en global namnrymd. En angripare kunde lägga beslag på en timmes id:n och permanent låsa godtyckliga användares synk. Hände också av misstag vid samma millisekund. Nu UUID. **Kort rörs inte** — deras id bär redan slump, och spelhallen läser den inledande tidsstämpeln |
| **`reviews`-upserten** | Saknade `ignoreDuplicates` och blev `ON CONFLICT DO UPDATE`. Loggen är append-only och saknar med flit update-policy, så en krock kastade — och `pushReviews` ligger före `pull()`. **Två öppna flikar räckte för att döda synken permanent** |
| **Läcka mellan konton** | Spegeln tömdes bara via utloggningsknappen. Gick sessionen förlorad på annat sätt loggade nästa användare in ovanpå förra användarens data, och molnlagret visade den. `claimMirror` i `sync.js` tömmer nu spegeln när den tillhör någon annan, **före** utkorgen skickas. Synkmarkören är namnrymdad per användare |
| **Utloggningen** | Tog bara bort en av sju nycklar. Kvar låg hela biblioteket i klartext under `repetix_lokal_data_innan_molnet`. Dialogen lovade redan motsatsen |
| **Lösenordsåterställning** | Länken fanns men ingen vy tog emot den. Med `detectSessionInUrl` blev användaren **inloggad** av att klicka den och trodde sig ha bytt lösenord medan det gamla gällde |
| **Trasig importfil låste appen** | `loadData()` låg först i `initApp`, så när den kastade kopplades aldrig importknappen — enda vägen tillbaka |
| **`.env.example`** | Beskrev anon-nyckeln som RLS-kringgående. En självhostare kunde dra slutsatsen att en service role-nyckel behövdes och klistra in en — vilket hade slagit ut varenda policy |

#### Kvar innan öppen registrering

- **Takt-spärr i `/api/*`** — `/api/ai-key` är annars ett obegränsat
  nyckelvalideringsorakel: svaret skiljer exakt på giltig och ogiltig nyckel,
  verifieringen kostar noll tokens, och anropen går från Vercels IP:n.
- **Migration 0004**: lagringshinken saknar `file_size_limit` och
  `allowed_mime_types`, och `public` sattes aldrig (`on conflict do nothing`
  rör inte en befintlig hink). Utan det är den gratis filhotell.
- **Främmande nycklar validerar inte ägarskap** — ett kort kan peka på någon
  annans kortlek. Inte läsbart för offret, men `on delete cascade` och ett
  existens-orakel följer med.
- **`deleteImage` anropas aldrig.** Mjuk radering lämnar filerna i hinken för
  alltid. Vid kontoradering blir de föräldralösa och överlever kontot.
- **Ingen kontoradering finns** i appen alls.

#### Lanseringschecklista — kräver ägaren

1. Kör migration `0003` och `0004` i Supabases SQL Editor, i ordning.
2. Verifiera RLS i det **körda** projektet, inte bara i filerna:
   `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';`
   och `select tablename, policyname, cmd from pg_policies where schemaname in ('public','storage');`
3. Slå på **e-postbekräftelse** i Supabase Auth. Utan den kostar ett nytt konto
   ingenting, och varje takt-spärr per användare går att kringgå.
4. Lägg `/#aterstall` i Supabases **Redirect URLs**, annars avvisas
   återställningslänken tyst.
5. Sätt de fem miljövariablerna i Vercel. **Ingen av dem är en service
   role-nyckel.**
6. Överväg en brandväggsregel per IP på `/api/*` (kräver Pro), eller
   Spend Management-tak på Hobby.
7. `public/wash/` innehåller 25 bilder från Picsum under Unsplash-licens. MIT
   ger formellt rätt att sälja kopior, vilket inte gäller fotona. Härkomsten
   står i README; vill man ha det vattentätt byts de mot egna eller CC0.

## Interaktionen — rörelsesystemet

Ägaren underkände appen som "inte inbjudande" och pekade på interaktionen, inte
designen. Svaret blev ett rörelselager i `src/styles/motion.css` med fyra tempon
och fyra kurvor i `tokens.css`.

**Regeln som allt hänger på: ingen varaktighet skrivs i millisekunder utanför
tokens.** Den som bett systemet om mindre rörelse får då noll, inte mindre, utan
att varje enskild regel behöver komma ihåg att fråga.

- Allt som kommer in bromsar in och reser sig sex pixlar; allt som lämnar
  accelererar bort. Ögat vet vad som är på väg in utan att läsa något.
- Kontroller ger efter under fingret. Kort lyfter ett hårstrå under pekaren —
  bara med mus: på en pekskärm finns inget "över".
- Listor lägger sig på plats med 30 ms mellan raderna, knutet till **navigering**
  och inte till rendering. En sökning ritar om listan vid varje tangenttryck.
- Vybytet visar aldrig två vyer samtidigt. Korsövertoningen som stod här
  underkändes ("man kan se båda sidorna samtidigt. Fult"), och intoning från
  noll ger en tom sida i några bildrutor — det var därför övertoningen en gång
  infördes. Lösningen som gör ingetdera: den utgående döljs i samma bildruta,
  den nya står färdig med full opacitet och sätter sig sex pixlar, och bara
  innehållet tonar via förskjutningen.
- Repetitionen är koreograferad: täckningen lyfts ett streck i taget, svaret
  följer, betygen kommer efter. Betygsättningen bär kortet bort åt domens håll.
- Spelytan tonar in och ut. In-toningen fanns aldrig: alla åtta lägen lade till
  elementet och klassen i samma bildruta, vilket slår ihop start och slut.

### Fallgropar som kostade tid

- **`.stagger` som spelas om vid varje omritning** är en blinkning, inte en
  välkomst. Klassen måste sättas av vybytet, aldrig av renderingen.
- **`appendChild` + `requestAnimationFrame` i samma bildruta** hoppar över
  övergången. Det krävs en framtvingad layoutläsning emellan.
- **En animation startar inte om av att klassen läggs tillbaka.** Ta bort, läs
  `offsetWidth`, lägg på.
- **`outline: none` → `solid` går inte att tona.** Sätt `transparent` permanent
  och tona `outline-color`.
- **Ett nyskapat element börjar i sitt slutläge.** Tickskalan måste byta klass
  på befintliga streck, inte skriva om raden.

### Två fel som kunde kosta data eller tillgänglighet

- **Betygsraden tar över samma pixlar som "Visa svar" låg på**, och
  mittpunkten på den knappen hamnar inuti "Bra". En dubbelklick satte ett betyg
  på ett kort ingen läst, och ett betyg går inte att ta tillbaka. Spärren ligger
  i `src/ui/flashcard.js` (`nyssVand`); tangenterna 1–4 passerar den.
- **Sidopanelen flyttas ut med transform** och låg därför kvar i tabbordningen:
  tretton osynliga kontroller infälld, och mitt i ett pass tabbade man rakt in i
  det osynliga biblioteket. Löst med `inert`, synkat från en observator på
  `<body>` i `src/app/init.js`.

### Kvar

- Kortradens svar snäpper fram medan mappen bredvid glider. Ett försök att
  fälla ut det över sin egen höjd gick inte att verifiera och backades.
- Två förskjutningssystem gör samma sak: `.stagger` i `motion.css` och
  spelhallens egna keyframes med `--i`. Bör slås ihop.
- Radmenyerna är `<details>` utan `aria-expanded` och utan pilnavigering.
- Sjutton dialoger, tre olika fotlösningar. Tre saknar Avbryt.
- Skapa kortlek tar två dialoger.

## Öppna punkter som kräver användaren

- **AI-rundturen är overifierad.** Användaren har inte lagt in någon API-nyckel
  än och sa att det får vänta. Allt är enhetstestat men ingen riktig prompt har
  gått ut till en leverantör. Migration `0003` är körd (2026-08-28).
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
| Primärknapp | Bläck (`--ink`), inte accentfylld — ägarens referensknapp 2026-08-28. Accenten bär tal, tillstånd och länkar |
| Vybyte | Ingen korsövertoning och ingen intoning från noll. Två synliga vyer samtidigt är underkänt |
| Texter | Inga instruerande stycken i formulär och modaler. Etiketten bär betydelsen; status och varningar med konsekvens får finnas |
| Inbjudningspanelerna | Mörka, med den utblurrade biblioteksbilden som tvätt. Enda mörka ytorna i appen — sprid dem inte, då slutar de vara en accent |
| Knappvikt | 600 på knappar, chips och sidopanelens fot. Kortleksrader i trädet står kvar på 400 |
| Nyckeltalen | **Inga lodräta linjer mellan talen.** Användaren underkände dem, trots att mockupen har dem. Återinför dem inte |
| Repetitionen | Fokusläge: sidopanelen fälls in medan passet pågår |
| Mobil | Tolkningen "stram komposition", inte den gestledda |
| Namn | Repetix |
