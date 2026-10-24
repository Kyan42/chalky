/**
 * What the drawing model reads about blocks: the two scene-language kinds and one catalog line
 * per block. Shared by lib/lesson/language.ts (the live drawer prompt) and anything else that
 * prompts for scene-language elements.
 *
 * Fifteen lines is cheap. Beyond about 30 blocks, filter the catalog by the question's words and
 * each block's `tags` before putting it in the prompt.
 */
import { BLOCKS } from "./index";
import type { Block } from "./types";

const aspect = (b: Block) => {
  const r = b.size[0] / b.size[1];
  return r > 1.3 ? "wide" : r < 0.77 ? "tall" : "square";
};

/** One line per block: id, what it is, its shape, part ids and anchor names. */
export function catalogLine(b: Block): string {
  const parts = b.parts.map((p) => p.id).join(", ");
  const anchors = Object.keys(b.anchors).join(", ");
  return `- ${b.id}: ${b.describe} (${aspect(b)}). Parts: ${parts}. Anchors: ${anchors}.`;
}

export const BLOCK_CATALOG = BLOCKS.map(catalogLine).join("\n");

export const BLOCK_LANGUAGE = `Ready-made drawings (hand-drawn blocks from the catalog below; they look far better than anything built from circles and lines):
- block: args cx, cy, size (its centre, and its longer side in x units: 20-35 for the main picture, 10-18 for a supporting thing, 5-9 for a molecule), text = the block's catalog id. A 4th arg of 1 pops it in instead of drawing it. Refer to it by your element id; to one of its parts as "<id>.<part>"; to one of its anchor points as "<id>.<anchor>". Those work in refs of connect, rays, label, highlight, dim and travel.
- travel: args x1, y1, x2, y2, size, count (2-4), stay (1 = the copies stay at the end, 0 = they vanish there), text = catalog id of the small thing that travels (a molecule, a drop). Copies pop in at the start, glide along a gentle curve to the end. Optional refs "fromRef,toRef" start and end it at anchors or elements instead of x1..y2, e.g. "plant.roots,plant.leaves"; write xy for an end that comes from args, e.g. "xy,leaf.surface".
Block rule: when a catalog block exists for something this beat draws (a sun, leaf, plant, tree, cell, mitochondrion, DNA, neuron, water, a molecule, glucose, energy, a cloud), you MUST draw it with block or travel, never from circles, boxes or lines. Then still add short labels next to it (label with refs = its id) and arrows to and from it (connect with refs like "sun,leaf" or "sun.bottom,leaf.surface"). To point at a part, highlight "<id>.<part>" (e.g. "leaf.veins"). Keep a block's whole box inside your region: on screen it is as tall as it is wide for a square block, which is 1.5x its size in y units.
Block catalog:
${BLOCK_CATALOG}`;
