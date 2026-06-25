"""Scan orchestration: runs the trend + Reddit scrapers for every keyword,
normalizes and combines the raw scores into a composite score, and persists
a Run + Score rows. POST /scan streams per-keyword progress as
Server-Sent Events while the scan runs. GET /results serializes the latest
run plus full per-keyword history."""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Keyword, Subreddit, Run, Score, Settings
from app.schemas import ResultsResponse, LatestRun, RankedScore, HistoryEntry
from scrapers.trends_scraper import get_trend_score, TrendsScraperError
from scrapers.reddit_scraper import (
    get_mention_score,
    reddit_available,
    RedditScraperError,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scan"])

TREND_WEIGHT = 0.6
MENTION_WEIGHT = 0.4


def _sse(event_type: str, **fields) -> str:
    return f"data: {json.dumps({'type': event_type, **fields})}\n\n"


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


def _run_scan_events(
    db: Session, keywords: list[Keyword], subreddits: list[Subreddit], lookback_months: int
) -> Iterator[str]:
    """Generator driving the scan loop, yielding SSE-formatted progress
    strings as each keyword completes and persisting the Run + Score rows
    once every keyword has been scored."""
    subreddit_names = [s.name for s in subreddits]
    total = len(keywords)

    logger.info("Scan started: %d keywords, %d subreddits", total, len(subreddits))

    reddit_enabled = reddit_available()
    if not reddit_enabled:
        logger.warning(
            "Reddit credentials not configured; scoring with Google Trends only."
        )

    raw_results: list[tuple[Keyword, float, int]] = []
    for i, keyword in enumerate(keywords):
        yield _sse("keyword_start", keyword_name=keyword.name, index=i, total=total)

        synonyms = [s.strip() for s in (keyword.synonyms or "").split(",") if s.strip()]

        if i > 0:
            time.sleep(5)  # avoid soft-blocking pytrends with rapid sequential calls

        try:
            trend_score = get_trend_score(keyword.name, lookback_months)
        except TrendsScraperError as exc:
            logger.error("Scan aborted: %s", exc, exc_info=True)
            yield _sse("error", detail=str(exc), keyword=keyword.name, source="trends")
            return

        mention_score = 0
        if reddit_enabled:
            try:
                mention_score = get_mention_score(
                    keyword.name, synonyms, subreddit_names, lookback_months
                )
            except RedditScraperError as exc:
                logger.warning(
                    "Reddit unavailable mid-scan (%s); falling back to Google Trends only "
                    "for the rest of this run.",
                    exc,
                )
                reddit_enabled = False

        raw_results.append((keyword, trend_score, mention_score))
        yield _sse(
            "keyword_done",
            keyword_name=keyword.name,
            index=i,
            total=total,
            trend_score=trend_score,
            mention_score=mention_score,
        )

    # If Reddit was never available (or dropped out mid-scan), score this run
    # on trend signal alone instead of diluting it with all-zero mention data.
    trend_weight, mention_weight = (
        (TREND_WEIGHT, MENTION_WEIGHT) if reddit_enabled else (1.0, 0.0)
    )

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
            composite = trend_weight * norm_trend + mention_weight * norm_mention
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
        yield _sse("error", detail=str(exc), source="db")
        return

    logger.info("Scan completed: run_id=%d", run.id)

    results = _build_results_response(db)
    yield _sse("complete", results=results.model_dump())


@router.post("/scan")
def run_scan(db: Session = Depends(get_db)):
    keywords = db.query(Keyword).all()
    subreddits = db.query(Subreddit).all()
    settings = db.query(Settings).first()

    if not keywords or not subreddits:
        raise HTTPException(
            status_code=400,
            detail="Add at least one keyword and one subreddit before running a scan.",
        )

    lookback_months = settings.lookback_months if settings is not None else 12

    return StreamingResponse(
        _run_scan_events(db, keywords, subreddits, lookback_months),
        media_type="text/event-stream",
    )


@router.get("/results", response_model=ResultsResponse)
def get_results(db: Session = Depends(get_db)):
    return _build_results_response(db)
