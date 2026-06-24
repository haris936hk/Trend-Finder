"""DB-backed CRUD endpoints for keywords."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Keyword, Score
from app.schemas import KeywordCreate, KeywordUpdate, KeywordOut

router = APIRouter(prefix="/keywords", tags=["keywords"])


def _parse_synonyms(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _join_synonyms(synonyms: list[str]) -> str:
    return ",".join(s.strip() for s in synonyms if s.strip())


def _to_out(keyword: Keyword) -> KeywordOut:
    return KeywordOut(id=keyword.id, name=keyword.name, synonyms=_parse_synonyms(keyword.synonyms))


@router.get("", response_model=list[KeywordOut])
def list_keywords(db: Session = Depends(get_db)):
    return [_to_out(k) for k in db.query(Keyword).all()]


@router.post("", response_model=KeywordOut)
def create_keyword(keyword: KeywordCreate, db: Session = Depends(get_db)):
    name = keyword.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Keyword name must not be empty.")

    db_keyword = Keyword(name=name, synonyms=_join_synonyms(keyword.synonyms))
    db.add(db_keyword)
    db.commit()
    db.refresh(db_keyword)
    return _to_out(db_keyword)


@router.put("/{keyword_id}", response_model=KeywordOut)
def update_keyword(keyword_id: int, keyword: KeywordUpdate, db: Session = Depends(get_db)):
    db_keyword = db.query(Keyword).filter(Keyword.id == keyword_id).first()
    if db_keyword is None:
        raise HTTPException(status_code=404, detail=f"Keyword {keyword_id} not found.")

    name = keyword.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Keyword name must not be empty.")

    db_keyword.name = name
    db_keyword.synonyms = _join_synonyms(keyword.synonyms)
    db.commit()
    db.refresh(db_keyword)
    return _to_out(db_keyword)


@router.delete("/{keyword_id}")
def delete_keyword(keyword_id: int, db: Session = Depends(get_db)):
    db_keyword = db.query(Keyword).filter(Keyword.id == keyword_id).first()
    if db_keyword is None:
        raise HTTPException(status_code=404, detail=f"Keyword {keyword_id} not found.")

    db.query(Score).filter(Score.keyword_id == keyword_id).delete()
    db.delete(db_keyword)
    db.commit()
    return {"status": "deleted", "id": keyword_id}
