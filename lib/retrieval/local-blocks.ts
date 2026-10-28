/**
 * The local block index: every catalog block's vector from lib/blocks/vectors.json (written by
 * scripts/build-block-vectors.ts), in a HybridIndex with its search text, title and tags. A block
 * missing from the file, or whose text or model changed since, is embedded when the model loads,
 * with a warning: `npm run build` refuses such a file (scripts/build-block-vectors.ts --check), dev
 * just copes.
 *
 * Learned blocks (slow mode's own drawings, lib/blocks/learned.ts) aren't in the file: they are
 * embedded when they are registered (blocksVersion() changes), so a later beat can find them by
 * meaning too, which the Moss index never did.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BLOCKS, blocksVersion, learnedBlocks, type Block } from "@/lib/blocks";
import { blockDoc, docHash } from "./docs";
import { EMBED_STAMP, fromBase64, loadEmbedder } from "./embed";
import { HybridIndex } from "./hybrid";

export const VECTORS_FILE = path.join(process.cwd(), "lib", "blocks", "vectors.json");

export type VectorFile = { model: string; dim: number; blocks: Record<string, { hash: string; v: string }> };

export function readVectorFile(): VectorFile | null {
  try {
    return JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as VectorFile;
  } catch {
    return null;
  }
}

type BlockIndexState = { index: HybridIndex; ready: Promise<void>; filling: boolean; stale: string[]; version: number };
const g = globalThis as typeof globalThis & { __chalkyLocalBlocks?: BlockIndexState };

const entry = (b: Block, vector?: Float32Array) => ({ id: b.id, text: blockDoc(b).text, title: b.title, tags: b.tags.join(", "), vector });

/** Embeds whatever has no vector yet; `ready` resolves when done. */
function fill(state: BlockIndexState): void {
  if (state.filling) return;
  state.filling = true;
  state.ready = state.ready.then(async () => {
    const embed = await loadEmbedder();
    const docs = state.index.missingVectors();
    if (!docs.length) return;
    const vectors = await embed(docs.map((d) => d.text));
    docs.forEach((d, i) => state.index.upsert({ ...d, vector: vectors[i] }));
  });
  state.ready.finally(() => (state.filling = false)).catch(() => {});
  state.ready.catch(() => {});
}

/** The block index, built once per process, with learned blocks added as they appear. */
export function localBlockIndex(): BlockIndexState {
  let state = g.__chalkyLocalBlocks;
  if (!state) {
    const t0 = performance.now();
    const file = readVectorFile();
    const index = new HybridIndex();
    const stale: string[] = [];
    for (const b of BLOCKS) {
      const stored = file?.model === EMBED_STAMP ? file.blocks[b.id] : undefined;
      const fresh = stored && stored.hash === docHash(EMBED_STAMP, blockDoc(b).text);
      if (!fresh) stale.push(b.id);
      index.upsert(entry(b, fresh ? fromBase64(stored.v) : undefined));
    }
    state = g.__chalkyLocalBlocks = { index, ready: Promise.resolve(), filling: false, stale, version: -1 };
    console.log(`[retrieval] block index: ${BLOCKS.length} blocks, ${BLOCKS.length - stale.length} vectors from vectors.json in ${Math.round(performance.now() - t0)} ms`);
    if (stale.length) console.warn(`[retrieval] ${stale.length} blocks have no current vector in lib/blocks/vectors.json (${stale.slice(0, 8).join(", ")}${stale.length > 8 ? ", ..." : ""}); embedding them now. Run: npx tsx scripts/build-block-vectors.ts`);
  }
  if (state.version !== blocksVersion()) {
    state.version = blocksVersion();
    for (const b of learnedBlocks()) if (!state.index.has(b.id)) state.index.upsert(entry(b));
  }
  if (state.index.missingVectors().length) fill(state);
  return state;
}
