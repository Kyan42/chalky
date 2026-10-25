/**
 * Moss picks the blocks the drawer sees. One Moss index holds the block catalog (one document per
 * block); each server process loads it once and queries it locally with a beat's visual brief, so
 * the drawer prompt lists the few blocks that fit instead of the whole catalog.
 *
 * Env: MOSS_PROJECT_ID and MOSS_PROJECT_KEY (portal.usemoss.dev); CHALKY_BLOCK_RETRIEVAL=moss|all
 * (default moss when the keys are set); MOSS_BLOCK_INDEX (default "chalky-blocks"). Without keys,
 * or when Moss is still loading, slow or failing, a beat gets keywordBlocks() instead: the catalog is
 * about 300 blocks, too big to list whole.
 *
 * No "server-only" here: scripts/moss-build-blocks.ts and scripts/test-moss-blocks.ts import it
 * under tsx. The index is built by `npx tsx --env-file=.env.local scripts/moss-build-blocks.ts`.
 */
import { MossClient, type DocumentInfo } from "@moss-js/moss";
import { BLOCKS, blockById, type Block } from "@/lib/blocks";
import { foldNumbered, keywordBlocks } from "@/lib/blocks/catalog";
import type { PlannedBeat } from "@/lib/lesson/types";

export const BLOCK_INDEX = process.env.MOSS_BLOCK_INDEX || "chalky-blocks";
/** Embedding model the index is built with: moss-minilm (fast) or moss-mediumlm (more accurate). */
export const BLOCK_MODEL = process.env.MOSS_BLOCK_MODEL || "moss-minilm";
/**
 * How long a beat being drawn waits for its Moss pick before taking the keyword match. A query takes
 * 5-7 ms alone and 17-90 ms with six at once inside the server, but anything that blocks the event loop
 * (a dev-server compile, a big JSON parse) delays it and its timer together: 150 ms lost most beats of
 * a live lesson. Most beats don't wait at all: prefetchBlocks() starts the query when the planner
 * emits the beat, seconds before it is drawn, with the longer PREFETCH_BUDGET_MS.
 */
export const QUERY_BUDGET_MS = Number(process.env.MOSS_BLOCK_BUDGET_MS) || 400;
const PREFETCH_BUDGET_MS = 3000;
/**
 * Hybrid weight, 1 = all semantic, 0 = all keyword (Moss default 0.8). Briefs name their things
 * literally ("carbon dioxide", "sugar"), so more keyword weight helps: at 0.8 the ten briefs in
 * scripts/test-moss-blocks.ts put h2o 5th; at 0.5 every expected block is in the top 3.
 */
const QUERY_ALPHA = Number(process.env.MOSS_BLOCK_ALPHA) || 0.5;
/** How many retrieved blocks a drawn beat sees (plus any named by id in its adds). */
const BEAT_K = Number(process.env.CHALKY_BLOCK_K) || 5;
/** How many keyword matches join Moss's pick (lib/blocks/catalog.ts keywordBlocks). */
const KEYWORD_K = 3;

export type RetrievalMode = "moss" | "all";
export type BlockHit = { id: string; score: number };
export type Retrieval =
  | { status: "ok"; hits: BlockHit[]; ms: number; mossMs?: number }
  | { status: "off" | "no-key" | "loading" | "error"; hits: null; ms: number; error?: string };

export const hasMossKeys = () => Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY);

/** "all" when asked for, or when there are no keys; otherwise "moss". */
export function retrievalMode(): RetrievalMode {
  return process.env.CHALKY_BLOCK_RETRIEVAL === "all" || !hasMossKeys() ? "all" : "moss";
}

const STANDARD_ANCHORS = new Set(["center", "top", "bottom", "left", "right"]);

/**
 * The text Moss embeds for a block: its title and topic words first, then what it is, its parts and
 * anchor names, with numbered runs folded ("cell 1-1…cell 7-18") so a block with 118 parts is
 * still about its title.
 */
export function blockDoc(b: Block): DocumentInfo {
  const parts = foldNumbered([...new Set(b.parts.map((p) => p.label))]);
  const anchors = foldNumbered(Object.keys(b.anchors).filter((a) => !STANDARD_ANCHORS.has(a)));
  return {
    id: b.id,
    text: `${b.title}. About: ${b.tags.join(", ")}. ${b.describe}. Parts: ${parts}.${anchors ? ` Anchors: ${anchors}.` : ""}`,
    metadata: { blockId: b.id, title: b.title },
  };
}

export const blockDocs = (): DocumentInfo[] => BLOCKS.map(blockDoc);

type MossState = { client: MossClient; ready: Promise<void>; loaded: boolean; loadMs: number | null; error: string | null };
const g = globalThis as typeof globalThis & { __chalkyMoss?: MossState };

/** The Moss client with the block index loading or loaded: one per server process (and per dev hot reload). */
export function mossState(): MossState | null {
  if (!hasMossKeys()) return null;
  if (g.__chalkyMoss) return g.__chalkyMoss;
  const client = new MossClient(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!);
  const t0 = performance.now();
  const state: MossState = { client, ready: Promise.resolve(), loaded: false, loadMs: null, error: null };
  state.ready = client
    .loadIndex(BLOCK_INDEX, { autoRefresh: true, pollingIntervalInSeconds: 300 })
    .then(() => {
      state.loaded = true;
      state.loadMs = Math.round(performance.now() - t0);
      console.log(`[moss] loaded index "${BLOCK_INDEX}" in ${state.loadMs} ms`);
    })
    .catch((e) => {
      state.error = String((e as Error)?.message ?? e).slice(0, 300);
      console.warn(`[moss] could not load index "${BLOCK_INDEX}": ${state.error}`);
      // Try again a minute later rather than staying broken for the life of the process.
      setTimeout(() => g.__chalkyMoss === state && (g.__chalkyMoss = undefined), 60_000).unref?.();
    });
  g.__chalkyMoss = state;
  return state;
}

/** Starts loading the index if retrieval is on, so the first beat doesn't pay for it. */
export function warmBlockIndex(): void {
  if (retrievalMode() === "moss") mossState();
}

/**
 * The k blocks whose catalog entries best match `query`, best first, with Moss scores. Never waits
 * on a load unless `waitForLoad` (scripts); a live beat just falls back while the index loads.
 */
export async function relevantBlocks(query: string, k = 4, opts: { waitForLoad?: boolean; force?: boolean; budgetMs?: number } = {}): Promise<Retrieval> {
  if (!hasMossKeys()) return { status: "no-key", hits: null, ms: 0 };
  if (!opts.force && retrievalMode() === "all") return { status: "off", hits: null, ms: 0 };
  const state = mossState()!;
  if (opts.waitForLoad) await state.ready;
  // Timed from here: the query, not the one-off index load.
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 10) / 10;
  if (state.error) return { status: "error", hits: null, ms: ms(), error: state.error };
  if (!state.loaded) return { status: "loading", hits: null, ms: ms() };
  const budgetMs = opts.budgetMs ?? QUERY_BUDGET_MS;
  try {
    const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs));
    const result = await Promise.race([state.client.query(BLOCK_INDEX, query, { topK: k, alpha: QUERY_ALPHA }), budget]);
    if (!result) return { status: "error", hits: null, ms: ms(), error: `over ${budgetMs} ms` };
    const hits = result.docs.filter((d) => blockById(d.id)).map((d) => ({ id: d.id, score: Math.round(d.score * 1000) / 1000 }));
    return { status: "ok", hits, ms: ms(), mossMs: result.timeTakenInMs };
  } catch (e) {
    return { status: "error", hits: null, ms: ms(), error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** What a beat asks Moss: the planned drawing plus what each new id is. */
export const beatQuery = (beat: Pick<PlannedBeat, "visual" | "adds">) => [beat.visual, ...beat.adds.map((a) => a.what)].filter(Boolean).join(". ");

/** Blocks a beat names outright: an add whose id is a block id, or starts with one ("co2-in", "neural-net-1"). */
export function namedBlocks(beat: Pick<PlannedBeat, "adds">): Block[] {
  return beat.adds.flatMap((a) => {
    const words = a.id.split(/[-_.]/);
    for (let n = words.length; n > 0; n--) {
      const b = blockById(words.slice(0, n).join("-"));
      if (b) return [b];
    }
    return [];
  });
}

type BeatBlocks = { blocks: Block[]; retrieval: Retrieval; prefetched?: boolean };

/**
 * Moss rankings started when a beat was planned. Keyed by the beat's id and spoken line: the layout
 * pass (/api/layout) rewrites a later beat's adds before it is drawn, but not those, so the drawn
 * beat still finds its ranking; its block list is then built from the beat as drawn.
 */
const gp = globalThis as typeof globalThis & { __chalkyBlockPicks?: Map<string, Promise<Retrieval>>; __chalkyBlockStats?: Record<string, number> };
const picks = (gp.__chalkyBlockPicks ??= new Map());
const stats = (gp.__chalkyBlockStats ??= { beats: 0, moss: 0, prefetched: 0, keyword: 0 });
const pickKey = (beat: PlannedBeat) => `${beat.id}|${beat.say}`;

/** Starts a beat's Moss ranking as soon as it is planned (/api/plan, /api/amend), so its draw finds it done. */
export function prefetchBlocks(beat: PlannedBeat): void {
  if (beat.mode === "point" || retrievalMode() !== "moss") return;
  const key = pickKey(beat);
  if (picks.has(key)) return;
  if (picks.size >= 400) picks.delete(picks.keys().next().value!);
  const query = beatQuery(beat);
  const state = mossState();
  // Off the critical path, a beat planned while the index loads can wait for it (within the budget).
  const loaded = state && !state.loaded ? Promise.race([state.ready, new Promise((r) => setTimeout(r, PREFETCH_BUDGET_MS))]) : Promise.resolve();
  picks.set(key, loaded.then(() => relevantBlocks(query, BEAT_K, { budgetMs: PREFETCH_BUDGET_MS })));
}

/**
 * The few blocks one beat's drawer prompt lists: the ones its adds name, then Moss's best matches
 * and the top keyword matches, or just keyword matches when Moss is off, keyless, loading, failing or
 * over budget. The pick prefetchBlocks() started when the beat was planned, if any; a point beat adds
 * nothing, so it gets none. Logs the pick, its latency and the running Moss hit rate.
 */
export async function blocksForBeat(beat: PlannedBeat): Promise<BeatBlocks> {
  if (beat.mode === "point") return { blocks: [], retrieval: { status: "off", hits: null, ms: 0 } };
  const t0 = performance.now();
  const query = beatQuery(beat);
  const early = picks.get(pickKey(beat));
  const late = new Promise<null>((r) => setTimeout(() => r(null), QUERY_BUDGET_MS));
  let retrieval: Retrieval = early ? ((await Promise.race([early, late])) ?? { status: "error", hits: null, ms: QUERY_BUDGET_MS, error: "prefetch still running" }) : await relevantBlocks(query, BEAT_K);
  const prefetched = Boolean(early && retrieval.hits);
  // A prefetch that ran while the index was still loading: the index may be ready now.
  if (early && retrieval.status === "loading") retrieval = await relevantBlocks(query, BEAT_K);
  const blocks = retrieval.hits
    ? // Plus the keyword match's top few: an embedding can rank a literal "water molecules" below the
      // plant it is in (scripts/test-moss-blocks.ts), and a keyword match never does.
      [...new Set([...namedBlocks(beat), ...retrieval.hits.map((h) => blockById(h.id)!), ...keywordBlocks(query, KEYWORD_K)])]
    : [...new Set([...namedBlocks(beat), ...keywordBlocks(query, BEAT_K)])];
  const waited = Math.round(performance.now() - t0);
  stats.beats++;
  if (retrieval.hits) stats.moss++;
  else stats.keyword++;
  if (prefetched) stats.prefetched++;
  const rate = `moss ${stats.moss}/${stats.beats} beats, ${stats.prefetched} prefetched, budget ${QUERY_BUDGET_MS} ms`;
  if (retrieval.hits) console.log(`[moss] ${beat.id}: ${prefetched ? `prefetched (query ${retrieval.ms} ms), waited ${waited} ms` : `${retrieval.ms} ms`} -> ${blocks.map((b) => b.id).join(", ")} (${retrieval.hits.map((h) => `${h.id} ${h.score}`).join(", ")}) [${rate}]`);
  else {
    if (retrieval.status !== "off" && retrieval.status !== "no-key") console.warn(`[moss] ${beat.id}: ${retrieval.status}${retrieval.error ? ` (${retrieval.error})` : ""}; keyword match [${rate}]`);
    console.log(`[blocks] ${beat.id}: keywords -> ${blocks.map((b) => b.id).join(", ") || "none"}`);
  }
  return { blocks, retrieval, prefetched };
}
