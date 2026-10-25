"use client";

/**
 * Live source cards: /experiments/sources
 *
 * Type a question, start a fetch, watch the cards fill (components/SourceCards.tsx, backed by
 * POST /api/sources and lib/sources/apify.ts), and switch the current beat to see each card's
 * passage follow it. The beats are sample lines (editable, one per line), not a real plan, so this
 * page makes no model calls. ?fixture=1 loads the hand-written test set instead of a fetch.
 */
import { useEffect, useState } from "react";
import { SourceCards } from "@/components/SourceCards";
import type { SourcesEvent, SourcesRecord } from "@/lib/sources/types";

const SAMPLES: Record<string, string[]> = {
  "what is photosynthesis": [
    "Plants make their own food, and they do it with light.",
    "Inside the leaf, chlorophyll soaks up sunlight, mostly red and blue light.",
    "Water comes up from the roots and gets split apart; that's where the oxygen we breathe comes from.",
    "Carbon dioxide drifts in through tiny pores called stomata.",
    "The Calvin cycle uses that energy to build sugar, glucose, out of carbon dioxide.",
  ],
  "why is the sky blue": [
    "Sunlight looks white, but it's every colour mixed together.",
    "When light hits the air, the tiny gas molecules scatter it in every direction.",
    "Short wavelengths, blue and violet, get scattered far more than red. That's Rayleigh scattering.",
    "At sunset the light crosses much more air, so the blue is scattered away and we see red and orange.",
  ],
  "how do plants breathe": [
    "Plants breathe too, day and night, through tiny holes in their leaves.",
    "Those holes are stomata, opened and closed by two guard cells.",
    "In cellular respiration, the plant burns sugar with oxygen to get energy, and releases carbon dioxide.",
    "During the day photosynthesis outpaces respiration, so plants give off more oxygen than they use.",
  ],
  "what is an oxygen molecule": [
    "An oxygen molecule is two oxygen atoms stuck together, O2.",
    "They share electrons in a double bond.",
    "Most of the oxygen in the air was made by photosynthesis.",
    "Ozone is a different molecule, three oxygen atoms, high up in the atmosphere.",
  ],
  "how do vaccines work": [
    "A vaccine teaches your immune system to recognise a germ before you ever meet it.",
    "It shows your body an antigen, a harmless piece or copy of the virus.",
    "B cells make antibodies that stick to that antigen.",
    "Memory cells stay behind, so a real infection gets fought off quickly.",
  ],
};
const QUESTIONS = Object.keys(SAMPLES);

const box: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, background: "#fff" };
const badge = (bg: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 12, background: bg, marginRight: 6 });

export default function SourcesPage() {
  const [draft, setDraft] = useState(QUESTIONS[0]);
  const [beatText, setBeatText] = useState(SAMPLES[QUESTIONS[0]].join("\n"));
  const [run, setRun] = useState<{ question: string; n: number; fresh: boolean } | null>(null);
  const [current, setCurrent] = useState("b1");
  const [rec, setRec] = useState<SourcesRecord | null>(null);
  const [events, setEvents] = useState<(SourcesEvent & { t: number })[]>([]);
  const [t0, setT0] = useState(0);
  const [fixture, setFixture] = useState(false);
  useEffect(() => setFixture(new URLSearchParams(location.search).get("fixture") === "1"), []);

  const beats = beatText
    .split("\n")
    .map((say) => say.trim())
    .filter(Boolean)
    .map((say, i) => ({ id: `b${i + 1}`, say }));

  const start = (fresh: boolean) => {
    setRec(null);
    setEvents([]);
    setT0(performance.now());
    setCurrent("b1");
    setRun({ question: draft.trim(), n: (run?.n ?? 0) + 1, fresh });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f5f1", minHeight: "100vh", color: "#222" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Live source cards</h1>
      <p style={{ margin: "0 0 16px", color: "#666", fontSize: 13 }}>
        apify/rag-web-browser via /api/sources; cached per question in experiments/sources-cache. Beats are sample lines, not a plan.
        {fixture && <b> Fixture mode: hand-written test cards, not a fetch.</b>}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <section style={{ display: "grid", gap: 12 }}>
          <div style={box}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start(false);
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, padding: 8, fontSize: 15 }} data-testid="sources-question" />
              <button type="submit" disabled={!draft.trim()} data-testid="sources-start">Find sources</button>
              <button type="button" disabled={!draft.trim() || fixture} onClick={() => start(true)} title="Skip the cache and fetch again (overwrites the cache file)">Fetch fresh</button>
            </form>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setDraft(q);
                    setBeatText(SAMPLES[q].join("\n"));
                  }}
                  style={{ fontSize: 12 }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <div style={box} data-testid="sources-status">
            {!run ? (
              <span style={{ color: "#888" }}>Not started.</span>
            ) : !rec ? (
              <span>Asking the server…</span>
            ) : (
              <>
                {rec.status === "no-token" && <span style={badge("#f8d7da")} data-testid="badge-no-token">no token</span>}
                {rec.status === "running" && <span style={badge("#fff3cd")}>running</span>}
                {rec.status === "failed" && <span style={badge("#f8d7da")}>failed</span>}
                {rec.status === "ready" && rec.cached && <span style={badge("#d1e7dd")} data-testid="badge-cached">cached</span>}
                {rec.status === "ready" && !rec.cached && <span style={badge("#cfe2ff")}>live</span>}
                {rec.fetchedVia === "fixture" && <span style={badge("#e2d9f3")} data-testid="badge-fixture">fixture</span>}
                <span style={{ fontSize: 13 }}>
                  {rec.cards.length} card(s){rec.ms != null ? ` · actor ${(rec.ms / 1000).toFixed(1)} s` : ""}
                  {rec.mode ? ` via ${rec.mode}` : ""}
                  {rec.fetchedAt ? ` · fetched ${new Date(rec.fetchedAt).toLocaleString()}` : ""}
                </span>
                {rec.status === "no-token" && (
                  <p style={{ fontSize: 13, margin: "8px 0 0" }}>
                    APIFY_TOKEN is not set, so only cached questions have cards. Add it to .env.local and restart the dev server (lib/sources/README.md).
                  </p>
                )}
                {rec.error && rec.status !== "no-token" && <p style={{ fontSize: 13, color: "#a33", margin: "8px 0 0" }}>{rec.error}</p>}
                <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>query: {rec.query}</div>
              </>
            )}
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>Current beat (click one; edit the lines below):</div>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14, lineHeight: 1.5 }} data-testid="sources-beats">
              {beats.map((b) => (
                <li key={b.id} onClick={() => setCurrent(b.id)} data-beat-id={b.id} style={{ cursor: "pointer", background: b.id === current ? "#fff3b0" : undefined, borderRadius: 4, padding: "1px 4px" }}>
                  {b.say}
                </li>
              ))}
            </ol>
            <textarea value={beatText} onChange={(e) => setBeatText(e.target.value)} rows={6} style={{ width: "100%", marginTop: 10, fontSize: 12 }} />
          </div>
          <div style={box}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>Source events (what the lesson transcript would store):</div>
            <pre style={{ fontSize: 11.5, margin: 0, whiteSpace: "pre-wrap" }} data-testid="sources-events">
              {events.map((e) => `${(e.t / 1000).toFixed(1)} s  ${JSON.stringify(e)}`).join("\n") || "—"}
            </pre>
          </div>
        </section>
        <section style={{ ...box, background: "var(--paper)", minHeight: 200 }}>
          {run && (
            <SourceCards
              key={run.n}
              layout="inline"
              question={run.question}
              title={run.question}
              beats={beats}
              currentBeatId={current}
              fresh={run.fresh}
              fixture={fixture}
              onRecord={setRec}
              onEvent={(e) => setEvents((list) => [...list, { ...e, t: Math.round(performance.now() - t0) }])}
            />
          )}
        </section>
      </div>
    </main>
  );
}
