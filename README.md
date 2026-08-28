# Repetix

A spaced-repetition flashcard app: decks, scheduled reviews, offline-first
sync, optional AI help, and eight practice modes. Built as vanilla JavaScript
in ES modules with Vite — no framework.

**The interface is entirely in Swedish**, and deliberately so: there is no
translation layer and none is planned. Most source comments and the documents
under `docs/` are Swedish too. This README is in English so the repository can
be read without it.

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Run it locally](#run-it-locally)
- [Commands](#commands)
- [Set up Supabase](#set-up-supabase)
- [AI: bring your own key](#ai-bring-your-own-key)
- [Build and deploy](#build-and-deploy)
- [Architecture](#architecture)
- [Tests and CI](#tests-and-ci)
- [License](#license)

## What it does

- **Spaced repetition** — a SuperMemo-2 variant with four grades, in
  `src/domain/srs.js`. Pure functions, no DOM, and the invariant
  `Igen ≤ Svårt < Bra < Lätt` (Again ≤ Hard < Good < Easy) is tested across
  196 states.
- **Cards with three fields** — front, back, and an optional description that
  is shown after the answer and never counts towards the grade.
- **Offline first** — the app always reads and writes locally (localStorage for
  app data, IndexedDB for images) and queues changes in an outbox. What changed
  is computed as a diff against the previous snapshot rather than reported by
  each mutation site. Deletes are soft (`deleted_at`), and the review log is
  append-only — it is the basis for every statistic.
- **Accounts and cloud sync** — Supabase Postgres with row-level security on
  every table: each row carries `user_id`, and every policy requires
  `user_id = auth.uid()`. A bug in client code cannot hand one user's cards to
  another, because the barrier sits in the database.
- **Bring your own AI key** — generating cards from a topic or from a diary
  entry, deck insights, sorting loose cards into folders, and a tutor you can
  ask about the card in front of you. All of it runs on the user's own provider
  key, which never reaches the browser. See [below](#ai-bring-your-own-key).
- **Markdown and LaTeX** on both sides of a card (marked and KaTeX, bundled
  from npm with pinned versions).
- **Eight practice modes** — Action (speed and combo), Lucktext (cloze),
  Fritext (write the answer from memory), Jeopardy (see the answer, guess the
  question), Dammiga kort (the twenty cards untouched the longest), Sudden
  Death (three lives), Transportbandet (sort falling cards into the right
  folder), and Dragkampen (true or false, tug of war).
- **Images on cards**, compressed in the browser and stored in a private
  Supabase bucket where each user has their own folder.

## Requirements

- **Node 22 or newer.** `package.json` declares `>=20`, but the dependency tree
  is stricter: `@supabase/supabase-js` requires `>=22` and Vite 8 requires
  `^20.19 || >=22.12`. CI runs on Node 22.
- npm 10 or newer (ships with Node 22).
- A [Supabase](https://supabase.com) project, if you want accounts, sync, or
  AI. The free tier is enough. Everything else runs without one.

## Run it locally

```bash
git clone <your fork of this repository>
cd Spaced-repetition
npm install
npm run dev
```

The dev server comes up on <http://localhost:5173>. `PORT` overrides the port,
so `PORT=5174 npm run dev` lets a second instance run alongside the first.

**Without Supabase configured the app still runs**, in local-only mode: no
account, no sync between devices, no AI, and all data stays in that browser.
That is enough to try it out. Add a `.env` (see below) to turn the cloud on.

`npm run dev` also mounts the serverless functions in `api/` as Vite
middleware, via `vite-plugin-api.js`. The handlers are written in Node's
`(req, res)` form precisely so that the same files run locally and on Vercel
instead of drifting apart.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on <http://localhost:5173> (`$PORT` overrides) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint over `src` and `api` |
| `npm run format` | Prettier over `src`, `api` and `tests` |

## Set up Supabase

### 1. Create the project

Create a project at [supabase.com](https://supabase.com). The project URL and
the anon (publishable) key are under **Project Settings → API**.

### 2. Run the migrations

Open the **SQL Editor** in the Supabase dashboard and run the files in
`supabase/migrations/` **one at a time, in numeric order**. This project has no
CLI step and no `supabase link` — the migrations are applied by hand. All three
are idempotent, so re-running one is safe.

| File | What it sets up |
|---|---|
| `0001_init.sql` | Tables, `updated_at` triggers, row-level security policies, and the private `card-images` storage bucket |
| `0002_ai_key_access.sql` | `get_my_ai_key()` and the `user_ai_key_status` view — this is what removes the need for a service role key |
| `0003_card_description.sql` | The `description` column on `cards` |

Skipping `0003` does not break the app locally, but syncing a card that has a
description will be rejected by the cloud.

### 3. Authentication

Sign-up with email and password is open, using Supabase Auth's defaults; adjust
email confirmation under **Authentication** as you prefer.

The app also offers a *Sign in with Google* button, which needs the Google
provider enabled under **Authentication → Providers**. Leave it off and
everything else still works.

Both the OAuth flow and the password-reset link redirect back to the page's own
origin, so add every origin you serve the app from — `http://localhost:5173`
in development, your deployment URL in production — under **Authentication →
URL Configuration**.

### 4. Environment variables

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and must
stay that way.

| Variable | Side | What it is |
|---|---|---|
| `VITE_SUPABASE_URL` | client | Project URL |
| `VITE_SUPABASE_ANON_KEY` | client | Anon (publishable) key |
| `SUPABASE_URL` | server | The same project URL, without the prefix |
| `SUPABASE_ANON_KEY` | server | The same anon key, without the prefix |
| `AI_KEY_SECRET` | server | 32 random bytes in base64 — the master key that users' API keys are encrypted with |

Anything carrying a `VITE_` prefix is compiled into the client bundle and is
therefore public on the web. The anon key is designed for that: row-level
security is what protects the data. **Never put `VITE_` in front of the three
server variables.**

Generate the master key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Rotating `AI_KEY_SECRET` makes every stored API key unreadable, and each user
has to paste theirs in again. That is intentional — the alternative would be
that a leaked old master key could still decrypt everything.

### No service role key

The app deliberately needs **no** Supabase service role key, anywhere. That key
bypasses all row-level security, so a leak would lay every user's library open
— a bad price for a protection that is not the real defence here. Migration
`0002` replaces it with a `security definer` function that filters on
`auth.uid()`, which comes from the caller's own token and cannot be forged, so
it can only ever return the caller's own row.

## AI: bring your own key

Repetix ships without a server-side AI key and never pays for anyone's usage.
Each signed-in user pastes their own provider key under **Inställningar**
(Settings) → provider → **API-nyckel**.

What happens to it:

- It is verified against the provider before being stored, so a typo shows up
  immediately rather than at the next AI call.
- It is encrypted with AES-256-GCM using `AI_KEY_SECRET` and stored in
  `user_ai_keys`. **The key never comes back to the browser** — only a hint
  such as `sk-ant...4f2a`, enough to recognise which key is in place.
- Every AI call goes through `POST /api/ai` with the user's Supabase token. The
  server derives the user from that token, looks up the key and decrypts it
  inside the function.

Supported providers: Anthropic (default model `claude-opus-5`), OpenAI, Google
and OpenRouter. The model list in Settings is a convenience, not a limit — a
model id can always be typed in by hand, since providers ship new models more
often than this app updates.

In the code, every AI call goes through one function,
`callAI({ system, user, maxTokens })` in `src/ai/call.js`. Do not add a direct
call to a provider anywhere else. The endpoint contract is
[`docs/api-contract.md`](docs/api-contract.md), and it is meant to be changed
before either implementation is.

## Build and deploy

```bash
npm run build     # → dist/
npm run preview   # serve that build
```

`vercel.json` is already configured for Vercel: the `vite` framework preset,
`npm run build`, `dist/` as output, and the functions in `api/` with a 60
second limit (a slow model can take that long). Import the repository into
Vercel, add the five environment variables under **Project Settings →
Environment Variables**, and add the resulting URL to Supabase's redirect URLs.

Nothing in the code is Vercel-specific: any static host plus a Node function
runtime will do.

One known rough edge: the client bundle is around 800 kB, most of it KaTeX, and
has not been code-split yet.

## Architecture

```
src/
  main.js       entry point: imports styles and modules, calls the init functions
  app/          third-party bundling (marked, KaTeX), initApp, the cloud layer
  core/         state, storage, supabase, sync, local-db, images, encryption
  domain/       srs, model, diff, stats, history — pure functions, no DOM
  ui/           one module per view, plus wiring/ for DOM binding
  games/        one practice mode per module
  ai/           call (the only call layer), models, prompts, wiring
  styles/       tokens, base, components, layout, views/, games/
api/            serverless functions: ai, ai-key, _lib
supabase/       database migrations, run by hand in the SQL Editor
tools/          generate-icons.mjs
tests/          Vitest
docs/           handover, API contract, design mockups
```

Four conventions hold it together:

- **Shared state lives in `S`** (`src/core/state.js`), one mutable object
  holding the app's globals. It is a halfway house inherited from the app's
  single-file past, not a final design.
- **Modules define, `main.js` wires.** Every DOM binding sits in an exported
  `initXxx()` that `main.js` calls, in an order that matters — check the
  dependencies before moving a call.
- **`domain/` never imports from `ui/`.** The domain modules are pure functions
  and are tested without a browser.
- **`src/styles/tokens.css` is the only place** a colour, a type step or a
  spacing value may be defined. No hardcoded hex values outside it, no
  `!important`, light mode only. The design direction is *Lugn precision*
  (calm precision) with a verdigris accent, and the reference mockups are
  `docs/mockup-a-lugn-precision.html` (desktop) and
  `docs/mockup-mobil-1-stram.html` (mobile).

`docs/OVERLAMNING.md` is the handover document (in Swedish): where the work
stands, which decisions are settled and must not be reopened, and which traps
have already cost time. `CLAUDE.md` holds the same rules in the form an AI
coding assistant reads.

## Tests and CI

`npm test` runs the Vitest suite in Node — the scheduler, the sync diff,
encryption, the provider adapters, the local database, image compression and
the statistics. The Vite plugin does not run under Vitest, so the server
environment variables are deliberately absent from the tests.

GitHub Actions runs `npm ci`, `npm run lint`, `npm test` and `npm run build` on
every push and pull request; see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). There is no deploy
automation — deployment is done from Vercel.

If you open a pull request: keep the interface Swedish, let comments explain
*why* rather than *what*, add tests when you touch `src/domain/srs.js`, and
never commit a `.env`.

## License

[MIT](LICENSE) © 2026 Emre Sunar.

The thirty background thumbnails in `public/wash/` are assets rather than
source code: five are the author's own photographs, and the rest come from
[Picsum](https://picsum.photos) under the Unsplash License. `marked` and KaTeX
are bundled from npm under their own MIT licenses.
