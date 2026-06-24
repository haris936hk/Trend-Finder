"""Google Trends scraper (no credentials needed — pytrends hits a public endpoint).

get_trend_score() pulls 12 months of interest-over-time data for a keyword via
pytrends and returns the difference between the average interest over the most
recent 3 months and the average interest over the prior 9 months. A positive
score means the keyword is trending up recently relative to its longer baseline.

This is a raw (non-normalized) slope value — normalization across a batch of
keywords happens later in the scan orchestrator, not here.
"""

import logging

import pandas as pd
from pytrends.request import TrendReq

logger = logging.getLogger(__name__)


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


def get_trend_score(keyword_name: str) -> float:
    """Returns a raw trend slope score for `keyword_name` over the last 12 months.

    Note: pytrends has no official rate limit but is known to soft-block rapid
    sequential requests — callers looping over many keywords should sleep ~1s
    between calls.
    """
    try:
        pytrends = TrendReq()
        pytrends.build_payload([keyword_name], timeframe="today 12-m")
        df = pytrends.interest_over_time()
    except Exception as exc:
        raise TrendsScraperError(keyword_name, exc) from exc

    if df is None or df.empty:
        return 0.0

    df = df.drop(columns=["isPartial"], errors="ignore")
    series = df[keyword_name]

    latest_date = series.index.max()
    recent_cutoff = latest_date - pd.DateOffset(months=3)

    recent = series[series.index > recent_cutoff]
    prior = series[series.index <= recent_cutoff]

    recent_avg = float(recent.mean()) if len(recent) > 0 else 0.0
    prior_avg = float(prior.mean()) if len(prior) > 0 else 0.0

    return recent_avg - prior_avg
