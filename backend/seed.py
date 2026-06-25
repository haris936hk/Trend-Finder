"""Manually-runnable seed script. Run with `python seed.py` from backend/ to populate
the keywords and subreddits tables with starting data. Not auto-run on app startup."""

from app.database import Base, engine, SessionLocal
from app.models import Keyword, Subreddit
from app.seed_data import DEFAULT_KEYWORDS, DEFAULT_SUBREDDITS


def seed():
    """Force-reseed the keyword/subreddit defaults regardless of current table
    contents. The app itself auto-seeds these defaults on first startup when
    the tables are empty (see app/main.py); run this script manually only if
    you want to add the defaults back on top of/after clearing your own data."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for name in DEFAULT_KEYWORDS:
            db.add(Keyword(name=name, synonyms=""))
        for name in DEFAULT_SUBREDDITS:
            db.add(Subreddit(name=name))
        db.commit()
        print(f"Seeded {len(DEFAULT_KEYWORDS)} keywords and {len(DEFAULT_SUBREDDITS)} subreddits.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
