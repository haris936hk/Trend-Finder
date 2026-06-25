"""Google Trends scraper (no credentials needed — pytrends hits a public endpoint).

get_trend_score() pulls `lookback_months` of interest-over-time data for a
keyword via pytrends and returns the difference between the average interest
over the most recent quarter of that window and the average interest over the
remainder. A positive score means the keyword is trending up recently relative
to its longer baseline.

This is a raw (non-normalized) slope value — normalization across a batch of
keywords happens later in the scan orchestrator, not here.
"""

import logging
import time
from datetime import datetime, timezone

import pandas as pd
from dateutil.relativedelta import relativedelta
from pytrends.exceptions import TooManyRequestsError
from pytrends.request import TrendReq

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 10


class TrendsScraperError(Exception):
    """Raised when the pytrends request itself fails (network error, rate limit,
    malformed response). Not raised for a keyword with genuinely zero search
    interest — that case returns a slope of 0.0 instead."""

    def __init__(self, keyword: str, original: Exception):
        self.keyword = keyword
        self.original = original
        super().__init__(str(self))

    def __str__(self) -> str:
        return f"Trends scrape failed for keyword '{self.keyword}': {self.original}"


def get_trend_score(keyword_name: str, lookback_months: int = 12) -> float:
    """Returns a raw trend slope score for `keyword_name` over the last
    `lookback_months` months.

    Note: pytrends has no official rate limit but is known to soft-block rapid
    sequential requests with 429s. On a 429 this retries up to MAX_RETRIES times
    with exponential backoff before giving up; callers looping over many keywords
    should still sleep a few seconds between calls to keep retries infrequent.
    """
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - relativedelta(months=lookback_months)
    timeframe = f"{start_date.isoformat()} {end_date.isoformat()}"

    df = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            pytrends = TrendReq()
            pytrends.build_payload([keyword_name], timeframe=timeframe)
            df = pytrends.interest_over_time()
            break
        except TooManyRequestsError as exc:
            if attempt == MAX_RETRIES:
                raise TrendsScraperError(keyword_name, exc) from exc
            backoff = BASE_BACKOFF_SECONDS * (2**attempt)
            logger.warning(
                "Rate limited fetching '%s' (attempt %d/%d); retrying in %ds.",
                keyword_name,
                attempt + 1,
                MAX_RETRIES,
                backoff,
            )
            time.sleep(backoff)
        except Exception as exc:
            raise TrendsScraperError(keyword_name, exc) from exc

    if df is None or df.empty:
        return 0.0

    df = df.drop(columns=["isPartial"], errors="ignore")
    series = df[keyword_name]

    recent_months = max(1, round(lookback_months / 4))
    latest_date = series.index.max()
    recent_cutoff = latest_date - pd.DateOffset(months=recent_months)

    recent = series[series.index > recent_cutoff]
    prior = series[series.index <= recent_cutoff]

    recent_avg = float(recent.mean()) if len(recent) > 0 else 0.0
    prior_avg = float(prior.mean()) if len(prior) > 0 else 0.0

    return recent_avg - prior_avg
