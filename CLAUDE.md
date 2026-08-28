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

Migrationer körs manuellt i Supabases SQL Editor, i ordning.

## Regler

- Gränssnittet är på svenska. Kommentarer förklarar **varför**, aldrig vad.
- `.env` committas aldrig. Ingen serverside-AI-nyckel finns.
- Schemaläggningen (`src/domain/srs.js`) är rena funktioner. Håll den så, och
  lägg till test när den ändras — invarianten `Igen ≤ Svårt < Bra < Lätt`
  provas över 196 tillstånd.
