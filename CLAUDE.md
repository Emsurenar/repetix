# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

Serve with any static file server. The configured launch uses:
```
npx http-server . -p 8234 -c-1
```
Then open `http://localhost:8234`. No build step, no bundler, no framework.

## Architecture

Single-page vanilla JS/HTML/CSS app — three files carry the entire codebase:

- **script.js** (~3500 lines): All application logic in one file. Sections are delimited by `// ---` comment headers. Key sections:
  - **Data & Storage** (~line 98): `appData` object with `decks`, `notebooks`, `bookshelves`. Persisted to `localStorage` under key `noji_clone_data`.
  - **Routing / View Logic** (~line 437): `switchView()` toggles between library, deck, study, notebook views. No router library — views are `<section>` elements toggled via `hidden` class.
  - **Study Logic** (~line 1760): SM-2 spaced repetition algorithm. Cards have `repetition`, `interval`, `easeFactor`, `nextReviewDate` fields. Study modes: per-deck, global (all due), bookshelf-scoped, section-scoped, and "playground" modes (svettiga timmen, dammiga kort, etc.).
  - **AI Logic** (~line 2034): Calls the Anthropic API directly from the browser using `claude-sonnet-4-6`. Functions: `fetchExplanation`, `fetchTestQuestion`, `fetchCardsByTopic`, `fetchStudyAi`. API key loaded from `.env` file via fetch.
  - **Initialization** (~line 3421): `initApp()` → `loadData()` → `renderDecks()` → `renderSidebar()`.
- **index.html** (~688 lines): All view templates and modals. Swedish-language UI.
- **style.css** (~1684 lines): All styling, responsive breakpoints at 768px.

## Data Model

```
appData = {
  decks: [{ id, title, color, bookshelfId, sections: [], cards: [] }],
  notebooks: [{ id, title, bookshelfId, notes: [] }],
  bookshelves: [{ id, title }]
}
```

Cards: `{ id, front, back, isLongForm, backImages, sectionId, repetition, interval, easeFactor, nextReviewDate, type, lapses, lastReviewed }`

All data lives in localStorage. No backend, no database. The `loadData()` function includes migration logic for schema changes.

## Key Conventions

- UI language is Swedish throughout.
- Markdown rendering via `marked.js`, LaTeX via KaTeX (both loaded from CDN).
- Images stored as base64 data URLs inside card objects in localStorage.
- `saveData()` is called after every mutation — grep for it to find all write points.
- Functions exposed to inline HTML handlers are assigned to `window.*` at the bottom of script.js.
- `remove_emojis.js` is a Node utility script to strip emojis from source files.
