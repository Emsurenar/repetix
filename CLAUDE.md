# CLAUDE.md

Vägledning för Claude Code (claude.ai/code) i det här repot.

## Repetix

Repetitionsapp med spaced repetition. Svenskt gränssnitt. Under ombyggnad från
en lokal envägsapp till en publik, molnlagrad app på Vercel enligt
[specen](docs/superpowers/specs/2026-08-28-repetix-design.md).

## Kommandon

```
npm run dev      # Vite på http://localhost:5173
npm test         # Vitest
npm run lint     # ESLint
npm run build    # produktionsbygge till dist/
```

Starta aldrig en dev-server med Bash. Använd `preview_start` med namnet
`repetix` från `.claude/launch.json`.

## Arkitektur

Vanilla JS i ES-moduler, byggt med Vite. Ingen ramverksberoende. `index.html`
innehåller alla vymallar och modaler; `style.css` all styling.

```
src/
  main.js       startpunkt: importerar moduler och anropar init-funktionerna
  app/          vendor (marked, KaTeX), initApp
  core/         state, storage, backup, utils
  domain/       srs (ren SM-2), stats
  ui/           en modul per vy, plus wiring/ för DOM-koppling
  games/        ett spelläge per modul
  ai/           anrop, prompts, wiring
tests/          Vitest
```

### Två konventioner som styr allt

**Delat tillstånd ligger i `S`** (`src/core/state.js`), ett muterbart objekt med
appens 50 globaler: `S.appData`, `S.currentDeckId`, `S.currentStudyCards` och så
vidare. Moduler importerar `S` och läser eller skriver egenskaper på det. Detta
är ett mellanläge från den ursprungliga enfilsappen, inte en slutgiltig design —
det ersätts av riktig molnlagring i etapp 2.

**Moduler definierar, `main.js` kopplar.** En modul innehåller bara
definitioner. All DOM-koppling ligger i en exporterad `initXxx()`-funktion som
`main.js` anropar, i samma ordning som den ursprungliga filen körde dem.
Ordningen har betydelse — flytta inte anropen i `main.js` utan att kontrollera
vad som beror på vad.

## Data

All data ligger i localStorage under `noji_clone_data`, plus separata nycklar
för rekord (`pg_records`), dagens mapp (`noji_dagens_mapp`) och personbästa per
spelläge (`spaced_rep_*_pb_*`). `saveData()` anropas efter varje mutation.

Kända problem som etapp 2 löser: bilder lagras som okomprimerad base64 och kan
spränga localStorage-kvoten, och statistiken härleds ur `card.lastReviewed` som
skrivs över vid varje repetition, så historiken raderar sig själv.

## Regler

- Inga emojis någonstans i appen.
- Gränssnittet är på svenska.
- `.env` committas aldrig. Det finns ingen serverside-API-nyckel i den nya
  arkitekturen; användarna tar med egna nycklar.
- Schemaläggningen (`src/domain/srs.js`) är rena funktioner utan DOM. Håll den
  så, och lägg till test när den ändras.
