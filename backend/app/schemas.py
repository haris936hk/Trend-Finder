"""Pydantic request/response models. Mirrors the ORM schema in models.py and the
TypeScript interfaces in frontend/src/types.ts so both sides agree on shape."""

from typing import Optional
from pydantic import BaseModel


# --- Keywords ---

class KeywordCreate(BaseModel):
    name: str
    synonyms: list[str] = []


class KeywordUpdate(BaseModel):
    name: str
    synonyms: list[str] = []


class KeywordOut(BaseModel):
    id: int
    name: str
    synonyms: list[str] = []


# --- Subreddits ---

class SubredditCreate(BaseModel):
    name: str


class SubredditUpdate(BaseModel):
    name: str


class SubredditOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# --- /scan and /results ---

class RankedScore(BaseModel):
    keyword_id: int
    keyword_name: str
    trend_score: float
    mention_score: float
    composite_score: float
    rank: int


class LatestRun(BaseModel):
    run_id: int
    timestamp: str
    ranked: list[RankedScore]


class HistoryEntry(BaseModel):
    run_id: int
    timestamp: str
    composite_score: float


class ResultsResponse(BaseModel):
    latest_run: Optional[LatestRun] = None
    history: dict[str, list[HistoryEntry]] = {}
