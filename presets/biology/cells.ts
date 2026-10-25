import { blob, pill, smooth, wave, type P } from "../geometry";
import type { Block } from "../types";

export const cell: Block = {
  id: "cell",
  title: "Cell",
  describe: "a simple animal cell: membrane, nucleus and a few organelle dots",
  tags: ["cell", "membrane", "nucleus", "cytoplasm", "organism", "eukaryote"],
  size: [100, 100],
  parts: [
    { id: "membrane", label: "cell membrane", shapes: [{ type: "path", d: blob(50, 50, 44, 40, [0.03, -0.02, 0.04, 0, -0.03, 0.02, -0.02, 0.04, 0.01, -0.03, 0.02, 0]), stroke: "purple", fill: "purple-tint" }] },
    { id: "nucleus", label: "nucleus", shapes: [{ type: "ellipse", cx: 46, cy: 48, rx: 14, ry: 13, stroke: "purple", fill: "nucleus-tint" }, { type: "ellipse", cx: 49, cy: 51, rx: 4, ry: 4, stroke: "purple", width: 0.7 }] },
    {
      id: "organelles",
      label: "organelles",
      shapes: [[74, 36], [70, 66], [28, 70], [26, 34], [56, 78]].map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 3.5, ry: 3.5, stroke: "purple", width: 0.7 })),
    },
  ],
  anchors: { center: [50, 50], nucleus: [46, 48], membrane: [94, 50], cytoplasm: [70, 66], top: [50, 8], bottom: [50, 92], left: [6, 50], right: [94, 50] },
};

export const mitochondrion: Block = {
  id: "mitochondrion",
  title: "Mitochondrion",
  describe: "a mitochondrion: capsule with a folded inner membrane; where respiration makes energy",
  tags: ["mitochondria", "respiration", "ATP", "energy", "organelle", "powerhouse"],
  size: [100, 60],
  parts: [
    { id: "outer", label: "outer membrane", shapes: [{ type: "path", d: pill(26, 30, 74, 30, 23), stroke: "orange", fill: "orange-tint" }] },
    { id: "cristae", label: "cristae", shapes: [{ type: "path", d: wave(14, 86, 30, 11, 3.5), stroke: "orange", width: 0.8 }] },
  ],
  anchors: { center: [50, 30], left: [3, 30], right: [97, 30], top: [50, 7], bottom: [50, 53] },
};

// Two strands half a turn apart, base pairs between them.
const strand = (phase: number) => {
  const pts: P[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = 6 + (88 * i) / 24;
    pts.push([30 + 20 * Math.sin(phase + (i / 24) * Math.PI * 4), y]);
  }
  return smooth(pts);
};
const rungs: string[] = [];
for (let i = 1; i < 12; i++) {
  const y = 6 + (88 * i) / 12, t = (i / 12) * Math.PI * 4;
  const a = 30 + 20 * Math.sin(t), b = 30 + 20 * Math.sin(t + Math.PI);
  if (Math.abs(a - b) > 12) rungs.push(`M${a.toFixed(1)} ${y.toFixed(1)} L${b.toFixed(1)} ${y.toFixed(1)}`);
}

export const dna: Block = {
  id: "dna",
  title: "DNA",
  describe: "a short stretch of DNA double helix with base pairs",
  tags: ["DNA", "gene", "genetics", "chromosome", "heredity", "base pair"],
  size: [60, 100],
  parts: [
    { id: "strand-a", label: "DNA strand", shapes: [{ type: "path", d: strand(0), stroke: "blue" }] },
    { id: "strand-b", label: "DNA strand", shapes: [{ type: "path", d: strand(Math.PI), stroke: "red" }] },
    { id: "base-pairs", label: "base pairs", shapes: rungs.map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.6 })) },
  ],
  anchors: { center: [30, 50], top: [30, 4], bottom: [30, 96], left: [8, 50], right: [52, 50] },
};

export const neuron: Block = {
  id: "neuron",
  title: "Neuron",
  describe: "a nerve cell: cell body with dendrites, a long axon and its terminals, left to right",
  tags: ["neuron", "nerve", "brain", "signal", "nervous system", "synapse"],
  size: [100, 50],
  parts: [
    {
      id: "dendrites",
      label: "dendrites",
      shapes: ["M18 22 L 8 10", "M14 26 L 3 26", "M18 30 L 9 42", "M23 19 L 26 6"].map((d) => ({ type: "path" as const, d, stroke: "purple", width: 0.8 })),
    },
    { id: "body", label: "cell body", shapes: [{ type: "ellipse", cx: 22, cy: 26, rx: 9, ry: 9, stroke: "purple", fill: "purple-tint" }] },
    { id: "axon", label: "axon", shapes: [{ type: "path", d: "M31 26 L 84 26", stroke: "purple" }] },
    {
      id: "terminals",
      label: "axon terminals",
      shapes: [
        { type: "path", d: "M84 26 L 94 16 M84 26 L 96 26 M84 26 L 94 36", stroke: "purple", width: 0.8 },
      ],
    },
  ],
  anchors: { body: [22, 26], dendrites: [6, 14], axon: [58, 26], terminals: [96, 26], left: [2, 26], right: [98, 26] },
};
