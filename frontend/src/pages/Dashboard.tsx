// Dashboard page: ranked product signal table + scan trigger + per-product detail panel.
// Wired to the real backend: POST /scan + GET /results drive the table, and
// keywords/subreddits chips are fetched from /keywords and /subreddits.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { Keyword, Subreddit, ResultsResponse, ScanProgressEvent } from "../types";

interface Product {
  id: number;
  name: string;
  score: number;
  trend: number;
  mentions: number;
  data: number[];
}

const HOT = 75;
const PANEL_W = 480;
const SCAN_MODAL_W = 440;

type KeywordScanStatus = "pending" | "scanning" | "done" | "failed";

interface KeywordScanStep {
  status: KeywordScanStatus;
  trendScore?: number;
  mentionScore?: number;
}

function formatScanFailure(event: ScanProgressEvent): string {
  const where = event.source ? ` (source: ${event.source}${event.keyword ? `, keyword: "${event.keyword}"` : ""})` : "";
  return `${event.detail ?? "Scan failed."}${where}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}  ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function verdict(score: number): string {
  if (score >= 80) return "STRONG SIGNAL — RECOMMEND PROCEED";
  if (score >= 70) return "MODERATE SIGNAL — MONITOR CLOSELY";
  if (score >= 60) return "WEAK SIGNAL — HOLD POSITION";
  return "LOW SIGNAL — STAND DOWN";
}

function signalDir(data: number[]): string {
  if (data.length < 2) return "→ STABLE";
  const h = Math.max(1, Math.floor(data.length / 2));
  const oldA = data.slice(0, h).reduce((a, b) => a + b, 0) / h;
  const newA = data.slice(-h).reduce((a, b) => a + b, 0) / h;
  if (newA > oldA + 4) return "↑ RISING";
  if (newA < oldA - 4) return "↓ DECLINING";
  return "→ STABLE";
}

function buildProducts(results: ResultsResponse | null): Product[] {
  if (!results?.latest_run) return [];
  return results.latest_run.ranked.map((r) => {
    const historyPoints = (results.history[String(r.keyword_id)] ?? []).map((h) => h.composite_score * 100);
    const data = historyPoints.length >= 2 ? historyPoints : [r.composite_score * 100, r.composite_score * 100];
    return {
      id: r.keyword_id,
      name: r.keyword_name,
      score: Math.round(r.composite_score * 100),
      trend: r.trend_score,
      mentions: r.mention_score,
      data,
    };
  });
}

function makeSparkline(data: number[], w: number, h: number, hot: number, detail: boolean) {
  const minV = Math.min(...data) - 4;
  const maxV = Math.max(...data) + 4;
  const rng = maxV - minV || 1;
  const pad = 3;
  const tx = (i: number) => (i / (data.length - 1)) * w;
  const ty = (v: number) => h - pad - ((v - minV) / rng) * (h - pad * 2);
  const pts = data.map((v, i) => ({ x: tx(i), y: ty(v), hot: v >= hot }));
  const thY = ty(hot);
  const els: React.ReactNode[] = [];

  if (detail) {
    [25, 50, 75].forEach((v, gi) => {
      const gy = ty(v);
      if (gy >= 0 && gy <= h) {
        els.push(<line key={`g${gi}`} x1={0} y1={gy} x2={w} y2={gy} stroke="rgba(30,58,95,0.7)" strokeWidth={1} />);
        els.push(
          <text key={`gl${gi}`} x={3} y={gy - 3} fill="rgba(126,147,176,0.4)" fontSize={8} fontFamily="JetBrains Mono,monospace">
            {v}
          </text>,
        );
      }
    });
    const ap = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${w},${h} L0,${h} Z`;
    els.push(<path key="area" d={ap} fill="rgba(79,209,197,0.055)" stroke="none" />);
  }

  if (thY >= 0 && thY <= h) {
    els.push(
      <line
        key="thresh"
        x1={0}
        y1={thY}
        x2={w}
        y2={thY}
        stroke="rgba(255,138,61,0.22)"
        strokeWidth={1}
        strokeDasharray={detail ? "4 5" : "2 3"}
      />,
    );
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const isHot = pts[i].hot || pts[i + 1].hot;
    els.push(
      <line
        key={`l${i}`}
        x1={pts[i].x}
        y1={pts[i].y}
        x2={pts[i + 1].x}
        y2={pts[i + 1].y}
        stroke={isHot ? "#FF8A3D" : "#4FD1C5"}
        strokeWidth={detail ? 2 : 1.5}
        strokeLinecap="round"
      />,
    );
  }

  pts.forEach((p, i) => {
    if (p.hot) {
      els.push(<circle key={`d${i}`} cx={p.x} cy={p.y} r={detail ? 3.5 : 2.5} fill="#FF8A3D" />);
    }
  });

  const svgStyle: CSSProperties = detail
    ? { display: "block", width: "100%", height: h, overflow: "visible" }
    : { display: "block", width: w, height: h, overflow: "visible" };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
      {els}
    </svg>
  );
}

export default function Dashboard() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanSteps, setScanSteps] = useState<Record<string, KeywordScanStep>>({});
  const [scanFatalError, setScanFatalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [addingSubreddit, setAddingSubreddit] = useState(false);
  const [subredditInput, setSubredditInput] = useState("");
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);
  const [results, setResults] = useState<ResultsResponse | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [kws, subs, res] = await Promise.all([api.listKeywords(), api.listSubreddits(), api.getResults()]);
      if (!mountedRef.current) return;
      setKeywords(kws);
      setSubreddits(subs);
      setResults(res);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof ApiError ? err.message : "Failed to load dashboard data.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function startScan() {
    if (scanning) return;
    setScanning(true);
    setScanError(null);
    setScanFatalError(null);
    setScanSteps(Object.fromEntries(keywords.map((kw) => [kw.name, { status: "pending" as const }])));
    setScanModalOpen(true);

    let sawFatalError = false;

    try {
      await api.streamScan((event) => {
        if (event.type === "keyword_start" && event.keyword_name) {
          setScanSteps((steps) => ({ ...steps, [event.keyword_name!]: { status: "scanning" } }));
        } else if (event.type === "keyword_done" && event.keyword_name) {
          setScanSteps((steps) => ({
            ...steps,
            [event.keyword_name!]: {
              status: "done",
              trendScore: event.trend_score,
              mentionScore: event.mention_score,
            },
          }));
        } else if (event.type === "error") {
          sawFatalError = true;
          if (event.keyword) {
            setScanSteps((steps) => ({ ...steps, [event.keyword!]: { status: "failed" } }));
          }
          setScanFatalError(formatScanFailure(event));
        } else if (event.type === "complete" && event.results) {
          setResults(event.results);
        }
      });

      if (!sawFatalError) {
        setTimeout(() => setScanModalOpen(false), 1000);
      }
    } catch (err) {
      setScanModalOpen(false);
      setScanError(err instanceof ApiError ? err.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function addKeyword() {
    const v = keywordInput.trim();
    setAddingKeyword(false);
    setKeywordInput("");
    if (!v) return;
    try {
      const created = await api.createKeyword(v, []);
      setKeywords((ks) => [...ks, created]);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to add keyword.");
    }
  }

  async function addSubreddit() {
    const v = subredditInput.trim();
    setAddingSubreddit(false);
    setSubredditInput("");
    if (!v) return;
    try {
      const created = await api.createSubreddit(v);
      setSubreddits((subs) => [...subs, created]);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to add subreddit.");
    }
  }

  function onKeywordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") addKeyword();
    else if (e.key === "Escape") setAddingKeyword(false);
  }

  function onSubredditKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") addSubreddit();
    else if (e.key === "Escape") setAddingSubreddit(false);
  }

  const products = buildProducts(results);
  const lastScan = results?.latest_run ? formatTimestamp(results.latest_run.timestamp) : "NEVER";

  const sel = products.find((p) => p.id === selectedId) || null;
  const selectedProduct = sel ? { ...sel, verdict: verdict(sel.score), signalDir: signalDir(sel.data) } : null;
  const detailSpark = sel ? makeSparkline(sel.data, 400, 96, HOT, true) : null;
  const historyRunCount = sel ? (results?.history[String(sel.id)]?.length ?? 1) : 0;

  const scanStepEntries = keywords.map((kw) => ({ name: kw.name, step: scanSteps[kw.name] ?? { status: "pending" as const } }));
  const scanDoneCount = scanStepEntries.filter((e) => e.step.status === "done" || e.step.status === "failed").length;
  const scanTotalCount = scanStepEntries.length;

  const tableWrapStyle: CSSProperties = {
    flex: 1,
    paddingRight: sel ? `${PANEL_W + 16}px` : "0",
    transition: "padding-right 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  };

  const detailPanelStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: `${PANEL_W}px`,
    background: "#0E1828",
    borderLeft: "1px solid #1E3A5F",
    transform: sel ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    zIndex: 20,
    overflowY: "auto",
  };

  const runScanStyle: CSSProperties = {
    background: scanning ? "rgba(255,138,61,0.15)" : "#FF8A3D",
    border: scanning ? "1px solid rgba(255,138,61,0.6)" : "1px solid transparent",
    color: scanning ? "#FF8A3D" : "#0B1220",
    fontFamily: "'IBM Plex Sans Condensed', sans-serif",
    fontSize: "14px",
    fontWeight: 700,
    padding: "7px 22px",
    cursor: scanning ? "not-allowed" : "pointer",
    letterSpacing: "0.13em",
    whiteSpace: "nowrap",
    animation: scanning ? "scanFlicker 2s ease-in-out infinite" : "none",
  };

  const scanLabel = scanning ? "SCANNING…" : "RUN SCAN";

  const cornerButtonStyle: CSSProperties = {
    background: "none",
    border: "1px solid #1E3A5F",
    color: "#7E93B0",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "11px",
    padding: "6px 14px",
    cursor: "pointer",
    letterSpacing: "0.08em",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0B1220",
        backgroundImage:
          "linear-gradient(rgba(30,58,95,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(30,58,95,0.2) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        color: "#E6EDF5",
        fontFamily: "'Inter',sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes scanFlicker { 0%,100%{opacity:1;} 48%{opacity:1;} 50%{opacity:0.6;} 52%{opacity:1;} }
      `}</style>

      {/* TOP BAR */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
          height: "60px",
          borderBottom: "1px solid #1E3A5F",
          position: "sticky",
          top: 0,
          background: "rgba(11,18,32,0.97)",
          zIndex: 30,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          <div style={{ position: "relative", padding: "6px 16px 6px 0", marginRight: "24px" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 8,
                height: 8,
                borderTop: "1px solid rgba(79,209,197,0.55)",
                borderLeft: "1px solid rgba(79,209,197,0.55)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: 8,
                height: 8,
                borderBottom: "1px solid rgba(79,209,197,0.55)",
                borderLeft: "1px solid rgba(79,209,197,0.55)",
              }}
            />
            <span
              style={{
                fontFamily: "'IBM Plex Sans Condensed',sans-serif",
                fontSize: "21px",
                fontWeight: 700,
                letterSpacing: "0.16em",
                color: "#E6EDF5",
                whiteSpace: "nowrap",
              }}
            >
              TREND FINDER
            </span>
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "10px",
              color: "#4FD1C5",
              letterSpacing: "0.1em",
              opacity: 0.65,
              paddingRight: "24px",
              borderRight: "1px solid #1E3A5F",
              marginRight: "24px",
            }}
          >
            SIGNAL INTELLIGENCE
          </span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.05em" }}>
            LAST SCAN <span style={{ color: "#E6EDF5", marginLeft: "6px" }}>{lastScan}</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => { setAddingKeyword(true); setKeywordInput(""); }} disabled={addingKeyword} style={cornerButtonStyle}>
            + KEYWORD
          </button>
          <button onClick={() => { setAddingSubreddit(true); setSubredditInput(""); }} disabled={addingSubreddit} style={cornerButtonStyle}>
            + SUBREDDIT
          </button>
          <button onClick={startScan} style={runScanStyle}>
            {scanLabel}
          </button>
          <Link to="/settings" style={cornerButtonStyle}>
            SETTINGS
          </Link>
        </div>
      </div>

      {/* SCAN PROGRESS BAR */}
      {scanning && (
        <div style={{ height: "2px", background: "#1E3A5F", position: "relative", overflow: "hidden", flexShrink: 0 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              background: "#FF8A3D",
              width: "100%",
              animation: "scanFlicker 1.2s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* ERROR BANNERS */}
      {(loadError || scanError) && (
        <div
          style={{
            padding: "9px 32px",
            background: "rgba(255,90,90,0.08)",
            borderBottom: "1px solid rgba(255,90,90,0.3)",
            color: "#FF8A8A",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: "11px",
            letterSpacing: "0.03em",
            flexShrink: 0,
          }}
        >
          {scanError || loadError}
        </div>
      )}

      {/* CONTEXT ROW */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "9px 32px",
          borderBottom: "1px solid rgba(30,58,95,0.5)",
          flexWrap: "wrap",
          flexShrink: 0,
          minHeight: "42px",
        }}
      >
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.14em", flexShrink: 0 }}>
          KEYWORDS
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {keywords.map((kw) => (
            <span
              key={kw.id}
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: "11px",
                color: "#4FD1C5",
                background: "rgba(79,209,197,0.07)",
                padding: "2px 10px",
                border: "1px solid rgba(79,209,197,0.2)",
              }}
            >
              {kw.name}
            </span>
          ))}
          {addingKeyword && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={onKeywordKeyDown}
                placeholder="new keyword"
                autoFocus
                style={{
                  background: "#0B1220",
                  border: "1px solid rgba(79,209,197,0.5)",
                  color: "#E6EDF5",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "11px",
                  padding: "2px 10px",
                  width: "128px",
                }}
              />
              <button
                onClick={addKeyword}
                style={{
                  background: "rgba(79,209,197,0.1)",
                  border: "1px solid rgba(79,209,197,0.3)",
                  color: "#4FD1C5",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "10px",
                  padding: "3px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                }}
              >
                ADD
              </button>
            </div>
          )}
        </div>
        <span style={{ color: "#1E3A5F", flexShrink: 0 }}>│</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.14em", flexShrink: 0 }}>
          SUBREDDITS
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {subreddits.map((sr) => (
            <span
              key={sr.id}
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: "11px",
                color: "#7E93B0",
                background: "rgba(126,147,176,0.07)",
                padding: "2px 10px",
                border: "1px solid rgba(126,147,176,0.18)",
              }}
            >
              r/{sr.name}
            </span>
          ))}
          {addingSubreddit && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                value={subredditInput}
                onChange={(e) => setSubredditInput(e.target.value)}
                onKeyDown={onSubredditKeyDown}
                placeholder="r/subreddit"
                autoFocus
                style={{
                  background: "#0B1220",
                  border: "1px solid rgba(126,147,176,0.5)",
                  color: "#E6EDF5",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "11px",
                  padding: "2px 10px",
                  width: "128px",
                }}
              />
              <button
                onClick={addSubreddit}
                style={{
                  background: "rgba(126,147,176,0.1)",
                  border: "1px solid rgba(126,147,176,0.3)",
                  color: "#7E93B0",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "10px",
                  padding: "3px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                }}
              >
                ADD
              </button>
            </div>
          )}
        </div>
      </div>

      {/* TABLE WRAPPER */}
      <div style={tableWrapStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr 180px 116px",
            padding: "0 32px",
            height: "34px",
            alignItems: "center",
            borderBottom: "1px solid rgba(30,58,95,0.9)",
          }}
        >
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.16em" }}>RANK</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.16em" }}>PRODUCT</span>
          <span
            style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.16em", textAlign: "center" }}
          >
            SIGNAL TRACE
          </span>
          <span
            style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.16em", textAlign: "right" }}
          >
            COMPOSITE
          </span>
        </div>

        {loading && (
          <div style={{ padding: "32px", fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#7E93B0" }}>LOADING…</div>
        )}

        {!loading && products.length === 0 && (
          <div style={{ padding: "32px", fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#7E93B0" }}>
            NO SCAN RESULTS YET — ADD KEYWORDS &amp; SUBREDDITS, THEN RUN SCAN.
          </div>
        )}

        {products.map((p, i) => {
          const isSel = p.id === selectedId;
          const isHov = p.id === hoveredId;
          const rowStyle: CSSProperties = {
            display: "grid",
            gridTemplateColumns: "60px 1fr 180px 116px",
            padding: "0 32px",
            height: "68px",
            alignItems: "center",
            borderBottom: "1px solid rgba(30,58,95,0.6)",
            cursor: "pointer",
            background: isSel ? "rgba(79,209,197,0.07)" : isHov ? "rgba(79,209,197,0.03)" : "transparent",
            position: "relative",
            transition: "background 0.1s",
          };
          const scoreStyle: CSSProperties = {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "22px",
            fontWeight: 500,
            color: p.score >= HOT ? "#FF8A3D" : "#4FD1C5",
          };
          return (
            <div
              key={p.id}
              style={rowStyle}
              onClick={() => setSelectedId((cur) => (cur === p.id ? null : p.id))}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {isSel && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "#4FD1C5" }} />}
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", color: "#7E93B0", letterSpacing: "0.04em", paddingLeft: 2 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: "'IBM Plex Sans Condensed',sans-serif",
                    fontSize: "16px",
                    fontWeight: 600,
                    color: "#E6EDF5",
                    letterSpacing: "0.015em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.name}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "#7E93B0", letterSpacing: "0.05em" }}>
                  {signalDir(p.data)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{makeSparkline(p.data, 120, 32, HOT, false)}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                <span style={scoreStyle}>{p.score}</span>
              </div>
            </div>
          );
        })}

        <div
          style={{
            padding: "13px 32px",
            borderTop: "1px solid rgba(30,58,95,0.4)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(126,147,176,0.45)", letterSpacing: "0.07em" }}>
            {products.length} PRODUCTS — CLICK ROW TO OPEN READOUT
          </span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(126,147,176,0.35)", letterSpacing: "0.05em" }}>
            COMPOSITE = (TREND × 0.6) + (MENTIONS × 0.4) — HOT ≥ {HOT}
          </span>
        </div>
      </div>

      {/* DETAIL PANEL */}
      <div style={detailPanelStyle}>
        <div style={{ position: "absolute", top: 16, left: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
        <div style={{ position: "absolute", top: 16, left: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />
        <div style={{ position: "absolute", bottom: 16, left: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
        <div style={{ position: "absolute", bottom: 16, left: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />
        <div style={{ position: "absolute", top: 16, right: 0, width: 8, height: 1, background: "rgba(79,209,197,0.25)" }} />
        <div style={{ position: "absolute", top: 16, right: 0, width: 1, height: 8, background: "rgba(79,209,197,0.25)" }} />
        <div style={{ position: "absolute", bottom: 16, right: 0, width: 8, height: 1, background: "rgba(79,209,197,0.25)" }} />
        <div style={{ position: "absolute", bottom: 16, right: 0, width: 1, height: 8, background: "rgba(79,209,197,0.25)" }} />

        {selectedProduct && (
          <div style={{ padding: "76px 26px 32px 26px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.2em", marginBottom: 7 }}>
                  PRODUCT READOUT
                </div>
                <div style={{ fontFamily: "'IBM Plex Sans Condensed',sans-serif", fontSize: "21px", fontWeight: 700, color: "#E6EDF5", letterSpacing: "0.02em", lineHeight: 1.2 }}>
                  {selectedProduct.name}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#4FD1C5", marginTop: 5, letterSpacing: "0.06em" }}>
                  {selectedProduct.signalDir}
                </div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{
                  background: "none",
                  border: "1px solid #1E3A5F",
                  color: "#7E93B0",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: "10px",
                  padding: "5px 11px",
                  cursor: "pointer",
                  letterSpacing: "0.07em",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                ✕ CLOSE
              </button>
            </div>

            <div style={{ position: "relative", padding: "14px 14px 10px 14px", background: "rgba(18,27,46,0.6)" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: "1px solid rgba(79,209,197,0.45)", borderLeft: "1px solid rgba(79,209,197,0.45)" }} />
              <div style={{ position: "absolute", top: 0, right: 0, width: 10, height: 10, borderTop: "1px solid rgba(79,209,197,0.45)", borderRight: "1px solid rgba(79,209,197,0.45)" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, width: 10, height: 10, borderBottom: "1px solid rgba(79,209,197,0.45)", borderLeft: "1px solid rgba(79,209,197,0.45)" }} />
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderBottom: "1px solid rgba(79,209,197,0.45)", borderRight: "1px solid rgba(79,209,197,0.45)" }} />
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.18em", marginBottom: 10 }}>
                SIGNAL HISTORY — {historyRunCount} SCAN RUN{historyRunCount === 1 ? "" : "S"}
              </div>
              {detailSpark}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "rgba(126,147,176,0.45)" }}>
                  RUN −{Math.max(0, historyRunCount - 1)}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "rgba(126,147,176,0.45)" }}>CURRENT</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ position: "relative", padding: "13px" }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 8, borderTop: "1px solid rgba(79,209,197,0.4)", borderLeft: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", top: 0, right: 0, width: 8, height: 8, borderTop: "1px solid rgba(79,209,197,0.4)", borderRight: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, width: 8, height: 8, borderBottom: "1px solid rgba(79,209,197,0.4)", borderLeft: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderBottom: "1px solid rgba(79,209,197,0.4)", borderRight: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.15em", marginBottom: 9 }}>
                  TREND SCORE (RAW)
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "38px", fontWeight: 500, color: "#4FD1C5", lineHeight: 1 }}>
                  {selectedProduct.trend.toFixed(1)}
                </div>
              </div>
              <div style={{ position: "relative", padding: "13px" }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 8, borderTop: "1px solid rgba(79,209,197,0.4)", borderLeft: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", top: 0, right: 0, width: 8, height: 8, borderTop: "1px solid rgba(79,209,197,0.4)", borderRight: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, width: 8, height: 8, borderBottom: "1px solid rgba(79,209,197,0.4)", borderLeft: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderBottom: "1px solid rgba(79,209,197,0.4)", borderRight: "1px solid rgba(79,209,197,0.4)" }} />
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.15em", marginBottom: 9 }}>
                  MENTION COUNT
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "38px", fontWeight: 500, color: "#FF8A3D", lineHeight: 1 }}>
                  {selectedProduct.mentions}
                </div>
              </div>
            </div>

            <div style={{ position: "relative", padding: "18px 18px" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: "1px solid rgba(255,138,61,0.6)", borderLeft: "1px solid rgba(255,138,61,0.6)" }} />
              <div style={{ position: "absolute", top: 0, right: 0, width: 10, height: 10, borderTop: "1px solid rgba(255,138,61,0.6)", borderRight: "1px solid rgba(255,138,61,0.6)" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, width: 10, height: 10, borderBottom: "1px solid rgba(255,138,61,0.6)", borderLeft: "1px solid rgba(255,138,61,0.6)" }} />
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderBottom: "1px solid rgba(255,138,61,0.6)", borderRight: "1px solid rgba(255,138,61,0.6)" }} />
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.18em", marginBottom: 8 }}>
                COMPOSITE SCORE
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "64px", fontWeight: 500, color: "#FF8A3D", lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {selectedProduct.score}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "16px", color: "rgba(255,138,61,0.35)" }}>/100</span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(255,138,61,0.75)", marginTop: 11, letterSpacing: "0.04em" }}>
                {selectedProduct.verdict}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SCAN PROGRESS MODAL */}
      {scanModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11,18,32,0.75)",
            backdropFilter: "blur(2px)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: `${SCAN_MODAL_W}px`,
              maxHeight: "78vh",
              background: "#0E1828",
              border: "1px solid #1E3A5F",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ position: "absolute", top: 16, left: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", top: 16, left: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", bottom: 16, left: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", bottom: 16, left: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", top: 16, right: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", top: 16, right: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", bottom: 16, right: 0, width: 14, height: 1, background: "rgba(79,209,197,0.4)" }} />
            <div style={{ position: "absolute", bottom: 16, right: 0, width: 1, height: 14, background: "rgba(79,209,197,0.4)" }} />

            <div style={{ padding: "28px 28px 16px 28px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "9px", color: "#7E93B0", letterSpacing: "0.2em", marginBottom: 7 }}>
                {scanFatalError ? "SCAN FAILED" : scanDoneCount >= scanTotalCount && scanTotalCount > 0 ? "SCAN COMPLETE" : "SCAN IN PROGRESS"}
              </div>
              <div style={{ fontFamily: "'IBM Plex Sans Condensed',sans-serif", fontSize: "19px", fontWeight: 700, color: "#E6EDF5", letterSpacing: "0.02em" }}>
                SIGNAL ACQUISITION
              </div>
            </div>

            <div style={{ padding: "0 28px", overflowY: "auto", flex: 1 }}>
              {scanStepEntries.map(({ name, step }) => {
                const statusColor =
                  step.status === "done" ? "#4FD1C5" : step.status === "failed" ? "#FF5A5A" : step.status === "scanning" ? "#FF8A3D" : "#7E93B0";
                const statusLabel =
                  step.status === "done"
                    ? "DONE"
                    : step.status === "failed"
                      ? "FAILED"
                      : step.status === "scanning"
                        ? "SCANNING…"
                        : "PENDING";
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(30,58,95,0.5)",
                      gap: "12px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Sans Condensed',sans-serif",
                        fontSize: "14px",
                        color: "#E6EDF5",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {name}
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexShrink: 0 }}>
                      {step.status === "done" && (
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(126,147,176,0.6)" }}>
                          T:{step.trendScore?.toFixed(1)} M:{step.mentionScore}
                        </span>
                      )}
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: "10px",
                          color: statusColor,
                          letterSpacing: "0.08em",
                          animation: step.status === "scanning" ? "scanFlicker 2s ease-in-out infinite" : "none",
                        }}
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {scanFatalError ? (
              <div style={{ padding: "16px 28px 24px 28px" }}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: "11px",
                    color: "#FF8A8A",
                    letterSpacing: "0.03em",
                    marginBottom: 14,
                  }}
                >
                  {scanFatalError}
                </div>
                <button
                  onClick={() => setScanModalOpen(false)}
                  style={{
                    background: "none",
                    border: "1px solid #1E3A5F",
                    color: "#7E93B0",
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: "10px",
                    padding: "6px 16px",
                    cursor: "pointer",
                    letterSpacing: "0.07em",
                  }}
                >
                  ✕ CLOSE
                </button>
              </div>
            ) : (
              <div style={{ padding: "16px 28px 24px 28px" }}>
                <div style={{ height: "2px", background: "#1E3A5F", position: "relative", overflow: "hidden", marginBottom: 8 }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      background: "#FF8A3D",
                      width: scanTotalCount > 0 ? `${(scanDoneCount / scanTotalCount) * 100}%` : "0%",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", color: "rgba(126,147,176,0.6)", letterSpacing: "0.07em" }}>
                  {scanDoneCount} / {scanTotalCount} KEYWORDS
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
