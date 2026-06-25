// Thin fetch wrapper for the FastAPI backend (backend/app/routers/*).
// The backend is a single local process on :8000 with CORS open for :5173 —
// no auth, no env config needed for a local single-user tool.

import type { Keyword, Subreddit, Settings, ResultsResponse, ScanProgressEvent } from "./types";

const API_BASE = "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // 400s shape as {"detail": "..."}; /scan failures shape as {"error": "scan_failed", "detail": "..."}.
    const message = typeof body?.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(res.status, body, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listKeywords: () => request<Keyword[]>("/keywords"),
  createKeyword: (name: string, synonyms: string[]) =>
    request<Keyword>("/keywords", { method: "POST", body: JSON.stringify({ name, synonyms }) }),
  updateKeyword: (id: number, name: string, synonyms: string[]) =>
    request<Keyword>(`/keywords/${id}`, { method: "PUT", body: JSON.stringify({ name, synonyms }) }),
  deleteKeyword: (id: number) =>
    request<{ status: string; id: number }>(`/keywords/${id}`, { method: "DELETE" }),

  listSubreddits: () => request<Subreddit[]>("/subreddits"),
  createSubreddit: (name: string) =>
    request<Subreddit>("/subreddits", { method: "POST", body: JSON.stringify({ name }) }),
  updateSubreddit: (id: number, name: string) =>
    request<Subreddit>(`/subreddits/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteSubreddit: (id: number) =>
    request<{ status: string; id: number }>(`/subreddits/${id}`, { method: "DELETE" }),

  streamScan: async (onEvent: (event: ScanProgressEvent) => void): Promise<void> => {
    const res = await fetch(`${API_BASE}/scan`, { method: "POST" });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = typeof body?.detail === "string" ? body.detail : res.statusText;
      throw new ApiError(res.status, body, message);
    }
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const records = buffer.split("\n\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        const dataLine = record.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        onEvent(JSON.parse(dataLine.slice("data: ".length)) as ScanProgressEvent);
      }
    }
  },
  getResults: () => request<ResultsResponse>("/results"),

  getSettings: () => request<Settings>("/settings"),
  updateSettings: (lookback_months: number) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify({ lookback_months }) }),
};
