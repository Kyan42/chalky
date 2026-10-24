import { cubicAt, type P } from "../geometry";
import type { Block } from "../types";

// A scalloped crown: bumps around an oval, each a curve bulging outwards.
const crown = (() => {
  const n = 9, cx = 50, cy = 40, rx = 36, ry = 29;
  const at = (i: number, k: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return `${(cx + Math.cos(a) * rx * k).toFixed(1)} ${(cy + Math.sin(a) * ry * k).toFixed(1)}`;
  };
  let d = `M${at(0, 1)}`;
  for (let i = 0; i < n; i++) d += ` Q${at(i + 0.5, 1.32)} ${at(i + 1, 1)}`;
  return d + " Z";
})();

// The leaf's midrib runs from the stem to the tip; veins branch off it towards the edges.
const base: P = [28, 75], tip: P = [83, 17];
const rib = (t: number) => cubicAt(base, [44, 56], [62, 37], tip, t);
const veins = [0.3, 0.52, 0.72].flatMap((t, i) => {
  const [x, y] = rib(t);
  const len = 16 - i * 3;
  return [`M${x.toFixed(1)} ${y.toFixed(1)} L${(x - len * 0.2).toFixed(1)} ${(y - len).toFixed(1)}`, `M${x.toFixed(1)} ${y.toFixed(1)} L${(x + len).toFixed(1)} ${(y - len * 0.2).toFixed(1)}`];
});

export const leaf: Block = {
  id: "leaf",
  title: "Leaf",
  describe: "a single leaf with midrib, veins and stem; where photosynthesis happens",
  tags: ["leaf", "plant", "photosynthesis", "chlorophyll", "stomata", "transpiration"],
  size: [100, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [{ type: "path", d: "M28 75 L 14 93", stroke: "green" }] },
    { id: "blade", label: "leaf", shapes: [{ type: "path", d: "M28 75 C 24 49, 49 23, 83 17 C 80 47, 58 75, 28 75 Z", stroke: "green", fill: "green-tint" }] },
    { id: "midrib", label: "midrib", shapes: [{ type: "path", d: "M28 75 C 44 56, 62 37, 83 17", stroke: "green", width: 0.8 }] },
    { id: "veins", label: "veins", shapes: veins.map((d) => ({ type: "path" as const, d, stroke: "green", width: 0.6 })) },
  ],
  anchors: { center: [52, 48], surface: [45, 40], underside: [64, 58], tip: [83, 17], stem: [16, 90], midrib: rib(0.5) },
};

export const plant: Block = {
  id: "plant",
  title: "Plant",
  describe: "a small plant growing out of the soil, with two leaves and roots",
  tags: ["plant", "seedling", "growth", "roots", "soil", "photosynthesis", "water uptake"],
  size: [80, 100],
  parts: [
    { id: "soil", label: "soil", shapes: [{ type: "path", d: "M4 80 L 76 80", stroke: "brown" }] },
    {
      id: "roots",
      label: "roots",
      shapes: ["M40 80 C 40 87, 34 91, 28 96", "M40 80 C 41 88, 47 91, 53 96", "M40 80 L 40 97"].map((d) => ({ type: "path" as const, d, stroke: "brown", width: 0.7 })),
    },
    { id: "stem", label: "stem", shapes: [{ type: "path", d: "M40 80 C 40 64, 37 50, 40 32", stroke: "green" }] },
    {
      id: "leaves",
      label: "leaves",
      shapes: [
        { type: "path", d: "M39 56 C 30 43, 16 42, 8 46 C 14 57, 28 60, 39 56 Z", stroke: "green", fill: "green-tint" },
        { type: "path", d: "M40 40 C 49 28, 63 26, 72 30 C 66 41, 52 45, 40 40 Z", stroke: "green", fill: "green-tint" },
      ],
    },
  ],
  anchors: { leaf: [58, 34], leaves: [40, 42], stem: [39, 66], roots: [40, 92], soil: [64, 80], top: [40, 26], center: [40, 50] },
};

export const tree: Block = {
  id: "tree",
  title: "Tree",
  describe: "a tree with a round leafy crown, trunk and ground line",
  tags: ["tree", "plant", "forest", "carbon cycle", "oxygen", "ecosystem"],
  size: [100, 110],
  parts: [
    { id: "ground", label: "ground", shapes: [{ type: "path", d: "M18 104 L 82 104", stroke: "brown" }] },
    {
      id: "trunk",
      label: "trunk",
      shapes: [
        { type: "path", d: "M43 104 C 45 90, 46 78, 45 66 L 55 66 C 54 78, 55 90, 57 104 Z", stroke: "brown", fill: "brown-tint" },
      ],
    },
    {
      id: "crown",
      label: "leaves",
      shapes: [{ type: "path", d: crown, stroke: "green", fill: "green-tint" }],
    },
  ],
  anchors: { crown: [50, 38], leaves: [50, 38], top: [50, 6], left: [8, 40], right: [92, 40], trunk: [50, 88], ground: [76, 104], roots: [50, 106] },
};
