"use client";

/**
 * Time-sensitive questions from the web: /experiments/research
 *
 * A question in; the pages (components/ResearchCards.tsx), the planner's material text, the
 * search sent, latency and a cached badge out (POST /api/research, lib/research/web.ts). Pick a
 * citation and type a line to see the card open and the matching key sentence light up, as a beat
 * with `cite` would. No model calls.
 */
import { useState } from "react";
import { ResearchCards } from "@/components/ResearchCards";
import type { ResearchEvent, ResearchRecord } from "@/lib/research/types";

const QUESTIONS = [
  "what's new in CRISPR this month",
  "what changed in Python 3.14",
  "who won the 2026 Nobel in physics and for what",
  "what's the latest on the James Webb telescope",
  "what's new in battery technology",
  "what's the latest with quantum computers",
];

const box: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, background: "#fff" };
const badge = (bg: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 12, background: bg, marginRight: 6 });

export default function ResearchPage() {
  const [draft, setDraft] = useState(QUESTIONS[0]);
  const [run, setRun] = useState<{ question: string; n: number; fresh: boolean } | null>(null);
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
    setRun({ question: draft.trim(), n: (run?.n ?? 0) + 1, fresh });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f5f1", minHeight: "100vh", color: "#222" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>What&apos;s new, from the web</h1>
      <p style={{ margin: "0 0 16px", color: "#666", fontSize: 13 }}>
        /api/research (lib/research/CONTRACT.md): one Apify rag-web-browser call, 8 s budget, cached per question in experiments/research-cache.
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
              <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, minWidth: 240, padding: 8, fontSize: 15 }} data-testid="research-question" />
              <button type="submit" disabled={!draft.trim()} data-testid="research-start">Look it up</button>
              <button type="button" disabled={!draft.trim()} onClick={() => start(true)} title="Skip the cache (a good answer still overwrites the cache file)">Fetch fresh</button>
            </form>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {QUESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => setDraft(q)} style={{ fontSize: 12 }}>{q}</button>
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
                {rec.status === "none" && <span style={badge("#f8d7da")} data-testid="badge-none">none</span>}
                {rec.status === "ready" && (rec.cached ? <span style={badge("#d1e7dd")} data-testid="badge-cached">cached</span> : <span style={badge("#cfe2ff")}>live</span>)}
                {rec.recent && <span style={badge("#e2d9f3")}>recency hint</span>}
                <span style={{ fontSize: 13 }}>
                  {rec.items.length} page(s){rec.ms != null ? ` · ${(rec.ms / 1000).toFixed(1)} s` : ""}
                  {rec.fetchedAt ? ` · fetched ${new Date(rec.fetchedAt).toLocaleString()}` : ""}
                </span>
                {rec.query && <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>search: {rec.query}</div>}
                {rec.error && <p style={{ fontSize: 13, color: "#a33", margin: "8px 0 0" }}>{rec.error}</p>}
              </>
            )}
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>A beat citing a page:</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              cite
              {(rec?.items ?? []).map((it) => (
                <button key={it.n} type="button" onClick={() => setCite(it.n)} aria-pressed={cite === it.n} style={{ fontWeight: cite === it.n ? 700 : 400 }} data-testid={`cite-${it.n}`}>
                  [{it.n}]
                </button>
              ))}
              <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="the beat's line" style={{ flex: 1, minWidth: 200, padding: 6 }} data-testid="research-line" />
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
            <ResearchCards
              key={run.n}
              layout="inline"
              question={run.question}
              fresh={run.fresh}
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
