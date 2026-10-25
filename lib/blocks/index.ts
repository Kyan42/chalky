// Janani's whiteboard blocks (presets/ on her `presets` branch, merged in): hand-authored line art
// the lesson places by id instead of drawing from primitives. Rendered through our stage by
// ./render.ts. presets/ is the one source; each topic exports factories (makeAtom, makeBeaker…)
// and a default instance of each, and these lists hold the defaults. Leo's scenery (forest and
// podium illustrations, ./scenery.ts) joins them as one more topic.
import { BIOLOGY, BY_TOPIC as BIOLOGY_TOPICS } from "@/presets/biology";
import { CHEMISTRY, BY_TOPIC as CHEMISTRY_TOPICS } from "@/presets/chemistry";
import { COMPUTING, BY_TOPIC as COMPUTING_TOPICS } from "@/presets/computing";
import type { Block } from "@/presets/types";
import { SCENERY } from "./scenery";

export type { Block, Paint, Part, Shape } from "@/presets/types";
export { BIOLOGY, CHEMISTRY, COMPUTING, SCENERY };

export const BLOCKS: Block[] = [...BIOLOGY, ...COMPUTING, ...CHEMISTRY, ...SCENERY];

/** The catalog by subject and topic ("biology: plants"), 4 to 20 blocks each, for galleries. */
export const TOPICS: { name: string; blocks: Block[] }[] = [
  ...Object.entries(BIOLOGY_TOPICS).map(([t, blocks]) => ({ name: `biology: ${t}`, blocks })),
  ...Object.entries(COMPUTING_TOPICS).map(([t, blocks]) => ({ name: `computing: ${t}`, blocks })),
  ...Object.entries(CHEMISTRY_TOPICS).map(([t, blocks]) => ({ name: `chemistry: ${t}`, blocks })),
  { name: "scenery: forest and podium", blocks: SCENERY },
];

/** Ids compare without case or punctuation, so "neural-net", "neural net" and "neuralnet" all match. */
export const blockKey = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, "");

const byId = new Map(BLOCKS.map((b) => [blockKey(b.id), b]));

/** The block with this id (spelling aside), or undefined. */
export function blockById(id: string): Block | undefined {
  return byId.get(blockKey(id));
}
