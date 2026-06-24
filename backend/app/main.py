"""FastAPI application entrypoint. Boots the app, creates DB tables on startup,
and wires up the keyword/subreddit/scan routers."""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import Base, engine
from app.routers import keywords, subreddits, scan
from app.routers.scan import ScanFailedError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Trend Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # Schema-only: create tables if they don't exist. No seeding happens here —
    # run `python seed.py` manually to populate initial keywords/subreddits.
    Base.metadata.create_all(bind=engine)


@app.exception_handler(ScanFailedError)
async def scan_failed_handler(request: Request, exc: ScanFailedError):
    body = {"error": "scan_failed", "detail": exc.detail}
    if exc.keyword is not None:
        body["keyword"] = exc.keyword
    if exc.source is not None:
        body["source"] = exc.source
    return JSONResponse(status_code=500, content=body)


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(keywords.router)
app.include_router(subreddits.router)
app.include_router(scan.router)
