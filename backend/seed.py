"""Manually-runnable seed script. Run with `python seed.py` from backend/ to populate
the keywords and subreddits tables with starting data. Not auto-run on app startup."""

from app.database import Base, engine, SessionLocal
from app.models import Keyword, Subreddit

KEYWORDS = [
    "Monitor Stand Riser",
    "Cable Management Kit",
    "Ergonomic Wrist Rest",
    "Desk Lamp with Wireless Charging",
    "Adjustable Laptop Stand",
    "Desk Pad",
    "USB Hub and Adapter",
    "Wireless Charging Pad",
    "Standing Desk Converter",
    "Mini Desk Vacuum",
    "Desk Organizer",
    "Ergonomic Keyboard",
    "Ergonomic Mouse",
    "Monitor Light Bar",
    "Mechanical Keyboard for Desk Setup",
]

SUBREDDITS = ["battlestations", "WFH", "desksetup"]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for name in KEYWORDS:
            db.add(Keyword(name=name, synonyms=""))
        for name in SUBREDDITS:
            db.add(Subreddit(name=name))
        db.commit()
        print(f"Seeded {len(KEYWORDS)} keywords and {len(SUBREDDITS)} subreddits.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
