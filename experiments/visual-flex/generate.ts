/**
 * Runs the flexibility experiment: 8 beats x 4 levels x 2 models.
 *
 *   npx tsx experiments/visual-flex/generate.ts            # everything
 *   npx tsx experiments/visual-flex/generate.ts --only headphones
 *
 * Reads ANTHROPIC_API_KEY from the environment or .env.local. Writes
 * public/experiments/visual-flex/results.json and one document per generation.
 */
import Anthropic from "@anthropic-ai/sdk";
import { assertValidAnimationDocument, type AnimationDocument } from "@clayzo/animation/authoring";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BEATS, estimateVisualSeconds, type ExperimentBeat } from "./beats";
import { compileLevel1, compileLevel2, type Level2Spec } from "./primitives";
import { promptFor, type Level } from "./prompts";
import { compileLevel3, type SceneElement } from "./scene";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public/experiments/visual-flex");
const DOC_DIR = join(OUT_DIR, "docs");
const TMP_DIR = join(ROOT, "experiments/visual-flex/.tmp");
const MODELS = ["claude-opus-5-5", "claude-haiku-5-5"] as const;
const LEVELS: Level[] = [1, 2, 3, 4];
const CONCURRENCY = 4;
const L4_TIMEOUT_MS = 10_000;

if (!process.env.ANTHROPIC_API_KEY && existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
const client = new Anthropic();

interface Attempt {
  ttftMs: number | null;
  apiMs: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  error: string | null;
}

export interface Generation {
  beat: string;
  level: Level;
  model: string;
  visualSeconds: number;
  attempts: Attempt[];
  firstTryValid: boolean;
  finalValid: boolean;
  /** Request start to a validated document, including the repair turn. Null if never valid. */
  msToValid: number | null;
  totalMs: number;
  output: unknown;
  docFile: string | null;
  nodes: number | null;
}

// ---------- one model call ----------

async function call(model: string, level: Level, messages: Anthropic.MessageParam[], system: string, schema?: object) {
  const t0 = performance.now();
  let ttft: number | null = null;
  const stream = client.messages.stream({
    model,
    max_tokens: level === 4 ? 16000 : 6000,
    system,
    messages,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", ...(schema ? { format: { type: "json_schema", schema } } : {}) },
  } as Anthropic.MessageStreamParams);
  stream.on("text", () => {
    if (ttft === null) ttft = performance.now() - t0;
  });
  const message = await stream.finalMessage();
  const apiMs = performance.now() - t0;
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { message, text, ttft, apiMs };
}

// ---------- turning output into a document ----------

const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, clean(x)]));
  return v;
};

const LIST_PARAMS = new Set(["labels", "steps", "values", "children", "layers"]);
const NUMBER_LIST_PARAMS = new Set(["values", "layers"]);

/** Level 2 sends params as name/value string pairs; turn them into the primitives' params. */
function level2Spec(json: { layout: Level2Spec["layout"]; caption: string; items: { primitive: string; startsAt: number; params: { name: string; value: string }[] }[] }): Level2Spec {
  return {
    layout: json.layout,
    caption: json.caption || undefined,
    items: json.items.map((item) => ({
      primitive: item.primitive,
      startsAt: item.startsAt,
      params: Object.fromEntries(item.params.map(({ name, value }) => {
        if (LIST_PARAMS.has(name)) {
          const parts = value.split("|").map((s) => s.trim()).filter(Boolean);
          return [name, NUMBER_LIST_PARAMS.has(name) ? parts.map(Number) : parts];
        }
        const n = Number(value);
        return [name, value.trim() !== "" && Number.isFinite(n) ? n : value];
      })),
    })),
  };
}

/** Level 3 sends each element's numbers as `args` in a fixed order per kind. */
function level3Spec(json: { elements: { kind: string; at: number; dur: number; color: string; args: number[]; text: string }[] }) {
  return {
    elements: json.elements.map((e): SceneElement => {
      const a = e.args;
      const need = (n: number) => {
        if (a.length < n) throw new Error(`${e.kind} needs ${n} args, got ${a.length}`);
      };
      const common = { at: e.at, dur: e.dur, color: e.color };
      switch (e.kind) {
        case "line": {
          need(4);
          const points: [number, number][] = [];
          for (let i = 0; i + 1 < a.length; i += 2) points.push([a[i], a[i + 1]]);
          return { kind: "line", points, ...common };
        }
        case "plot":
          need(4);
          return { kind: "plot", fn: e.text, box: [a[0], a[1], a[2], a[3]], xRange: a.length >= 6 ? [a[4], a[5]] : undefined, ...common };
        case "circle":
          need(3);
          return { kind: "circle", cx: a[0], cy: a[1], r: a[2], filled: a[3] !== 0, ...common };
        case "rect":
          need(4);
          return { kind: "rect", x: a[0], y: a[1], w: a[2], h: a[3], filled: a[4] !== 0, ...common };
        case "arrow":
          need(4);
          return { kind: "arrow", from: [a[0], a[1]], to: [a[2], a[3]], ...common };
        case "bar":
          need(4);
          return { kind: "bar", x: a[0], baseline: a[1], w: a[2], h: a[3], ...common };
        case "move":
          need(4);
          return { kind: "move", from: [a[0], a[1]], to: [a[2], a[3]], r: a[4], ...common };
        case "text":
          need(2);
          return { kind: "text", x: a[0], y: a[1], size: a[2], text: e.text, ...common };
        default:
          throw new Error(`unknown element kind "${e.kind}"`);
      }
    }),
  };
}

const ALLOWED_IMPORT = "@clayzo/animation/authoring";
const FORBIDDEN = /\brequire\s*\(|\bprocess\s*\.|\bglobalThis\b|\beval\s*\(|\bnew\s+Function\b|\bfetch\s*\(|\bimport\s*\(|child_process|XMLHttpRequest|WebSocket/;

function extractCode(text: string): string {
  const m = text.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (!m) throw new Error("no ```ts code block found in the answer");
  const code = m[1];
  for (const imp of code.matchAll(/^\s*import[^;]*?from\s*["']([^"']+)["']/gm)) {
    if (imp[1] !== ALLOWED_IMPORT) throw new Error(`import from "${imp[1]}" is not allowed; import only from "${ALLOWED_IMPORT}"`);
  }
  const bad = code.match(FORBIDDEN);
  if (bad) throw new Error(`the code uses "${bad[0]}", which is not allowed`);
  return code;
}

function runLevel4(code: string, id: string): Promise<AnimationDocument> {
  mkdirSync(TMP_DIR, { recursive: true });
  const file = join(TMP_DIR, `${id}.ts`);
  writeFileSync(file, code);
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", join(ROOT, "experiments/visual-flex/run-l4.ts"), file],
      { cwd: ROOT, timeout: L4_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } as unknown as NodeJS.ProcessEnv },
      (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => {
        if (error) {
          const detail = (stderr || error.message).split("\n").filter((l: string) => l.trim() && !l.includes("node:internal")).slice(0, 12).join("\n");
          return reject(new Error(error.killed ? `timed out after ${L4_TIMEOUT_MS} ms` : detail));
        }
        try {
          resolve(JSON.parse(stdout) as AnimationDocument);
        } catch {
          reject(new Error("the module did not default-export a JSON-serializable document"));
        }
      },
    );
  });
}

async function toDocument(level: Level, text: string, id: string): Promise<{ doc: AnimationDocument; output: unknown }> {
  if (level === 4) {
    const code = extractCode(text);
    const doc = await runLevel4(code, id);
    if (!doc || typeof doc !== "object") throw new Error("default export is not a document");
    assertValidAnimationDocument(doc);
    return { doc, output: code };
  }
  const json = clean(JSON.parse(text)) as Record<string, unknown>;
  if (level === 1) return { doc: compileLevel1(String(json.primitive), id), output: json };
  if (level === 2) return { doc: compileLevel2(level2Spec(json as unknown as Parameters<typeof level2Spec>[0]), id), output: json };
  return { doc: compileLevel3(level3Spec(json as unknown as Parameters<typeof level3Spec>[0]), id), output: json };
}

// ---------- one generation, with one repair turn ----------

async function generate(beat: ExperimentBeat, level: Level, model: string): Promise<Generation> {
  const id = `${beat.id}-L${level}-${model.replace("claude-", "")}`;
  const prompt = promptFor(level, beat);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt.user }];
  const attempts: Attempt[] = [];
  const t0 = performance.now();
  let output: unknown = null;
  let doc: AnimationDocument | null = null;
  let firstTryValid = false;

  for (let turn = 0; turn < 2 && !doc; turn++) {
    const r = await call(model, level, messages, prompt.system, prompt.schema);
    const attempt: Attempt = {
      ttftMs: r.ttft === null ? null : Math.round(r.ttft),
      apiMs: Math.round(r.apiMs),
      inputTokens: r.message.usage.input_tokens,
      outputTokens: r.message.usage.output_tokens,
      stopReason: r.message.stop_reason,
      error: null,
    };
    attempts.push(attempt);
    if (r.message.stop_reason === "refusal") {
      attempt.error = `refusal: ${JSON.stringify((r.message as { stop_details?: unknown }).stop_details ?? null)}`;
      break;
    }
    try {
      if (r.message.stop_reason === "max_tokens") throw new Error("output was cut off at max_tokens");
      const built = await toDocument(level, r.text, id);
      doc = built.doc;
      output = built.output;
      if (turn === 0) firstTryValid = true;
    } catch (e) {
      // Local paths would leak into the public results file.
      attempt.error = String((e as Error).message ?? e).split(ROOT).join("<repo>").split(ROOT.replace(/\\/g, "/")).join("<repo>").slice(0, 1500);
      output = level === 4 ? r.text : r.text.slice(0, 20000);
      messages.push({ role: "assistant", content: r.message.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: "user", content: `That failed with this error:\n${attempt.error}\n\nFix it and answer again in the same format.` });
    }
  }
  const totalMs = Math.round(performance.now() - t0);
  let docFile: string | null = null;
  if (doc) {
    docFile = `docs/${id}.json`;
    writeFileSync(join(OUT_DIR, docFile), JSON.stringify(doc));
  }
  const nodes = doc ? Object.keys(doc.compositions[doc.rootCompositionId].nodes).length : null;
  const g: Generation = {
    beat: beat.id, level, model, visualSeconds: estimateVisualSeconds(beat), attempts, firstTryValid,
    finalValid: !!doc, msToValid: doc ? totalMs : null, totalMs, output, docFile, nodes,
  };
  console.log(`${id.padEnd(40)} ${doc ? "valid" : "INVALID"}${firstTryValid ? "" : " (after repair)"} ${totalMs} ms, ${attempts.map((a) => a.outputTokens).join("+")} out tokens${attempts.some((a) => a.error) ? `\n    ${attempts.map((a) => a.error).filter(Boolean).join("\n    ").slice(0, 300)}` : ""}`);
  return g;
}

// ---------- main ----------

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function main() {
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const beats = only ? BEATS.filter((b) => b.id === only) : BEATS;
mkdirSync(DOC_DIR, { recursive: true });

// Each JSON schema is compiled once per model on first use (cached 24 h), so warm them up untimed.
console.log("warming up schemas...");
const warmup: Record<string, number> = {};
await Promise.all(MODELS.flatMap((model) => ([1, 2, 3] as Level[]).map(async (level) => {
  const p = promptFor(level, BEATS[0]);
  const t = performance.now();
  await call(model, level, [{ role: "user", content: p.user }], p.system, p.schema).catch((e) => console.warn("warmup failed", model, level, String(e)));
  warmup[`${model} L${level}`] = Math.round(performance.now() - t);
})));
console.log(warmup);

const jobs = beats.flatMap((beat) => LEVELS.flatMap((level) => MODELS.map((model) => ({ beat, level, model }))));
const started = new Date().toISOString();
const generations = await pool(jobs, CONCURRENCY, ({ beat, level, model }) =>
  generate(beat, level, model).catch((e): Generation => {
    console.error(beat.id, level, model, "crashed:", e);
    return { beat: beat.id, level, model, visualSeconds: estimateVisualSeconds(beat), attempts: [], firstTryValid: false, finalValid: false, msToValid: null, totalMs: 0, output: String(e), docFile: null, nodes: null };
  }),
);

const file = join(OUT_DIR, "results.json");
const previous = only && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).generations as Generation[]).filter((g) => g.beat !== only) : [];
writeFileSync(file, JSON.stringify({
  started, finished: new Date().toISOString(), models: MODELS, effort: "low", concurrency: CONCURRENCY,
  schemaWarmupMs: warmup, beats: BEATS, generations: [...previous, ...generations],
}, null, 2));
console.log(`wrote ${generations.length} generations to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
