# Trend Finder

Local-only, single-user tool to score candidate home-office products by demand
signal (Google Trends + Reddit mentions) for dropshipping product selection.
This is a **scaffold** — schema, stub endpoints, and a placeholder UI shell are
in place; the real scoring/scraping logic is not implemented yet.

## Stack

- **Backend**: FastAPI + SQLAlchemy (SQLite), Python
- **Frontend**: React (Vite) + TypeScript + Tailwind CSS + recharts
- **Scrapers**: pytrends (Google Trends), PRAW (Reddit)

## Running locally

Two separate processes, no Docker required. Once both are set up individually
(venv + `pip install`, `npm install`) at least once, you can launch both at
the same time from the project root with:

```powershell
.\start.ps1
```

This opens two PowerShell windows — one running `uvicorn`, one running
`npm run dev`. Close those windows (or Ctrl+C inside them) to stop the servers.

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Server runs at `http://127.0.0.1:8000`. Confirm it booted with:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}
```

A `backend/trend_finder.db` SQLite file is created automatically on startup.
If the `keywords`/`subreddits` tables are empty (e.g. on first run), they're
auto-seeded with a default list of home-office keywords and subreddits — see
`backend/app/seed_data.py`. Defaults are only inserted when a table is empty,
so your own edits are never overwritten on later restarts. To force-reseed
the defaults (e.g. after clearing your data), run `python seed.py` manually.

#### Reddit credentials

Copy `backend/.env.example` to `backend/.env` and fill in your Reddit app
credentials (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`).
Reddit credentials are optional: if they're missing, or the Reddit API fails
mid-scan, `POST /scan` falls back to scoring on Google Trends data alone
instead of failing the run.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:5173`. Visit `/` (Dashboard) and
`/settings` (Settings) to see the placeholder shell.

## Schema decision: no Alembic

Tables are created via `Base.metadata.create_all()` on FastAPI startup
(`backend/app/main.py`) instead of using Alembic migrations. This is a
single-user local SQLite file with no deployment/migration history to
manage — Alembic would add overhead with no current benefit. Revisit if/when
the schema needs versioned migrations.

## Where the TODOs are

Grouped by what you'll fill in next:

**Scan/scoring logic**
- `backend/app/routers/scan.py` — `POST /scan` pipeline (create run, loop
  keywords × subreddits, call scrapers, normalize, compute composite score,
  persist results, abort on a Trends failure) and `GET /results` (query
  latest run + history). Reddit is optional: missing credentials or a failed
  Reddit call fall back to Trends-only scoring instead of aborting the run.

**Scraper internals**
- `backend/scrapers/trends_scraper.py` — `get_trend_score()`: real pytrends
  call + recent-3mo-vs-prior-9mo slope calculation
- `backend/scrapers/reddit_scraper.py` — `get_mention_score()`: real PRAW
  search across subreddits + fuzzy matching against keyword/synonyms;
  `reddit_available()` lets callers check credentials upfront without
  raising.

**Settings CRUD**
- `backend/app/routers/keywords.py` — real DB-backed create/read/update/delete
- `backend/app/routers/subreddits.py` — real DB-backed create/read/update/delete,
  plus enforcing the max-5-rows constraint on create

**Frontend data-fetching**
- `frontend/src/pages/Dashboard.tsx` — wire "Run Scan" button to `POST /scan`,
  render ranked results from `GET /results`
- `frontend/src/pages/Settings.tsx` — fetch/display/edit keywords and
  subreddits via the backend CRUD endpoints
