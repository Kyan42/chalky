/**
 * The Moss engine for block picks (RETRIEVAL_ENGINE=moss, lib/retrieval/blocks.ts): the chalky-blocks
 * Moss cloud index, one document per catalog block (lib/retrieval/docs.ts blockDoc), loaded once per
 * server process and queried locally with hybrid search. Kept so the local engine can be compared
 * against it; the index is built by `npx tsx --env-file=.env.local scripts/moss-build-blocks.ts`.
 *
 * Env: MOSS_PROJECT_ID and MOSS_PROJECT_KEY (portal.usemoss.dev); MOSS_BLOCK_INDEX (default
 * "chalky-blocks").
 */
import { MossClient } from "@moss-js/moss";
import { blockById } from "@/lib/blocks";
import { hasMossKeys } from "@/lib/retrieval/docs";
import type { Retrieval } from "@/lib/retrieval/blocks";

export const BLOCK_INDEX = process.env.MOSS_BLOCK_INDEX || "chalky-blocks";
/** Embedding model the index is built with: moss-minilm (fast) or moss-mediumlm (more accurate). */
export const BLOCK_MODEL = process.env.MOSS_BLOCK_MODEL || "moss-minilm";

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

/** One block query against the Moss index, within `budgetMs`. */
export async function mossBlockQuery(query: string, k: number, alpha: number, opts: { waitForLoad?: boolean; budgetMs: number }): Promise<Retrieval> {
  const state = mossState();
  if (!state) return { status: "no-key", engine: "moss", hits: null, ms: 0 };
  if (opts.waitForLoad) await state.ready;
  // Timed from here: the query, not the one-off index load.
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 10) / 10;
  if (state.error) return { status: "error", engine: "moss", hits: null, ms: ms(), error: state.error };
  if (!state.loaded) return { status: "loading", engine: "moss", hits: null, ms: ms() };
  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), opts.budgetMs));
  const result = await Promise.race([state.client.query(BLOCK_INDEX, query, { topK: k, alpha }), budget]);
  if (!result) return { status: "error", engine: "moss", hits: null, ms: ms(), error: `over ${opts.budgetMs} ms` };
  const hits = result.docs.filter((d) => blockById(d.id)).map((d) => ({ id: d.id, score: Math.round(d.score * 1000) / 1000 }));
  return { status: "ok", engine: "moss", hits, ms: ms(), engineMs: result.timeTakenInMs };
}
