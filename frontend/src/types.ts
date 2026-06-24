// Shared TypeScript types matching the backend Pydantic schemas (backend/app/schemas.py).

export interface Keyword {
  id: number;
  name: string;
  synonyms: string[];
}

export interface Subreddit {
  id: number;
  name: string;
}

export interface RankedScore {
  keyword_id: number;
  keyword_name: string;
  trend_score: number;
  mention_score: number;
  composite_score: number;
  rank: number;
}

export interface LatestRun {
  run_id: number;
  timestamp: string;
  ranked: RankedScore[];
}

export interface HistoryEntry {
  run_id: number;
  timestamp: string;
  composite_score: number;
}

export interface ResultsResponse {
  latest_run: LatestRun | null;
  history: Record<string, HistoryEntry[]>;
}

export interface ScanFailure {
  error: "scan_failed";
  keyword?: string;
  source?: "trends" | "reddit" | "db";
  detail: string;
}
