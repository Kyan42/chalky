/**
 * Draws one beat from the planner's layout alone (no board state), so every
 * beat of a lesson can be drawn in parallel the moment it is planned. Returns
 * scene-language elements, scaled into the beat's region; the browser compiles
 * the scene's beats into one Clayzo document.
 *
 * Beat 1 is drawn by Haiku (it has to be on the board within seconds); later
 * beats by Sonnet, whose boards read more cleanly, with a hard deadline and a
 * Haiku fallback instead of a repair turn. A beat that still fails just plays
 * with the board as it was.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { trackCall } from "./calllog";
import { DRAW_SYSTEM, drawPrompt, PRESET_SCHEMA } from "./language";
import { cleanId } from "./planner";
import { fitToRegion, PRESET_KINDS, type PresetElement } from "./presets";
import type { CallLog, PlannedBeat } from "./types";
import type { Block } from "@/lib/blocks";
import { blocksForBeat } from "@/lib/moss/blocks";

const FAST_MODEL = process.env.DRAW_FAST_MODEL || "claude-haiku-5-5";
const MODEL = process.env.DRAW_MODEL || "claude-sonnet-5-5";
const TIMEOUT_MS = Number(process.env.DRAW_TIMEOUT_MS) || 20000;
const FALLBACK_TIMEOUT_MS = 12000;
const KINDS = new Set<string>(PRESET_KINDS);
const EDIT_KINDS = new Set(["highlight", "dim"]);
/** How many ids each referring kind needs. */
const REFS_NEEDED: Record<string, number> = { connect: 2, rays: 2, label: 1, highlight: 1, dim: 1 };
/** Kinds that expose numbered parts (<id>.0, <id>.1, ...). */
const WITH_PARTS = new Set(["flow", "cycle"]);

export interface DrawResult {
  elements: PresetElement[];
  ms: number;
  model: string;
  outputTokens: number;
  /** Elements dropped because they referred to ids nobody declared or drew. */
  dropped: number;
  error: string | null;
  /** Each model call made (a fallback adds a second). */
  calls?: CallLog[];
  /** The blocks Moss listed in the prompt; absent when it listed the whole catalog. */
  blockIds?: string[];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The model for a beat: the lesson's first drawing can't wait for Sonnet. */
export function modelFor(beat: PlannedBeat): string {
  return beat.id === "b1" ? FAST_MODEL : MODEL;
}

/**
 * Keeps what the compiler can use and drops the rest instead of retrying. A
 * ref must name an id the planner declared (this beat's or an earlier one's),
 * or an element earlier in this answer; the compiler would only report it as
 * dangling otherwise.
 */
function cleanElements(raw: unknown, beat: PlannedBeat, earlier: PlannedBeat[]): { elements: PresetElement[]; dropped: number } {
  const pointOnly = beat.mode === "point";
  const list = Array.isArray((raw as { elements?: unknown })?.elements) ? (raw as { elements: unknown[] }).elements : [];
  const known = new Set<string>([...earlier.flatMap((b) => b.adds.map((a) => a.id)), ...beat.adds.map((a) => a.id)]);
  const parts = new Set<string>();
  // "<id>.<part>": a flow or cycle's numbered step, or a block's part or anchor (lib/blocks).
  const knows = (id: string) => known.has(id) || parts.has(id.split(".")[0]) || (id.includes(".") && known.has(id.split(".")[0]));
  const out: PresetElement[] = [];
  let dropped = 0;
  for (const item of list) {
    const e = item as Record<string, unknown>;
    const kind = String(e.kind ?? "");
    if (!KINDS.has(kind)) continue;
    if (pointOnly && !EDIT_KINDS.has(kind)) continue;
    const id = cleanId(e.id) || `${kind}-${out.length + 1}`;
    // Dots survive cleaning so "leaf.veins" stays a part ref.
    const refs = typeof e.refs === "string" ? e.refs.split(",").map((r) => r.split(".").map(cleanId).filter(Boolean).join(".")).filter(Boolean) : [];
    const needed = REFS_NEEDED[kind] ?? 0;
    if (needed && (refs.length < needed || refs.slice(0, needed).some((r) => !knows(r)))) {
      dropped++;
      continue;
    }
    out.push({
      id,
      kind,
      at: num(e.at, 0),
      dur: num(e.dur, 0.6),
      color: typeof e.color === "string" ? e.color : "ink",
      args: Array.isArray(e.args) ? e.args.map((a) => num(a, 0)) : [],
      text: typeof e.text === "string" ? e.text : "",
      refs: refs.join(","),
    });
    known.add(id);
    if (WITH_PARTS.has(kind)) parts.add(id);
    if (out.length >= 14) break;
  }
  return { elements: pointOnly ? out : fitToRegion(out, beat.region), dropped };
}

async function attempt(question: string, beat: PlannedBeat, earlier: PlannedBeat[], model: string, timeoutMs: number, signal?: AbortSignal, blocks?: Block[] | null): Promise<DrawResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const deadline = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const tracked = trackCall("draw", model);
  const fail = (error: string, outputTokens = 0): DrawResult => ({ elements: [], ms: ms(), model, outputTokens, dropped: 0, error, calls: [tracked.finish(error)] });
  try {
    const message = await tracked
      .watch(tracked.client.messages.stream(
        {
          model,
          max_tokens: 4000,
          system: DRAW_SYSTEM,
          messages: [{ role: "user", content: drawPrompt(question, beat, earlier, blocks) }],
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: { type: "json_schema", schema: PRESET_SCHEMA } },
        } as Anthropic.MessageStreamParams,
        { signal: abort },
      ))
      .finalMessage();
    const outputTokens = message.usage.output_tokens;
    if (message.stop_reason === "refusal") return fail("refusal", outputTokens);
    if (message.stop_reason === "max_tokens") return fail("cut off at max_tokens", outputTokens);
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const { elements, dropped } = cleanElements(JSON.parse(text), beat, earlier);
    return { elements, ms: ms(), model, outputTokens, dropped, error: elements.length ? null : "no usable elements", calls: [tracked.finish()] };
  } catch (e) {
    return fail(deadline.aborted ? `deadline (${timeoutMs} ms)` : String((e as Error)?.message ?? e).slice(0, 300));
  }
}

export async function drawBeat(question: string, beat: PlannedBeat, earlier: PlannedBeat[], signal?: AbortSignal, model = modelFor(beat)): Promise<DrawResult> {
  // Moss picks the catalog blocks this beat's prompt lists (null: all of them).
  const { blocks } = await blocksForBeat(beat);
  const blockIds = blocks?.map((b) => b.id);
  const first = { ...(await attempt(question, beat, earlier, model, TIMEOUT_MS, signal, blocks)), blockIds };
  if (first.elements.length || model === FAST_MODEL || signal?.aborted) return first;
  // Sonnet missed its deadline or came back unusable: one quick Haiku try before giving up.
  const second = await attempt(question, beat, earlier, FAST_MODEL, FALLBACK_TIMEOUT_MS, signal, blocks);
  return { ...second, blockIds, ms: first.ms + second.ms, calls: [...(first.calls ?? []), ...(second.calls ?? [])], error: second.error ? `${first.error}; fallback: ${second.error}` : `${first.model} failed (${first.error}), fell back to ${FAST_MODEL}` };
}
