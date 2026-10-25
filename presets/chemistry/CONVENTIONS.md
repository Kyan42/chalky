# Chemistry blocks: conventions

Blocks for lessons on matter, atoms, bonding, reactions and the lab. Same format as the other blocks
(`presets/types.ts`), drawn on the same board (`presets/board.ts`) in any theme (`presets/themes.ts`).
Read `presets/README.md`, `presets/computing/CONVENTIONS.md` and one of `presets/computing/*.ts`
(`data.ts` has a good `finish`/fit helper and scribble shading) first. These rules follow the
computing ones; differences are below.

## Flexible: a factory and a default

```ts
export interface BeakerOptions { fill?: number; liquid?: string; bubbles?: number; color?: string }
/** A beaker, `fill` full (0–1, default 0.5) of `liquid`-coloured liquid. */
export function makeBeaker({ fill = 0.5, liquid = "blue", bubbles = 0, color = "ink" }: BeakerOptions = {}): Block { ... }
export const beaker = makeBeaker();
```

- Every factory takes `color` and clamps its options so any call draws cleanly. Fixed things are a
  factory too. Default const camelCase, id kebab-case, factory `make` + PascalCase.
- Make the options the ones a chemistry lesson would actually change: fill level and liquid colour
  in glassware; protons, neutrons and electrons in an atom; the atoms and bonds in a molecule; the
  activation energy and catalyst in an energy profile; the pH on a scale; particle counts.

## Every element is addressable

Parts and anchors for each thing a lesson might point at: `atom-0`, `bond-0-1`, `electron-2`,
`shell-1`, `liquid`, `surface` (the liquid's top), `flame`, `particle-3`, `peak`, `reactants`,
`products`. Always `center`, `top`, `bottom`, `left`, `right`. Glassware also has `mouth` (the opening)
and `base`. Number from 0.

## Look

- Simple whiteboard line art, recognisable at 150px, no text in blocks (element symbols too: a lesson
  labels atoms at their anchors). Thick chalk: lines are 11px on screen, so at least 12 box units
  between parallel lines; modest defaults.
- **Fills disappear in the chalk theme** (it draws no fills). Anything that must read as filled —
  liquid in glassware, a shaded region, a solid — needs strokes too: a liquid gets its surface line
  plus a couple of short wavy lines or a scribble; a precipitate gets dots.
- Box with the longer side 100, never thinner than 3:1. Shapes: path (M, L, C, Q, Z only), ellipse,
  rect. Width 1 outlines, 0.8 details.
- Colours. Lines: ink, grey, blue, green, red, orange, purple, brown, pink (never yellow). Fills: the
  line colour's `-tint`, `yellow-tint`, `grey-tint`, `board`.
  - glassware and apparatus: ink lines; liquids blue unless set;
  - heat, flames, energy: orange (hot core red);
  - acids red, bases purple, neutral green (pH scale runs red → orange → green → blue → purple);
  - particles of matter: blue;
  - atoms, one colour per element, the same in every file:
    H `board` fill with ink outline, C ink (grey-tint fill), O red, N blue, Cl and F green,
    S orange, Na and K purple, metals grey, others brown. Protons red, neutrons grey, electrons blue.
  - Atom balls: radius 10 for H, 13 for everything else, in box units of a molecule drawn at its
    natural size before fitting.
- describe: one plain line naming the options. tags: 4–7 topic words. title: Title Case.

## Ids

Unique across chemistry, and not any id already used:
sun, cloud, drop, energy, leaf, plant, tree, acorn, apple, bud, cactus, carrot, chloroplast, flower, grass, mushroom, pine-tree, pinecone, pollen, roots, seed, seedling, stoma, cell, mitochondrion, dna, neuron, amoeba, bacterium, cell-membrane, chromosome, egg-cell, er, golgi, nucleus, plant-cell, red-blood-cell, ribosome, sperm, vacuole, virus, white-blood-cell, yeast, amino-acid, atp, co2, glucose, h2o, ion, nitrogen, o2, bladder, blood-vessel, bone, brain, ear, eye, heart, intestines, kidney, liver, lungs, muscle, pancreas, skin, spine, stomach, tongue, tooth, blood-drop, body, embryo, foot, hand, heartbeat, knee, mouth, ribcage, skeleton, skull, trachea, ant, bee, bird, bird-egg, butterfly, caterpillar, coral, cow, earthworm, feather, fish, fox, frog, jellyfish, rabbit, seashell, snail, spider, tadpole, battery, cable, camera, cell-tower, cpu, gpu, headphones, keyboard, laptop, microphone, monitor, mouse, phone, ram, router, satellite, server, server-rack, ssd, wifi, app-window, browser, bug, chat, cloud-computing, code, cursor, database, email, file, firewall, folder, gear, globe, key, link, lock, search, terminal, user, array, binary-tree, bits, function-box, graph, hash-table, heap, key-value, linked-list, loop, matrix, pixel-grid, queue, recursion, search-pointer, sort-bars, stack, table, tree-structure, venn, activation, ai-chip, attention, clusters, convolution, dataset, decision-boundary, embedding-space, gradient-descent, image-classifier, layer, loss-curve, model, neural-net, perceptron, pooling, robot, token, training-loop, transformer, axes, bar-chart, bell-curve, big-o, clock, decision, flow-step, gauge, heatmap, histogram, line-chart, number-line, pie-chart, pipeline, progress-bar, scatter-plot, sine-wave, state-machine, timeline, vector.
(So: `water-molecule` not `h2o`, `atomic-nucleus` not `nucleus`, `ionic-charge` not `ion`.)

## Check

```bash
npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --types node --skipLibCheck presets/chemistry/<file>.ts
npx tsx presets/sheet.ts presets/chemistry/<file>.ts chalk        # → presets/out/sheet-<file>-chalk.png
npx tsx presets/sheet.ts presets/chemistry/<file>.ts whiteboard
```

Look at both sheets (Read the PNG). Also render a throwaway module in your scratchpad exporting
factories at small and large settings — give each copy its own `id` and `title`
(`{ ...makeX({...}), id: "x-big", title: "X Big" }`), since sheet.ts drops repeated ids — and fix
anything that clogs or breaks. Keep only your one file in `presets/chemistry/`.
