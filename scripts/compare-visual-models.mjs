// Draws one planned lesson with several visual models and saves each board.
//
//   npm run dev        # in another terminal
//   node scripts/compare-visual-models.mjs "What is photosynthesis?"
//
// Plans the lesson once (POST /api/plan), then for each model runs every draw
// and point beat through POST /api/visual in order, carrying the board forward
// exactly as the lesson page does. Writes each beat's document and a summary to
// public/experiments/board-compare/ (served, so /experiments/board-view can render it).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const question = process.argv[2] ?? "What is photosynthesis?";
const MODELS = (process.env.MODELS ?? "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5").split(",");
const OUT = join(process.cwd(), "public/experiments/board-compare");
mkdirSync(OUT, { recursive: true });

const post = (path, body) => fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const res = await post("/api/plan", { question });
const beats = (await res.text()).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "beat").map((e) => e.beat);
console.log(`planned ${beats.length} beats: ${beats.map((b) => b.mode).join(", ")}`);

const summary = { question, beats, models: {} };
await Promise.all(MODELS.map(async (model) => {
  let board = [];
  const runs = [];
  for (const beat of beats) {
    if (beat.mode === "talk") continue;
    const t0 = Date.now();
    const r = await (await post("/api/visual", { question, beat, board, model })).json();
    const file = `${model}-${beat.id}.json`;
    if (r.doc) {
      writeFileSync(join(OUT, file), JSON.stringify(r.doc));
      board = r.board;
    }
    runs.push({ beat: beat.id, mode: beat.mode, ok: !!r.doc, ms: Date.now() - t0, attempts: r.attempts?.map((a) => ({ ms: a.ms, out: a.outputTokens, err: a.error?.slice(0, 160) })), edits: r.edits, onBoard: board.length, cleared: r.cleared, file: r.doc ? file : null });
    console.log(`${model.padEnd(18)} ${beat.id.padEnd(4)} ${beat.mode.padEnd(5)} ${r.doc ? "ok " : "FAIL"} ${String(Date.now() - t0).padStart(6)} ms  ${board.length} on board${r.attempts?.some((a) => a.error) ? `  (${r.attempts.map((a) => a.error).filter(Boolean).join(" | ").slice(0, 120)})` : ""}`);
  }
  summary.models[model] = runs;
}));
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`wrote ${OUT}`);
