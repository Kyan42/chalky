/**
 * Moss picks the blocks the drawer sees. One Moss index holds the block catalog (one document per
 * block); each server process loads it once and queries it locally with a beat's visual brief, so
 * the drawer prompt lists the few blocks that fit instead of the whole catalog.
 *
 * Env: MOSS_PROJECT_ID and MOSS_PROJECT_KEY (portal.usemoss.dev); CHALKY_BLOCK_RETRIEVAL=moss|all
 * (default moss when the keys are set); MOSS_BLOCK_INDEX (default "chalky-blocks"). Without keys,
 * or when Moss is still loading, slow or failing, every caller gets null and keeps the full catalog.
 *
 * No "server-only" here: scripts/moss-build-blocks.ts and scripts/test-moss-blocks.ts import it
 * under tsx. The index is built by `npx tsx --env-file=.env.local scripts/moss-build-blocks.ts`.
 */
import { MossClient, type DocumentInfo } from "@moss-js/moss";
import { BLOCKS, blockById, type Block } from "@/lib/blocks";
import type { PlannedBeat } from "@/lib/lesson/types";

export const BLOCK_INDEX = process.env.MOSS_BLOCK_INDEX || "chalky-blocks";
/** Embedding model the index is built with: moss-minilm (fast) or moss-mediumlm (more accurate). */
export const BLOCK_MODEL = process.env.MOSS_BLOCK_MODEL || "moss-minilm";
/** A query that takes longer than this is abandoned for the full catalog. */
const QUERY_BUDGET_MS = 150;
/** How many retrieved blocks a drawn beat sees (plus any named by id in its adds). */
const BEAT_K = Number(process.env.CHALKY_BLOCK_K) || 5;

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

/** The text Moss embeds for a block: what it is, what it's about, its parts and anchor names. */
export function blockDoc(b: Block): DocumentInfo {
  const parts = b.parts.map((p) => p.label).join(", ");
  const anchors = Object.keys(b.anchors).join(", ");
  return {
    id: b.id,
    text: `${b.title}: ${b.describe}. About: ${b.tags.join(", ")}. Parts: ${parts}. Anchors: ${anchors}.`,
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
      // Try again on a later request rather than staying broken for the life of the process.
      g.__chalkyMoss = undefined;
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
export async function relevantBlocks(query: string, k = 4, opts: { waitForLoad?: boolean; force?: boolean } = {}): Promise<Retrieval> {
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 10) / 10;
  if (!hasMossKeys()) return { status: "no-key", hits: null, ms: 0 };
  if (!opts.force && retrievalMode() === "all") return { status: "off", hits: null, ms: 0 };
  const state = mossState()!;
  if (opts.waitForLoad) await state.ready;
  if (state.error) return { status: "error", hits: null, ms: ms(), error: state.error };
  if (!state.loaded) return { status: "loading", hits: null, ms: ms() };
  try {
    const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), QUERY_BUDGET_MS));
    const result = await Promise.race([state.client.query(BLOCK_INDEX, query, { topK: k }), budget]);
    if (!result) return { status: "error", hits: null, ms: ms(), error: `over ${QUERY_BUDGET_MS} ms` };
    const hits = result.docs.filter((d) => blockById(d.id)).map((d) => ({ id: d.id, score: Math.round(d.score * 1000) / 1000 }));
    return { status: "ok", hits, ms: ms(), mossMs: result.timeTakenInMs };
  } catch (e) {
    return { status: "error", hits: null, ms: ms(), error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** What a beat asks Moss: the planned drawing plus what each new id is. */
export const beatQuery = (beat: Pick<PlannedBeat, "visual" | "adds">) => [beat.visual, ...beat.adds.map((a) => a.what)].filter(Boolean).join(". ");

/** Blocks a beat names outright: an add whose id is a block id, or starts with one ("co2-in"). */
export function namedBlocks(beat: Pick<PlannedBeat, "adds">): Block[] {
  return beat.adds.flatMap((a) => {
    const b = blockById(a.id) ?? blockById(a.id.split(/[-_.]/)[0]);
    return b ? [b] : [];
  });
}

/**
 * The blocks one beat's drawer prompt lists, or null for the whole catalog (retrieval off, no key,
 * index loading or failing, or a point beat that adds nothing). Logs the pick and its latency.
 */
export async function blocksForBeat(beat: PlannedBeat): Promise<{ blocks: Block[] | null; retrieval: Retrieval }> {
  if (beat.mode === "point") return { blocks: null, retrieval: { status: "off", hits: null, ms: 0 } };
  const retrieval = await relevantBlocks(beatQuery(beat), BEAT_K);
  if (!retrieval.hits) {
    if (retrieval.status !== "off" && retrieval.status !== "no-key") console.warn(`[moss] ${beat.id}: ${retrieval.status}${retrieval.error ? ` (${retrieval.error})` : ""}; full catalog`);
    return { blocks: null, retrieval };
  }
  const blocks = [...new Set([...namedBlocks(beat), ...retrieval.hits.map((h) => blockById(h.id)!)])];
  console.log(`[moss] ${beat.id}: ${retrieval.ms} ms -> ${blocks.map((b) => b.id).join(", ")} (${retrieval.hits.map((h) => `${h.id} ${h.score}`).join(", ")})`);
  return { blocks, retrieval };
}
