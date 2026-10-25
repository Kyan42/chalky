// Whiteboard blocks: Janani's biology (from her `presets` branch) and Leo's scenery (forest and
// podium illustrations), hand-authored line art the lesson places by id instead of drawing from
// primitives. Rendered through our stage by ./render.ts.
import { BIOLOGY } from "./biology";
import { SCENERY } from "./scenery";
import type { Block } from "./types";

export type { Block, Paint, Part, Shape } from "./types";
export { BIOLOGY } from "./biology";
export { SCENERY } from "./scenery";

export const BLOCKS: Block[] = [...BIOLOGY, ...SCENERY];

const byId = new Map(BLOCKS.map((b) => [b.id, b]));

/** The block with this id, or undefined. */
export function blockById(id: string): Block | undefined {
  return byId.get(id);
}
