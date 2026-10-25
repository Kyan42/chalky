/**
 * Learned blocks: drawings a slow-mode lesson authored in a free beat (lib/blocks/learn.ts), kept so
 * later lessons on this server, in either mode, can reuse them like a catalog block.
 *
 * Kept in experiments/learned-blocks.json only, never in Moss: the Moss block index holds the catalog
 * and nothing else (scripts/moss-build-blocks.ts deletes anything that isn't a catalog block). The
 * file is read once per server process (loadLearned) and its blocks registered (lib/blocks
 * registerBlocks), which puts them in the keyword match, the planner's list and the compiler; Moss's
 * ranking never returns them, so a beat finds one by keyword (lib/blocks/catalog.ts keywordBlocks)
 * or by naming it.
 */
// Node only (fs): used by lib/lesson/draw.ts and instrumentation.ts, never the browser.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLearned, learnedBlocks, registerBlocks, type Block } from "./index";

const FILE = () => join(process.cwd(), "experiments/learned-blocks.json");

const g = globalThis as typeof globalThis & { __chalkyLearnedLoad?: Promise<void> };

const isBlock = (b: unknown): b is Block => {
  const x = b as Block;
  return !!x && typeof x.id === "string" && Array.isArray(x.size) && Array.isArray(x.parts) && !!x.anchors && Array.isArray(x.tags);
};

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

/** Loads learned blocks from the local file once per server process. Never throws. */
export function loadLearned(): Promise<void> {
  return (g.__chalkyLearnedLoad ??= (async () => {
    const t0 = performance.now();
    const loaded = registerBlocks(await readFileBlocks());
    console.log(`[learned] ${loaded.length} learned block(s) from ${FILE()} in ${Math.round(performance.now() - t0)} ms`);
  })());
}

/**
 * Keeps a new block (from cleanNewBlock, so its id was free): registered (this server's next beats can
 * use it; the drawer has usually registered it already to place it) and written to the local file in
 * the background, which only logs on failure.
 */
export function saveLearned(block: Block): boolean {
  registerBlocks([block]);
  if (!isLearned(block.id)) return false;
  console.log(`[learned] new block "${block.id}" (${block.title}): ${block.parts.length} part(s), ${block.parts.reduce((n, p) => n + p.shapes.length, 0)} shape(s), kept locally`);
  void writeFileBlocks().catch((e) => console.warn(`[learned] could not write ${FILE()}: ${String((e as Error)?.message ?? e)}`));
  return true;
}
