# CLAUDE.md

Vägledning för Claude Code i det här repot.

## Repetix

Repetitionsapp med spaced repetition. Svenskt gränssnitt. Under ombyggnad från
en lokal envägsapp till en publik, molnlagrad app på Vercel enligt
[specen](docs/superpowers/specs/2026-08-28-repetix-design.md).

**Läs [ÖVERLÄMNING.md](docs/OVERLAMNING.md) först** — den beskriver var arbetet
står, vad som är nästa steg, och vilka fällor som redan kostat tid.

## Kommandon

```
npm run dev      # Vite på http://localhost:5173
npm test         # Vitest
npm run lint     # ESLint
npm run build    # produktionsbygge till dist/
```

Starta aldrig en dev-server med Bash. Använd `preview_start` med namnet
`repetix` från `.claude/launch.json`. Mockuperna har ett eget namn, `mockups`.

## Arkitektur

Vanilla JS i ES-moduler, byggt med Vite. Inget ramverk.

```
src/
  main.js       startpunkt: importerar stilar och moduler, anropar init-funktionerna
  app/          vendor (marked, KaTeX), initApp, molnlagret
  core/         state, storage, supabase, sync, local-db, bilder, kryptering
  domain/       srs, model, diff, stats, history — rena funktioner, inget DOM
  ui/           en modul per vy, plus wiring/ för DOM-koppling
  games/        ett spelläge per modul
  ai/           call (enda anropslagret), models, prompts, wiring
  styles/       tokens, base, components, layout, views/, games-legacy
api/            serverfunktioner: ai, ai-key, _lib
supabase/       databasmigrationer, körs manuellt i SQL Editor
tools/          generate-icons.mjs
tests/          Vitest
```

### Konventioner som styr allt

**Delat tillstånd ligger i `S`** (`src/core/state.js`), ett muterbart objekt med
appens 50 globaler. Ett mellanläge från enfilsappen, inte en slutgiltig design.

**Moduler definierar, `main.js` kopplar.** All DOM-koppling ligger i en
exporterad `initXxx()` som `main.js` anropar i ursprunglig ordning. Ordningen
har betydelse — flytta inte anropen utan att kontrollera beroenden.

**`domain/` importerar aldrig från `ui/`.** Domänmodulerna är rena funktioner
och testas utan webbläsare.

## Design

Riktningen heter **"Lugn precision"** och facit är mockupen:

```
docs/mockup-a-lugn-precision.html   (desktop, sektion 01 bibliotek, 02 repetition)
docs/mockup-mobil-1-stram.html      (mobil)
```

Öppna dem och appen sida vid sida och jämför. **Designbeslut ska stämmas av mot
mockupen, inte tolkas fritt.** En omgång agenter tog paletten men byggde en egen
tolkning, och användaren underkände resultatet med orden "detta är ju inte den".

- `src/styles/tokens.css` är **enda** stället där en färg, ett typsnittssteg
  eller ett avstånd får definieras. Noll hårdkodade hexvärden utanför den.
- Noll `!important`. Behövs specificitet: använd id-scope.
- Enbart ljust läge. **Aldrig blått** — accenten är verdigris `#0E6A5E`.
- Inga skuggor. Djup skapas av ytkontrast och 1px-linjer.
- Kontrollhöjd styrs av `--control-h`: 34px med mus, 44px med finger via en
  enda mediefråga. Hårdkoda aldrig höjder.
- Inga emojis. Inga hover-beroende funktioner — allt ska nås med ett finger.

### Kurvatur — **en enda**

Ägaren pekade ut hörnet på "Dagens mapp" och sa att **exakt alla knappar** ska
ha det. Därför är `--r-md` och `--r-lg` **båda 16px**: knappar, fält, väljare,
ikonknappar, kort och paneler har samma hörn. Skalan finns kvar för att
beskriva vad en sak är, inte för att den ska se annorlunda ut.

- Skriv **aldrig** en egen radie. Ingen `border-radius: 8px` någonstans.
- `--r-sm` (10px) är bara för listrader, menyval och tangentmärken — de är
  inte knappar, och 16px hade gjort en 30px hög rad till en kapsel.
- `--r-pill` är bara chips.
- Ändrar du den ena av md/lg måste du ändra den andra.

### Övriga låsta beslut

- **Primärknappen är bläck** (`--ink`), inte accentfylld. Accenten bär tal,
  tillstånd och länkar — aldrig massa.
- **Knappar och navigering bär vikt 600.** Kortleksrader i sidopanelens träd
  står kvar på 400: viktskillnaden skiljer appens egna vägar från användarens
  innehåll.
- **Inbjudningspanelerna** ("Dagens mapp", kortlekens statusband) är appens
  **enda mörka ytor**: en utblurrad bild per kortlek ur `public/wash/`, vald i
  `src/ui/wash.js`. Allt som står i dem använder `--on-wash-*`. Sprid dem
  inte — en mörk yta som återkommer slutar vara en accent.
- **Inga instruerande stycken** i formulär och modaler. Etiketten bär
  betydelsen. Status och varningar med konsekvens får finnas. Enda undantaget
  är nyckelguiden under API-nyckelfältet i Inställningar (ägarens beslut
  2026-09-05): den ber om något man måste hämta hos någon annan, och står
  hopfälld tills man ber om den.
- **Vybytet visar aldrig två vyer samtidigt** och tonar aldrig från noll.
- **Fokusera aldrig ett fält på pekskärm.** Fokus i ett fält är ett uppfällt
  tangentbord, och dialogen knuffas upp över det innan man hunnit läsa den.
  Gå alltid genom `fokusera()` i `src/ui/fokus.js`; anropa aldrig `.focus()`
  på ett fält direkt.
- **Högerklick på en rad öppnar dess radmeny** (`contextmenu` i
  `src/ui/library.js`), på samma plats som de tre punkterna. I sidopanelen,
  som saknar radmenyer, öppnas samma val vid pekaren (`src/ui/kontextmeny.js`).
  Fält och länkar lämnas åt systemets egen meny.
- **Kortlekens verktygsrad är tre knappar**: Nytt kort, Ny mapp, AI. De fyra
  AI-verktygen ligger i en remsa som fälls ut under raden, likadant med mus
  och finger. Lägg inte tillbaka verktyg i raden.
- **En radmeny som hänger ut över nästa kort** måste lyfta sitt kort
  (`z-index` på `:has(.row-menu[open])`). Ett kort med transform är en egen
  stackningskontext, och menyn täcks annars av syskonet efter.
- **Appens egen väljare** (`src/ui/select.js`) klär varje `<select>`. En
  select som skapas efter uppstart måste anropa `initSelect()` själv, annars
  står systemets lista mitt i appen.

## AI

Allt går genom **en** funktion: `callAI({ system, user, maxTokens })` i
`src/ai/call.js`. Lägg aldrig till ett direktanrop mot en leverantör.

Anropet går via `/api/ai`, som slår upp användarens krypterade nyckel och
anropar vald leverantör. **Nyckeln når aldrig webbläsaren.** Kontraktet står i
[docs/api-contract.md](docs/api-contract.md) och ska ändras först.

Standardmodell `claude-opus-5`. Appen behöver **ingen** service role-nyckel.

## Data

Supabase i molnet, IndexedDB som lokal spegel, localStorage för appdatan.
Offline först: appen läser och skriver alltid lokalt, ändringar köas i en
utkorg.

- Vad som ändrats räknas ut med en **diff** mot förra ögonblicksbilden, inte
  genom att varje mutationsställe rapporterar sin avsikt.
- `reviews` är **append-only** och underlaget för all statistik. Streak
  härleds aldrig ur `card.lastReviewed` — det fältet skrivs över.
- Radering är **mjuk** via `deleted_at`.
- Ett kort har `front`, `back` och `description`. Beskrivningen är fördjupning
  som visas efter svaret och ingår aldrig i bedömningen.
- **En delad kortlek är en kopia**, aldrig en levande delning. Delningen är
  en ögonblicksbild i `deck_shares` (migration 0010), adresserad till en
  e-postadress som aldrig slås upp — eller, sedan 0011, till en väns id, som
  bara en accepterad vän får skicka till. Sorten (`kind`: deck, section,
  card) säger vad mottagaren erbjuds göra med lasten. Bilderna väntar under
  `delningar/<id>/` i hinken. Mottagaren får färska id:n på allt —
  nyttolasten litas aldrig på. Radnivåsäkerheten på innehållstabellerna har
  inga undantag.
- **Profilens statistik är en ögonblicksbild** som ägarens egen klient
  publicerar i `profiles.stats` efter synk (`src/core/vanner.js`). Ingen
  läser någon annans kort, lekar eller logg — regeln `user_id = auth.uid()`
  gäller utan undantag. En profil syns för andra först när den fått ett
  handtag. Profilbilder ligger i den publika hinken `avatars`.

Migrationer körs manuellt i Supabases SQL Editor, i ordning. **0010 och 0011
är inte körda** (2026-09-05): utan 0010 svarar delningen "Databasen saknar
delningsfunktionen", utan 0011 svarar Vänner detsamma och delning till vän
och av mappar/kort faller tillbaka på 0010:s form.

## Regler

- Gränssnittet är på svenska. Kommentarer förklarar **varför**, aldrig vad.
- `.env` committas aldrig. Ingen serverside-AI-nyckel finns.
- Schemaläggningen (`src/domain/srs.js`) är rena funktioner. Håll den så, och
  lägg till test när den ändras — invarianten `Igen ≤ Svårt < Bra < Lätt`
  provas över 196 tillstånd.

## Commits

**Repot är publikt.** Loggen är en del av det en främling läser, bredvid
README:n — och till skillnad från en arbetskopia går den inte att städa i
efterhand. Skriv varje meddelande till den läsaren, inte till den som satt i
rummet när ändringen gjordes.

- **Engelska**, Conventional Commits. Det är den globala regeln, och här finns
  skälet till att den gäller: gränssnittet är svenskt med flit, men loggen ska
  gå att läsa av vem som helst som klonar repot. Historiken är blandad —
  merparten är på svenska, en del på engelska. Den lämnas som den är; det som
  skrivs härifrån är på engelska.
- **Meddelandet ska stå för sig självt.** Läsaren har ingen konversation att
  falla tillbaka på. "Som vi pratade om", "fixar det förra" och "enligt
  önskemål" betyder ingenting för den som kommer hit via en sökning ett år
  senare.
- **Beskriv varför, inte vad.** Diffen visar redan vad. Samma regel som för
  kommentarer i koden: det som är värt att spara är resonemanget som inte syns
  i raderna — vilket alternativ som valdes bort, och vad som gick sönder förut.
- **Inget privat i kroppen.** Inga mejladresser, inga länkar till Vercel- eller
  Supabase-projektet, inga id:n ur dashboarden, inga nyckelfragment. Det som
  hamnar i loggen ligger kvar även sedan det tagits bort ur koden.
- Ingen `Co-Authored-By`-rad eller annan attribution.
