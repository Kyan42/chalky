/**
 * Learned blocks: drawings a slow-mode lesson authored in a free beat (lib/blocks/learn.ts), kept so
 * every later lesson, in either mode, can find and reuse them like a catalog block.
 *
 * Moss is the shared store: each one is a document in the block index (MOSS_BLOCK_INDEX), embedded
 * from the same text as a catalog block (blockDoc), tagged metadata.learned = "1", with the whole
 * block as its JSON payload. experiments/learned-blocks.json keeps a local copy, so they also load
 * without Moss keys or while Moss is down. Both are read once per server process (loadLearned) and
 * registered (lib/blocks registerBlocks), which puts them in the keyword match, the planner's list
 * and the compiler at once; Moss's own ranking picks a new one up when the loaded index next
 * refreshes (autoRefresh, every few minutes).
 */
// No "server-only" (as in ./blocks.ts): instrumentation.ts loads it at startup, outside the react-server build.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentInfo } from "@moss-js/moss";
import { isLearned, learnedBlocks, registerBlocks, type Block } from "@/lib/blocks";
import { BLOCK_INDEX, blockDoc, hasMossKeys, mossState } from "./blocks";

const FILE = () => join(process.cwd(), "experiments/learned-blocks.json");

const g = globalThis as typeof globalThis & { __chalkyLearnedLoad?: Promise<void> };

const isBlock = (b: unknown): b is Block => {
  const x = b as Block;
  return !!x && typeof x.id === "string" && Array.isArray(x.size) && Array.isArray(x.parts) && !!x.anchors && Array.isArray(x.tags);
};

/** The Moss document for a learned block: the catalog's embedded text, plus the block itself. */
export const learnedDoc = (b: Block): DocumentInfo => ({ ...blockDoc(b), metadata: { blockId: b.id, title: b.title, learned: "1" }, payload: JSON.stringify(b) });

async function readFileBlocks(): Promise<Block[]> {
  try {
    const parsed = JSON.parse(await readFile(FILE(), "utf8")) as { blocks?: unknown[] };
    return (parsed.blocks ?? []).filter(isBlock);
  } catch {
    return [];
  }
}

async function writeFileBlocks(): Promise<void> {
  const file = FILE();
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ blocks: learnedBlocks() }, null, 2));
  await rename(tmp, file);
}

async function readMossBlocks(): Promise<Block[]> {
  const state = mossState();
  if (!state) return [];
  const docs = await state.client.getDocs(BLOCK_INDEX);
  return docs.flatMap((d) => {
    if (d.metadata?.learned !== "1" || !d.payload) return [];
    try {
      const b = JSON.parse(d.payload) as unknown;
      return isBlock(b) ? [b] : [];
    } catch {
      return [];
    }
  });
}

/** Loads learned blocks (the local copy, then Moss) once per server process. Never throws. */
export function loadLearned(): Promise<void> {
  return (g.__chalkyLearnedLoad ??= (async () => {
    const t0 = performance.now();
    const local = registerBlocks(await readFileBlocks());
    let fromMoss: Block[] = [];
    if (hasMossKeys()) {
      try {
        fromMoss = registerBlocks(await readMossBlocks());
        // Learned on another machine: keep a local copy too.
        if (fromMoss.length) await writeFileBlocks().catch(() => {});
      } catch (e) {
        console.warn(`[learned] could not read learned blocks from Moss: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      }
    }
    console.log(`[learned] ${learnedBlocks().length} learned block(s) (${local.length} from the local copy, ${fromMoss.length} more from Moss) in ${Math.round(performance.now() - t0)} ms`);
  })());
}

/**
 * Keeps a new block (from cleanNewBlock, so its id was free): registered (this server's next beats can
 * use it; the drawer has usually registered it already to place it), written to the local copy, and
 * added to the Moss index for every server and later lessons. The writes finish in the background and
 * only log on failure.
 */
export function saveLearned(block: Block): boolean {
  registerBlocks([block]);
  if (!isLearned(block.id)) return false;
  console.log(`[learned] new block "${block.id}" (${block.title}): ${block.parts.length} part(s), ${block.parts.reduce((n, p) => n + p.shapes.length, 0)} shape(s)`);
  void writeFileBlocks().catch((e) => console.warn(`[learned] could not write ${FILE()}: ${String((e as Error)?.message ?? e)}`));
  const state = mossState();
  if (state) {
    void state.client
      .addDocs(BLOCK_INDEX, [learnedDoc(block)], { upsert: true })
      .then(() => console.log(`[learned] "${block.id}" added to Moss index "${BLOCK_INDEX}"`))
      .catch((e) => console.warn(`[learned] could not add "${block.id}" to Moss: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
  }
  return true;
}
