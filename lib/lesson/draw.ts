/**
 * Draws one beat from the planner's layout alone (no board state), so every
 * beat of a lesson can be drawn in parallel the moment it is planned. Returns
 * scene-language elements; the browser compiles the scene's beats into one
 * Clayzo document. One attempt, a hard deadline, no repair turn: a beat that
 * fails just plays with the board as it was.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import { DRAW_SYSTEM, drawPrompt, PRESET_SCHEMA } from "./language";
import { cleanId } from "./planner";
import { PRESET_KINDS, type PresetElement } from "./presets";
import type { PlannedBeat } from "./types";

const MODEL = process.env.DRAW_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = Number(process.env.DRAW_TIMEOUT_MS) || 20000;
const KINDS = new Set<string>(PRESET_KINDS);
const EDIT_KINDS = new Set(["highlight", "dim"]);

export interface DrawResult {
  elements: PresetElement[];
  ms: number;
  model: string;
  outputTokens: number;
  error: string | null;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Keeps what the compiler can use; drops the rest instead of retrying. */
function cleanElements(raw: unknown, pointOnly: boolean): PresetElement[] {
  const list = Array.isArray((raw as { elements?: unknown })?.elements) ? ((raw as { elements: unknown[] }).elements) : [];
  const out: PresetElement[] = [];
  for (const item of list) {
    const e = item as Record<string, unknown>;
    const kind = String(e.kind ?? "");
    if (!KINDS.has(kind)) continue;
    if (pointOnly && !EDIT_KINDS.has(kind)) continue;
    const id = cleanId(e.id) || `${kind}-${out.length + 1}`;
    out.push({
      id,
      kind,
      at: num(e.at, 0),
      dur: num(e.dur, 0.6),
      color: typeof e.color === "string" ? e.color : "ink",
      args: Array.isArray(e.args) ? e.args.map((a) => num(a, 0)) : [],
      text: typeof e.text === "string" ? e.text : "",
      refs: typeof e.refs === "string" ? e.refs.split(",").map(cleanId).filter(Boolean).join(",") : "",
    });
    if (out.length >= 14) break;
  }
  return out;
}

export async function drawBeat(question: string, beat: PlannedBeat, earlier: PlannedBeat[], signal?: AbortSignal, model = MODEL): Promise<DrawResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const message = await anthropic()
      .messages.stream(
        {
          model,
          max_tokens: 4000,
          system: DRAW_SYSTEM,
          messages: [{ role: "user", content: drawPrompt(question, beat, earlier) }],
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: { type: "json_schema", schema: PRESET_SCHEMA } },
        } as Anthropic.MessageStreamParams,
        { signal: abort },
      )
      .finalMessage();
    const outputTokens = message.usage.output_tokens;
    if (message.stop_reason === "refusal") return { elements: [], ms: ms(), model, outputTokens, error: "refusal" };
    if (message.stop_reason === "max_tokens") return { elements: [], ms: ms(), model, outputTokens, error: "cut off at max_tokens" };
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const elements = cleanElements(JSON.parse(text), beat.mode === "point");
    return { elements, ms: ms(), model, outputTokens, error: elements.length ? null : "no usable elements" };
  } catch (e) {
    const reason = deadline.aborted ? `deadline (${TIMEOUT_MS} ms)` : String((e as Error)?.message ?? e).slice(0, 300);
    return { elements: [], ms: ms(), model, outputTokens: 0, error: reason };
  }
}
