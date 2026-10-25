import { pill, smooth, type P } from "../geometry";
import type { Block, Shape } from "../types";

const f = (v: number) => v.toFixed(1);
const line = (d: string, stroke: string, width = 1): Shape => ({ type: "path", d, stroke, width });

// A scalloped ring: `n` bumps around (cx, cy), each a curve bulging out to k × r.
function scallop(cx: number, cy: number, r: number, n: number, k: number, turn = -Math.PI / 2): string {
  const at = (i: number, s: number) => {
    const a = turn + (i / n) * Math.PI * 2;
    return `${f(cx + Math.cos(a) * r * s)} ${f(cy + Math.sin(a) * r * s)}`;
  };
  let d = `M${at(0, 1)}`;
  for (let i = 0; i < n; i++) d += ` C${at(i + 0.15, k)} ${at(i + 0.85, k)} ${at(i + 1, 1)}`;
  return d + " Z";
}

export const flower: Block = {
  id: "flower",
  title: "Flower",
  describe: "a flower with petals around a centre, on a short stem with a leaf",
  tags: ["flower", "petals", "pollination", "reproduction", "plant", "nectar"],
  size: [80, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [line("M40 58 C 39 72, 41 84, 40 97", "green")] },
    { id: "leaf", label: "leaf", shapes: [{ type: "path", d: "M40 82 C 46 70, 58 66, 68 68 C 64 78, 52 84, 40 82 Z", stroke: "green", fill: "green-tint" }] },
    { id: "petals", label: "petals", shapes: [{ type: "path", d: scallop(40, 34, 19, 6, 1.75), stroke: "pink", fill: "pink-tint" }] },
    { id: "centre", label: "centre", shapes: [{ type: "ellipse", cx: 40, cy: 34, rx: 10, ry: 10, stroke: "orange", fill: "yellow-tint" }] },
  ],
  anchors: { center: [40, 40], top: [40, 3], bottom: [40, 97], left: [6, 34], right: [74, 34], petals: [62, 22], centre: [40, 34], stem: [40, 70], leaf: [58, 72] },
};

export const seed: Block = {
  id: "seed",
  title: "Seed",
  describe: "a single bean-shaped seed with its seed coat; what a new plant grows from",
  tags: ["seed", "germination", "plant", "reproduction", "embryo", "growth"],
  size: [100, 70],
  parts: [
    { id: "coat", label: "seed coat", shapes: [{ type: "path", d: "M50 14 C 72 6, 94 16, 94 36 C 94 56, 72 66, 50 60 C 38 57, 30 64, 20 62 C 8 60, 4 48, 6 36 C 8 18, 30 20, 50 14 Z", stroke: "brown", fill: "brown-tint" }] },
    { id: "embryo", label: "embryo", shapes: [line("M30 40 C 40 30, 56 28, 70 34", "brown", 0.8)] },
  ],
  anchors: { center: [50, 36], top: [50, 12], bottom: [50, 62], left: [6, 38], right: [94, 36], coat: [80, 18], embryo: [50, 32] },
};

export const seedling: Block = {
  id: "seedling",
  title: "Seedling",
  describe: "a seedling just sprouted: two round seed leaves, a little stem and roots below the soil",
  tags: ["seedling", "germination", "sprout", "growth", "seed", "roots"],
  size: [80, 100],
  parts: [
    { id: "soil", label: "soil", shapes: [line("M4 62 L 76 62", "brown")] },
    { id: "roots", label: "roots", shapes: [line("M40 70 C 40 80, 36 88, 30 96", "brown", 0.8), line("M40 70 C 42 80, 46 88, 48 96", "brown", 0.8)] },
    { id: "stem", label: "stem", shapes: [line("M40 70 C 40 56, 36 46, 40 34", "green")] },
    {
      id: "leaves",
      label: "seed leaves",
      shapes: [
        { type: "path", d: "M40 34 C 34 18, 16 14, 6 20 C 10 34, 28 40, 40 34 Z", stroke: "green", fill: "green-tint" },
        { type: "path", d: "M40 34 C 46 18, 64 14, 74 20 C 70 34, 52 40, 40 34 Z", stroke: "green", fill: "green-tint" },
      ],
    },
  ],
  anchors: { center: [40, 50], top: [40, 14], bottom: [40, 96], left: [6, 22], right: [74, 22], leaves: [22, 26], stem: [39, 50], roots: [40, 88], soil: [70, 62] },
};

export const roots: Block = {
  id: "roots",
  title: "Roots",
  describe: "a plant's root system below the soil line: a main taproot with side roots branching off",
  tags: ["roots", "water uptake", "minerals", "soil", "plant", "anchor"],
  size: [100, 100],
  parts: [
    { id: "shoot", label: "shoot", shapes: [line("M50 28 L 50 6", "green"), { type: "path", d: "M50 14 C 42 4, 30 4, 24 8 C 30 18, 42 18, 50 14 Z", stroke: "green", fill: "green-tint" }] },
    { id: "soil", label: "soil", shapes: [line("M6 28 L 94 28", "brown")] },
    { id: "taproot", label: "main root", shapes: [line("M50 28 C 52 50, 48 72, 50 95", "brown")] },
    {
      id: "side-roots",
      label: "side roots",
      shapes: ["M50 42 C 40 46, 28 50, 14 62", "M50 52 C 62 56, 74 62, 86 74", "M50 68 C 42 72, 32 80, 26 92", "M50 80 C 58 82, 66 86, 72 94"].map((d) => line(d, "brown", 0.8)),
    },
  ],
  anchors: { center: [50, 55], top: [50, 6], bottom: [50, 95], left: [14, 62], right: [86, 74], roots: [50, 62], soil: [82, 28], shoot: [50, 12], "root-tip": [50, 95] },
};

export const cactus: Block = {
  id: "cactus",
  title: "Cactus",
  describe: "a desert cactus with a tall body and two arms raised; a plant adapted to dry places",
  tags: ["cactus", "desert", "adaptation", "water storage", "plant", "habitat"],
  size: [100, 100],
  parts: [
    { id: "ground", label: "ground", shapes: [line("M12 93 L 88 93", "brown")] },
    {
      id: "body",
      label: "stem",
      shapes: [
        {
          type: "path",
          d: "M38 93 L 38 70 L 22 70 Q 10 70 10 58 L 10 36 Q 10 28 18 28 Q 26 28 26 36 L 26 56 L 38 56 L 38 22 Q 38 8 50 8 Q 62 8 62 22 L 62 48 L 74 48 L 74 30 Q 74 22 82 22 Q 90 22 90 30 L 90 50 Q 90 62 78 62 L 62 62 L 62 93 Z",
          stroke: "green",
          fill: "green-tint",
        },
      ],
    },
    { id: "rib", label: "ribs", shapes: [line("M50 20 L 50 84", "green", 0.8)] },
  ],
  anchors: { center: [50, 52], top: [50, 8], bottom: [50, 93], left: [10, 40], right: [90, 36], stem: [50, 60], arms: [18, 34], spines: [62, 30] },
};

export const grass: Block = {
  id: "grass",
  title: "Grass",
  describe: "a tuft of grass blades growing from the ground; a producer at the base of food chains",
  tags: ["grass", "producer", "food chain", "meadow", "plant", "habitat"],
  size: [100, 70],
  parts: [
    { id: "ground", label: "ground", shapes: [line("M6 64 L 94 64", "brown")] },
    {
      id: "blades",
      label: "grass blades",
      shapes: [
        "M28 64 C 26 48, 18 32, 8 22",
        "M40 64 C 40 44, 36 24, 28 8",
        "M52 64 C 52 44, 54 24, 52 4",
        "M64 64 C 64 46, 70 28, 78 12",
        "M74 64 C 76 50, 84 38, 94 30",
      ].map((d) => line(d, "green")),
    },
  ],
  anchors: { center: [50, 40], top: [52, 4], bottom: [50, 64], left: [8, 22], right: [94, 30], blades: [52, 30], ground: [86, 64] },
};

export const pineTree: Block = {
  id: "pine-tree",
  title: "Pine Tree",
  describe: "a pointed evergreen pine tree with tiers of needles and a short trunk; a conifer",
  tags: ["pine", "conifer", "evergreen", "tree", "forest", "cones"],
  size: [80, 100],
  parts: [
    { id: "trunk", label: "trunk", shapes: [{ type: "rect", x: 33, y: 76, w: 14, h: 20, r: 2, stroke: "brown", fill: "brown-tint" }] },
    {
      id: "needles",
      label: "needles",
      shapes: [{ type: "path", d: "M40 4 L 60 30 L 50 30 L 68 53 L 57 53 L 76 78 L 4 78 L 23 53 L 12 53 L 30 30 L 20 30 Z", stroke: "green", fill: "green-tint" }],
    },
  ],
  anchors: { center: [40, 50], top: [40, 4], bottom: [40, 96], left: [4, 78], right: [76, 78], needles: [40, 40], trunk: [40, 88] },
};

// Rows of scales across the cone: each row a line of downward scallops, clipped to the cone's width.
const coneRows = [30, 46, 62, 78].map((y, i) => {
  const half = Math.sqrt(Math.max(0, 1 - ((y - 54) / 44) ** 2)) * 26 - 3;
  const x0 = 35 - half, x1 = 35 + half, n = i === 3 ? 2 : 3;
  let d = `M${f(x0)} ${y}`;
  for (let k = 0; k < n; k++) {
    const a = x0 + ((x1 - x0) * k) / n, b = x0 + ((x1 - x0) * (k + 1)) / n;
    d += ` Q${f((a + b) / 2)} ${y + 10} ${f(b)} ${y}`;
  }
  return d;
});

export const pinecone: Block = {
  id: "pinecone",
  title: "Pinecone",
  describe: "a pinecone: an oval cone covered in rows of woody scales; holds a conifer's seeds",
  tags: ["pinecone", "conifer", "seeds", "pine", "reproduction", "tree"],
  size: [70, 100],
  parts: [
    { id: "stalk", label: "stalk", shapes: [line("M35 12 L 35 3", "brown")] },
    { id: "cone", label: "cone", shapes: [{ type: "path", d: smooth([[35, 10], [55, 22], [61, 50], [50, 82], [35, 98], [20, 82], [9, 50], [15, 22]], true), stroke: "brown", fill: "brown-tint" }] },
    { id: "scales", label: "scales", shapes: coneRows.map((d) => line(d, "brown", 0.8)) },
  ],
  anchors: { center: [35, 54], top: [35, 3], bottom: [35, 98], left: [9, 50], right: [61, 50], scales: [35, 50], seeds: [48, 66] },
};

export const apple: Block = {
  id: "apple",
  title: "Apple",
  describe: "a round apple with a stalk and a leaf; a fruit that holds seeds",
  tags: ["apple", "fruit", "seeds", "food", "plant", "nutrition"],
  size: [100, 100],
  parts: [
    { id: "fruit", label: "fruit", shapes: [{ type: "path", d: "M50 30 C 40 20, 12 22, 12 54 C 12 80, 32 96, 42 94 C 46 93, 54 93, 58 94 C 68 96, 88 80, 88 54 C 88 22, 60 20, 50 30 Z", stroke: "red", fill: "red-tint" }] },
    { id: "stalk", label: "stalk", shapes: [line("M50 30 C 50 22, 51 14, 54 6", "brown")] },
    { id: "leaf", label: "leaf", shapes: [{ type: "path", d: "M53 16 C 60 6, 74 4, 84 8 C 78 20, 64 22, 53 16 Z", stroke: "green", fill: "green-tint" }] },
  ],
  anchors: { center: [50, 60], top: [52, 6], bottom: [50, 94], left: [12, 54], right: [88, 54], fruit: [50, 62], stalk: [51, 20], leaf: [70, 12] },
};

export const acorn: Block = {
  id: "acorn",
  title: "Acorn",
  describe: "an acorn: an oak's nut with its scaly cap and stalk; a seed of the oak tree",
  tags: ["acorn", "oak", "seed", "nut", "tree", "dispersal"],
  size: [80, 100],
  parts: [
    { id: "nut", label: "nut", shapes: [{ type: "path", d: "M14 44 C 12 66, 28 88, 40 96 C 52 88, 68 66, 66 44 Z", stroke: "brown", fill: "orange-tint" }] },
    {
      id: "cap",
      label: "cap",
      shapes: [
        { type: "path", d: "M6 48 C 6 28, 22 16, 40 16 C 58 16, 74 28, 74 48 C 58 54, 22 54, 6 48 Z", stroke: "brown", fill: "brown-tint" },
        line("M16 34 C 30 27, 50 27, 64 34", "brown", 0.8),
      ],
    },
    { id: "stalk", label: "stalk", shapes: [line("M40 16 C 40 10, 42 6, 46 3", "brown")] },
  ],
  anchors: { center: [40, 54], top: [44, 3], bottom: [40, 96], left: [6, 46], right: [74, 46], cap: [40, 30], nut: [40, 70], stalk: [43, 8] },
};

export const mushroom: Block = {
  id: "mushroom",
  title: "Mushroom",
  describe: "a mushroom with a domed cap on a thick stem; a fungus and decomposer",
  tags: ["mushroom", "fungi", "decomposer", "spores", "decay", "toadstool"],
  size: [100, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [{ type: "path", d: "M41 56 C 40 70, 38 82, 30 94 L 70 94 C 62 82, 60 70, 59 56", stroke: "brown", fill: "board" }] },
    { id: "cap", label: "cap", shapes: [{ type: "path", d: "M6 54 C 6 24, 30 8, 50 8 C 70 8, 94 24, 94 54 C 72 62, 28 62, 6 54 Z", stroke: "brown", fill: "brown-tint" }] },
    { id: "spots", label: "spots", shapes: [{ type: "ellipse", cx: 32, cy: 32, rx: 8, ry: 6, stroke: "brown", width: 0.8 }, { type: "ellipse", cx: 64, cy: 26, rx: 9, ry: 7, stroke: "brown", width: 0.8 }] },
  ],
  anchors: { center: [50, 50], top: [50, 8], bottom: [50, 94], left: [6, 52], right: [94, 52], cap: [50, 30], gills: [50, 58], stem: [50, 82] },
};

export const chloroplast: Block = {
  id: "chloroplast",
  title: "Chloroplast",
  describe: "a chloroplast: green capsule with stacks of thylakoids inside; where photosynthesis happens",
  tags: ["chloroplast", "photosynthesis", "chlorophyll", "organelle", "plant cell", "light"],
  size: [100, 60],
  parts: [
    { id: "membrane", label: "membrane", shapes: [{ type: "path", d: pill(28, 30, 72, 30, 26), stroke: "green", fill: "green-tint" }] },
    { id: "lamellae", label: "lamellae", shapes: [line("M8 30 L 92 30", "green", 0.8)] },
    {
      id: "grana",
      label: "grana",
      shapes: [26, 50, 74].map((cx) => ({ type: "rect" as const, x: cx - 6, y: 14, w: 12, h: 32, r: 3, stroke: "green", fill: "green-tint", width: 0.8 })),
    },
  ],
  anchors: { center: [50, 30], top: [50, 4], bottom: [50, 56], left: [2, 30], right: [98, 30], grana: [50, 16], stroma: [38, 46] },
};

export const stoma: Block = {
  id: "stoma",
  title: "Stoma",
  describe: "a stoma: two bean-shaped guard cells around a pore on a leaf, where gases pass in and out",
  tags: ["stomata", "guard cells", "gas exchange", "transpiration", "leaf", "pore"],
  size: [80, 100],
  parts: [
    {
      id: "guard-cells",
      label: "guard cells",
      shapes: [
        { type: "path", d: "M40 6 C 18 6, 4 26, 4 50 C 4 74, 18 94, 40 94 L 40 82 C 30 74, 24 62, 24 50 C 24 38, 30 26, 40 18 Z", stroke: "green", fill: "green-tint" },
        { type: "path", d: "M40 6 C 62 6, 76 26, 76 50 C 76 74, 62 94, 40 94 L 40 82 C 50 74, 56 62, 56 50 C 56 38, 50 26, 40 18 Z", stroke: "green", fill: "green-tint" },
      ],
    },
  ],
  anchors: { center: [40, 50], top: [40, 6], bottom: [40, 94], left: [4, 50], right: [76, 50], pore: [40, 50], "guard-cell": [14, 50] },
};

// A rounded spiky outline: alternate inner and outer points, smoothed.
const pollenEdge = smooth(
  Array.from({ length: 24 }, (_, i): P => {
    const a = (i / 24) * Math.PI * 2, r = i % 2 ? 44 : 34;
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
  }),
  true,
  0.5,
);

export const pollen: Block = {
  id: "pollen",
  title: "Pollen",
  describe: "a pollen grain seen up close: a round spiky grain; carried by insects or wind to pollinate",
  tags: ["pollen", "pollination", "flower", "reproduction", "bees", "allergy"],
  size: [100, 100],
  parts: [
    { id: "grain", label: "pollen grain", shapes: [{ type: "path", d: pollenEdge, stroke: "orange", fill: "yellow-tint" }] },
    { id: "pores", label: "pores", shapes: [[50, 36], [38, 58], [62, 58]].map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 6, ry: 6, stroke: "orange", width: 0.8 })) },
  ],
  anchors: { center: [50, 50], top: [50, 6], bottom: [50, 94], left: [6, 50], right: [94, 50], spikes: [81, 19], pores: [50, 36] },
};

export const bud: Block = {
  id: "bud",
  title: "Bud",
  describe: "a closed flower bud held by green sepals on a stem, about to open",
  tags: ["bud", "flower", "growth", "sepals", "plant", "spring"],
  size: [70, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [line("M35 64 C 34 76, 36 86, 35 97", "green")] },
    { id: "bud", label: "bud", shapes: [{ type: "path", d: "M35 6 C 50 20, 58 38, 52 54 C 48 62, 22 62, 18 54 C 12 38, 20 20, 35 6 Z", stroke: "pink", fill: "pink-tint" }, line("M35 20 C 41 32, 41 44, 36 56", "pink", 0.8)] },
    {
      id: "sepals",
      label: "sepals",
      shapes: [
        { type: "path", d: "M35 66 C 20 64, 10 52, 8 36 C 20 42, 30 52, 35 66 Z", stroke: "green", fill: "green-tint" },
        { type: "path", d: "M35 66 C 50 64, 60 52, 62 36 C 50 42, 40 52, 35 66 Z", stroke: "green", fill: "green-tint" },
      ],
    },
  ],
  anchors: { center: [35, 50], top: [35, 6], bottom: [35, 97], left: [8, 38], right: [62, 38], bud: [35, 34], sepals: [14, 46], stem: [35, 82] },
};

export const carrot: Block = {
  id: "carrot",
  title: "Carrot",
  describe: "a carrot: an orange taproot pointing down with leafy green tops; a root we eat",
  tags: ["carrot", "root", "taproot", "vegetable", "food storage", "plant"],
  size: [70, 100],
  parts: [
    { id: "leaves", label: "leaves", shapes: ["M35 32 C 30 22, 22 12, 12 6", "M35 32 C 35 22, 35 12, 35 2", "M35 32 C 40 22, 48 12, 58 6"].map((d) => line(d, "green")) },
    { id: "root", label: "root", shapes: [{ type: "path", d: "M12 36 C 12 28, 58 28, 58 36 C 56 58, 44 80, 35 97 C 26 80, 14 58, 12 36 Z", stroke: "orange", fill: "orange-tint" }] },
    { id: "rings", label: "root rings", shapes: ["M18 50 L 30 50", "M40 62 L 50 62", "M26 74 L 36 74"].map((d) => line(d, "orange", 0.8)) },
  ],
  anchors: { center: [35, 54], top: [35, 2], bottom: [35, 97], left: [12, 38], right: [58, 38], root: [35, 56], leaves: [35, 14], tip: [35, 95] },
};
