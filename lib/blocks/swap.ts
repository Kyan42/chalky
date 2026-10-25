/**
 * A circle or box whose label is a block's name becomes that block: the catalog rule says a block
 * must be used when one exists, and a model that drew "Leaf" as a green box missed it. The label
 * is kept beside the block. Used by the drawer's cleanElements (lib/lesson/draw.ts); pure, so it
 * can be tested without the server.
 */
import { BLOCKS } from "./index";
import type { ElementLike } from "./compile";

/** Block id by its id or title, spelling aside ("Water drop", "water-drop", "CO2", "a leaf"). */
const BLOCK_NAMES = new Map<string, string>();
for (const b of BLOCKS) for (const name of [b.id, b.title]) BLOCK_NAMES.set(name.toLowerCase().replace(/[^a-z0-9]/g, ""), b.id);

export const blockNamed = (text: string): string | null =>
  BLOCK_NAMES.get(text.toLowerCase().replace(/^(a|an|the|one)\s+/, "").replace(/[^a-z0-9]/g, "")) ?? null;

/**
 * The block (and its label) a circle or box labelled with a block's name should have been, or
 * null. A circle's size is its diameter; a box's its longer side (its height counted in x units).
 */
export function asBlock<T extends ElementLike>(e: T): T[] | null {
  if (e.kind !== "circle" && e.kind !== "box") return null;
  const id = blockNamed(e.text);
  if (!id) return null;
  const a = e.args;
  const args = e.kind === "circle" ? [a[0], a[1], Math.max(4, a[2] * 2)] : [a[0] + a[2] / 2, a[1] + a[3] / 2, Math.max(4, a[2], a[3] / 1.5)];
  return [
    { ...e, kind: "block", args, text: id, refs: "" },
    { ...e, id: `${e.id}-label`, kind: "label", at: e.at + 0.2, dur: 0.4, args: [], text: e.text, refs: e.id },
  ];
}
