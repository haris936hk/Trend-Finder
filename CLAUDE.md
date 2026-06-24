# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-only, single-user tool to score candidate home-office products by demand
signal (Google Trends + Reddit mentions) for dropshipping product selection.
This is a **scaffold**: schema, stub endpoints, and a placeholder UI shell are
in place, but the real scoring/scraping logic is not implemented yet (see
"Where the TODOs are" below).

## Stack

- **Backend**: FastAPI + SQLAlchemy (SQLite), Python — `backend/`
- **Frontend**: React (Vite) + TypeScript + Tailwind CSS + recharts — `frontend/`
- **Scrapers**: pytrends (Google Trends, no auth needed), PRAW (Reddit, needs credentials)

No Docker. Two separate local dev processes (backend on :8000, frontend on :5173).

## Commands

### Backend (run from `backend/`)

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- Health check: `curl http://127.0.0.1:8000/health` -> `{"status":"ok"}`
- `backend/trend_finder.db` (SQLite) is created automatically on startup — tables only, no data.
- Seed starting keywords/subreddits manually (not run automatically): `python seed.py`
- No test suite exists yet.

### Frontend (run from `frontend/`)

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview
```

### Reddit credentials

Copy `backend/.env.example` to `backend/.env` and fill in `REDDIT_CLIENT_ID`,
`REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`. The app boots fine without them;
`get_reddit_mentions()` raises a `RuntimeError` at call time if they're missing.

## Architecture

### Backend layout (`backend/app/`)

- `database.py` — SQLAlchemy engine/session/Base for `sqlite:///./trend_finder.db`, plus the `get_db()` FastAPI dependency.
- `models.py` — ORM tables: `Keyword`, `Subreddit`, `Run`, `Score`. A `Run` has many `Score` rows (one per keyword scanned in that run); `Score.run_id`/`keyword_id` are FKs.
- `schemas.py` — Pydantic request/response models. Deliberately mirrors both `models.py` and `frontend/src/types.ts` so backend and frontend agree on shape — when changing one, update all three.
- `routers/keywords.py`, `routers/subreddits.py` — CRUD endpoints (currently stubs returning hardcoded/echoed data, no DB access yet).
- `routers/scan.py` — `POST /scan` and `GET /results` (currently stubs). This is meant to become the core pipeline: create a `Run`, loop keywords × subreddits, call both scrapers, normalize scores, compute `composite_score`, persist `Score` rows, and abort the run with a clear error if any scraper call fails.
- `main.py` — app entrypoint. Tables are created via `Base.metadata.create_all()` on FastAPI startup — **no Alembic** by design (single-user local SQLite file, no deployment/migration history to manage; revisit only if the schema needs versioned migrations).

### Scrapers (`backend/scrapers/`)

- `trends_scraper.py` — `get_trend_score(keyword)` will use pytrends to compute a slope score: average interest over the most recent 3 months vs. the prior 9 months. A score above 0 means recently trending up relative to its longer baseline. Currently raises `NotImplementedError`.
- `reddit_scraper.py` — `get_reddit_mentions(keyword, synonyms, subreddits)` will search subreddits via PRAW and fuzzy-match post/comment text against the keyword and its synonyms, returning a mention count. Credential loading (`_load_reddit_credentials()`) is already implemented; the search/match logic currently raises `NotImplementedError`.

### Frontend layout (`frontend/src/`)

- `App.tsx` — router shell with two routes: `/` (Dashboard) and `/settings` (Settings).
- `types.ts` — TypeScript interfaces mirroring `backend/app/schemas.py` — keep in sync when backend schemas change.
- `pages/Dashboard.tsx` — placeholder; will wire a "Run Scan" button to `POST /scan` and render ranked results from `GET /results`.
- `pages/Settings.tsx` — placeholder; will fetch/display/edit keywords and subreddits via the backend CRUD endpoints.

## Where the TODOs are

Grouped by what gets filled in next:

**Scan/scoring logic**
- `backend/app/routers/scan.py` — the `POST /scan` pipeline and `GET /results` query logic described above.

**Scraper internals**
- `backend/scrapers/trends_scraper.py` — real pytrends call + slope calculation.
- `backend/scrapers/reddit_scraper.py` — real PRAW search + fuzzy matching.

**Settings CRUD**
- `backend/app/routers/keywords.py` — real DB-backed create/read/update/delete.
- `backend/app/routers/subreddits.py` — real DB-backed create/read/update/delete, plus enforcing a max-5-rows constraint on create (`Subreddit.name` comment notes this limit).

**Frontend data-fetching**
- `frontend/src/pages/Dashboard.tsx` — wire "Run Scan" button and render results.
- `frontend/src/pages/Settings.tsx` — wire keyword/subreddit CRUD UI.

## Conventions

- Keep `backend/app/models.py`, `backend/app/schemas.py`, and `frontend/src/types.ts` in sync — they describe the same shapes across three layers.
- Subreddits table is capped at 5 rows by design (enforced at the API layer, not the DB).

## Tooling

- Use the LSP tool (goToDefinition, findReferences, hover, documentSymbol, etc.) when navigating or editing code in this repo, rather than relying on text search alone — especially for cross-file checks like keeping `models.py`/`schemas.py`/`types.ts` in sync, or tracing scraper/router call sites.
- The Python LSP (Pyright) needs `backend/.venv` set up with `pip install -r requirements.txt` to resolve imports; without it, import diagnostics will show as false positives.
