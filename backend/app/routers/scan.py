"""Scan orchestration: runs the trend + Reddit scrapers for every keyword,
normalizes and combines the raw scores into a composite score, and persists
a Run + Score rows. GET /results serializes the latest run plus full
per-keyword history."""

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Keyword, Subreddit, Run, Score
from app.schemas import ResultsResponse, LatestRun, RankedScore, HistoryEntry
from scrapers.trends_scraper import get_trend_score, TrendsScraperError
from scrapers.reddit_scraper import (
    get_mention_score,
    RedditScraperError,
    RedditCredentialsError,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scan"])

TREND_WEIGHT = 0.6
MENTION_WEIGHT = 0.4


class ScanFailedError(Exception):
    """Raised whenever a scan must abort before completing — carries enough
    detail to build the {"error": "scan_failed", ...} response body without
    FastAPI wrapping it inside a "detail" key."""

    def __init__(self, detail: str, keyword: Optional[str] = None, source: Optional[str] = None):
        self.detail = detail
        self.keyword = keyword
        self.source = source
        super().__init__(detail)


def _normalize(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.5 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def _build_results_response(db: Session) -> ResultsResponse:
    latest_run = db.query(Run).order_by(Run.id.desc()).first()

    latest_run_out = None
    if latest_run is not None:
        rows = db.query(Score).filter(Score.run_id == latest_run.id).all()
        ranked_rows = sorted(rows, key=lambda r: r.composite_score, reverse=True)
        ranked = [
            RankedScore(
                keyword_id=row.keyword_id,
                keyword_name=row.keyword.name,
                trend_score=row.trend_score,
                mention_score=row.mention_score,
                composite_score=row.composite_score,
                rank=i + 1,
            )
            for i, row in enumerate(ranked_rows)
        ]
        latest_run_out = LatestRun(
            run_id=latest_run.id, timestamp=latest_run.timestamp, ranked=ranked
        )

    history: dict[str, list[HistoryEntry]] = {}
    all_scores = (
        db.query(Score).join(Run, Score.run_id == Run.id).order_by(Run.timestamp.asc()).all()
    )
    for row in all_scores:
        key = str(row.keyword_id)
        history.setdefault(key, []).append(
            HistoryEntry(
                run_id=row.run_id,
                timestamp=row.run.timestamp,
                composite_score=row.composite_score,
            )
        )

    return ResultsResponse(latest_run=latest_run_out, history=history)


@router.post("/scan", response_model=ResultsResponse)
def run_scan(db: Session = Depends(get_db)):
    keywords = db.query(Keyword).all()
    subreddits = db.query(Subreddit).all()

    if not keywords or not subreddits:
        raise HTTPException(
            status_code=400,
            detail="Add at least one keyword and one subreddit before running a scan.",
        )

    subreddit_names = [s.name for s in subreddits]

    logger.info("Scan started: %d keywords, %d subreddits", len(keywords), len(subreddits))

    raw_results: list[tuple[Keyword, float, int]] = []
    for i, keyword in enumerate(keywords):
        synonyms = [s.strip() for s in (keyword.synonyms or "").split(",") if s.strip()]

        if i > 0:
            time.sleep(1)  # avoid soft-blocking pytrends with rapid sequential calls

        try:
            trend_score = get_trend_score(keyword.name)
        except TrendsScraperError as exc:
            logger.error("Scan aborted: %s", exc, exc_info=True)
            raise ScanFailedError(detail=str(exc), keyword=keyword.name, source="trends")

        try:
            mention_score = get_mention_score(keyword.name, synonyms, subreddit_names)
        except (RedditScraperError, RedditCredentialsError) as exc:
            logger.error("Scan aborted: %s", exc, exc_info=True)
            raise ScanFailedError(detail=str(exc), keyword=keyword.name, source="reddit")

        raw_results.append((keyword, trend_score, mention_score))

    trend_values = [r[1] for r in raw_results]
    mention_values = [float(r[2]) for r in raw_results]
    normalized_trends = _normalize(trend_values)
    normalized_mentions = _normalize(mention_values)

    run = Run(timestamp=datetime.now(timezone.utc).isoformat())
    try:
        db.add(run)
        db.flush()

        for (keyword, trend_score, mention_score), norm_trend, norm_mention in zip(
            raw_results, normalized_trends, normalized_mentions
        ):
            composite = TREND_WEIGHT * norm_trend + MENTION_WEIGHT * norm_mention
            db.add(
                Score(
                    run_id=run.id,
                    keyword_id=keyword.id,
                    trend_score=trend_score,
                    mention_score=mention_score,
                    composite_score=composite,
                )
            )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Scan aborted: DB write failed: %s", exc, exc_info=True)
        raise ScanFailedError(detail=str(exc), source="db")

    logger.info("Scan completed: run_id=%d", run.id)

    return _build_results_response(db)


@router.get("/results", response_model=ResultsResponse)
def get_results(db: Session = Depends(get_db)):
    return _build_results_response(db)
