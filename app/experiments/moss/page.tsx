"use client";

/**
 * Which blocks the retrieval engine hands the drawer: /experiments/moss
 *
 * Type a beat's visual brief; see the blocks the engine (local by default, Moss with
 * RETRIEVAL_ENGINE=moss) ranks for it with their scores and the query's latency, the keyword
 * fallback's pick for comparison, and the drawer prompt's block section.
 * Backed by POST /api/moss-blocks; lib/retrieval/blocks.ts does the work.
 */
import { useState } from "react";

type Hit = { id: string; title: string; score: number };
type Answer = {
  index: string;
  keys: boolean;
  mode: "local" | "moss" | "all";
  status: "ok" | "off" | "no-key" | "loading" | "error";
  error?: string;
  ms: number;
  engineMs?: number;
  loadMs: number | null;
  hits: Hit[];
  keywords: string[];
  after: string | null;
};

const EXAMPLES = [
  "Side view of a leaf; carbon dioxide molecules drift in through tiny holes on the underside.",
  "The sun shines on a plant; water comes up from the roots and sugar is made in the leaves.",
  "The powerhouse organelle that burns sugar with oxygen to release usable energy.",
  "A nerve cell passing a signal down its long axon.",
];

const box: React.CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, background: "#fff" };
const pre: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.45, margin: 0, maxHeight: 420, overflow: "auto" };

export default function MossBlocksPage() {
  const [brief, setBrief] = useState(EXAMPLES[0]);
  const [k, setK] = useState(4);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(text = brief) {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/moss-blocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: text, k }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setAnswer(json);
    } catch (e) {
      setFailure(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  // Moss ranks by its hybrid (semantic + keyword) match but reports the semantic score alone, so its
  // top hit need not have the highest score (the local engine reports the blend); bars scale to the largest.
  const top = Math.max(0.001, ...(answer?.hits ?? []).map((h) => h.score));
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#222", background: "#f6f6f3", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Block retrieval</h1>
      <p style={{ margin: "0 0 16px", color: "#555", fontSize: 14 }}>
        A beat&apos;s visual brief goes to the block index (local engine, or Moss with RETRIEVAL_ENGINE=moss); the drawer prompt lists only the blocks it returns.
      </p>

      <div style={{ ...box, display: "grid", gap: 8 }}>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} style={{ width: "100%", fontSize: 15, padding: 8, boxSizing: "border-box" }} aria-label="Beat brief" />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => run()} disabled={busy || !brief.trim()} style={{ padding: "6px 16px", fontSize: 15 }}>
            {busy ? "Searching..." : "Rank blocks"}
          </button>
          <label style={{ fontSize: 14 }}>
            top k <input type="number" min={1} max={15} value={k} onChange={(e) => setK(Number(e.target.value))} style={{ width: 48 }} />
          </label>
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setBrief(ex); run(ex); }} style={{ fontSize: 12, padding: "3px 8px" }} title={ex}>
              {ex.slice(0, 28)}...
            </button>
          ))}
        </div>
      </div>

      {failure && <p style={{ color: "#b00" }}>Request failed: {failure}</p>}

      {answer && (
        <>
          <Status answer={answer} />
          {answer.status === "ok" && (
            <div style={{ ...box, marginTop: 12 }}>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {answer.hits.map((h) => (
                  <li key={h.id} style={{ margin: "4px 0", fontSize: 15 }}>
                    <code>{h.id}</code> <span style={{ color: "#555" }}>{h.title}</span>{" "}
                    <span style={{ display: "inline-block", width: 160 * (h.score / top), height: 8, background: "#4a8", borderRadius: 4, marginLeft: 8 }} /> {h.score.toFixed(3)}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginTop: 12 }}>
            <div style={box}>
              <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Keyword fallback (used while the engine loads, or when retrieval is off)</h2>
              <pre style={pre}>{answer.keywords.join("\n") || "No keyword match."}</pre>
            </div>
            <div style={box}>
              <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Drawer prompt for the engine&apos;s pick {answer.after ? `(${answer.after.length} chars)` : ""}</h2>
              <pre style={pre}>{answer.after ?? "No engine result, so the drawer uses the keyword pick (left)."}</pre>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Status({ answer }: { answer: Answer }) {
  const line = (color: string, text: React.ReactNode) => <p style={{ ...box, marginTop: 12, borderColor: color, color }}>{text}</p>;
  switch (answer.status) {
    case "ok":
      return line("#2a6", <>Index <code>{answer.index}</code>: query {answer.ms} ms{answer.engineMs != null ? ` (Moss reports ${answer.engineMs} ms)` : ""}{answer.loadMs != null ? `; loaded in ${answer.loadMs} ms` : ""}. Live beats use retrieval: {answer.mode === "all" ? "no (CHALKY_BLOCK_RETRIEVAL=all)" : `yes (${answer.mode})`}.</>);
    case "no-key":
      return line("#b60", <>No Moss keys: MOSS_PROJECT_ID and MOSS_PROJECT_KEY are not set, so RETRIEVAL_ENGINE=moss can&apos;t be used. Unset RETRIEVAL_ENGINE for the local engine.</>);
    default:
      return line("#b00", <>Retrieval {answer.status}{answer.error ? `: ${answer.error}` : ""}. The drawer falls back to the keyword pick.</>);
  }
}
