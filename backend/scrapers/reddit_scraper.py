"""Reddit mention-counting scraper using PRAW.

get_mention_score() searches a list of subreddits for posts and top-level
comments that contain an exact-phrase (case-insensitive) match against a
keyword or any of its synonyms, within a configurable lookback window, and
returns the count of distinct matching posts/comments.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

import praw
import prawcore
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

MAX_COMMENTS_PER_THREAD = 50


class RedditCredentialsError(Exception):
    """Raised immediately when the PRAW client is constructed if any required
    Reddit credential is missing from the environment."""


class RedditScraperError(Exception):
    """Raised when a PRAW call fails for a given keyword/subreddit pair —
    rate limiting, network errors, or an invalid/inaccessible subreddit."""

    def __init__(self, keyword: str, subreddit: str, original: Exception):
        self.keyword = keyword
        self.subreddit = subreddit
        self.original = original
        super().__init__(str(self))

    def __str__(self) -> str:
        return (
            f"Reddit scrape failed for keyword '{self.keyword}' in subreddit "
            f"'{self.subreddit}': {self.original}"
        )


def _load_reddit_credentials() -> tuple[str, str, str]:
    """Read Reddit API credentials from the environment and validate they're present."""
    client_id = os.environ.get("REDDIT_CLIENT_ID", "")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "")
    user_agent = os.environ.get("REDDIT_USER_AGENT", "")

    missing = [
        name
        for name, value in (
            ("REDDIT_CLIENT_ID", client_id),
            ("REDDIT_CLIENT_SECRET", client_secret),
            ("REDDIT_USER_AGENT", user_agent),
        )
        if not value
    ]
    if missing:
        raise RedditCredentialsError(
            "Reddit API credentials missing. Fill in REDDIT_CLIENT_ID, "
            "REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT in your .env file. "
            "See .env.example."
        )

    return client_id, client_secret, user_agent


def _get_reddit_client() -> praw.Reddit:
    client_id, client_secret, user_agent = _load_reddit_credentials()
    return praw.Reddit(client_id=client_id, client_secret=client_secret, user_agent=user_agent)


def reddit_available() -> bool:
    """Returns True if Reddit credentials are configured in the environment.
    Used by the scan pipeline to decide upfront whether to attempt Reddit
    scraping at all, or fall back to Google Trends-only scoring."""
    try:
        _load_reddit_credentials()
        return True
    except RedditCredentialsError:
        return False


def _time_filter_for(lookback_months: int) -> str:
    """Picks the smallest PRAW `time_filter` enum value that still covers the
    requested lookback window (PRAW only accepts a fixed set of values, not
    an arbitrary day count)."""
    if lookback_months <= 1:
        return "month"
    if lookback_months <= 12:
        return "year"
    return "all"


def get_mention_score(
    keyword_name: str,
    synonyms: list[str],
    subreddit_names: list[str],
    lookback_months: int = 3,
) -> int:
    """Returns the count of distinct posts/comments matching `keyword_name` or any
    of `synonyms`, across `subreddit_names`, within the last `lookback_months` months.
    """
    reddit = _get_reddit_client()

    terms = [keyword_name.strip().lower()] + [s.strip().lower() for s in synonyms]
    terms = [t for t in terms if t]

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_months * 30)
    time_filter = _time_filter_for(lookback_months)
    matched_ids: set[str] = set()

    for subreddit_name in subreddit_names:
        try:
            subreddit = reddit.subreddit(subreddit_name)
            seen_post_ids: set[str] = set()

            for term in terms:
                for submission in subreddit.search(term, sort="new", time_filter=time_filter):
                    if submission.id in seen_post_ids:
                        continue

                    created = datetime.fromtimestamp(submission.created_utc, tz=timezone.utc)
                    if created < cutoff:
                        continue
                    seen_post_ids.add(submission.id)

                    combined_text = f"{submission.title} {submission.selftext}".lower()
                    if any(t in combined_text for t in terms):
                        matched_ids.add(f"post:{submission.id}")

                    submission.comment_sort = "top"
                    submission.comments.replace_more(limit=0)
                    for comment in submission.comments[:MAX_COMMENTS_PER_THREAD]:
                        comment_created = datetime.fromtimestamp(
                            comment.created_utc, tz=timezone.utc
                        )
                        if comment_created < cutoff:
                            continue
                        if any(t in comment.body.lower() for t in terms):
                            matched_ids.add(f"comment:{comment.id}")
        except (prawcore.exceptions.Redirect, prawcore.exceptions.NotFound) as exc:
            raise RedditScraperError(
                keyword_name,
                subreddit_name,
                Exception(f"invalid or inaccessible subreddit: {exc}"),
            ) from exc
        except prawcore.exceptions.PrawcoreException as exc:
            raise RedditScraperError(keyword_name, subreddit_name, exc) from exc
        except praw.exceptions.PRAWException as exc:
            raise RedditScraperError(keyword_name, subreddit_name, exc) from exc

    return len(matched_ids)
