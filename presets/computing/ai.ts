// AI and machine learning blocks: neural networks, training, data and models. Purple for AI, blue for
// charts and data, orange for algorithms. Each block is drawn in its own logical units and `fit`
// scales it so the longer side is 100, so a factory can grow with its counts and stay in proportion.
import { poly, smooth, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---------- helpers ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const r1 = (v: number) => +v.toFixed(1);

/** A small seeded random generator (mulberry32), so "random" layouts are the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tint = (color: string) => (color === "ink" ? "grey-tint" : `${color}-tint`);

const circle = (cx: number, cy: number, r: number, stroke: string, fill?: string, width?: number): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(fill ? { fill } : {}), ...(width ? { width } : {}),
});
const rect = (x: number, y: number, w: number, h: number, stroke: string, o: { r?: number; fill?: string; width?: number } = {}): Shape => ({
  type: "rect", x, y, w, h, stroke, ...(o.r ? { r: o.r } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const path = (d: string, stroke: string, width?: number, fill?: string): Shape => ({ type: "path", d, stroke, ...(width ? { width } : {}), ...(fill ? { fill } : {}) });

/** A straight arrow from a to b with a two-stroke head. */
function arrowD(a: P, b: P, head = 6): string {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const h1: P = [b[0] - head * Math.cos(ang - 0.5), b[1] - head * Math.sin(ang - 0.5)];
  const h2: P = [b[0] - head * Math.cos(ang + 0.5), b[1] - head * Math.sin(ang + 0.5)];
  return `${poly([a, b])} ${poly([h1, b, h2])}`;
}
/** An arrow head at `tip`, pointing along the direction `from` → `tip`. */
function headD(from: P, tip: P, head = 6): string {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  return poly([[tip[0] - head * Math.cos(ang - 0.5), tip[1] - head * Math.sin(ang - 0.5)], tip, [tip[0] - head * Math.cos(ang + 0.5), tip[1] - head * Math.sin(ang + 0.5)]]);
}
/** A line from circle a to circle b, starting and ending on their rims. */
function between(a: P, ra: number, b: P, rb: number): string {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
  return poly([[a[0] + (dx / d) * ra, a[1] + (dy / d) * ra], [b[0] - (dx / d) * rb, b[1] - (dy / d) * rb]]);
}

type Draft = Omit<Block, "size"> & { W: number; H: number };

/**
 * Scales a drawing made in W × H logical units so its longer side is 100, pads the shorter side so
 * the box is never thinner than 3:1, and fills in the standard anchors it does not name.
 */
function fit({ W, H, parts, anchors, ...rest }: Draft): Block {
  const s = 100 / Math.max(W, H);
  let w = W * s, h = H * s, dx = 0, dy = 0;
  if (h < w / 3) { dy = (w / 3 - h) / 2; h = w / 3; }
  if (w < h / 3) { dx = (h / 3 - w) / 2; w = h / 3; }
  const X = (v: number) => r1(v * s + dx), Y = (v: number) => r1(v * s + dy), S = (v: number) => r1(v * s);
  const tx = (d: string) => {
    let i = 0;
    return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (m) => String(i++ % 2 ? Y(+m) : X(+m)));
  };
  const shape = (sh: Shape): Shape => {
    if (sh.type === "path") return { ...sh, d: tx(sh.d) };
    if (sh.type === "ellipse") return { ...sh, cx: X(sh.cx), cy: Y(sh.cy), rx: S(sh.rx), ry: S(sh.ry) };
    return { ...sh, x: X(sh.x), y: Y(sh.y), w: S(sh.w), h: S(sh.h), ...(sh.r ? { r: S(sh.r) } : {}) };
  };
  const out: Record<string, [number, number]> = {};
  for (const [k, [x, y]] of Object.entries(anchors)) out[k] = [X(x), Y(y)];
  const std: Record<string, P> = { center: [W / 2, H / 2], top: [W / 2, 0], bottom: [W / 2, H], left: [0, H / 2], right: [W, H / 2] };
  for (const [k, [x, y]] of Object.entries(std)) out[k] ??= [X(x), Y(y)];
  return { ...rest, size: [r1(w), r1(h)], parts: parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors: out };
}

// ---------- neural networks ----------

export interface NeuralNetOptions { layers?: number[]; color?: string }
/** A fully connected network: columns of nodes with weights between consecutive layers (default [3, 4, 2]). */
export function makeNeuralNet({ layers = [3, 4, 2], color = "purple" }: NeuralNetOptions = {}): Block {
  let ls = layers.slice(0, 6).map((n) => clamp(n, 1, 6));
  while (ls.length < 2) ls.push(ls.length ? 1 : 3);
  const L = ls.length, m = Math.max(...ls);
  const r = 7.5, colGap = 46, rowGap = 27, pad = r + 6;
  const W = (L - 1) * colGap + 2 * pad, H = (m - 1) * rowGap + 2 * pad;
  const pos = (i: number, j: number): P => [pad + i * colGap, H / 2 + (j - (ls[i] - 1) / 2) * rowGap];
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  for (let i = 0; i < L - 1; i++) {
    const shapes: Shape[] = [];
    for (let a = 0; a < ls[i]; a++) for (let b = 0; b < ls[i + 1]; b++) shapes.push(path(between(pos(i, a), r, pos(i + 1, b), r), "grey", 0.45));
    parts.push({ id: `weights-${i}`, label: `weights from layer ${i} to layer ${i + 1}`, shapes });
    anchors[`weights-${i}`] = [pad + (i + 0.5) * colGap, H / 2];
  }
  for (let i = 0; i < L; i++) {
    const top = pos(i, 0)[1] - r - 4, bot = pos(i, ls[i] - 1)[1] + r + 4;
    // The column itself is not drawn (an outline crowds the edges); its box is there to circle.
    parts.push({ id: `layer-${i}`, label: i === 0 ? "input layer" : i === L - 1 ? "output layer" : `hidden layer ${i}`, shapes: [{ type: "rect", x: pad + i * colGap - r - 4, y: top, w: 2 * r + 8, h: bot - top }] });
    anchors[`layer-${i}`] = [pad + i * colGap, H / 2];
    anchors[`layer-${i}-top`] = [pad + i * colGap, top];
    for (let j = 0; j < ls[i]; j++) {
      const [x, y] = pos(i, j);
      parts.push({ id: `node-${i}-${j}`, label: `neuron ${j} of layer ${i}`, shapes: [circle(x, y, r, color, tint(color))] });
      anchors[`layer-${i}-node-${j}`] = [x, y];
    }
  }
  anchors.input = [3, H / 2];
  anchors.output = [W - 3, H / 2];
  return fit({
    id: "neural-net", title: "Neural Network",
    describe: "a neural network: columns of nodes joined by weights, input on the left; set layers (node counts, e.g. [3, 4, 2])",
    tags: ["neural network", "deep learning", "AI", "neurons", "layers", "weights"],
    W, H, parts, anchors,
  });
}
export const neuralNet = makeNeuralNet();

export interface PerceptronOptions { inputs?: number; color?: string }
/** A single artificial neuron: `inputs` inputs (1–5, default 3) weighted into a sum node, with an output arrow. */
export function makePerceptron({ inputs = 3, color = "purple" }: PerceptronOptions = {}): Block {
  const n = clamp(inputs, 1, 5);
  const gap = 24, H = Math.max(56, (n - 1) * gap + 28), W = 120, cy = H / 2;
  const ri = 8, sum: P = [66, cy], rs = 18;
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  const ins: P[] = Array.from({ length: n }, (_, i) => [12, cy + (i - (n - 1) / 2) * gap]);
  ins.forEach((p, i) => parts.push({ id: `weight-${i}`, label: `weight ${i}`, shapes: [path(between(p, ri, sum, rs), "grey", 0.7)] }));
  ins.forEach((p, i) => {
    parts.push({ id: `input-${i}`, label: `input ${i}`, shapes: [circle(p[0], p[1], ri, color)] });
    anchors[`input-${i}`] = p;
    anchors[`weight-${i}`] = [(p[0] + sum[0]) / 2, (p[1] + sum[1]) / 2];
  });
  parts.push({
    id: "sum", label: "weighted sum and activation",
    shapes: [circle(sum[0], sum[1], rs, color, tint(color))],
  });
  parts.push({ id: "output", label: "output", shapes: [path(arrowD([sum[0] + rs + 2, cy], [W - 4, cy], 8), color)] });
  anchors.sum = sum;
  anchors.output = [W - 4, cy];
  anchors.input = [4, cy];
  return fit({
    id: "perceptron", title: "Perceptron",
    describe: "a perceptron: input nodes weighted into one summing neuron with an output arrow; set inputs (1-5)",
    tags: ["perceptron", "neuron", "weights", "neural network", "AI", "classifier"],
    W, H, parts, anchors,
  });
}
export const perceptron = makePerceptron();

export interface LayerOptions { n?: number; color?: string }
/** One layer of a network: `n` nodes in a column (1–8, default 4) inside a rounded outline. */
export function makeLayer({ n = 4, color = "purple" }: LayerOptions = {}): Block {
  const k = clamp(n, 1, 8);
  const r = 9, gap = 29, W = 2 * r + 22, H = (k - 1) * gap + 2 * r + 22;
  // The layer's box is there to circle, not drawn, so the nodes stay clear.
  const parts: Part[] = [{ id: "layer", label: "layer", shapes: [{ type: "rect", x: 4, y: 4, w: W - 8, h: H - 8 }] }];
  const anchors: Record<string, [number, number]> = {};
  for (let i = 0; i < k; i++) {
    const y = 11 + r + i * gap;
    parts.push({ id: `node-${i}`, label: `neuron ${i}`, shapes: [circle(W / 2, y, r, color, tint(color))] });
    anchors[`node-${i}`] = [W / 2, y];
  }
  anchors.input = [0, H / 2];
  anchors.output = [W, H / 2];
  return fit({
    id: "layer", title: "Layer",
    describe: "one layer of a neural network: a column of n neurons; set n (1-8)",
    tags: ["layer", "neurons", "neural network", "hidden layer", "AI"],
    W, H, parts, anchors,
  });
}
export const layer = makeLayer();

export type ActivationKind = "relu" | "sigmoid" | "tanh" | "step";
export interface ActivationOptions { kind?: ActivationKind; color?: string }
/** An activation function drawn on small axes: relu (default), sigmoid, tanh or step. */
export function makeActivation({ kind = "relu", color = "purple" }: ActivationOptions = {}): Block {
  const W = 100, H = 80, ox = 50, oy = kind === "tanh" ? 40 : 60, u = kind === "tanh" ? 28 : 40;
  const xs = Array.from({ length: 25 }, (_, i) => -1 + (2 * i) / 24);
  const f = (t: number) =>
    kind === "sigmoid" ? 1 / (1 + Math.exp(-6 * t)) : kind === "tanh" ? Math.tanh(3 * t) : kind === "step" ? (t < 0 ? 0 : 1) : Math.max(0, t) * 1.05;
  let d: string;
  const X = (t: number) => ox + t * 42;
  if (kind === "step") d = poly([[X(-1), oy], [ox, oy], [ox, oy - u], [X(1), oy - u]]);
  else if (kind === "relu") d = poly([[X(-1), oy], [ox, oy], [X(1), oy - u * 1.05]]);
  else d = smooth(xs.map((t): P => [X(t), oy - u * f(t)]));
  return fit({
    id: "activation", title: "Activation Function",
    describe: "an activation function curve on small axes; set kind: relu, sigmoid, tanh or step",
    tags: ["activation", "ReLU", "sigmoid", "tanh", "neuron", "function"],
    W, H,
    parts: [
      { id: "axes", label: "axes", shapes: [path(`M4 ${oy} L96 ${oy} M${ox} 76 L${ox} 4`, "ink", 0.6)] },
      { id: "curve", label: `${kind} curve`, shapes: [path(d, color)] },
    ],
    anchors: { origin: [ox, oy], curve: [X(0.6), oy - u * f(0.6)], low: [X(-0.8), oy - u * f(-0.8)], high: [X(0.9), oy - u * f(0.9)] },
  });
}
export const activation = makeActivation();

// ---------- training ----------

export interface LossCurveOptions { steps?: number; noisy?: boolean; color?: string }
/** A training loss curve falling and levelling off; `steps` (0–1) is how far along it is drawn, `noisy` adds wiggle. */
export function makeLossCurve({ steps = 1, noisy = false, color = "blue" }: LossCurveOptions = {}): Block {
  const t1 = Math.max(0.08, Math.min(1, steps));
  const W = 100, H = 80, x0 = 14, x1 = 94, yTop = 12, yBot = 70;
  const pts: P[] = [];
  const N = noisy ? 34 : 16, count = Math.max(2, Math.round(N * t1));
  for (let i = 0; i <= count; i++) {
    const t = (i / N);
    const wig = noisy && i > 0 ? Math.sin(i * 2.3) * 4.5 * (1 - 0.5 * t) : 0;
    pts.push([x0 + 4 + (x1 - x0 - 4) * t, yTop + 4 + (yBot - yTop - 12) * (1 - Math.exp(-4 * t)) / (1 - Math.exp(-4)) + wig]);
  }
  const end = pts[pts.length - 1];
  return fit({
    id: "loss-curve", title: "Loss Curve",
    describe: "a training loss curve falling and levelling off on axes; set steps (0-1, how far it has got) and noisy",
    tags: ["loss", "training", "error", "chart", "learning curve", "epochs"],
    W, H,
    parts: [
      { id: "axes", label: "axes: loss against training steps", shapes: [path(`M${x0} 4 L${x0} ${yBot + 4} L${x1 + 2} ${yBot + 4}`, "ink", 0.7)] },
      { id: "curve", label: "loss curve", shapes: [path(noisy ? poly(pts) : smooth(pts), color)] },
    ],
    anchors: { start: pts[0], end, now: end, "axis-x": [(x0 + x1) / 2, yBot + 4], "axis-y": [x0, (yTop + yBot) / 2], origin: [x0, yBot + 4] },
  });
}
export const lossCurve = makeLossCurve();

export interface GradientDescentOptions { steps?: number; color?: string }
/** A ball stepping down a loss bowl: `steps` dots (0–6, default 4) heading for the minimum. */
export function makeGradientDescent({ steps = 4, color = "blue" }: GradientDescentOptions = {}): Block {
  const n = clamp(steps, 0, 6);
  const W = 100, H = 72, cx = 50, base = 64, a = 54;
  const g = (x: number) => base - a * ((x - cx) / 44) ** 2;
  const bowl = smooth(Array.from({ length: 13 }, (_, i): P => { const x = 6 + (88 * i) / 12; return [x, g(x)]; }));
  const parts: Part[] = [{ id: "bowl", label: "loss surface", shapes: [path(bowl, color)] }];
  const anchors: Record<string, [number, number]> = { minimum: [cx, base], bowl: [80, g(80)] };
  const rd = 5.5;
  // Each step overshoots to the other side, by less each time.
  const offsets = [-38, 29, -20, 13, -7, 2];
  const dots: P[] = offsets.slice(0, n).map((o) => [cx + o, g(cx + o) - rd - 1.5]);
  dots.forEach((p, i) => {
    parts.push({ id: `step-${i}`, label: `step ${i}`, shapes: [circle(p[0], p[1], rd, "orange", "orange-tint")] });
    anchors[`step-${i}`] = p;
  });
  if (n) anchors.start = dots[0], anchors.current = dots[n - 1];
  return fit({
    id: "gradient-descent", title: "Gradient Descent",
    describe: "gradient descent: dots stepping down a loss bowl towards the minimum; set steps (0-6)",
    tags: ["gradient descent", "optimisation", "training", "loss", "minimum", "learning rate"],
    W, H, parts, anchors,
  });
}
export const gradientDescent = makeGradientDescent();

export interface DecisionBoundaryOptions { points?: number; boundary?: "line" | "curve"; color?: string }
/** Two classes of points (circles and crosses, `points` each, 4–16) split by a line or curve. */
export function makeDecisionBoundary({ points = 6, boundary = "line", color = "blue" }: DecisionBoundaryOptions = {}): Block {
  const n = clamp(points, 4, 16);
  const W = 100, H = 80;
  const g = boundary === "curve" ? (x: number) => 44 + 20 * Math.sin(((x - 8) / 84) * Math.PI * 1.6 + 0.4) : (x: number) => 74 - 0.68 * x;
  const line = smooth(Array.from({ length: 11 }, (_, i): P => { const x = 2 + (96 * i) / 10; return [x, g(x)]; }));
  const rand = rng(n * 7 + (boundary === "curve" ? 101 : 3));
  const placed: P[] = [];
  const pick = (above: boolean): P => {
    for (let minD = 14; ; minD -= 1) {
      for (let t = 0; t < 400; t++) {
        const p: P = [8 + rand() * 84, 8 + rand() * 64];
        const side = p[1] - g(p[0]);
        if ((above ? -side : side) < 9) continue;
        if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minD)) continue;
        placed.push(p);
        return p;
      }
      if (minD < 5) { const p: P = above ? [10, 10] : [90, 70]; placed.push(p); return p; }
    }
  };
  const A: P[] = [], B: P[] = [];
  for (let i = 0; i < n; i++) A.push(pick(true)), B.push(pick(false));
  const parts: Part[] = [{ id: "boundary", label: "decision boundary", shapes: [path(line, "red")] }];
  const anchors: Record<string, [number, number]> = { boundary: [50, g(50)] };
  const ra = n > 10 ? 3.4 : 4.2;
  A.forEach(([x, y], i) => { parts.push({ id: `a-${i}`, label: `class A point ${i}`, shapes: [circle(x, y, ra, color)] }); anchors[`a-${i}`] = [x, y]; });
  B.forEach(([x, y], i) => { parts.push({ id: `b-${i}`, label: `class B point ${i}`, shapes: [path(`M${r1(x - ra)} ${r1(y - ra)} L${r1(x + ra)} ${r1(y + ra)} M${r1(x + ra)} ${r1(y - ra)} L${r1(x - ra)} ${r1(y + ra)}`, "orange")] }); anchors[`b-${i}`] = [x, y]; });
  const mean = (ps: P[]): [number, number] => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
  anchors["class-a"] = mean(A);
  anchors["class-b"] = mean(B);
  return fit({
    id: "decision-boundary", title: "Decision Boundary",
    describe: "a classifier's decision boundary splitting circles from crosses; set points (4-16 per class) and boundary: line or curve",
    tags: ["classification", "decision boundary", "classifier", "machine learning", "data points", "separate"],
    W, H, parts, anchors,
  });
}
export const decisionBoundary = makeDecisionBoundary();

export interface ClustersOptions { k?: number; color?: string }
/** `k` clusters of dots (2–4, default 3), each loosely ringed. */
export function makeClusters({ k = 3, color = "blue" }: ClustersOptions = {}): Block {
  const n = clamp(k, 2, 4);
  const W = 100, H = n === 2 ? 52 : n === 3 ? 92 : 100;
  const centres: P[] = n === 2 ? [[25, 26], [75, 26]] : n === 3 ? [[24, 68], [50, 24], [76, 68]] : [[25, 25], [75, 25], [25, 75], [75, 75]];
  const palette = [color, ...["blue", "orange", "green", "purple"].filter((c) => c !== color)];
  const rand = rng(11 + n);
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  centres.forEach(([cx, cy], i) => {
    const c = palette[i];
    const dots: Shape[] = [circle(cx, cy, 2.6, c, c === "ink" ? undefined : tint(c))];
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + rand() * 0.7, d = 11 + rand() * 2;
      dots.push(circle(r1(cx + Math.cos(a) * d), r1(cy + Math.sin(a) * d), 2.6, c, c === "ink" ? undefined : tint(c)));
    }
    parts.push({ id: `cluster-${i}`, label: `cluster ${i}`, shapes: [path(smooth(Array.from({ length: 8 }, (_, t): P => { const a = (t / 8) * Math.PI * 2; const rr = 21 + (t % 2 ? 1.2 : -0.8); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]; }), true), "grey", 0.45), ...dots] });
    anchors[`cluster-${i}`] = [cx, cy];
  });
  return fit({
    id: "clusters", title: "Clusters",
    describe: "unsupervised clustering: k groups of similar data points, each ringed; set k (2-4)",
    tags: ["clustering", "k-means", "unsupervised", "groups", "data points", "machine learning"],
    W, H, parts, anchors,
  });
}
export const clusters = makeClusters();

export interface EmbeddingSpaceOptions { vectors?: number; color?: string }
/** Word or item vectors as `vectors` arrows (2–5, default 3) from an origin on two axes. */
export function makeEmbeddingSpace({ vectors = 3, color = "purple" }: EmbeddingSpaceOptions = {}): Block {
  const n = clamp(vectors, 2, 5);
  const W = 100, H = 88, o: P = [16, 76];
  const parts: Part[] = [{ id: "axes", label: "axes", shapes: [path(`${poly([[o[0], 4], o, [96, o[1]]])}`, "ink", 0.6)] }];
  const anchors: Record<string, [number, number]> = { origin: o };
  const lens = [70, 58, 74, 54, 66];
  for (let i = 0; i < n; i++) {
    const ang = ((14 + (62 * i) / (n - 1)) * Math.PI) / 180;
    const tip: P = [o[0] + Math.cos(ang) * lens[i], o[1] - Math.sin(ang) * lens[i] * 0.92];
    parts.push({ id: `vector-${i}`, label: `vector ${i}`, shapes: [path(arrowD(o, tip, 8), color)] });
    anchors[`vector-${i}`] = tip;
    anchors[`vector-${i}-mid`] = [(o[0] + tip[0]) / 2, (o[1] + tip[1]) / 2];
  }
  return fit({
    id: "embedding-space", title: "Embedding Space",
    describe: "an embedding space: vectors as arrows from an origin, similar things pointing the same way; set vectors (2-5)",
    tags: ["embedding", "vector", "semantic space", "similarity", "word vectors", "AI"],
    W, H, parts, anchors,
  });
}
export const embeddingSpace = makeEmbeddingSpace();

// ---------- language models ----------

export interface AttentionOptions { tokens?: number; from?: number; color?: string }
/** A row of `tokens` boxes (2–6, default 4) with attention arcs from token `from` to each other token. */
export function makeAttention({ tokens = 4, from = 0, color = "purple" }: AttentionOptions = {}): Block {
  const n = clamp(tokens, 2, 6), f = clamp(from, 0, n - 1);
  const tw = 20, th = 16, gap = 12, W = n * tw + (n - 1) * gap + 8;
  const span = (n - 1) * (tw + gap);
  const H = Math.max(56, 30 + span * 0.42 + 14);
  const y0 = H - th - 4;
  const xc = (i: number) => 4 + tw / 2 + i * (tw + gap);
  const rand = rng(n * 13 + f);
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = { from: [xc(f), y0] };
  for (let i = 0; i < n; i++) {
    if (i === f) continue;
    const d = Math.abs(i - f) * (tw + gap);
    const apex = y0 - 12 - d * 0.42;
    const a: P = [xc(f) + (i > f ? 3 : -3), y0 - 2], b: P = [xc(i) + (i > f ? -3 : 3), y0 - 2];
    const ctrl: P = [(a[0] + b[0]) / 2, 2 * apex - y0];
    parts.push({ id: `arc-${i}`, label: `attention from token ${f} to token ${i}`, shapes: [path(`M${r1(a[0])} ${r1(a[1])} Q${r1(ctrl[0])} ${r1(ctrl[1])} ${r1(b[0])} ${r1(b[1])} ${headD(ctrl, b, 6)}`, color, r1(0.5 + rand() * 0.5))] });
    anchors[`arc-${i}`] = [(a[0] + b[0]) / 2, apex];
  }
  for (let i = 0; i < n; i++) {
    parts.push({ id: `token-${i}`, label: `token ${i}`, shapes: [rect(xc(i) - tw / 2, y0, tw, th, i === f ? color : "blue", { r: 4, fill: i === f ? tint(color) : "blue-tint" })] });
    anchors[`token-${i}`] = [xc(i), y0 + th / 2];
    anchors[`token-${i}-top`] = [xc(i), y0];
  }
  return fit({
    id: "attention", title: "Attention",
    describe: "self-attention: a row of token boxes with arcs from one token to the others it attends to; set tokens (2-6) and from (index)",
    tags: ["attention", "transformer", "tokens", "language model", "self-attention", "LLM"],
    W, H, parts, anchors,
  });
}
export const attention = makeAttention();

export interface TransformerOptions { blocks?: number; color?: string }
/** A transformer: input tokens feeding up through `blocks` stacked layers (1–4, default 2) to an output arrow. */
export function makeTransformer({ blocks = 2, color = "purple" }: TransformerOptions = {}): Block {
  const n = clamp(blocks, 1, 4);
  const W = 76, bw = 60, bh = 26, gap = 12, x0 = (W - bw) / 2;
  const tokY = 12 + 16 + n * bh + (n - 1) * gap + 14; // top of the token row
  const H = tokY + 16 + 3;
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  parts.push({ id: "output", label: "output", shapes: [path(arrowD([W / 2, 26], [W / 2, 4], 7), color)] });
  anchors.output = [W / 2, 4];
  const links: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const y = 28 + (n - 1 - i) * (bh + gap); // block-0 is the bottom one
    parts.push({
      id: `block-${i}`, label: `transformer layer ${i}`,
      shapes: [rect(x0, y, bw, bh, color, { r: 5, fill: tint(color) }), path(`M${W / 2} ${y + 6} L${W / 2} ${y + bh - 6}`, color, 0.6)],
    });
    anchors[`block-${i}`] = [W / 2, y + bh / 2];
    anchors[`block-${i}-attention`] = [x0 + bw / 4, y + bh / 2];
    anchors[`block-${i}-feed-forward`] = [x0 + (3 * bw) / 4, y + bh / 2];
    if (i < n - 1) links.push(path(`M${W / 2} ${y} L${W / 2} ${y - gap}`, color, 0.7));
  }
  links.push(path(`M${W / 2} ${tokY - 2} L${W / 2} ${tokY - 14}`, color, 0.7));
  parts.push({ id: "links", label: "data flowing up", shapes: links });
  const chips: Shape[] = [0, 1, 2].map((i) => rect(x0 + 2 + i * 20, tokY, 16, 14, "blue", { r: 4, fill: "blue-tint" }));
  parts.push({ id: "input", label: "input tokens", shapes: chips });
  anchors.input = [W / 2, tokY + 7];
  return fit({
    id: "transformer", title: "Transformer",
    describe: "a transformer model: input tokens rising through stacked attention + feed-forward layers to an output; set blocks (1-4)",
    tags: ["transformer", "language model", "LLM", "attention", "layers", "GPT"],
    W, H, parts, anchors,
  });
}
export const transformer = makeTransformer();

export interface TokenOptions { n?: number; color?: string }
/** `n` rounded token chips in a row (1–6, default 3), the pieces text is split into. */
export function makeToken({ n = 3, color = "blue" }: TokenOptions = {}): Block {
  const k = clamp(n, 1, 6);
  const tw = 30, th = 22, gap = 15, W = k * tw + (k - 1) * gap + 6, H = th + 6;
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  for (let i = 0; i < k; i++) {
    const x = 3 + i * (tw + gap);
    parts.push({ id: `token-${i}`, label: `token ${i}`, shapes: [rect(x, 3, tw, th, color, { r: 7, fill: tint(color) }), ...(k <= 3 ? [path(`M${x + 9} ${3 + th / 2} L${x + tw - 9} ${3 + th / 2}`, color, 0.6)] : [])] });
    anchors[`token-${i}`] = [x + tw / 2, 3 + th / 2];
  }
  anchors.first = anchors["token-0"];
  anchors.last = anchors[`token-${k - 1}`];
  return fit({
    id: "token", title: "Tokens",
    describe: "tokens: n rounded chips in a row, the pieces a language model reads text as; set n (1-6)",
    tags: ["token", "tokenizer", "text", "language model", "LLM", "words"],
    W, H, parts, anchors,
  });
}
export const token = makeToken();

// ---------- vision ----------

function grid(x: number, y: number, n: number, c: number, color: string, fill?: string): Shape[] {
  const inner: string[] = [];
  for (let i = 1; i < n; i++) inner.push(`M${x + i * c} ${y} L${x + i * c} ${y + n * c}`, `M${x} ${y + i * c} L${x + n * c} ${y + i * c}`);
  return [rect(x, y, n * c, n * c, color, fill ? { fill } : {}), ...(inner.length ? [path(inner.join(" "), color, 0.45)] : [])];
}

export interface ConvolutionOptions { size?: number; color?: string }
/** A convolution: a 3×3 kernel over a `size`×`size` input grid (4–6, default 5) making one cell of a smaller output. */
export function makeConvolution({ size = 5, color = "blue" }: ConvolutionOptions = {}): Block {
  const n = clamp(size, 4, 6), m = n - 2, c = 14;
  const gin = n * c, gout = m * c, gap = 30;
  const W = gin + gap + gout + 8, H = gin + 8;
  const ix = 4, iy = 4, ox = ix + gin + gap, oy = iy + (gin - gout) / 2;
  const kx = ix, ky = iy;
  const cell: P = [ox, oy];
  return fit({
    id: "convolution", title: "Convolution",
    describe: "a convolution: a 3x3 kernel sliding over an input grid, each position making one cell of the output; set size (4-6)",
    tags: ["convolution", "CNN", "kernel", "filter", "image", "computer vision"],
    W, H,
    parts: [
      { id: "input", label: "input image", shapes: grid(ix, iy, n, c, color) },
      { id: "output", label: "feature map", shapes: grid(ox, oy, m, c, "purple") },
      { id: "projection", label: "kernel to output", shapes: [path(`M${kx + 3 * c} ${ky} L${cell[0]} ${cell[1]} M${kx + 3 * c} ${ky + 3 * c} L${cell[0]} ${cell[1] + c}`, "grey", 0.45)] },
      { id: "kernel", label: "3x3 kernel", shapes: [rect(kx, ky, 3 * c, 3 * c, "red", { fill: "red-tint" })] },
      { id: "output-cell", label: "output cell", shapes: [rect(cell[0], cell[1], c, c, "red", { fill: "red-tint" })] },
    ],
    anchors: {
      input: [ix + gin / 2, iy + gin / 2], kernel: [kx + 1.5 * c, ky + 1.5 * c], output: [ox + gout / 2, oy + gout / 2],
      "output-cell": [cell[0] + c / 2, cell[1] + c / 2], "input-top": [ix + gin / 2, iy], "output-top": [ox + gout / 2, oy],
    },
  });
}
export const convolution = makeConvolution();

export interface PoolingOptions { size?: number; color?: string }
/** Pooling: a `size`×`size` grid (2–6, default 4) shrunk to half by taking each 2×2 window. */
export function makePooling({ size = 4, color = "blue" }: PoolingOptions = {}): Block {
  const n = clamp(size, 2, 6), m = Math.ceil(n / 2), c = 14;
  const gin = n * c, gout = m * c, gap = 32;
  const W = gin + gap + gout + 8, H = gin + 8;
  const ix = 4, iy = 4, ox = ix + gin + gap, oy = iy + (gin - gout) / 2;
  const windows: string[] = [];
  for (let i = 2; i < n; i += 2) windows.push(`M${ix + i * c} ${iy} L${ix + i * c} ${iy + gin} M${ix} ${iy + i * c} L${ix + gin} ${iy + i * c}`);
  const ay = iy + gin / 2;
  return fit({
    id: "pooling", title: "Pooling",
    describe: "max pooling: a grid shrunk to half size, each 2x2 window becoming one cell; set size (2-6)",
    tags: ["pooling", "max pool", "CNN", "downsample", "image", "computer vision"],
    W, H,
    parts: [
      { id: "input", label: "input grid", shapes: [...grid(ix, iy, n, c, color), ...(windows.length ? [path(windows.join(" "), color, 0.9)] : [])] },
      { id: "window", label: "2x2 window", shapes: [rect(ix, iy, Math.min(2, n) * c, Math.min(2, n) * c, "red", { fill: "red-tint" })] },
      { id: "arrow", label: "pool", shapes: [path(arrowD([ix + gin + 7, ay], [ox - 7, ay], 6), "grey", 0.8)] },
      { id: "output", label: "pooled grid", shapes: grid(ox, oy, m, c, "purple") },
      { id: "output-cell", label: "pooled cell", shapes: [rect(ox, oy, c, c, "red", { fill: "red-tint" })] },
    ],
    anchors: { input: [ix + gin / 2, iy + gin / 2], window: [ix + c, iy + c], output: [ox + gout / 2, oy + gout / 2], "output-cell": [ox + c / 2, oy + c / 2] },
  });
}
export const pooling = makePooling();

// ---------- things ----------

export interface ColorOptions { color?: string }

/** A friendly robot: boxy head with an antenna, eyes and mouth, a body and arms. */
export function makeRobot({ color = "ink" }: ColorOptions = {}): Block {
  return fit({
    id: "robot", title: "Robot",
    describe: "a friendly robot with antenna, square head and arms; AI, automation or a chatbot",
    tags: ["robot", "AI", "automation", "chatbot", "machine", "android"],
    W: 80, H: 100,
    parts: [
      { id: "antenna", label: "antenna", shapes: [path("M40 18 L40 8", color, 0.8), circle(40, 6, 3.5, "red", "red-tint", 0.8)] },
      { id: "head", label: "head", shapes: [rect(18, 18, 44, 32, color, { r: 7, fill: "grey-tint" })] },
      { id: "eyes", label: "eyes", shapes: [circle(30, 32, 4.5, "blue", "blue-tint", 0.8), circle(50, 32, 4.5, "blue", "blue-tint", 0.8)] },
      { id: "mouth", label: "mouth", shapes: [path("M32 42 L48 42", color, 0.7)] },
      { id: "arms", label: "arms", shapes: [path("M20 64 L6 78 L6 88", color, 0.9), path("M60 64 L74 78 L74 88", color, 0.9)] },
      { id: "body", label: "body", shapes: [rect(20, 54, 40, 34, color, { r: 5, fill: "grey-tint" }), circle(40, 71, 5, color, undefined, 0.7)] },
      { id: "legs", label: "legs", shapes: [path("M30 88 L30 97 M50 88 L50 97", color, 0.9)] },
    ],
    anchors: { head: [40, 34], eyes: [40, 32], mouth: [40, 42], antenna: [40, 4], body: [40, 71], "left-hand": [6, 88], "right-hand": [74, 88], top: [40, 2], bottom: [40, 98] },
  });
}
export const robot = makeRobot();

/** An AI chip: a square package with pins on every side and a small network etched on the core. */
export function makeAiChip({ color = "ink" }: ColorOptions = {}): Block {
  const pins: string[] = [];
  for (const t of [36, 50, 64]) pins.push(`M${t} 6 L${t} 20`, `M${t} 80 L${t} 94`, `M6 ${t} L20 ${t}`, `M80 ${t} L94 ${t}`);
  const nodes: P[] = [[40, 42], [40, 58], [60, 50]];
  return fit({
    id: "ai-chip", title: "AI Chip",
    describe: "an AI chip: a square processor with pins on all sides and a tiny network on its core (GPU, TPU, NPU)",
    tags: ["chip", "GPU", "processor", "hardware", "AI accelerator", "compute"],
    W: 100, H: 100,
    parts: [
      { id: "pins", label: "pins", shapes: [path(pins.join(" "), color, 0.8)] },
      { id: "chip", label: "chip package", shapes: [rect(20, 20, 60, 60, color, { r: 6, fill: "grey-tint" })] },
      { id: "core", label: "core", shapes: [rect(31, 31, 38, 38, "purple", { r: 3, fill: "purple-tint", width: 0.8 }), path(`${between(nodes[0], 3.5, nodes[2], 3.5)} ${between(nodes[1], 3.5, nodes[2], 3.5)}`, "purple", 0.5), ...nodes.map(([x, y]) => circle(x, y, 3.5, "purple", undefined, 0.6))] },
    ],
    anchors: { chip: [50, 50], core: [50, 50], pins: [50, 13], top: [50, 6], bottom: [50, 94], left: [6, 50], right: [94, 50] },
  });
}
export const aiChip = makeAiChip();

export interface DatasetOptions { items?: number; color?: string }
/** A dataset: `items` stacked cards (2–6, default 4), the front one showing a small picture. */
export function makeDataset({ items = 4, color = "blue" }: DatasetOptions = {}): Block {
  const n = clamp(items, 2, 6), cw = 58, ch = 44, step = 12;
  const W = cw + (n - 1) * step + 6, H = ch + (n - 1) * step + 6;
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  for (let i = 0; i < n; i++) {
    // item-0 is the back card (top right); the last one is in front (bottom left).
    const x = 3 + (n - 1 - i) * step, y = 3 + i * step;
    const shapes: Shape[] = [rect(x, y, cw, ch, color, { r: 4, fill: "board" })];
    if (i === n - 1) shapes.push(path(`M${x + 8} ${y + ch - 8} L${x + 24} ${y + 18} L${x + 34} ${y + 30} L${x + 40} ${y + 24} L${x + cw - 8} ${y + ch - 8}`, color, 0.7), circle(x + cw - 14, y + 13, 4.5, "orange", undefined, 0.7));
    parts.push({ id: `item-${i}`, label: i === n - 1 ? "front example" : `example ${i}`, shapes });
    anchors[`item-${i}`] = [x + cw / 2, y + ch / 2];
  }
  anchors.front = anchors[`item-${n - 1}`];
  anchors.back = anchors["item-0"];
  return fit({
    id: "dataset", title: "Dataset",
    describe: "a dataset: a stack of example cards, the front one a picture; training data; set items (2-6)",
    tags: ["dataset", "training data", "examples", "data", "labels", "machine learning"],
    W, H, parts, anchors,
  });
}
export const dataset = makeDataset();

export interface TrainingLoopOptions { stages?: number; color?: string }
/** A training cycle: `stages` boxes (3–5, default 4) round a loop with arrows from each to the next. */
export function makeTrainingLoop({ stages = 4, color = "orange" }: TrainingLoopOptions = {}): Block {
  const n = clamp(stages, 3, 5);
  const W = 100, H = 100, c: P = [50, 50], R = 37, bs = n === 5 ? 20 : 22;
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const at = (a: number, r = R): P => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {};
  const gapA = (bs * 0.68) / R; // angle the box covers on each side
  for (let i = 0; i < n; i++) {
    const a0 = ang(i) + gapA + 0.08, a1 = ang(i + 1) - gapA - 0.08;
    const pts: P[] = Array.from({ length: 7 }, (_, t) => at(a0 + ((a1 - a0) * t) / 6));
    parts.push({ id: `arrow-${i}`, label: `from stage ${i} to stage ${(i + 1) % n}`, shapes: [path(`${smooth(pts)} ${headD(pts[5], pts[6], 6)}`, "grey", 0.75)] });
    anchors[`arrow-${i}`] = at((a0 + a1) / 2);
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = at(ang(i));
    parts.push({ id: `stage-${i}`, label: `stage ${i}`, shapes: [rect(x - bs / 2, y - bs / 2, bs, bs, color, { r: 4, fill: tint(color) })] });
    anchors[`stage-${i}`] = [x, y];
  }
  return fit({
    id: "training-loop", title: "Training Loop",
    describe: "a training loop: stages (e.g. predict, measure loss, update) round a cycle with arrows; set stages (3-5)",
    tags: ["training", "loop", "cycle", "epoch", "backpropagation", "iteration"],
    W, H, parts, anchors,
  });
}
export const trainingLoop = makeTrainingLoop();

/** A model as a black box: an input arrow in on the left, an output arrow out on the right. */
export function makeModel({ color = "purple" }: ColorOptions = {}): Block {
  const nodes: P[] = [[42, 20], [42, 36], [58, 28]];
  return fit({
    id: "model", title: "Model",
    describe: "an AI model as a black box: input goes in on the left, output comes out on the right",
    tags: ["model", "black box", "AI", "input", "output", "prediction"],
    W: 100, H: 56,
    parts: [
      { id: "input", label: "input", shapes: [path(arrowD([3, 28], [24, 28], 7), "grey")] },
      { id: "box", label: "model", shapes: [rect(28, 6, 44, 44, color, { r: 6, fill: tint(color) })] },
      { id: "inside", label: "hidden workings", shapes: [path(`${between(nodes[0], 3.5, nodes[2], 3.5)} ${between(nodes[1], 3.5, nodes[2], 3.5)}`, color, 0.5), ...nodes.map(([x, y]) => circle(x, y, 3.5, color, undefined, 0.6))] },
      { id: "output", label: "output", shapes: [path(arrowD([76, 28], [97, 28], 7), "grey")] },
    ],
    anchors: { input: [3, 28], output: [97, 28], box: [50, 28], top: [50, 6], bottom: [50, 50] },
  });
}
export const model = makeModel();

/** An image classifier: a picture (a cat) goes into a model, a label box comes out. */
export function makeImageClassifier({ color = "purple" }: ColorOptions = {}): Block {
  const cat = [
    smooth([[9, 27], [10, 35], [20, 39], [30, 35], [31, 27], [20, 22]], true),
    "M10 26 L10.5 12 L17 22 M30 26 L29.5 12 L23 22",
  ];
  return fit({
    id: "image-classifier", title: "Image Classifier",
    describe: "an image classifier: a picture goes into a model and a label box comes out",
    tags: ["image classification", "computer vision", "classifier", "label", "CNN", "prediction"],
    W: 120, H: 44,
    parts: [
      { id: "image", label: "input picture", shapes: [rect(3, 6, 34, 34, "blue", { r: 3, fill: "blue-tint" }), path(cat[0], "ink", 0.7), path(cat[1], "ink", 0.7)] },
      { id: "arrow-in", label: "into the model", shapes: [path(arrowD([40, 23], [49, 23], 5), "grey", 0.8)] },
      { id: "model", label: "model", shapes: [rect(52, 10, 26, 26, color, { r: 5, fill: tint(color) })] },
      { id: "arrow-out", label: "out of the model", shapes: [path(arrowD([81, 23], [90, 23], 5), "grey", 0.8)] },
      { id: "label", label: "predicted label", shapes: [rect(93, 15, 25, 16, "green", { r: 4, fill: "green-tint" }), path("M99 23 L112 23", "green", 0.6)] },
    ],
    anchors: { image: [20, 23], input: [3, 23], model: [65, 23], label: [105.5, 23], output: [118, 23], top: [60, 6], bottom: [60, 40] },
  });
}
export const imageClassifier = makeImageClassifier();
