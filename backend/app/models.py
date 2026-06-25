"""ORM models for the Trend Finder schema: keywords, subreddits, runs, scores."""

from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship

from app.database import Base


class Keyword(Base):
    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    synonyms = Column(String)  # comma-separated string, UI-editable


class Subreddit(Base):
    __tablename__ = "subreddits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)  # max 5 rows enforced at the API layer


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, default=1)  # singleton row
    lookback_months = Column(Integer, nullable=False, default=12)


class Run(Base):
    __tablename__ = "runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String, nullable=False)

    scores = relationship("Score", back_populates="run")


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("runs.id"), nullable=False)
    keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=False)
    trend_score = Column(Float)
    mention_score = Column(Float)
    composite_score = Column(Float)

    run = relationship("Run", back_populates="scores")
    keyword = relationship("Keyword")
