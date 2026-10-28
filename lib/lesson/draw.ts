/**
 * Draws one beat from the planner's layout alone (no board state), so every
 * beat of a lesson can be drawn in parallel the moment it is planned. Returns
 * scene-language elements, scaled into the beat's region; the browser compiles
 * the scene's beats into one Clayzo document.
 *
 * Beat 1 is drawn by the fast model (it has to be on the board within seconds); later
 * beats by the mid model (the strongest in slow mode), whose boards read more cleanly, with a hard deadline
 * and a fast-model fallback instead of a repair turn. A beat that still fails just plays with the board as
 * it was. Models per role: lib/lesson/provider.ts. Parallel draws are capped per provider (DRAW_CONCURRENCY).
 *
 * Draw modes (lib/lesson/language.ts DrawMode): fast draws every beat from presets and freehand; slow
 * makes about FREE_SHARE of beats (never the first) free, allowed one new block as well, which is kept
 * in a local file (lib/blocks/learned.ts) for later lessons; the Moss index stays the catalog alone.
 */
import "server-only";
import { asBlock } from "@/lib/blocks/swap";
import { modelFor as roleModel, providerOf, streamModel, type Provider } from "./provider";
import { DRAW_SYSTEM, drawPrompt, FREE_SCHEMA, PRESET_SCHEMA, type DrawMode } from "./language";
import { cleanId } from "./planner";
import { fitToRegion, PRESET_KINDS, type PresetElement } from "./presets";
import type { CallLog, PlannedBeat } from "./types";
import { blockById, isLearned, registerBlocks, type Block } from "@/lib/blocks";
import { cleanNewBlock } from "@/lib/blocks/learn";
import { blocksForBeat } from "@/lib/retrieval/blocks";
import { loadLearned, saveLearned } from "@/lib/blocks/learned";

const FAST_MODEL = roleModel("draw-fast");
const MODEL = roleModel("draw");
/** Slow mode draws its beats (all but the first) with the strongest model: the free beats author new blocks. */
const SLOW_MODEL = roleModel("draw-slow");

/**
 * Parallel draws per provider: a new OpenAI account is low-tier, so at most OPENAI_DRAW_CONCURRENCY (default 4)
 * at once; Anthropic is uncapped unless ANTHROPIC_DRAW_CONCURRENCY says otherwise. A held call waits for a
 * slot (logged), and its deadline starts once it has one. 429s still go through the SDK's retry and backoff.
 */
const DRAW_CAP: Record<Provider, number> = {
  openai: Number(process.env.OPENAI_DRAW_CONCURRENCY) || 4,
  anthropic: Number(process.env.ANTHROPIC_DRAW_CONCURRENCY) || 0,
};
const drawing: Record<Provider, number> = { openai: 0, anthropic: 0 };
const waiting: Record<Provider, (() => void)[]> = { openai: [], anthropic: [] };
async function drawSlot(provider: Provider, beatId: string): Promise<{ release: () => void; queuedMs: number }> {
  const cap = DRAW_CAP[provider];
  const t0 = performance.now();
  if (cap > 0 && drawing[provider] >= cap) {
    console.info(`[draw] ${beatId}: ${provider} cap of ${cap} parallel draws reached, waiting for a slot`);
    await new Promise<void>((r) => waiting[provider].push(r));
  }
  drawing[provider]++;
  let released = false;
  return {
    queuedMs: Math.round(performance.now() - t0),
    release: () => {
      if (released) return;
      released = true;
      drawing[provider]--;
      waiting[provider].shift()?.();
    },
  };
}
const TIMEOUT_MS = Number(process.env.DRAW_TIMEOUT_MS) || 20000;
/** Opus is slower, and slow mode's beats are drawn well ahead of when they play. */
const SLOW_TIMEOUT_MS = Number(process.env.DRAW_SLOW_TIMEOUT_MS) || 40000;
const FALLBACK_TIMEOUT_MS = 12000;
/** Slow mode: the share of beats drawn free (the rest from presets, as in fast mode). */
const FREE_SHARE = Number(process.env.CHALKY_FREE_SHARE) || 0.2;
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
  /** Circles or boxes labelled with a block's name that were swapped for that block. */
  swapped: number;
  error: string | null;
  /** Each model call made (a fallback adds a second). */
  calls?: CallLog[];
  /** The blocks the prompt listed (Moss's pick, or the keyword fallback's). */
  blockIds?: string[];
  /** A slow-mode free beat (freehand kinds and one new block allowed). */
  free?: boolean;
  /** Ids of blocks this beat authored and kept. */
  learned?: string[];
  /** Learned blocks its elements place (new or from earlier lessons): the browser registers them to render them. */
  blocks?: Block[];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The model for a beat: the lesson's first drawing can't wait for Sonnet (or Opus); slow mode draws the rest with Opus. */
export function modelFor(beat: PlannedBeat, mode: DrawMode = "fast"): string {
  return beat.id === "b1" ? FAST_MODEL : mode === "slow" ? SLOW_MODEL : MODEL;
}

/**
 * Keeps what the compiler can use and drops the rest instead of retrying. A
 * ref must name an id the planner declared (this beat's or an earlier one's),
 * or an element earlier in this answer; the compiler would only report it as
 * dangling otherwise.
 */
function cleanElements(raw: unknown, beat: PlannedBeat, earlier: PlannedBeat[], free = false): { elements: PresetElement[]; dropped: number; swapped: number } {
  const pointOnly = beat.mode === "point";
  const list = Array.isArray((raw as { elements?: unknown })?.elements) ? (raw as { elements: unknown[] }).elements : [];
  const known = new Set<string>([...earlier.flatMap((b) => b.adds.map((a) => a.id)), ...beat.adds.map((a) => a.id)]);
  const parts = new Set<string>();
  // "<id>.<part>": a flow or cycle's numbered step, or a block's part or anchor (lib/blocks).
  const knows = (id: string) => known.has(id) || parts.has(id.split(".")[0]) || (id.includes(".") && known.has(id.split(".")[0]));
  const out: PresetElement[] = [];
  let dropped = 0;
  let swapped = 0;
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
    const element: PresetElement = {
      id,
      kind,
      at: num(e.at, 0),
      dur: num(e.dur, 0.6),
      color: typeof e.color === "string" ? e.color : "ink",
      args: Array.isArray(e.args) ? e.args.map((a) => num(a, 0)) : [],
      text: typeof e.text === "string" ? e.text : "",
      refs: refs.join(","),
    };
    const swap = asBlock(element);
    if (swap) swapped++;
    out.push(...(swap ?? [element]));
    known.add(id);
    if (WITH_PARTS.has(kind)) parts.add(id);
    if (out.length >= 14) break;
  }
  return { elements: pointOnly ? out : fitToRegion(out, beat.region), dropped, swapped };
}

async function attempt(question: string, beat: PlannedBeat, earlier: PlannedBeat[], model: string, timeoutMs: number, signal?: AbortSignal, blocks: Block[] = [], free = false): Promise<DrawResult> {
  const slot = await drawSlot(providerOf(model), beat.id);
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const deadline = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const stream = streamModel({
    name: "draw",
    model,
    system: DRAW_SYSTEM,
    messages: [{ role: "user", content: drawPrompt(question, beat, earlier, blocks, free) }],
    // A new block's line art is long.
    maxTokens: free ? 10000 : 4000,
    effort: "low",
    schema: free ? FREE_SCHEMA : PRESET_SCHEMA,
    signal: abort,
  });
  if (slot.queuedMs) stream.log.queuedMs = slot.queuedMs;
  const done = () => (stream.log.totalMs === null ? stream.fail(null) : stream.log);
  const fail = (error: string, outputTokens = 0): DrawResult => {
    const call = stream.log.totalMs === null ? stream.fail(error) : stream.log;
    call.error ??= error;
    return { elements: [], ms: ms(), model, outputTokens, dropped: 0, swapped: 0, error, calls: [call] };
  };
  try {
    const message = await stream.result();
    const outputTokens = message.usage.output;
    if (message.stop === "refusal") return fail("refusal", outputTokens);
    if (message.stop === "max_tokens") return fail("cut off at max_tokens", outputTokens);
    const text = message.text;
    const parsed = JSON.parse(text) as { elements?: unknown; newBlocks?: unknown };
    // A free beat's new block is registered before its elements are fitted (fitToRegion sizes blocks by id).
    const fresh = free && Array.isArray(parsed.newBlocks) ? parsed.newBlocks.slice(0, 1).map(cleanNewBlock).filter((b): b is Block => !!b) : [];
    if (free && Array.isArray(parsed.newBlocks) && parsed.newBlocks.length && !fresh.length) console.log(`[draw] ${beat.id}: new block dropped (unusable, or its id is taken) (${model})`);
    registerBlocks(fresh);
    const { elements, dropped, swapped } = cleanElements(parsed, beat, earlier, free);
    if (swapped) console.log(`[draw] ${beat.id}: ${swapped} shape(s) labelled with a block's name swapped for the block (${model})`);
    const placed = new Set(elements.flatMap((e) => (e.kind === "block" || e.kind === "travel" ? [blockById(e.text.trim())?.id] : [])).filter(Boolean));
    // Kept only once a lesson actually draws it.
    const learned = fresh.filter((b) => placed.has(b.id) && saveLearned(b)).map((b) => b.id);
    const learnedUsed = [...placed].flatMap((id) => (id && isLearned(id) ? [blockById(id)!] : []));
    return { elements, ms: ms(), model, outputTokens, dropped, swapped, free, learned, blocks: learnedUsed, error: elements.length ? null : "no usable elements", calls: [done()] };
  } catch (e) {
    return fail(deadline.aborted ? `deadline (${timeoutMs} ms)` : String((e as Error)?.message ?? e).slice(0, 300));
  } finally {
    slot.release();
  }
}

/** Whether a beat is drawn free: slow mode, a drawing beat that isn't the lesson's first, about FREE_SHARE of the time. */
export function isFreeBeat(beat: PlannedBeat, mode: DrawMode): boolean {
  return mode === "slow" && beat.mode !== "point" && beat.id !== "b1" && Math.random() < FREE_SHARE;
}

export async function drawBeat(question: string, beat: PlannedBeat, earlier: PlannedBeat[], signal?: AbortSignal, model?: string, mode: DrawMode = "fast", forceFree = false): Promise<DrawResult> {
  model ??= modelFor(beat, mode);
  // Learned blocks join the catalog before Moss (or the keyword fallback) picks what this beat's prompt lists.
  await loadLearned();
  const { blocks } = await blocksForBeat(beat);
  const blockIds = blocks?.map((b) => b.id);
  const free = (forceFree && beat.mode !== "point") || isFreeBeat(beat, mode);
  if (free) console.log(`[draw] ${beat.id}: free beat (slow mode)`);
  const first = { ...(await attempt(question, beat, earlier, model, model === SLOW_MODEL ? SLOW_TIMEOUT_MS : TIMEOUT_MS, signal, blocks, free)), blockIds };
  if (first.elements.length || model === FAST_MODEL || signal?.aborted) return first;
  // Sonnet (or Opus) missed its deadline or came back unusable: one quick Haiku try (from presets) before giving up.
  const second = await attempt(question, beat, earlier, FAST_MODEL, FALLBACK_TIMEOUT_MS, signal, blocks);
  return { ...second, blockIds, ms: first.ms + second.ms, calls: [...(first.calls ?? []), ...(second.calls ?? [])], error: second.error ? `${first.error}; fallback: ${second.error}` : `${first.model} failed (${first.error}), fell back to ${FAST_MODEL}` };
}
