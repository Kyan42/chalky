# Computing blocks: conventions

Blocks for lessons on computers, software, data, networks and AI. Same format as the biology
blocks (`presets/types.ts`), drawn on the same board (`presets/board.ts`) in any theme
(`presets/themes.ts`). Read `presets/README.md` and a few blocks in `presets/biology/` first.

## Flexible: a factory and a default

Anything with a natural size or count is a factory with options, plus a default instance:

```ts
export interface ArrayOptions { n?: number; color?: string }
/** An array of `n` cells in a row (default 6). */
export function makeArray({ n = 6, color = "blue" }: ArrayOptions = {}): Block { ... }
export const array = makeArray();
```

- Every factory takes `color` (the line colour; fills use `${color}-tint` when there is one), and
  clamps its counts to a sensible range (for example `n` 2–10), so any call still draws cleanly.
- Fixed things (a laptop, a robot) are a factory too, taking just `color`, so a lesson can recolour them.
- The default instance is what sheets show. Its const name is camelCase (`linkedList`); its `id`
  is kebab-case (`linked-list`). Factory names are `make` + PascalCase (`makeLinkedList`).
- A factory's `id` is the block's own id whatever the options; the board numbers each placed copy.

## Every element is addressable

Lessons point at, circle, label and send things to single elements, so:

- **Parts:** one part per element a lesson might talk about: `cell-0`, `cell-1`…; `node-0`…;
  `layer-0`, `layer-1`…; `bar-0`…; `edge-0-1`. Groups too where useful (`cells`, `nodes`, `edges`).
- **Anchors:** always `center`, `top`, `bottom`, `left`, `right`; plus one per element (the
  element's centre: `cell-3`, `layer-2-node-4`, `bar-1`) and the meaningful ends (`input`,
  `output`, `head`, `tail`, `root`, `top-of-stack`, `front`, `back`).
- Number from 0, left to right, top to bottom.

## Look

- Simple whiteboard line art, recognisable at 150px. No text in blocks (lessons add labels at anchors).
- Thick chalk: lines are 11px on screen and blocks usually show at 150–400px on their longer side.
  Keep elements big and spacing generous: at least 12 box units between parallel lines. Keep
  default counts modest (an array of 6, a neural net of [3, 4, 2]) and let lessons ask for more.
- Box: `size` [w, h] with the longer side 100. Factories may change the shorter side with the
  count (a long array is wide and short), but never thinner than 3:1.
- Shapes: `path` (SVG with only M, L, C, Q, Z; no arc commands), `ellipse`, `rect` (with `r` for
  rounded corners). `width` 1 for outlines, 0.8 for inner details.
- Colours. Lines: ink, grey, blue, green, red, orange, purple, brown, pink (never yellow). Fills:
  the line colour's `-tint`, `yellow-tint`, `grey-tint`, `nucleus-tint`, or `board` (white).
  By subject:
  - hardware and devices: ink lines, grey-tint or board fills (screens blue-tint);
  - software, files and data: blue;
  - networks and the internet: green;
  - AI, neural networks and models: purple;
  - algorithms, flow and control: orange;
  - charts: a blue series, then orange, then green; axes in ink;
  - errors, bugs, security, highlights: red.
- `describe`: one plain line for an AI model choosing a block, naming the options ("an array of n
  cells in a row; set n"). `tags`: 4–7 topic words. `title`: Title Case.

## Ids

Unique across computing, and not reusing a biology block id (sun, cloud, drop, energy, leaf,
plant, tree, acorn, apple, bud, cactus, carrot, chloroplast, flower, grass, mushroom, pine-tree,
pinecone, pollen, roots, seed, seedling, stoma, cell, mitochondrion, dna, neuron, amoeba, bacterium,
cell-membrane, chromosome, egg-cell, er, golgi, nucleus, plant-cell, red-blood-cell, ribosome,
sperm, vacuole, virus, white-blood-cell, yeast, amino-acid, atp, co2, glucose, h2o, ion, nitrogen,
o2, bladder, blood-vessel, bone, brain, ear, eye, heart, intestines, kidney, liver, lungs, muscle,
pancreas, skin, spine, stomach, tongue, tooth, blood-drop, body, embryo, foot, hand, heartbeat, knee,
mouth, ribcage, skeleton, skull, trachea, ant, bee, bird, bird-egg, butterfly, caterpillar, coral,
cow, earthworm, feather, fish, fox, frog, jellyfish, rabbit, seashell, snail, spider, tadpole).

## Check

```bash
npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --types node --skipLibCheck presets/computing/<file>.ts
npx tsx presets/sheet.ts presets/computing/<file>.ts chalk        # → presets/out/sheet-<file>-chalk.png
npx tsx presets/sheet.ts presets/computing/<file>.ts whiteboard
```

Sheets show each default instance. Also try a couple of factories at bigger and smaller counts
(write a throwaway module in your scratchpad that exports a few `makeX({...})` results and render
it with sheet.ts) to be sure every option draws cleanly.
