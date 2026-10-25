// The factories at other settings, for a sheet: npx tsx presets/sheet.ts presets/computing/variants.ts
// Each copy gets its own id and title so the sheet shows them side by side.
import type { Block } from "../types";
import * as c from "./index";

const v = (block: Block, title: string): Block => ({ ...block, id: `${block.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title });

export const VARIANTS: Block[] = [
  v(c.makeNeuralNet({ layers: [2, 3, 1] }), "Net 2-3-1"),
  v(c.makeNeuralNet({ layers: [3, 5, 5, 2] }), "Net 3-5-5-2"),
  v(c.makePerceptron({ inputs: 5 }), "Perceptron, 5 Inputs"),
  v(c.makeActivation({ kind: "sigmoid" }), "Sigmoid"),
  v(c.makeClusters({ k: 2 }), "2 Clusters"),
  v(c.makeArray({ n: 3 }), "Array of 3"),
  v(c.makeMatrix({ rows: 2, cols: 3, color: "orange" }), "2x3 Matrix, Orange"),
  v(c.makeBinaryTree({ depth: 2 }), "Tree, Depth 2"),
  v(c.makeStack({ n: 5 }), "Stack of 5"),
  v(c.makeQueue({ n: 3 }), "Queue of 3"),
  v(c.makeSortBars({ values: [5, 1, 4, 2, 3] }), "Bars 5 1 4 2 3"),
  v(c.makeBarChart({ values: [3, 7, 2, 9] }), "Bars 3 7 2 9"),
  v(c.makePieChart({ parts: [0.5, 0.3, 0.2] }), "Pie 50/30/20"),
  v(c.makeLineChart({ values: [1, 4, 2, 6, 5], series: [2, 2, 3, 3, 4] }), "Two Lines"),
  v(c.makeGauge({ value: 0.9 }), "Gauge at 90%"),
  v(c.makeClock({ time: 3 }), "3 O'Clock"),
  v(c.makeBattery({ level: 0.25 }), "Battery 25%"),
  v(c.makeWifi({ bars: 1 }), "Wi-Fi, 1 Bar"),
  v(c.makeLock({ open: true }), "Open Lock"),
  v(c.makeUser({ people: 3 }), "Team of 3"),
  v(c.makeLaptop({ color: "purple" }), "Purple Laptop"),
];
