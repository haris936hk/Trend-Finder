"""FastAPI application entrypoint. Boots the app, creates DB tables on startup,
and wires up the keyword/subreddit/scan routers."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.orm import Session

from app.database import Base, engine, SessionLocal
from app.models import Keyword, Subreddit, Settings
from app.routers import keywords, subreddits, scan, settings
from app.seed_data import DEFAULT_KEYWORDS, DEFAULT_SUBREDDITS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Trend Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _seed_defaults_if_empty(db: Session) -> None:
    """Populate the keywords/subreddits tables with default starting data the
    first time the app boots against a fresh (empty) database. Leaves existing
    data untouched on every later startup."""
    if db.query(Keyword).first() is None:
        for name in DEFAULT_KEYWORDS:
            db.add(Keyword(name=name, synonyms=""))
    if db.query(Subreddit).first() is None:
        for name in DEFAULT_SUBREDDITS:
            db.add(Subreddit(name=name))
    if db.query(Settings).first() is None:
        db.add(Settings(id=1, lookback_months=12))
    db.commit()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _seed_defaults_if_empty(db)
    finally:
        db.close()


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(keywords.router)
app.include_router(subreddits.router)
app.include_router(scan.router)
app.include_router(settings.router)
