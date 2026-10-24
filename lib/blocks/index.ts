// Janani's whiteboard blocks (from her `presets` branch): hand-authored line art the lesson
// places by id instead of drawing from primitives. Rendered through our stage by ./render.ts.
import { BIOLOGY } from "./biology";
import type { Block } from "./types";

export type { Block, Paint, Part, Shape } from "./types";
export { BIOLOGY } from "./biology";

export const BLOCKS: Block[] = [...BIOLOGY];

const byId = new Map(BLOCKS.map((b) => [b.id, b]));

/** The block with this id, or undefined. */
export function blockById(id: string): Block | undefined {
  return byId.get(id);
}
