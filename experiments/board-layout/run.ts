/**
 * Board-layout experiment: which way of generating the board's visuals looks good?
 *
 *   npm run dev       # in another terminal (for /api/plan and the baseline /api/visual)
 *   npx tsx experiments/board-layout/run.ts
 *
 * One plan per question (cached in public/experiments/board-compare/<slug>/plan.json), then:
 *   A  baseline: today's scene language and /api/visual, Haiku, sequential
 *   B  presets, sequential: v2 language, each beat sees the real board, Sonnet
 *   C  layout + parallel: one layout pass, then every beat drawn at once, Sonnet
 *   D  layout + parallel, Haiku drawers
 *   E  layout + parallel, Opus drawers (first question only)
 * Writes the board after the middle and last visual beats, timings and layout scores.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardBoxes, type BoardElement } from "@/lib/lesson/board";
import { compilePresetBoard, fitToRegion, scoreLayout, type Box, type PresetElement } from "@/lib/lesson/presets";
import type { PlannedBeat } from "@/lib/lesson/types";
import { LAYOUT_SCHEMA, layoutPrompt, parallelPrompt, PRESET_SCHEMA, SCENE_LAYOUT_SCHEMA, sceneLayoutPrompt, sequentialPrompt, SYSTEM, type LayoutBeat } from "./prompts";

process.loadEnvFile(".env.local");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "public/experiments/board-compare");
const QUESTIONS = ["What is photosynthesis?", "How do sewage systems work?", "How does a heat pump work?"];
const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
const BEAT_TIMEOUT_MS = 45_000;

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const post = (path: string, body: unknown) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function structured<T>(model: string, user: string, schema: object, system = SYSTEM): Promise<{ value: T; ms: number; out: number }> {
  const t0 = performance.now();
  const message = await client.messages
    .stream(
      {
        model, max_tokens: 8000, system, messages: [{ role: "user", content: user }], thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      } as Anthropic.MessageStreamParams,
      { signal: AbortSignal.timeout(BEAT_TIMEOUT_MS) },
    )
    .finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`stop_reason ${message.stop_reason}`);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { value: JSON.parse(text) as T, ms: Math.round(performance.now() - t0), out: message.usage.output_tokens };
}

async function plan(q: string): Promise<PlannedBeat[]> {
  const file = join(OUT, slug(q), "plan.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const text = await (await post("/api/plan", { question: q })).text();
  const beats = text.trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "beat").map((e) => e.beat as PlannedBeat);
  mkdirSync(join(OUT, slug(q)), { recursive: true });
  writeFileSync(file, JSON.stringify(beats, null, 2));
  return beats;
}

interface VariantResult {
  variant: string;
  model: string;
  /** Time from the plan to every beat's visual ready (sequential: the sum; parallel: layout + the slowest beat). */
  totalMs: number;
  beatMs: number[];
  failures: string[];
  score: ReturnType<typeof scoreLayout>;
  files: { mid: string; final: string };
}

/** Today's pipeline: /api/visual with the old scene language, beat after beat. */
async function baseline(q: string, beats: PlannedBeat[], dir: string, midIndex: number): Promise<VariantResult> {
  let board: BoardElement[] = [];
  const beatMs: number[] = [];
  const failures: string[] = [];
  let mid = "", final = "";
  const visual = beats.filter((b) => b.mode !== "talk");
  for (const [i, beat] of visual.entries()) {
    const t0 = Date.now();
    const r = await (await post("/api/visual", { question: q, beat, board, model: HAIKU })).json();
    beatMs.push(Date.now() - t0);
    if (!r.doc) {
      failures.push(`${beat.id}: ${r.attempts?.map((a: { error: string }) => a.error).join(" | ")}`);
      continue;
    }
    board = r.board;
    const file = `A-${beat.id}.json`;
    writeFileSync(join(dir, file), JSON.stringify(r.doc));
    if (i <= midIndex) mid = file;
    final = file;
  }
  return { variant: "A baseline", model: HAIKU, totalMs: beatMs.reduce((a, b) => a + b, 0), beatMs, failures, score: scoreLayout(boardBoxes(board)), files: { mid, final } };
}

function snapshot(dir: string, name: string, drawn: PresetElement[][], upTo: number) {
  const { doc, report } = compilePresetBoard(drawn.slice(0, upTo + 1), -1, name);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(doc));
  return { file: `${name}.json`, score: scoreLayout(report) };
}

/** Live layout of the real board, for the sequential preset variant's prompt. */
function describe(drawn: PresetElement[][]): string {
  if (!drawn.flat().length) return "The board is empty.";
  const { report } = compilePresetBoard(drawn, -1, "describe");
  const r = (b: Box) => `x ${Math.round((b.x1 / 1200) * 100)}..${Math.round((b.x2 / 1200) * 100)}, y ${Math.round((b.y1 / 800) * 100)}..${Math.round((b.y2 / 800) * 100)}`;
  const byId = new Map(drawn.flat().map((e) => [e.id, e]));
  const lines = report.shapes.filter((s) => !s.id.includes(".")).map((s) => `- ${s.id}: ${byId.get(s.id)?.kind ?? "part"}${byId.get(s.id)?.text ? ` "${byId.get(s.id)!.text}"` : ""}, spans ${r(s.box)}`);
  const cells = Array.from({ length: 10 }, () => Array<string>(10).fill("."));
  for (const b of [...report.shapes.map((s) => s.box), ...report.texts.map((t) => t.box)]) {
    for (let row = Math.max(0, Math.floor((b.y1 / 800) * 10)); row <= Math.min(9, Math.floor((b.y2 / 800) * 10)); row++)
      for (let c = Math.max(0, Math.floor((b.x1 / 1200) * 10)); c <= Math.min(9, Math.floor((b.x2 / 1200) * 10)); c++) cells[row][c] = "#";
  }
  return `Already on the board (labels included in the map):\n${lines.join("\n")}\n\nOccupied areas (# = used), columns x 0-10 ... 90-100:\n${cells.map((row, i) => `  y ${String(i * 10).padStart(2)}: ${row.join(" ")}`).join("\n")}`;
}

async function presetsSequential(q: string, beats: PlannedBeat[], dir: string, midIndex: number, model: string): Promise<VariantResult> {
  const visual = beats.filter((b) => b.mode !== "talk");
  const drawn: PresetElement[][] = [];
  const beatMs: number[] = [];
  const failures: string[] = [];
  for (const beat of visual) {
    const t0 = Date.now();
    try {
      const r = await structured<{ elements: PresetElement[] }>(model, sequentialPrompt(q, beat, describe(drawn)), PRESET_SCHEMA);
      drawn.push(r.value.elements);
    } catch (e) {
      failures.push(`${beat.id}: ${String(e).slice(0, 160)}`);
      drawn.push([]);
    }
    beatMs.push(Date.now() - t0);
  }
  const mid = snapshot(dir, "B-mid", drawn, midIndex);
  const final = snapshot(dir, "B-final", drawn, drawn.length - 1);
  return { variant: "B presets, sequential", model, totalMs: beatMs.reduce((a, b) => a + b, 0), beatMs, failures, score: final.score, files: { mid: mid.file, final: final.file } };
}

async function layoutParallel(q: string, beats: PlannedBeat[], dir: string, midIndex: number, model: string, tag: string, layout: { value: { beats: LayoutBeat[] }; ms: number }): Promise<VariantResult> {
  const visual = beats.filter((b) => b.mode !== "talk");
  const plans = visual.map((b) => layout.value.beats.find((l) => l.id === b.id) ?? { id: b.id, region: { x: 5, y: 5, w: 90, h: 90 }, introduces: [], refs: [] });
  const failures: string[] = [];
  const beatMs: number[] = [];
  const drawn = await Promise.all(visual.map(async (beat, i) => {
    const t0 = Date.now();
    try {
      const r = await structured<{ elements: PresetElement[] }>(model, parallelPrompt(q, beat, plans[i], plans.slice(0, i)), PRESET_SCHEMA);
      return r.value.elements;
    } catch (e) {
      failures.push(`${beat.id}: ${String(e).slice(0, 160)}`);
      return [];
    } finally {
      beatMs[i] = Date.now() - t0;
    }
  }));
  const mid = snapshot(dir, `${tag}-mid`, drawn, midIndex);
  const final = snapshot(dir, `${tag}-final`, drawn, drawn.length - 1);
  return { variant: `${tag} layout + parallel`, model, totalMs: layout.ms + Math.max(...beatMs), beatMs, failures, score: final.score, files: { mid: mid.file, final: final.file } };
}

/**
 * Round 2: scenes. The layout pass splits the lesson into scenes of at most four
 * drawings, each on a fresh board; every beat is drawn at once, then fitted into
 * its region. Writes one board per scene (as it looks when the scene ends).
 */
async function scenesParallel(q: string, beats: PlannedBeat[], dir: string, model: string, tag: string, layout: { value: { beats: LayoutBeat[] }; ms: number }) {
  const visual = beats.filter((b) => b.mode !== "talk");
  const plans = visual.map((b) => layout.value.beats.find((l) => l.id === b.id) ?? { id: b.id, scene: 1, region: { x: 5, y: 5, w: 90, h: 90 }, introduces: [], refs: [] });
  const failures: string[] = [];
  const beatMs: number[] = [];
  const drawn = await Promise.all(visual.map(async (beat, i) => {
    const t0 = Date.now();
    const sameScene = plans.slice(0, i).filter((p) => p.scene === plans[i].scene);
    try {
      const r = await structured<{ elements: PresetElement[] }>(model, parallelPrompt(q, beat, plans[i], sameScene), PRESET_SCHEMA);
      return beat.mode === "point" ? r.value.elements : fitToRegion(r.value.elements, plans[i].region);
    } catch (e) {
      failures.push(`${beat.id}: ${String(e).slice(0, 160)}`);
      return [];
    } finally {
      beatMs[i] = Date.now() - t0;
    }
  }));
  const scenes = [...new Set(plans.map((p) => p.scene ?? 1))].sort((a, b) => a - b);
  const files = scenes.map((scene) => {
    const inScene = drawn.filter((_, i) => (plans[i].scene ?? 1) === scene);
    const { doc } = compilePresetBoard(inScene, -1, `${tag}-scene${scene}`);
    writeFileSync(join(dir, `${tag}-scene${scene}.json`), JSON.stringify(doc));
    return `${tag}-scene${scene}.json`;
  });
  return { variant: `${tag} scenes + parallel`, model, totalMs: layout.ms + Math.max(...beatMs), beatMs, failures, scenes: plans.map((p) => `${p.id}:${p.scene}`).join(" "), files };
}

async function round2(only?: string) {
  await Promise.all(QUESTIONS.filter((q) => !only || slug(q).includes(only)).map(async (q) => {
    const dir = join(OUT, slug(q));
    const beats = await plan(q);
    const layout = await structured<{ beats: LayoutBeat[] }>(SONNET, sceneLayoutPrompt(q, beats), SCENE_LAYOUT_SCHEMA, "You plan whiteboard layouts. Answer with the requested JSON only.");
    console.log(`${slug(q)}: scene layout ${layout.ms} ms, scenes ${layout.value.beats.map((b) => `${b.id}:${b.scene}`).join(" ")}`);
    const variants = await Promise.all([
      scenesParallel(q, beats, dir, SONNET, "F", layout),
      scenesParallel(q, beats, dir, OPUS, "G", layout),
      scenesParallel(q, beats, dir, HAIKU, "H", layout),
    ]);
    for (const v of variants) console.log(`${slug(q)}: ${v.variant} (${v.model}) ready in ${v.totalMs} ms${v.failures.length ? `, failures: ${v.failures.join("; ")}` : ""}`);
    writeFileSync(join(dir, "results-round2.json"), JSON.stringify({ layout: layout.value.beats, layoutMs: layout.ms, variants }, null, 2));
  }));
}

async function main() {
  if (process.argv[2] === "round2") return round2(process.argv[3]);
  const only = process.argv[2];
  const results: Record<string, { beats: PlannedBeat[]; layoutMs?: number; layout?: LayoutBeat[]; variants: VariantResult[] }> = {};
  await Promise.all(QUESTIONS.filter((q) => !only || slug(q).includes(only)).map(async (q, qi) => {
    const dir = join(OUT, slug(q));
    mkdirSync(dir, { recursive: true });
    const beats = await plan(q);
    const midIndex = Math.floor(beats.filter((b) => b.mode !== "talk").length / 2) - 1;
    console.log(`${slug(q)}: ${beats.length} beats (${beats.map((b) => b.mode[0]).join("")}), mid snapshot after visual beat ${midIndex + 1}`);
    const layout = await structured<{ beats: LayoutBeat[] }>(SONNET, layoutPrompt(q, beats), LAYOUT_SCHEMA, "You plan whiteboard layouts. Answer with the requested JSON only.");
    console.log(`${slug(q)}: layout ${layout.ms} ms`);
    const jobs: Promise<VariantResult>[] = [
      baseline(q, beats, dir, midIndex),
      presetsSequential(q, beats, dir, midIndex, SONNET),
      layoutParallel(q, beats, dir, midIndex, SONNET, "C", layout),
      layoutParallel(q, beats, dir, midIndex, HAIKU, "D", layout),
    ];
    if (qi === 0) jobs.push(layoutParallel(q, beats, dir, midIndex, OPUS, "E", layout));
    const variants = await Promise.all(jobs.map((j) => j.then((r) => (console.log(`${slug(q)}: ${r.variant} (${r.model}) done in ${r.totalMs} ms, ${JSON.stringify(r.score)}${r.failures.length ? `, failures: ${r.failures.join("; ")}` : ""}`), r))));
    results[slug(q)] = { beats, layoutMs: layout.ms, layout: layout.value.beats, variants };
    writeFileSync(join(dir, "results.json"), JSON.stringify(results[slug(q)], null, 2));
  }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
