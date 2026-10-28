/**
 * Picks the blocks the drawer sees. Each visual beat's brief is searched against the block catalog
 * (one document per block, lib/retrieval/docs.ts), so the drawer prompt lists the few blocks that fit
 * instead of all 300.
 *
 * Two engines behind the same functions (lib/retrieval/docs.ts retrievalEngine()):
 * - local (default): a sentence model in this process plus BM25, over vectors computed ahead by
 *   scripts/build-block-vectors.ts (lib/retrieval/local-blocks.ts). No vendor, no key.
 * - moss: the chalky-blocks Moss cloud index (lib/moss/blocks.ts), when RETRIEVAL_ENGINE=moss and both
 *   MOSS_* keys are set. Kept for comparison.
 * CHALKY_BLOCK_RETRIEVAL=all turns retrieval off. Whenever the engine is still loading, slow or failing,
 * a beat gets keywordBlocks() instead.
 *
 * No "server-only" here: scripts/build-block-vectors.ts and scripts/test-retrieval.ts import it under tsx.
 */
import { blockById, type Block } from "@/lib/blocks";
import { keywordBlocks } from "@/lib/blocks/catalog";
import type { PlannedBeat } from "@/lib/lesson/types";
import { mossBlockQuery, mossState } from "@/lib/moss/blocks";
import { retrievalEngine, type Engine } from "./docs";
import { embedderNow, loadEmbedder, modelError } from "./embed";
import { localBlockIndex } from "./local-blocks";

export { blockDoc, blockDocs, hasMossKeys, retrievalEngine } from "./docs";

/**
 * How long a beat being drawn waits for its pick before taking the keyword match. Anything that
 * blocks the event loop (a dev-server compile, a big JSON parse) delays a query and its timer
 * together, so most beats don't wait at all: prefetchBlocks() starts the query when the planner emits
 * the beat, seconds before it is drawn, with the longer PREFETCH_BUDGET_MS.
 */
export const QUERY_BUDGET_MS = Number(process.env.MOSS_BLOCK_BUDGET_MS) || 400;
const PREFETCH_BUDGET_MS = 3000;
/**
 * Hybrid weight, 1 = all semantic, 0 = all keyword. Briefs name their things literally ("carbon
 * dioxide", "sugar"), so a strong keyword half helps (scripts/test-retrieval.ts).
 */
const QUERY_ALPHA = Number(process.env.MOSS_BLOCK_ALPHA) || 0.5;
/** How many retrieved blocks a drawn beat sees (plus any named by id in its adds). */
const BEAT_K = Number(process.env.CHALKY_BLOCK_K) || 5;
/** How many keyword matches join the engine's pick (lib/blocks/catalog.ts keywordBlocks). */
const KEYWORD_K = 3;

export type RetrievalMode = Engine | "all";
export type BlockHit = { id: string; score: number };
export type Retrieval =
  | { status: "ok"; engine: Engine; hits: BlockHit[]; ms: number; engineMs?: number }
  | { status: "off" | "no-key" | "loading" | "error"; engine?: Engine; hits: null; ms: number; error?: string };

/** "all" (no retrieval) when CHALKY_BLOCK_RETRIEVAL=all; otherwise the engine. */
export function retrievalMode(): RetrievalMode {
  return process.env.CHALKY_BLOCK_RETRIEVAL === "all" ? "all" : retrievalEngine();
}

/** Starts loading what the engine needs (the model and block vectors, or the Moss index), so the first beat doesn't pay for it. */
export function warmBlockIndex(): void {
  const mode = retrievalMode();
  if (mode === "moss") mossState();
  else if (mode === "local") {
    localBlockIndex();
    loadEmbedder().catch(() => {});
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

async function localQuery(query: string, k: number, opts: { waitForLoad?: boolean; budgetMs?: number }): Promise<Retrieval> {
  const blocks = localBlockIndex();
  if (opts.waitForLoad) await Promise.all([loadEmbedder(), blocks.ready]).catch(() => {});
  const t0 = performance.now();
  const embed = embedderNow();
  if (modelError()) return { status: "error", engine: "local", hits: null, ms: 0, error: modelError()! };
  if (!embed) return { status: "loading", engine: "local", hits: null, ms: 0 };
  const budgetMs = opts.budgetMs ?? QUERY_BUDGET_MS;
  const budget = new Promise<null>((r) => setTimeout(() => r(null), budgetMs));
  const vector = await Promise.race([embed([query]).then((v) => v[0]), budget]);
  if (!vector) return { status: "error", engine: "local", hits: null, ms: round(performance.now() - t0), error: `over ${budgetMs} ms` };
  const hits = blocks.index.search(query, vector, k, QUERY_ALPHA).map((h) => ({ id: h.id, score: Math.round(h.score * 1000) / 1000 }));
  return { status: "ok", engine: "local", hits, ms: round(performance.now() - t0) };
}

/**
 * The k blocks whose catalog entries best match `query`, best first, with blended scores. Never waits
 * on a load unless `waitForLoad` (scripts); a live beat just falls back while the engine loads.
 * `engine` overrides the configured one (the fixture test compares them).
 */
export async function relevantBlocks(query: string, k = 4, opts: { waitForLoad?: boolean; force?: boolean; budgetMs?: number; engine?: Engine } = {}): Promise<Retrieval> {
  const mode = opts.engine ?? retrievalMode();
  if (mode === "all" && !opts.force) return { status: "off", hits: null, ms: 0 };
  const engine = mode === "all" ? retrievalEngine() : mode;
  try {
    if (engine === "moss") return await mossBlockQuery(query, k, QUERY_ALPHA, { waitForLoad: opts.waitForLoad, budgetMs: opts.budgetMs ?? QUERY_BUDGET_MS });
    return await localQuery(query, k, opts);
  } catch (e) {
    return { status: "error", engine, hits: null, ms: 0, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** What a beat asks: the planned drawing plus what each new id is. */
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
 * Rankings started when a beat was planned. Keyed by the beat's id and spoken line: the layout pass
 * (/api/layout) rewrites a later beat's adds before it is drawn, but not those, so the drawn beat
 * still finds its ranking; its block list is then built from the beat as drawn.
 */
const gp = globalThis as typeof globalThis & { __chalkyBlockPicks?: Map<string, Promise<Retrieval>>; __chalkyBlockStats?: Record<string, number> };
const picks = (gp.__chalkyBlockPicks ??= new Map());
const stats = (gp.__chalkyBlockStats ??= { beats: 0, retrieved: 0, prefetched: 0, keyword: 0 });
const pickKey = (beat: PlannedBeat) => `${beat.id}|${beat.say}`;

/** Starts a beat's ranking as soon as it is planned (/api/plan, /api/amend), so its draw finds it done. */
export function prefetchBlocks(beat: PlannedBeat): void {
  if (beat.mode === "point" || retrievalMode() === "all") return;
  const key = pickKey(beat);
  if (picks.has(key)) return;
  if (picks.size >= 400) picks.delete(picks.keys().next().value!);
  // Off the critical path, a beat planned while the engine loads can wait for it (within the budget).
  const loading = retrievalEngine() === "moss" ? mossState()?.ready : Promise.all([loadEmbedder(), localBlockIndex().ready]);
  const loaded = Promise.race([Promise.resolve(loading).catch(() => {}), new Promise((r) => setTimeout(r, PREFETCH_BUDGET_MS))]);
  picks.set(key, loaded.then(() => relevantBlocks(beatQuery(beat), BEAT_K, { budgetMs: PREFETCH_BUDGET_MS })));
}

/**
 * The few blocks one beat's drawer prompt lists: the ones its adds name, then the engine's best
 * matches and the top keyword matches, or just keyword matches when retrieval is off, loading,
 * failing or over budget. The pick prefetchBlocks() started when the beat was planned, if any; a point
 * beat adds nothing, so it gets none. Logs the pick, its latency and the running hit rate.
 */
export async function blocksForBeat(beat: PlannedBeat): Promise<BeatBlocks> {
  if (beat.mode === "point") return { blocks: [], retrieval: { status: "off", hits: null, ms: 0 } };
  const t0 = performance.now();
  const query = beatQuery(beat);
  const early = picks.get(pickKey(beat));
  const late = new Promise<null>((r) => setTimeout(() => r(null), QUERY_BUDGET_MS));
  let retrieval: Retrieval = early ? ((await Promise.race([early, late])) ?? { status: "error", hits: null, ms: QUERY_BUDGET_MS, error: "prefetch still running" }) : await relevantBlocks(query, BEAT_K);
  const prefetched = Boolean(early && retrieval.hits);
  // A prefetch that ran while the engine was still loading: it may be ready now.
  if (early && retrieval.status === "loading") retrieval = await relevantBlocks(query, BEAT_K);
  const blocks = retrieval.hits
    ? // Plus the keyword match's top few: an embedding can rank a literal "water molecules" below the
      // plant it is in (scripts/test-retrieval.ts), and a keyword match never does.
      [...new Set([...namedBlocks(beat), ...retrieval.hits.map((h) => blockById(h.id)!), ...keywordBlocks(query, KEYWORD_K)])]
    : [...new Set([...namedBlocks(beat), ...keywordBlocks(query, BEAT_K)])];
  const waited = Math.round(performance.now() - t0);
  stats.beats++;
  if (retrieval.hits) stats.retrieved++;
  else stats.keyword++;
  if (prefetched) stats.prefetched++;
  const engine = retrieval.engine ?? retrievalEngine();
  const rate = `engine=${engine}: ${stats.retrieved}/${stats.beats} beats retrieved, ${stats.prefetched} prefetched, budget ${QUERY_BUDGET_MS} ms`;
  if (retrieval.hits) console.log(`[retrieval] ${beat.id}: ${prefetched ? `prefetched (query ${retrieval.ms} ms), waited ${waited} ms` : `${retrieval.ms} ms`} -> ${blocks.map((b) => b.id).join(", ")} (${retrieval.hits.map((h) => `${h.id} ${h.score}`).join(", ")}) [${rate}]`);
  else {
    if (retrieval.status !== "off" && retrieval.status !== "no-key") console.warn(`[retrieval] ${beat.id}: ${retrieval.status}${retrieval.error ? ` (${retrieval.error})` : ""}; keyword match [${rate}]`);
    console.log(`[blocks] ${beat.id}: keywords -> ${blocks.map((b) => b.id).join(", ") || "none"}`);
  }
  return { blocks, retrieval, prefetched };
}
