// Settings page: real CRUD for keywords and subreddits against the backend API.

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { Keyword, Subreddit } from "../types";

export default function Settings() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newKeywordName, setNewKeywordName] = useState("");
  const [newKeywordSynonyms, setNewKeywordSynonyms] = useState("");
  const [newSubredditName, setNewSubredditName] = useState("");

  const [editingKeywordId, setEditingKeywordId] = useState<number | null>(null);
  const [editKeywordName, setEditKeywordName] = useState("");
  const [editKeywordSynonyms, setEditKeywordSynonyms] = useState("");

  const [editingSubredditId, setEditingSubredditId] = useState<number | null>(null);
  const [editSubredditName, setEditSubredditName] = useState("");

  const [lookbackMonths, setLookbackMonths] = useState("12");
  const [savingLookback, setSavingLookback] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [kws, subs, settings] = await Promise.all([
        api.listKeywords(),
        api.listSubreddits(),
        api.getSettings(),
      ]);
      setKeywords(kws);
      setSubreddits(subs);
      setLookbackMonths(String(settings.lookback_months));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function parseSynonyms(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleSaveLookback(e: FormEvent) {
    e.preventDefault();
    const months = Number(lookbackMonths);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      setError("Lookback window must be a whole number of months between 1 and 24.");
      return;
    }
    setError(null);
    setSavingLookback(true);
    try {
      const updated = await api.updateSettings(months);
      setLookbackMonths(String(updated.lookback_months));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update scan window.");
    } finally {
      setSavingLookback(false);
    }
  }

  async function handleAddKeyword(e: FormEvent) {
    e.preventDefault();
    const name = newKeywordName.trim();
    if (!name) return;
    setError(null);
    try {
      const created = await api.createKeyword(name, parseSynonyms(newKeywordSynonyms));
      setKeywords((ks) => [...ks, created]);
      setNewKeywordName("");
      setNewKeywordSynonyms("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add keyword.");
    }
  }

  function startEditKeyword(k: Keyword) {
    setEditingKeywordId(k.id);
    setEditKeywordName(k.name);
    setEditKeywordSynonyms(k.synonyms.join(", "));
  }

  async function handleSaveKeyword(id: number) {
    const name = editKeywordName.trim();
    if (!name) return;
    setError(null);
    try {
      const updated = await api.updateKeyword(id, name, parseSynonyms(editKeywordSynonyms));
      setKeywords((ks) => ks.map((k) => (k.id === id ? updated : k)));
      setEditingKeywordId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update keyword.");
    }
  }

  async function handleDeleteKeyword(id: number) {
    setError(null);
    try {
      await api.deleteKeyword(id);
      setKeywords((ks) => ks.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete keyword.");
    }
  }

  async function handleAddSubreddit(e: FormEvent) {
    e.preventDefault();
    const name = newSubredditName.trim();
    if (!name) return;
    setError(null);
    try {
      const created = await api.createSubreddit(name);
      setSubreddits((subs) => [...subs, created]);
      setNewSubredditName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add subreddit.");
    }
  }

  function startEditSubreddit(s: Subreddit) {
    setEditingSubredditId(s.id);
    setEditSubredditName(s.name);
  }

  async function handleSaveSubreddit(id: number) {
    const name = editSubredditName.trim();
    if (!name) return;
    setError(null);
    try {
      const updated = await api.updateSubreddit(id, name);
      setSubreddits((subs) => subs.map((s) => (s.id === id ? updated : s)));
      setEditingSubredditId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update subreddit.");
    }
  }

  async function handleDeleteSubreddit(id: number) {
    setError(null);
    try {
      await api.deleteSubreddit(id);
      setSubreddits((subs) => subs.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete subreddit.");
    }
  }

  return (
    <div className="p-8">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">
        ← Back to Dashboard
      </Link>
      <h1 className="mt-4 text-3xl font-bold text-slate-800">Settings</h1>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="mt-6">
        <h2 className="text-xl font-semibold text-slate-700">Scan Window</h2>
        <p className="mt-1 text-xs text-slate-500">
          How many months back to look when scoring Google Trends and Reddit mentions.
        </p>

        <form onSubmit={handleSaveLookback} className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={24}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            value={lookbackMonths}
            onChange={(e) => setLookbackMonths(e.target.value)}
            disabled={loading}
          />
          <span className="text-sm text-slate-600">months</span>
          <button
            type="submit"
            disabled={loading || savingLookback}
            className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingLookback ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-700">Keywords</h2>

        {loading ? (
          <p className="mt-2 text-slate-500">Loading…</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded border border-slate-200">
            {keywords.length === 0 && <li className="p-3 text-sm text-slate-500">No keywords yet.</li>}
            {keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 p-3">
                {editingKeywordId === k.id ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <input
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={editKeywordName}
                      onChange={(e) => setEditKeywordName(e.target.value)}
                      placeholder="name"
                    />
                    <input
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      value={editKeywordSynonyms}
                      onChange={(e) => setEditKeywordSynonyms(e.target.value)}
                      placeholder="synonyms, comma-separated"
                    />
                    <button
                      onClick={() => handleSaveKeyword(k.id)}
                      className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingKeywordId(null)}
                      className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{k.name}</div>
                      {k.synonyms.length > 0 && (
                        <div className="text-xs text-slate-500">{k.synonyms.join(", ")}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => startEditKeyword(k)}
                        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteKeyword(k.id)}
                        className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddKeyword} className="mt-3 flex flex-wrap gap-2">
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={newKeywordName}
            onChange={(e) => setNewKeywordName(e.target.value)}
            placeholder="new keyword name"
          />
          <input
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            value={newKeywordSynonyms}
            onChange={(e) => setNewKeywordSynonyms(e.target.value)}
            placeholder="synonyms, comma-separated"
          />
          <button type="submit" className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800">
            Add Keyword
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-700">Subreddits</h2>
        <p className="mt-1 text-xs text-slate-500">Max 5 subreddits. {subreddits.length}/5 used.</p>

        {loading ? (
          <p className="mt-2 text-slate-500">Loading…</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded border border-slate-200">
            {subreddits.length === 0 && <li className="p-3 text-sm text-slate-500">No subreddits yet.</li>}
            {subreddits.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                {editingSubredditId === s.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      value={editSubredditName}
                      onChange={(e) => setEditSubredditName(e.target.value)}
                      placeholder="r/subreddit"
                    />
                    <button
                      onClick={() => handleSaveSubreddit(s.id)}
                      className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingSubredditId(null)}
                      className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="font-medium text-slate-800">r/{s.name}</div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => startEditSubreddit(s)}
                        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteSubreddit(s.id)}
                        className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddSubreddit} className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            value={newSubredditName}
            onChange={(e) => setNewSubredditName(e.target.value)}
            placeholder="r/subreddit"
            disabled={subreddits.length >= 5}
          />
          <button
            type="submit"
            disabled={subreddits.length >= 5}
            className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Subreddit
          </button>
        </form>
      </section>
    </div>
  );
}
