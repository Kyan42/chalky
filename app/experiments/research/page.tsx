"use client";

/**
 * Recent papers: /experiments/research
 *
 * A topic and a window in; the papers (components/PaperCards.tsx), the planner's material text,
 * the path that fetched them, latency and a cached badge out (POST /api/research,
 * lib/research/papers.ts). "Path" forces one fetch path for measuring; pick a citation and type a
 * line to see the card open and the matching key sentence light up, as a beat with `cite` would.
 * No model calls.
 */
import { useState } from "react";
import { PaperCards } from "@/components/PaperCards";
import type { ResearchEvent, ResearchRecord } from "@/lib/research/types";

const TOPICS = ["vision-language-action models", "LLM agents", "voice AI", "retrieval-augmented generation", "photosynthesis"];
const PATHS = [
  { value: "", label: "auto (Apify, then arXiv API)" },
  { value: "apify-arxiv", label: "Apify arXiv actor" },
  { value: "apify-rag", label: "Apify rag-web-browser" },
  { value: "arxiv-api", label: "arXiv API (free fallback)" },
];

const box: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, background: "#fff" };
const badge = (bg: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 12, background: bg, marginRight: 6 });

export default function ResearchPage() {
  const [draft, setDraft] = useState(TOPICS[0]);
  const [days, setDays] = useState(14);
  const [path, setPath] = useState("");
  const [run, setRun] = useState<{ topic: string; days: number; n: number; fresh: boolean; only: string } | null>(null);
  const [rec, setRec] = useState<ResearchRecord | null>(null);
  const [events, setEvents] = useState<(ResearchEvent & { t: number })[]>([]);
  const [t0, setT0] = useState(0);
  const [cite, setCite] = useState(1);
  const [line, setLine] = useState("");

  const start = (fresh: boolean) => {
    setRec(null);
    setEvents([]);
    setT0(performance.now());
    setCite(1);
    setRun({ topic: draft.trim(), days, n: (run?.n ?? 0) + 1, fresh: fresh || !!path, only: path });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f5f1", minHeight: "100vh", color: "#222" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Recent papers</h1>
      <p style={{ margin: "0 0 16px", color: "#666", fontSize: 13 }}>
        /api/research (lib/research/CONTRACT.md); cached per topic and window in experiments/research-cache. Forcing a path skips the cache and does not write it.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <section style={{ display: "grid", gap: 12 }}>
          <div style={box}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start(false);
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, minWidth: 200, padding: 8, fontSize: 15 }} data-testid="research-topic" />
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                last
                <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 14)))} style={{ width: 56, padding: 6 }} data-testid="research-days" />
                days
              </label>
              <select value={path} onChange={(e) => setPath(e.target.value)} style={{ fontSize: 13 }} data-testid="research-path">
                {PATHS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <button type="submit" disabled={!draft.trim()} data-testid="research-start">Find papers</button>
              <button type="button" disabled={!draft.trim()} onClick={() => start(true)} title="Skip the cache and fetch again (overwrites the cache file)">Fetch fresh</button>
            </form>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TOPICS.map((t) => (
                <button key={t} type="button" onClick={() => setDraft(t)} style={{ fontSize: 12 }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={box} data-testid="research-status">
            {!run ? (
              <span style={{ color: "#888" }}>Not started.</span>
            ) : !rec ? (
              <span>Asking the server…</span>
            ) : (
              <>
                {rec.status === "running" && <span style={badge("#fff3cd")}>running</span>}
                {rec.status === "failed" && <span style={badge("#f8d7da")}>failed</span>}
                {rec.status === "ready" && (rec.cached ? <span style={badge("#d1e7dd")} data-testid="badge-cached">cached</span> : <span style={badge("#cfe2ff")}>live</span>)}
                {rec.via && <span style={badge("#e2d9f3")} data-testid="badge-via">{rec.via}</span>}
                <span style={{ fontSize: 13 }}>
                  {rec.papers.length} paper(s) · {rec.from} to {rec.to}
                  {rec.searchedDays > rec.days ? ` (widened to ${rec.searchedDays} days)` : ""}
                  {rec.ms != null ? ` · fetched in ${(rec.ms / 1000).toFixed(1)} s` : ""}
                  {rec.fetchedAt ? ` · ${new Date(rec.fetchedAt).toLocaleString()}` : ""}
                </span>
                {rec.error && <p style={{ fontSize: 13, color: "#a33", margin: "8px 0 0" }}>{rec.error}</p>}
              </>
            )}
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>A beat citing a paper:</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              cite
              {(rec?.papers ?? []).map((p) => (
                <button key={p.n} type="button" onClick={() => setCite(p.n)} aria-pressed={cite === p.n} style={{ fontWeight: cite === p.n ? 700 : 400 }} data-testid={`cite-${p.n}`}>
                  [{p.n}]
                </button>
              ))}
              <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="the beat's line, e.g. it hit 40% better success" style={{ flex: 1, minWidth: 200, padding: 6 }} data-testid="research-line" />
            </div>
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>Material for the planner{rec?.material ? ` (${rec.material.split(/\s+/).length} words)` : ""}:</div>
            <pre style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.45 }} data-testid="research-material">
              {rec?.material || "—"}
            </pre>
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>Research events (what the lesson transcript would store):</div>
            <pre style={{ fontSize: 11.5, margin: 0, whiteSpace: "pre-wrap" }} data-testid="research-events">
              {events.map((e) => `${(e.t / 1000).toFixed(1)} s  ${JSON.stringify(e)}`).join("\n") || "—"}
            </pre>
          </div>
        </section>
        <section style={{ ...box, background: "var(--paper)", minHeight: 200 }}>
          {run && (
            <PaperCards
              key={run.n}
              layout="inline"
              topic={run.topic}
              days={run.days}
              fresh={run.fresh}
              only={run.only || undefined}
              currentCite={cite}
              currentLine={line}
              onRecord={setRec}
              onEvent={(e) => setEvents((list) => [...list, { ...e, t: Math.round(performance.now() - t0) }])}
            />
          )}
        </section>
      </div>
    </main>
  );
}
