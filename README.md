# Repetix

A spaced-repetition flashcard app: decks, scheduled reviews, offline-first
sync, optional AI help, and eight practice modes. Vanilla JavaScript in ES
modules, built with Vite. No framework.

**The interface is entirely in Swedish**, deliberately: there is no translation
layer and none is planned. Most source comments and the documents under `docs/`
are Swedish too. This README is in English so the repository can be read
without it.

![The library view: decks grouped into shelves, with the day's recommended folder on top](docs/skarmbilder/bibliotek.png)

## Contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Run it locally](#run-it-locally)
- [Commands](#commands)
- [Set up Supabase](#set-up-supabase)
- [AI: bring your own key](#ai-bring-your-own-key)
- [Security](#security)
- [Build and deploy](#build-and-deploy)
- [Architecture](#architecture)
- [Tests and CI](#tests-and-ci)
- [Status and contributions](#status-and-contributions)
- [License](#license)

## What it does

- **Spaced repetition** — a SuperMemo-2 variant with four grades, in
  `src/domain/srs.js`. Pure functions, no DOM, and the invariant
  `Igen ≤ Svårt < Bra < Lätt` (Again ≤ Hard < Good < Easy) is tested across
  196 states.
- **Cards with three fields** — front, back, and an optional description shown
  after the answer that never counts towards the grade.
- **Offline first** — the app always reads and writes locally (localStorage for
  app data, IndexedDB for the mirror) and queues changes in an outbox. What
  changed is computed as a diff against the previous snapshot rather than
  reported by each mutation site. Deletes are soft (`deleted_at`), and the
  review log is append-only — it is the basis for every statistic.
- **Accounts and cloud sync** — Supabase Postgres with row-level security on
  every table: each row carries `user_id`, and every policy requires
  `user_id = auth.uid()`. A bug in client code cannot hand one user's cards to
  another, because the barrier sits in the database.
- **Bring your own AI key** — generate cards from a topic or a diary entry, get
  deck insights, sort loose cards into folders, and ask a tutor about the card
  in front of you. All of it runs on the user's own provider key, which never
  reaches the browser. See [below](#ai-bring-your-own-key).
- **Markdown and LaTeX** on both sides of a card (marked and KaTeX, bundled
  from npm with pinned versions). KaTeX is fetched only when a card actually
  contains maths.
- **Eight practice modes** — Action (a clock you spend by thinking), Lucktext
  (cloze, with a bonus that ticks down while you memorise), Fritext (write the
  answer from memory; near-misses count), Jeopardy (bet before you see the
  clue), Dammiga kort (the cards untouched the longest), Sudden Death (three
  lives, endless), Transportbandet (sort falling cards; a growing queue is the
  only way to lose), and Dragkampen (true or false, tug of war).
- **Images on cards**, compressed in the browser and stored in a private
  Supabase bucket where each user has their own folder.
- **Delete your account** from within the app, images included.

## Screenshots

| | |
|---|---|
| ![The arcade: eight practice modes, each with its own blurred backdrop](docs/skarmbilder/spelhallen.png) | ![A deck: what is due, the folders, and the cards](docs/skarmbilder/kortlek.png) |
| The arcade. Each mode keeps the same backdrop every time, so the hall is navigable from colour memory. | A deck: what is due today, the AI panels, and the cards grouped by folder. |

## Requirements

- **Node 22 or newer.** `@supabase/supabase-js` requires `>=22` and Vite 8
  requires `^20.19 || >=22.12`. CI runs on Node 22.
- npm 10 or newer (ships with Node 22).
- A [Supabase](https://supabase.com) project, if you want accounts, sync or AI.
  The free tier is enough. Everything else runs without one.

## Run it locally

```bash
git clone https://github.com/Emsurenar/repetix.git
cd repetix
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

Open the **SQL Editor** and run the files in `supabase/migrations/` **one at a
time, in numeric order**. There is no CLI step and no `supabase link` — the
migrations are applied by hand. All of them are idempotent, so re-running one
is safe.

| File | What it sets up |
|---|---|
| `0001_init.sql` | Tables, `updated_at` triggers, row-level security policies, and the private `card-images` storage bucket |
| `0002_ai_key_access.sql` | `get_my_ai_key()` and the `user_ai_key_status` view — this is what removes the need for a service role key |
| `0003_card_description.sql` | The `description` column on `cards` |
| `0004_hardening.sql` | Per-user rate limits for `api/`, plus size and MIME limits on the storage bucket |
| `0005_account_deletion.sql` | `delete_my_account()`, and foreign keys that force a row to share its owner with its parent |

Two of these are load-bearing, not optional:

- **Skipping `0004` breaks the AI endpoints.** The rate limiter fails closed —
  a limiter that opens up when the database is unwell is useless exactly when
  it is needed — so without the table `/api/ai` answers `503`.
- **Skipping `0003`** does not break the app locally, but syncing a card that
  has a description will be rejected by the cloud.

`0005` repoints several foreign keys. Read the comment at the top: run the
included check query first, and make sure it returns nothing.

### 3. Authentication

Sign-up with email and password is open, using Supabase Auth's defaults.

**Turn on email confirmation before you let strangers register.** The rate
limits in `0004` count per user, so without friction at sign-up an attacker
simply registers more accounts. Consider a CAPTCHA on sign-up too. This is the
one protection that cannot live in the code.

The app also offers a *Sign in with Google* button, which needs the Google
provider enabled under **Authentication → Providers**. Leave it off and
everything else still works.

Both the OAuth flow and the password-reset link redirect back to the page's own
origin. Under **Authentication → URL Configuration**, add every origin you
serve the app from, and add `/#aterstall` as a redirect URL — without it the
password reset link is silently rejected.

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
it can only ever return the caller's own row. `0005` deletes accounts the same
way.

If a comment or a guide ever tells you to paste a service role key into
`SUPABASE_ANON_KEY`, it is wrong. It would work, and it would silently disable
every policy in the project.

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

## Security

The app was reviewed in three passes — the serverless functions, account and
data access, and injection in the client — before this repository was made
public. What that established:

- **Row-level security covers every table**, for select, insert, update *and*
  delete, and `with check` prevents a client from writing someone else's
  `user_id`. `reviews` deliberately has no update or delete policy: the log is
  append-only even for its owner.
- **All rendered HTML is sanitised** with DOMPurify. The app builds markup with
  template strings and `innerHTML`, so this is the barrier that matters; both
  the Markdown path and the LaTeX path go through it.
- **No inline event handlers anywhere**, which is what allows the
  Content-Security-Policy in `vercel.json` to use `script-src 'self'` with no
  `unsafe-inline`.
- **Per-user rate limits** on the AI endpoints, counted atomically in Postgres.
  Without them `/api/ai-key` is an unlimited key-validation oracle: it answers
  *valid* or *invalid* for any key you hand it, at no cost to the caller.
- **Encryption** is AES-256-GCM with a fresh 12-byte IV per encryption and the
  authentication tag verified on the way back.

Known gaps, which are honest rather than resolved:

- Storage objects are removed when a card image is deleted and when an account
  is deleted, but there is no sweeper for anything that slipped through before
  that code existed.
- There is no global quota across all users. Rate limits are per account, and
  a hundred accounts get a hundred quotas. An IP-level rule at the edge is the
  missing layer; on Vercel that is a firewall rule on `/api/*`.
- The review is documented in `docs/OVERLAMNING.md` (Swedish), including what
  was checked and found sound, so it does not have to be redone from scratch.

Found something? Open an issue, or email the address on the author's GitHub
profile if you would rather not do it in public.

## Build and deploy

```bash
npm run build     # → dist/
npm run preview   # serve that build
```

The build splits KaTeX and its fonts into a lazy chunk, so a reader who never
opens a card with maths does not download it:

| | Raw | gzip |
|---|---|---|
| Initial JS | ~594 kB | ~163 kB |
| Initial CSS | ~163 kB | ~26 kB |
| KaTeX, lazy | ~261 kB | ~78 kB |

`vercel.json` is already configured: the `vite` framework preset,
`npm run build`, `dist/` as output, the functions in `api/` with a 60-second
limit, a Content-Security-Policy, and immutable caching for the
content-hashed assets. Import the repository into Vercel, add the five
environment variables, and add the resulting URL to Supabase's redirect URLs.

The function's own timeout is 45 seconds and must stay **strictly below**
`maxDuration`, or the function is cut off before it can write the timeout
response and the client gets Vercel's HTML error page instead of the
contract's JSON.

Nothing in the code is Vercel-specific: any static host plus a Node function
runtime will do.

## Architecture

```
src/
  main.js       entry point: imports styles and modules, calls the init functions
  app/          third-party bundling (KaTeX), initApp, the cloud layer
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
docs/           handover, API contract, design mockups, screenshots
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
  `!important`, light mode only, one corner radius for everything. The design
  direction is *Lugn precision* (calm precision) with a verdigris accent, and
  the reference mockups are `docs/mockup-a-lugn-precision.html` (desktop) and
  `docs/mockup-mobil-1-stram.html` (mobile).

`docs/OVERLAMNING.md` is the handover document (in Swedish): where the work
stands, which decisions are settled and must not be reopened, and which traps
have already cost time. `CLAUDE.md` holds the same rules in the form an AI
coding assistant reads.

## Tests and CI

`npm test` runs the Vitest suite in Node — the scheduler, the sync diff,
encryption, the provider adapters, the local database, image compression,
sanitisation, the rate limiter and the statistics. The Vite plugin does not run
under Vitest, so the server environment variables are deliberately absent from
the tests.

GitHub Actions runs `npm ci`, `npm run lint`, `npm test` and `npm run build` on
every push and pull request; see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). There is no deploy
automation — deployment is done from Vercel.

## Status and contributions

This is a personal project, built for one person's studying and published in
case it is useful to someone else. It works and it is in daily use, but it is
not a product: there is no roadmap, no support commitment, and no guarantee
that an issue gets answered quickly.

You are welcome to fork it. If you open a pull request: keep the interface
Swedish, let comments explain *why* rather than *what*, add tests when you
touch `src/domain/srs.js`, and never commit a `.env`.

## License

[MIT](LICENSE) © 2026 Emre Sunar.

The thirty background thumbnails in `public/wash/` are assets rather than
source code: five are the author's own photographs, and the rest come from
[Picsum](https://picsum.photos) under the Unsplash License, which permits free
use but not resale of the photographs themselves. If you redistribute a fork,
consider replacing them with your own.

Bundled dependencies keep their own licenses: `marked` and KaTeX are MIT,
DOMPurify is dual-licensed under MPL-2.0 or Apache-2.0.

The four provider marks in the settings view come from
[Simple Icons](https://simpleicons.org) (CC0). The brands themselves remain
trademarks of Anthropic, OpenAI, Google and OpenRouter, and are used here only
to identify which provider a setting applies to.
