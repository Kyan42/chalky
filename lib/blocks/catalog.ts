/**
 * What the drawing model reads about blocks: the two scene-language kinds and one catalog line
 * per block. Shared by lib/lesson/language.ts (the live drawer prompt) and anything else that
 * prompts for scene-language elements.
 *
 * The catalog is about 300 blocks, far too many to list in a prompt, so each beat sees a few:
 * lib/moss/blocks.ts picks them with Moss, or with keywordBlocks() below when Moss is off, and
 * blockLanguageFor() writes the section for just those.
 */
import { allBlocks, blocksVersion } from "./index";
import type { Block } from "@/presets/types";

const aspect = (b: Block) => {
  const r = b.size[0] / b.size[1];
  return r > 1.3 ? "wide" : r < 0.77 ? "tall" : "square";
};

/** Every block answers these anchors (lib/blocks/compile.ts), so catalog lines leave them out. */
const STANDARD_ANCHORS = new Set(["center", "top", "bottom", "left", "right"]);

/**
 * Names with a numbered run folded: "cell-0, cell-1, … cell-9" becomes "cell-0…cell-9", so a
 * periodic table's 118 cells cost one entry, not 118.
 */
export function foldNumbered(names: string[]): string {
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const key = n.replace(/\d+/g, "#");
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups.values()].map((g) => (g.length > 2 ? `${g[0]}…${g[g.length - 1]}` : g.join(", "))).join(", ");
}

/** One line per block: id, what it is, its shape, part ids and its other anchor names. */
export function catalogLine(b: Block): string {
  const partIds = b.parts.map((p) => p.id);
  const parts = new Set(partIds);
  const anchors = Object.keys(b.anchors).filter((a) => !parts.has(a) && !STANDARD_ANCHORS.has(a));
  return `- ${b.id}: ${b.describe} (${aspect(b)}). Parts: ${foldNumbered(partIds)}.${anchors.length ? ` Anchors: ${foldNumbered(anchors)}.` : ""}`;
}

/** The block section of the drawer prompt for these blocks. */
export function blockLanguageFor(blocks: Block[]): string {
  if (!blocks.length) return "Ready-made drawings: none fit this beat; draw with the kinds below.";
  const examples = blocks.map((b) => b.title.toLowerCase()).join(", ");
  return `Ready-made drawings (hand-drawn blocks from the catalog below; they look far better than anything built from circles and lines):
- block: args cx, cy, size (its centre, and its longer side in x units: 20-35 for the main picture, 10-18 for a supporting thing, 5-9 for a molecule), text = the block's catalog id. A 4th arg of 1 pops it in instead of drawing it. Refer to it by your element id; to one of its parts as "<id>.<part>"; to one of its anchor points as "<id>.<anchor>" (every block also has center, top, bottom, left and right). Those work in refs of connect, rays, label, highlight, dim and travel. A catalog entry like "cell-0…cell-9" means cell-0, cell-1 and so on up to cell-9.
- travel: args x1, y1, x2, y2, size, count (2-4), stay (1 = the copies stay at the end, 0 = they vanish there), text = catalog id of the small thing that travels (a molecule, a drop). Copies pop in at the start, glide along a gentle curve to the end. Optional refs "fromRef,toRef" start and end it at anchors or elements instead of x1..y2, e.g. "plant.roots,plant.leaves"; write xy for an end that comes from args, e.g. "xy,leaf.surface".
A block's text must be exactly one of these ids: ${blocks.map((b) => b.id).join(", ")}. Anything not in this list has no block for this beat: draw it with circle, box and the other kinds as usual.
Block rule: when a catalog block exists for something this beat draws (${examples}), you MUST draw it with block or travel, never from circles, boxes or lines. Then still add short labels next to it (label with refs = its id) and arrows to and from it (connect with refs like "sun,leaf" or "sun.bottom,leaf.surface"). To point at a part, highlight "<id>.<part>" (e.g. "leaf.veins"). Keep a block's whole box inside your region: on screen it is as tall as it is wide for a square block, which is 1.5x its size in y units.
Block catalog:
${blocks.map(catalogLine).join("\n")}`;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

type Indexed = { block: Block; name: Set<string>; tags: Set<string>; tagPhrases: string[]; describe: Set<string> };
let indexed: Indexed[] | null = null;
let indexedAt = -1;
const index = () => {
  if (indexedAt !== blocksVersion()) {
    indexed = null;
    indexedAt = blocksVersion();
  }
  return (indexed ??= allBlocks().map((block) => ({
    block,
    name: new Set([...words(block.id), ...words(block.title)]),
    tags: new Set(block.tags.flatMap(words)),
    tagPhrases: block.tags.filter((t) => t.includes(" ")).map((t) => t.toLowerCase()),
    describe: new Set(words(block.describe)),
  })));
};

/**
 * The k blocks whose name, tags and description share the most words with `query`, best first.
 * The fallback when Moss is off or not ready: no network, a few hundred microseconds.
 */
export function keywordBlocks(query: string, k: number): Block[] {
  const q = words(query);
  if (!q.length) return [];
  const text = query.toLowerCase();
  return index()
    .map(({ block, name, tags, tagPhrases, describe }) => {
      let score = 0;
      for (const w of q) score += name.has(w) ? 3 : tags.has(w) ? 1.5 : describe.has(w) ? 0.5 : 0;
      for (const t of tagPhrases) if (text.includes(t)) score += 2;
      return { block, score };
    })
    .filter((s) => s.score >= 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.block);
}
