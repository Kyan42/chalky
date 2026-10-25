// Janani's whiteboard blocks (presets/ on her `presets` branch, merged in): hand-authored line art
// the lesson places by id instead of drawing from primitives. Rendered through our stage by
// ./render.ts. presets/ is the one source; each topic exports factories (makeAtom, makeBeaker…)
// and a default instance of each, and these lists hold the defaults.
import { BIOLOGY, BY_TOPIC as BIOLOGY_TOPICS } from "@/presets/biology";
import { CHEMISTRY, BY_TOPIC as CHEMISTRY_TOPICS } from "@/presets/chemistry";
import { COMPUTING, BY_TOPIC as COMPUTING_TOPICS } from "@/presets/computing";
import type { Block } from "@/presets/types";

export type { Block, Paint, Part, Shape } from "@/presets/types";
export { BIOLOGY, CHEMISTRY, COMPUTING };

export const BLOCKS: Block[] = [...BIOLOGY, ...COMPUTING, ...CHEMISTRY];

/** The catalog by subject and topic ("biology: plants"), 4 to 20 blocks each, for galleries. */
export const TOPICS: { name: string; blocks: Block[] }[] = [
  ...Object.entries(BIOLOGY_TOPICS).map(([t, blocks]) => ({ name: `biology: ${t}`, blocks })),
  ...Object.entries(COMPUTING_TOPICS).map(([t, blocks]) => ({ name: `computing: ${t}`, blocks })),
  ...Object.entries(CHEMISTRY_TOPICS).map(([t, blocks]) => ({ name: `chemistry: ${t}`, blocks })),
];

/** Ids compare without case or punctuation, so "neural-net", "neural net" and "neuralnet" all match. */
export const blockKey = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, "");

const byId = new Map(BLOCKS.map((b) => [blockKey(b.id), b]));

/** The block with this id (spelling aside), or undefined: the catalog's, else a learned one. */
export function blockById(id: string): Block | undefined {
  const key = blockKey(id);
  return byId.get(key) ?? store.byId.get(key);
}

/**
 * Blocks a slow-mode lesson drew for itself and kept (lib/blocks/learned.ts, a local file, never Moss):
 * registered on the server when the file loads, and in the browser when a draw response carries them,
 * so they place and render like any catalog block. An id the catalog already has is never replaced.
 * Held on globalThis so a dev hot reload of this module doesn't forget them.
 */
type LearnedStore = { list: Block[]; byId: Map<string, Block>; version: number };
const gl = globalThis as typeof globalThis & { __chalkyLearnedBlocks?: LearnedStore };
const store: LearnedStore = (gl.__chalkyLearnedBlocks ??= { list: [], byId: new Map(), version: 0 });

export function registerBlocks(blocks: readonly Block[]): Block[] {
  const added = blocks.filter((b) => {
    const key = blockKey(b.id);
    if (!key || byId.has(key) || store.byId.has(key)) return false;
    store.byId.set(key, b);
    store.list.push(b);
    return true;
  });
  if (added.length) store.version++;
  return added;
}

export const isLearned = (id: string) => store.byId.has(blockKey(id));
export const learnedBlocks = (): readonly Block[] => store.list;
/** The catalog plus every learned block. */
export const allBlocks = (): Block[] => [...BLOCKS, ...store.list];
/** Bumped whenever learned blocks are added, so caches built from allBlocks() know to rebuild. */
export const blocksVersion = () => store.version;
