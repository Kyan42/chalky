# Blocks in the preset compiler: handoff

## Update: 300 blocks from presets/

Janani's `presets` branch is merged in, and `presets/` is now the only copy of the blocks:
biology (100), computing (100) and chemistry (100). `lib/blocks/index.ts` reads them from there.
The old copies in `lib/blocks/biology`, `types.ts` and `geometry.ts` are gone.

- **Ids:** `blockById` compares ids without case or punctuation, so a hyphenated id like
  `neural-net` or `water-molecule` resolves. Before, the compiler stripped hyphens from `text` and
  then missed. `namedBlocks` also matches a planner id that starts with a hyphenated block id,
  such as `neural-net-1`.
- **Prompt:** the whole catalog is about 74k characters, so the drawer prompt never lists all of
  it.
  - `blocksForBeat` returns the blocks the beat names, plus Moss's top 5.
  - When Moss is off, has no keys, is loading or fails, `keywordBlocks` (`lib/blocks/catalog.ts`)
    picks them from names, tags and descriptions instead.
  - A point beat gets none.
  - `presetLanguage(blocks)` in `lib/lesson/language.ts` writes the scene language for just those
    blocks. It replaces the old `PRESET_LANGUAGE` constant.
- **Catalog lines:** numbered parts are folded, so 118 periodic-table cells read
  `cell-1-1…cell-7-18`. The standard anchors (center, top, bottom, left, right) are stated once
  rather than on every line.
- **Swap:** the circle-or-box-to-block swap matches ids before titles. In each case the first
  block to claim a name keeps it.
- **Gallery:** `/experiments/blocks?topic=<n>` shows one topic at a time.
- **Moss:** rebuild the index after changing blocks, with
  `npx tsx --env-file=.env.local scripts/moss-build-blocks.ts`.
  - `scripts/test-moss-blocks.ts` checks 26 briefs across the three subjects.
  - It also scores the keyword fallback on the same briefs, which needs no keys.
- **Factories:** the presets also export factories such as `makeAtom({ protons })` and
  `makeBeaker({ fill })`. The scene language can only place the default instances so far.


Janani's biology blocks (hand-drawn line art with named parts and anchors) now render on our
stage and are wired into the preset compiler and drawer prompt on branch
`keyon/biology-blocks-b31bcc`. This note is for whoever merges that with the parallel-board /
scenes work, which rewrites `lib/lesson/presets.ts` and the drawer prompt.

## What lives where

| File | What it is |
| --- | --- |
| `lib/blocks/types.ts`, `geometry.ts`, `biology/*` | Her block data, unchanged apart from import paths |
| `lib/blocks/index.ts` | `BLOCKS`, `blockById` |
| `lib/blocks/render.ts` | `renderBlock`, `renderTravel`, `renderLoop` on our `Scene` (1200x800, 60 fps) |
| `lib/blocks/compile.ts` | `block` / `travel` for any preset compiler, plus the block highlight |
| `lib/blocks/catalog.ts` | `BLOCK_LANGUAGE`: the two kinds, the must-use rule, one line per block |
| `lib/blocks/demo.ts` | Gallery boards and her photosynthesis script as scene-language elements |

Nothing in `lib/blocks` depends on `presets.ts` except types (structural) and `demo.ts`.

## Exactly what changed outside lib/blocks

Branch `keyon/biology-blocks-b31bcc`, rebased on `9a86bd0`. Four files, all additive except
two lines in `draw.ts`.

`lib/lesson/presets.ts` (import, kinds, context, one case, one highlight line, draw order,
two `fitToRegion` cases):

```ts
import { BLOCK_KINDS, blockExtent, drawBlockElement, highlightBlock, scaleBlockArgs, shapesFirst, type BlockContext } from "@/lib/blocks/compile";

// The kinds: this array feeds draw.ts's kind filter AND the schema enum.
export const PRESET_KINDS = [/* ...existing... */, ...BLOCK_KINDS] as const;

// After `register` and `occupy` exist:
const blocks: BlockContext = { scene: s, placed, register, occupy: (id, box) => occupy(id, box), dangling: report.dangling };

// In the per-element switch (`at` is -1 for earlier beats, which draws them finished):
case "block":
case "travel":
  drawBlockElement(blocks, { ...e, id }, at);
  return;

// In `highlight`, right after the target resolves and leaves `dimmed`:
if (highlightBlock(blocks, target, at, dur)) return;

// The per-beat loop draws ref kinds (connect, rays, label, highlight, dim, ref'd travel) last:
for (const e of shapesFirst(elements)) {

// fitToRegion, collecting points:
case "block":
case "travel":
  for (const [x, y] of blockExtent(e)) point(x, y);
  break;
// fitToRegion, mapping:
case "block":
case "travel":
  return { ...e, args: scaleBlockArgs(e, X, Y, k) };
```

`shapesFirst` matters beyond blocks: in the first lesson, models wrote `connect` before the
block it pointed at and 7 refs dangled; with it, none.

`lib/lesson/language.ts`: `import { BLOCK_LANGUAGE } from "@/lib/blocks/catalog";` and
`${BLOCK_LANGUAGE}` as its own paragraph in `PRESET_LANGUAGE`, right after the "Every element
has" line.

`lib/lesson/draw.ts`, in `cleanElements` (two lines replaced):

```ts
// Dots survive cleaning so "leaf.veins" stays a part ref.
const refs = typeof e.refs === "string" ? e.refs.split(",").map((r) => r.split(".").map(cleanId).filter(Boolean).join(".")).filter(Boolean) : [];
// "<id>.<part>": a flow or cycle's numbered step, or a block's part or anchor (lib/blocks).
const knows = (id: string) => known.has(id) || parts.has(id.split(".")[0]) || (id.includes(".") && known.has(id.split(".")[0]));
```

`cleanElements` can't tell an earlier beat's block from any other declared id, so it accepts
`<declared id>.<anything>`; the compiler drops what doesn't resolve and counts it.

`lib/lesson/planner.ts`: `import { BLOCKS } from "@/lib/blocks";` and one sentence in the
`adds` rule: when the board has a ready-made drawing for the thing (the block ids), use that
word as the id or say it in "what".

### What gets registered (all boxes in stage pixels)

- **The block's box** under its element id, through `register` and `occupy`. Labels placed by
  the compiler avoid it, `label` with refs = id sits beside it, `connect` / `rays` snap to its
  edge, `dim` covers it.
- **The block's body** as a circle (centre anchor, 0.4 of the box's short side), so
  `connect` / `rays` end at the drawing rather than at its half-empty box.
- **Each part** under `<id>.<part>` and `<id>-<part>`, in `placed` only (not occupied, not in
  the layout report). The dash form matters: `draw.ts` runs every ref through `cleanId`, which
  turns `leaf.veins` into `leaf-veins`.
- **Each anchor** whose name isn't also a part, as a zero-radius circle under `<id>.<anchor>` /
  `<id>-<anchor>`, plus `center`, `top`, `bottom`, `left`, `right` on every block (models guess
  those; a block's own anchors of the same name win). `connect` with refs `sun.bottom-right,plant.leaf` then ends right at those
  points through the existing `edge()`.
- **An alias**: when the element id differs from the block id (`big-leaf` drawing `leaf`), the
  block id answers too if nothing else has it.
- **travel** registers its path box, or the merged box of copies that stay; staying copies are
  occupied.

Unknown block ids drop the element and push to `report.dangling`.

### Highlight

A highlight on a block or a part draws her hand-drawn red loop (fading after the usual
highlight time) and bounces the owning block, instead of the soft yellow mark. Point beats built
in `Lesson.tsx` from planner ids work unchanged: they highlight `plant`, which is now a block.

### Prompt

Interpolate `BLOCK_LANGUAGE` into the drawer prompt, before the other kinds. It holds the
`block` and `travel` docs, the list of valid ids, the rule that a block MUST be used when one
exists (and labels and arrows still added), and the catalog. Fifteen lines is cheap; past about
30 blocks, filter the catalog by the question's words and each block's `tags`.


## One beat, before and after

Same beat, same Haiku call settings, drawer prompt from `8b798ba` versus this branch. Beat b1 of
"What is photosynthesis?", region x 5..57, y 8..70, adds `plant`, `sun`, `sun-rays`.

Before (3.6 s):

```json
{"id": "plant", "kind": "box", "at": 0, "dur": 1.5, "color": "green", "args": [25, 40, 22, 24, 0], "text": "plant", "refs": ""}
{"id": "sun", "kind": "circle", "at": 0.2, "dur": 1, "color": "yellow", "args": [12, 16, 6, 1], "text": "sun", "refs": ""}
{"id": "sun-rays", "kind": "rays", "at": 1.2, "dur": 1.2, "color": "yellow", "args": [3], "text": "", "refs": "sun,plant"}
```

After (3.6 s):

```json
{"id": "plant", "kind": "block", "at": 0, "dur": 1.2, "color": "green", "args": [34, 50, 28, 0], "text": "plant", "refs": ""}
{"id": "sun", "kind": "block", "at": 0.3, "dur": 1, "color": "yellow", "args": [14, 20, 12, 0], "text": "sun", "refs": ""}
{"id": "sun-rays", "kind": "rays", "at": 1.2, "dur": 1.2, "color": "yellow", "args": [3], "text": "", "refs": "sun,plant.leaves"}
{"id": "plant-label", "kind": "label", "at": 2.4, "dur": 0.6, "color": "ink", "args": [], "text": "Plant: solar kitchen", "refs": "plant"}
```

The whole photosynthesis script from her `presets/preview.ts`, as one beat, is
`PHOTOSYNTHESIS` in `lib/blocks/demo.ts`; it plays at `/experiments/blocks`.

## Where our stage forced changes to her blocks

- Board: 1200x800 stage units on a 100x100 grid instead of 1920x1080 pixels. `size` is the
  block's longer side in grid x units; the block keeps its aspect, so it spans 1.5x as many grid
  y units.
- Marker: the theme's (lib/board/theme.ts: WHITEBOARD 4, CHALK and CHALKBOARD 4.5 stage px; hers
  5 / 6 px on 1920); draw speed 940 px/s (her 1500 px/s scaled to our width).
- Time: 60 fps and 240 ticks/s instead of 30 fps; 20 s documents with time 0 at the anchor word.
- Pop: a cubic overshoot on the 60 fps grid (as our `Scene` pops) instead of her spring ease.
- Colours and fills: her themes verbatim (lib/board/theme.ts), read from the scene's theme:
  on CHALK and CHALKBOARD a `-tint` becomes the board colour arriving as the outline starts, on
  WHITEBOARD the wash fades in, on a hatch theme her scribble is clipped to the shape; the chalk
  grain goes over the whole drawing in `Scene.build`.
- Labels use our Inter through the compiler's own label placement, not her Manrope labels.
- Highlights are her chalk loop (`Scene.loop`), the same one the compiler draws around any
  shape or label; her highlighter swipe was removed on her side too.
- Not ported: her `Board` class and timeline (`with`, `delay`), `move`, `remove`.
