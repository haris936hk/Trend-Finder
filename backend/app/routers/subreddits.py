"""DB-backed CRUD endpoints for subreddits. Capped at 5 rows by design."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Subreddit
from app.schemas import SubredditCreate, SubredditUpdate, SubredditOut

router = APIRouter(prefix="/subreddits", tags=["subreddits"])

MAX_SUBREDDITS = 5


def _strip_prefix(name: str) -> str:
    name = name.strip()
    if name.lower().startswith("/r/"):
        name = name[3:]
    elif name.lower().startswith("r/"):
        name = name[2:]
    return name.strip()


@router.get("", response_model=list[SubredditOut])
def list_subreddits(db: Session = Depends(get_db)):
    return db.query(Subreddit).all()


@router.post("", response_model=SubredditOut)
def create_subreddit(subreddit: SubredditCreate, db: Session = Depends(get_db)):
    count = db.query(Subreddit).count()
    if count >= MAX_SUBREDDITS:
        raise HTTPException(
            status_code=400,
            detail="Maximum of 5 subreddits allowed. Delete one before adding another.",
        )

    name = _strip_prefix(subreddit.name)
    if not name:
        raise HTTPException(status_code=400, detail="Subreddit name must not be empty.")

    db_subreddit = Subreddit(name=name)
    db.add(db_subreddit)
    db.commit()
    db.refresh(db_subreddit)
    return db_subreddit


@router.put("/{subreddit_id}", response_model=SubredditOut)
def update_subreddit(subreddit_id: int, subreddit: SubredditUpdate, db: Session = Depends(get_db)):
    db_subreddit = db.query(Subreddit).filter(Subreddit.id == subreddit_id).first()
    if db_subreddit is None:
        raise HTTPException(status_code=404, detail=f"Subreddit {subreddit_id} not found.")

    name = _strip_prefix(subreddit.name)
    if not name:
        raise HTTPException(status_code=400, detail="Subreddit name must not be empty.")

    db_subreddit.name = name
    db.commit()
    db.refresh(db_subreddit)
    return db_subreddit


@router.delete("/{subreddit_id}")
def delete_subreddit(subreddit_id: int, db: Session = Depends(get_db)):
    db_subreddit = db.query(Subreddit).filter(Subreddit.id == subreddit_id).first()
    if db_subreddit is None:
        raise HTTPException(status_code=404, detail=f"Subreddit {subreddit_id} not found.")

    db.delete(db_subreddit)
    db.commit()
    return {"status": "deleted", "id": subreddit_id}
