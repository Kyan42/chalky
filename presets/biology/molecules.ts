import type { Block, Shape } from "../types";

// Atoms in the usual model-kit colours: oxygen red, carbon dark grey, hydrogen white.
const ATOM = {
  O: { stroke: "red", fill: "red-tint" },
  C: { stroke: "ink", fill: "grey-tint" },
  H: { stroke: "grey", fill: "board" },
};
const atom = (kind: keyof typeof ATOM, cx: number, cy: number, r: number): Shape => ({ type: "ellipse", cx, cy, rx: r, ry: r, ...ATOM[kind] });

export const co2: Block = {
  id: "co2",
  title: "Carbon dioxide",
  describe: "a CO2 molecule: grey carbon between two red oxygens",
  tags: ["CO2", "carbon dioxide", "photosynthesis", "respiration", "gas", "carbon cycle"],
  size: [100, 40],
  parts: [{ id: "molecule", label: "carbon dioxide", shapes: [atom("O", 21, 20, 15), atom("O", 79, 20, 15), atom("C", 50, 20, 15)] }],
  anchors: { center: [50, 20], left: [6, 20], right: [94, 20] },
};

export const o2: Block = {
  id: "o2",
  title: "Oxygen",
  describe: "an O2 molecule: two red oxygen atoms",
  tags: ["O2", "oxygen", "photosynthesis", "respiration", "breathing", "gas"],
  size: [70, 40],
  parts: [{ id: "molecule", label: "oxygen", shapes: [atom("O", 22, 20, 15), atom("O", 48, 20, 15)] }],
  anchors: { center: [35, 20], left: [7, 20], right: [63, 20] },
};

export const h2o: Block = {
  id: "h2o",
  title: "Water molecule",
  describe: "an H2O molecule: a red oxygen with two white hydrogens",
  tags: ["H2O", "water", "molecule", "photosynthesis", "respiration"],
  size: [80, 60],
  parts: [{ id: "molecule", label: "water", shapes: [atom("H", 17, 40, 10), atom("H", 63, 40, 10), atom("O", 40, 26, 17)] }],
  anchors: { center: [40, 30], top: [40, 9], left: [7, 40], right: [73, 40] },
};

const hexagon = (cx: number, cy: number, r: number) =>
  [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return `${i ? "L" : "M"}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ") + " Z";

export const glucose: Block = {
  id: "glucose",
  title: "Glucose",
  describe: "a glucose (sugar) molecule drawn as a hexagon ring; food, stored energy",
  tags: ["glucose", "sugar", "food", "photosynthesis", "respiration", "energy", "carbohydrate"],
  size: [80, 80],
  parts: [
    {
      id: "ring",
      label: "glucose",
      shapes: [
        { type: "path", d: hexagon(40, 40, 32), stroke: "orange", fill: "yellow-tint" },
        { type: "path", d: hexagon(40, 40, 20), stroke: "orange", width: 0.6 },
      ],
    },
  ],
  anchors: { center: [40, 40], top: [40, 8], bottom: [40, 72], left: [12, 40], right: [68, 40] },
};
