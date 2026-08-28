# Överlämning

Skriven 2026-08-28. Läs den här före [CLAUDE.md](../CLAUDE.md) och
[specen](superpowers/specs/2026-08-28-repetix-design.md).

## Var arbetet står

Ombyggnaden är indelad i sex etapper. Tre är klara, en är påbörjad.

| Etapp | Status |
|---|---|
| 1. Fundament — git, Vite, moduluppdelning, tester | **Klar** |
| 2. Molnet — Supabase, auth, offline-synk, bilder | **Klar** |
| 3. AI — leverantörsoberoende lager, serverproxy | **Klar** |
| 4. Design — hela gränssnittet | **Påbörjad, underkänd** |
| 5. Spellägena — åtta lägen ombyggda | Ej påbörjad |
| 6. Publicering — README, licens, CI, Vercel | Ej påbörjad |

461 tester, noll lintfel, bygget går igenom. 16 commits.

## Nästa steg, i ordning

### 1. Gör designen trogen mockupen

**Detta är det som blockerar allt annat.** Användaren har underkänt nuvarande
design med orden *"detta är ju inte den"*. En omgång agenter tog mockupens
palett och typografi men byggde en egen tolkning.

Facit är mockupen, som nu ligger i repot:
`docs/mockup-a-lugn-precision.html` och `docs/mockup-mobil-1-stram.html`.
Servera dem och appen sida vid sida och jämför tills de stämmer — designbeslut
ska inte tolkas fritt.

Kända avvikelser i **biblioteket**:

- Rubriken säger "Mitt bibliotek", mockupen säger "Bibliotek".
- Åtgärdsraden har ikoner; mockupen har små knappar utan ikoner med
  "Repetera allt" som enda fyllda primärknapp.
- Statistikraden ligger fritt; i mockupen ligger de tre talen i en **inramad
  panel** med lodräta hårlinjer mellan cellerna.
- "Dagens mapp" saknar mockupens **gröna vänsterkant**.
- Sidopanelen listar bara bokhyllornas namn. I mockupen är bokhyllan en liten
  versal etikett och **kortlekarna ligger som rader under den**, med
  fyrkantsprick till vänster och antal förfallna högerställt i monospace.
- Kortleksrutnätet är grupperat per bokhylla med egna rubrikrader; mockupen har
  ett **platt rutnät** med tre kolumner.
- Kortleks-korten är för kompakta. I mockupen: titel högst upp, mycket luft,
  tunn framstegslinje, och underst "142 kort  12 förfallna" i monospace.

Kända avvikelser i **studievyn** (den vy användaren uttryckligen älskar i
mockupen):

- Frågan och svaret är **centrerade**; i mockupen är de **vänsterställda** i en
  spalt med begränsad radlängd.
- Topraden visar "Avsluta / Radera / 1 / 2". Mockupen har en tunn rad med
  kortlekens namn i halvfet, mappens namn i grått, och till höger en tickskala
  följd av "7 av 19" i monospace.
- Betygsknapparna har en streckramp i övre högra hörnet. Mockupen har
  **tangentnumret** där. Streckrampen hör hemma under 768px där det inte finns
  tangentbord.
- Sekundäråtgärderna är vänsterställda; i mockupen är de **centrerade** under
  betygsknapparna.

Mobilvyn följer `docs/mockup-mobil-1-stram.html` och användaren har **inte**
klagat på den.

### 2. Gör klart beskrivningsfältet

Datalagret är klart och testat: migration `0003`, `model.js`, `createCard`.
Kvar:

- Ett tredje fält i formulären för nytt och redigerat kort.
- Rendering i studievyn, under svaret. Mockupen har redan raden.
- Användaren behöver köra migration `0003` i Supabases SQL Editor.

### 3. Flytta Importera och Exportera till Inställningar

Användarens beslut: de ska inte finnas i biblioteket alls. Skapa ett avsnitt
"Data" i inställningsvyn.

### 4. Etapp 5 — spellägena

Åtta lägen ska byggas om "så att de verkligen är bra". Deras CSS ligger
oförändrad i `src/styles/games-legacy.css` (3 000 rader) med ett skikt som
översätter gamla variabelnamn till de nya tokens.

Kända problem:

- **Transportbandet är helt ospelbart på mobil** — enda styrningen är
  piltangenter, korgarna saknar klick- och touch-handlers.
- **Alla åtta är otillgängliga med tangentbord** — `.pg-mode` är en `<a>` utan
  `href`.
- `src/games/_legacy-fritext.js` är 241 rader död kod som aldrig nås.
- Lägena använder fortfarande dekorfonter (Bangers, Russo One) som skär sig mot
  resten av appen.

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
| Mobil | Tolkningen "stram komposition", inte den gestledda |
| Namn | Repetix |
