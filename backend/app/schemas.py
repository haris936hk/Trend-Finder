"""Pydantic request/response models. Mirrors the ORM schema in models.py and the
TypeScript interfaces in frontend/src/types.ts so both sides agree on shape."""

from typing import Optional
from pydantic import BaseModel, Field


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


# --- Settings ---

class SettingsOut(BaseModel):
    lookback_months: int

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    lookback_months: int = Field(ge=1, le=24)


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


class ScanProgressEvent(BaseModel):
    """Shape of each SSE payload streamed by POST /scan. Not used for runtime
    response validation (StreamingResponse bypasses response_model) — kept in
    sync with frontend/src/types.ts ScanProgressEvent for documentation."""

    type: str  # "keyword_start" | "keyword_done" | "error" | "complete"
    keyword_name: Optional[str] = None
    index: Optional[int] = None
    total: Optional[int] = None
    trend_score: Optional[float] = None
    mention_score: Optional[float] = None
    detail: Optional[str] = None
    keyword: Optional[str] = None
    source: Optional[str] = None  # "trends" | "reddit" | "db"
    results: Optional[ResultsResponse] = None
