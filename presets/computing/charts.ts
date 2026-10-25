// Charts, maths and flow: bar and line charts, curves, number lines, gauges and flowchart pieces.
// Every factory draws any reasonable data: each bar, point, slice, cell or stage is its own part and anchor.
import { poly, smooth, wave, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---------- helpers ----------

const r1 = (v: number) => +v.toFixed(1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const clampInt = (v: number, lo: number, hi: number) => Math.round(clamp(v, lo, hi));
const tint = (color: string) => `${color}-tint`;
const pt = (x: number, y: number): [number, number] => [r1(x), r1(y)];

/** A small seeded random generator, so default data looks the same every time. */
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

/** An open arrowhead at `tip`, pointing away from `from`. */
function head(tip: P, from: P, len = 7, spread = 0.55): string {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const l: P = [tip[0] - len * Math.cos(a - spread), tip[1] - len * Math.sin(a - spread)];
  const r: P = [tip[0] - len * Math.cos(a + spread), tip[1] - len * Math.sin(a + spread)];
  return poly([l, tip, r]);
}

/** A straight arrow from a to b. */
const arrow = (a: P, b: P, len = 7) => `${poly([a, b])} ${head(b, a, len)}`;

/** A circular arc from angle a0 to a1 (radians, y down, so increasing runs clockwise) as cubics. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, move = true): string {
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  let d = move ? `M${r1(cx + r * Math.cos(a0))} ${r1(cy + r * Math.sin(a0))}` : "";
  for (let i = 0; i < segs; i++) {
    const a = a0 + step * i, b = a + step;
    const p0: P = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const p3: P = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    const c1: P = [p0[0] - k * r * Math.sin(a), p0[1] + k * r * Math.cos(a)];
    const c2: P = [p3[0] + k * r * Math.sin(b), p3[1] - k * r * Math.cos(b)];
    d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p3[0])} ${r1(p3[1])}`;
  }
  return d.trim();
}

const circle = (cx: number, cy: number, r: number, stroke: string, fill?: string, width?: number): Shape => ({
  type: "ellipse", cx: r1(cx), cy: r1(cy), rx: r, ry: r, stroke, ...(fill ? { fill } : {}), ...(width ? { width } : {}),
});

/** The five anchors every block has, inset a little from the box edges. */
const edges = (w: number, h: number) => ({
  center: pt(w / 2, h / 2), top: pt(w / 2, 3), bottom: pt(w / 2, h - 3), left: pt(3, h / 2), right: pt(w - 3, h / 2),
});

/** Ink axes with the origin at (x0, y0), the y axis up to yTop and the x axis out to xRight. */
const inkAxes = (x0: number, y0: number, xRight: number, yTop: number): Part => ({
  id: "axes", label: "axes", shapes: [{ type: "path", d: poly([[x0, yTop], [x0, y0], [xRight, y0]]), stroke: "ink" }],
});

const numbers = (vs: unknown, lo: number, hi: number, fallback: number[]): number[] => {
  const list = Array.isArray(vs) ? vs.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
  return (list.length >= lo ? list : fallback).slice(0, hi);
};

// ---------- bar chart ----------

export interface BarChartOptions { values?: number[]; color?: string }
/** Vertical bars on ink axes, scaled to the largest value (2–10 bars). */
export function makeBarChart({ values, color = "blue" }: BarChartOptions = {}): Block {
  const vs = numbers(values, 2, 10, [3, 5, 2, 6]).map((v) => Math.max(0, v));
  const max = Math.max(...vs) || 1;
  const x0 = 10, y0 = 74, left = 15, right = 95, slot = (right - left) / vs.length, bw = slot * (vs.length > 6 ? 0.6 : 0.62);
  const parts: Part[] = [inkAxes(x0, y0, 97, 5)];
  const anchors: Record<string, [number, number]> = { ...edges(100, 80), origin: [x0, y0] };
  vs.forEach((v, i) => {
    const h = Math.max(1.5, (62 * v) / max), x = left + slot * i + (slot - bw) / 2;
    parts.push({ id: `bar-${i}`, label: `bar ${i + 1}`, shapes: [{ type: "rect", x: r1(x), y: r1(y0 - h), w: r1(bw), h: r1(h), stroke: color, fill: tint(color) }] });
    anchors[`bar-${i}`] = pt(x + bw / 2, y0 - h);
    anchors[`bar-${i}-base`] = pt(x + bw / 2, y0 + 4);
  });
  return {
    id: "bar-chart",
    title: "Bar Chart",
    describe: "a bar chart on axes, bars scaled to the largest; set values (2–10 numbers); bar-i parts, anchors at each bar top",
    tags: ["chart", "bar chart", "data", "statistics", "compare", "graph"],
    size: [100, 80],
    parts,
    anchors,
  };
}
export const barChart = makeBarChart();

// ---------- line chart ----------

export interface LineChartOptions { values?: number[]; series?: number[]; color?: string }
/** A line through 2–12 points on ink axes, with an optional second series in orange. */
export function makeLineChart({ values, series, color = "blue" }: LineChartOptions = {}): Block {
  const a = numbers(values, 2, 12, [2, 4, 3, 6, 5, 8]);
  const b = series ? numbers(series, 2, 12, []) : [];
  const all = [...a, ...b];
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all) > lo ? Math.max(...all) : lo + 1;
  const x0 = 10, y0 = 74;
  const at = (vs: number[], i: number): P => [17 + (76 * i) / Math.max(1, vs.length - 1), y0 - 6 - (58 * (vs[i] - lo)) / (hi - lo)];
  const parts: Part[] = [inkAxes(x0, y0, 97, 5)];
  const anchors: Record<string, [number, number]> = { ...edges(100, 80), origin: [x0, y0] };
  const draw = (vs: number[], stroke: string, line: string, point: string) => {
    const pts = vs.map((_, i) => at(vs, i));
    parts.push({ id: line, label: line === "line" ? "line" : "second series line", shapes: [{ type: "path", d: poly(pts), stroke }] });
    pts.forEach((p, i) => {
      parts.push({ id: `${point}-${i}`, label: `point ${i + 1}`, shapes: [circle(p[0], p[1], 2.8, stroke, "board")] });
      anchors[`${point}-${i}`] = pt(p[0], p[1]);
    });
    anchors[`${line}-end`] = pt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  draw(a, color, "line", "point");
  if (b.length >= 2) draw(b, color === "orange" ? "green" : "orange", "series-line", "series-point");
  return {
    id: "line-chart",
    title: "Line Chart",
    describe: "a line chart on axes; set values (2–12 numbers) and an optional second series (orange); point-i anchors",
    tags: ["chart", "line chart", "data", "trend", "time series", "graph"],
    size: [100, 80],
    parts,
    anchors,
  };
}
export const lineChart = makeLineChart();

// ---------- scatter plot ----------

export interface ScatterPlotOptions { points?: [number, number][]; n?: number; trend?: boolean; color?: string }
/** Dots on ink axes: given [x, y] points in 0–1, or n seeded points with a rising trend; optional trend line. */
export function makeScatterPlot({ points, n = 12, trend = true, color = "blue" }: ScatterPlotOptions = {}): Block {
  let ps: [number, number][];
  if (Array.isArray(points) && points.length >= 2) ps = points.slice(0, 40).map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)]);
  else {
    const rand = rng(7), count = clampInt(n, 3, 30);
    ps = Array.from({ length: count }, (_, i) => {
      const x = (i + 0.2 + rand() * 0.6) / count;
      return [x, clamp(0.12 + 0.72 * x + (rand() - 0.5) * 0.32, 0.02, 0.98)];
    });
  }
  const x0 = 10, y0 = 74;
  const to = ([x, y]: [number, number]): P => [17 + 76 * x, y0 - 7 - 60 * y];
  const parts: Part[] = [inkAxes(x0, y0, 97, 5)];
  const anchors: Record<string, [number, number]> = { ...edges(100, 80), origin: [x0, y0] };
  ps.forEach((p, i) => {
    const [x, y] = to(p);
    parts.push({ id: `point-${i}`, label: `point ${i + 1}`, shapes: [circle(x, y, 2.6, color, color)] });
    anchors[`point-${i}`] = pt(x, y);
  });
  if (trend) {
    const mx = ps.reduce((s, p) => s + p[0], 0) / ps.length, my = ps.reduce((s, p) => s + p[1], 0) / ps.length;
    const sxx = ps.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = ps.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    const m = sxx ? sxy / sxx : 0;
    const xa = Math.min(...ps.map((p) => p[0])), xb = Math.max(...ps.map((p) => p[0]));
    const ends: [number, number][] = [xa, xb].map((x) => [x, clamp(my + m * (x - mx), -0.08, 1.05)]);
    const [a, b] = ends.map(to);
    parts.push({ id: "trend", label: "trend line", shapes: [{ type: "path", d: poly([a, b]), stroke: color === "orange" ? "red" : "orange" }] });
    anchors["trend"] = pt(b[0], b[1]);
  }
  return {
    id: "scatter-plot",
    title: "Scatter Plot",
    describe: "dots on axes; set points ([x, y] in 0–1) or n seeded points, and trend (a best-fit line); point-i anchors",
    tags: ["chart", "scatter plot", "correlation", "data", "regression", "statistics"],
    size: [100, 80],
    parts,
    anchors,
  };
}
export const scatterPlot = makeScatterPlot();

// ---------- histogram ----------

export interface HistogramOptions { values?: number[]; color?: string }
/** Touching bars, one per bin (3–12 bins), scaled to the tallest. */
export function makeHistogram({ values, color = "blue" }: HistogramOptions = {}): Block {
  const vs = numbers(values, 3, 12, [2, 5, 8, 6, 3]).map((v) => Math.max(0, v));
  const max = Math.max(...vs) || 1;
  const x0 = 10, y0 = 74, left = 13, right = 95, bw = (right - left) / vs.length;
  const parts: Part[] = [inkAxes(x0, y0, 97, 5)];
  const anchors: Record<string, [number, number]> = { ...edges(100, 80), origin: [x0, y0] };
  vs.forEach((v, i) => {
    const h = Math.max(1.5, (62 * v) / max), x = left + bw * i;
    parts.push({ id: `bar-${i}`, label: `bin ${i + 1}`, shapes: [{ type: "rect", x: r1(x), y: r1(y0 - h), w: r1(bw), h: r1(h), stroke: color, fill: tint(color) }] });
    anchors[`bar-${i}`] = pt(x + bw / 2, y0 - h);
    anchors[`bar-${i}-base`] = pt(x + bw / 2, y0 + 4);
  });
  return {
    id: "histogram",
    title: "Histogram",
    describe: "a histogram of touching bars on axes; set values (3–12 bin heights); bar-i parts and anchors",
    tags: ["chart", "histogram", "distribution", "frequency", "statistics", "data"],
    size: [100, 80],
    parts,
    anchors,
  };
}
export const histogram = makeHistogram();

// ---------- pie chart ----------

const SERIES = ["blue", "orange", "green", "purple", "red", "pink", "brown"];
const palette = (first: string) => [first, ...SERIES.filter((c) => c !== first)];

export interface PieChartOptions { parts?: number[]; color?: string }
/** A pie of 2–6 slices from fractions (normalised), clockwise from the top. */
export function makePieChart({ parts: fractions, color = "blue" }: PieChartOptions = {}): Block {
  const fs = numbers(fractions, 2, 6, [0.45, 0.3, 0.25]).map((v) => Math.max(0, v));
  const total = fs.reduce((s, v) => s + v, 0) || 1;
  const cx = 50, cy = 50, r = 44, colors = palette(color);
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = { ...edges(100, 100) };
  let a = -Math.PI / 2;
  fs.forEach((f, i) => {
    const span = (f / total) * Math.PI * 2, b = a + span;
    const d = span >= Math.PI * 2 - 1e-6 ? `${arc(cx, cy, r, a, b)} Z` : `M${cx} ${cy} L${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))} ${arc(cx, cy, r, a, b, false)} Z`;
    const c = colors[i % colors.length];
    parts.push({ id: `slice-${i}`, label: `slice ${i + 1}`, shapes: [{ type: "path", d, stroke: c, fill: tint(c) }] });
    const m = (a + b) / 2;
    anchors[`slice-${i}`] = pt(cx + r * 0.58 * Math.cos(m), cy + r * 0.58 * Math.sin(m));
    anchors[`slice-${i}-edge`] = pt(cx + (r + 3) * Math.cos(m), cy + (r + 3) * Math.sin(m));
    a = b;
  });
  return {
    id: "pie-chart",
    title: "Pie Chart",
    describe: "a pie chart; set parts (2–6 fractions, clockwise from the top); slice-i parts and anchors",
    tags: ["chart", "pie chart", "proportion", "percentage", "share", "data"],
    size: [100, 100],
    parts,
    anchors,
  };
}
export const pieChart = makePieChart();

// ---------- axes ----------

export interface AxesOptions { quadrants?: 1 | 4; ticks?: number; color?: string }
/** x and y axes with arrowheads: one quadrant (origin bottom left) or four (origin centre), with 0–6 ticks. */
export function makeAxes({ quadrants = 1, ticks = 4, color = "ink" }: AxesOptions = {}): Block {
  const four = quadrants === 4, k = clampInt(ticks, 0, 6);
  const o: P = four ? [50, 50] : [12, 88];
  const xEnd = 95, yEnd = 5, xStart = four ? 5 : o[0], yStart = four ? 95 : o[1];
  const parts: Part[] = [
    { id: "x-axis", label: "x axis", shapes: [{ type: "path", d: `${poly([[xStart, o[1]], [xEnd, o[1]]])} ${head([xEnd, o[1]], o, 8)}${four ? ` ${head([xStart, o[1]], o, 8)}` : ""}`, stroke: color }] },
    { id: "y-axis", label: "y axis", shapes: [{ type: "path", d: `${poly([[o[0], yStart], [o[0], yEnd]])} ${head([o[0], yEnd], o, 8)}${four ? ` ${head([o[0], yStart], o, 8)}` : ""}`, stroke: color }] },
  ];
  const anchors: Record<string, [number, number]> = { ...edges(100, 100), origin: pt(o[0], o[1]), "x-axis": [xEnd, o[1]], "y-axis": [o[0], yEnd] };
  if (k) {
    const span = (four ? 50 - 5 : 95 - 12) - 10, gap = span / k, d: string[] = [];
    for (let i = 1; i <= k; i++) {
      for (const s of four ? [1, -1] : [1]) {
        const x = o[0] + s * gap * i, y = o[1] - s * gap * i;
        d.push(poly([[x, o[1] - 4], [x, o[1] + 4]]), poly([[o[0] - 4, y], [o[0] + 4, y]]));
        const tag = s > 0 ? "" : "neg-";
        anchors[`x-${tag}${i}`] = pt(x, o[1] + 8);
        anchors[`y-${tag}${i}`] = pt(o[0] - 8, y);
      }
    }
    parts.push({ id: "ticks", label: "tick marks", shapes: [{ type: "path", d: d.join(" "), stroke: color }] });
  }
  return {
    id: "axes",
    title: "Axes",
    describe: "x and y axes with arrows; set quadrants (1 or 4) and ticks (0–6 per axis); anchors origin, x-i, y-i",
    tags: ["axes", "graph", "coordinates", "plot", "maths", "cartesian"],
    size: [100, 100],
    parts,
    anchors,
  };
}
export const axes = makeAxes();

// ---------- vector ----------

export interface VectorOptions { angle?: number; length?: number; color?: string }
/** An arrow from the origin of faint axes at `angle` degrees (anticlockwise from +x) and `length` 0–1. */
export function makeVector({ angle = 35, length = 0.85, color = "blue" }: VectorOptions = {}): Block {
  const a = (clamp(angle, -720, 720) * Math.PI) / 180, l = 44 * clamp(length, 0.15, 1);
  const tail: P = [50, 50], tip: P = [50 + l * Math.cos(a), 50 - l * Math.sin(a)];
  return {
    id: "vector",
    title: "Vector",
    describe: "a vector arrow from the origin of faint axes; set angle (degrees from +x, anticlockwise) and length (0–1)",
    tags: ["vector", "direction", "magnitude", "maths", "physics", "arrow"],
    size: [100, 100],
    parts: [
      { id: "axes", label: "axes", shapes: [{ type: "path", d: "M6 50 L94 50 M50 94 L50 6", stroke: "grey", width: 0.8 }] },
      { id: "vector", label: "vector", shapes: [{ type: "path", d: arrow(tail, tip, 8), stroke: color }] },
    ],
    anchors: {
      ...edges(100, 100), tail: [50, 50], origin: [50, 50], head: pt(tip[0], tip[1]), mid: pt((tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2),
      "x-component": pt(tip[0], 50), "y-component": pt(50, tip[1]),
    },
  };
}
export const vector = makeVector();

// ---------- bell curve ----------

export interface BellCurveOptions { spread?: number; shade?: [number, number]; color?: string }
/** A normal distribution on a baseline; `spread` widens it, `shade` fills under it between two z-scores. */
export function makeBellCurve({ spread = 1, shade, color = "blue" }: BellCurveOptions = {}): Block {
  const s = clamp(spread, 0.5, 2), sd = 13 * s, base = 58, peak = 46 * Math.min(1, Math.pow(1 / s, 0.6));
  const x0 = 4, x1 = 96;
  const y = (x: number) => base - peak * Math.exp(-(((x - 50) / sd) ** 2) / 2);
  const sample = (a: number, b: number, n: number): P[] => Array.from({ length: n + 1 }, (_, i) => { const x = a + ((b - a) * i) / n; return [x, y(x)]; });
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = {
    ...edges(100, 64), mean: pt(50, base - peak), peak: pt(50, base - peak), "mean-base": [50, base + 3],
    "left-tail": pt(14, y(14) - 4), "right-tail": pt(86, y(86) - 4),
  };
  for (const z of [-2, -1, 1, 2]) {
    const x = 50 + z * sd;
    if (x > x0 && x < x1) anchors[`sd${z > 0 ? "+" : ""}${z}`] = pt(x, base + 3);
  }
  if (shade) {
    const za = clamp(Math.min(shade[0], shade[1]), -6, 6), zb = clamp(Math.max(shade[0], shade[1]), -6, 6);
    const a = clamp(50 + za * sd, x0, x1), b = clamp(50 + zb * sd, x0, x1);
    if (b - a > 1) {
      const top = sample(a, b, 24);
      const hatch: string[] = [];
      for (let x = a + 5; x < b - 2; x += 7) if (base - y(x) > 6) hatch.push(poly([[x, base - 2], [x, y(x) + 3]]));
      parts.push({
        id: "shade", label: "shaded area",
        shapes: [
          { type: "path", d: `${smooth(top)} L${r1(b)} ${base} L${r1(a)} ${base} Z`, stroke: color, fill: tint(color), width: 0.6 },
          ...(hatch.length ? [{ type: "path" as const, d: hatch.join(" "), stroke: color, width: 0.6 }] : []),
        ],
      });
      anchors["shade"] = pt((a + b) / 2, base - (base - y((a + b) / 2)) * 0.4);
    }
  }
  parts.push(
    { id: "axis", label: "baseline", shapes: [{ type: "path", d: poly([[2, base], [98, base]]), stroke: "ink" }] },
    { id: "mean-line", label: "mean", shapes: [{ type: "path", d: poly([[50, base], [50, base - peak + 4]]), stroke: "grey", width: 0.7 }] },
    { id: "curve", label: "bell curve", shapes: [{ type: "path", d: smooth(sample(x0, x1, 40)), stroke: color }] },
  );
  return {
    id: "bell-curve",
    title: "Bell Curve",
    describe: "a normal distribution bell curve; set spread (0.5–2) and shade ([from, to] in standard deviations); anchors mean, sd-1, sd+1",
    tags: ["normal distribution", "bell curve", "statistics", "probability", "standard deviation", "gaussian"],
    size: [100, 64],
    parts,
    anchors,
  };
}
export const bellCurve = makeBellCurve();

// ---------- sine wave ----------

export interface SineWaveOptions { cycles?: number; amplitude?: number; color?: string }
/** A sine wave across ink axes; `cycles` 0.5–4, `amplitude` 0–1. */
export function makeSineWave({ cycles = 2, amplitude = 0.8, color = "blue" }: SineWaveOptions = {}): Block {
  const c = clamp(cycles, 0.5, 4), amp = 24 * clamp(amplitude, 0, 1), x0 = 8, x1 = 94, mid = 32;
  const xAt = (t: number) => x0 + (x1 - x0) * t;
  const tPeak = 0.25 / c, tTrough = 0.75 / c;
  return {
    id: "sine-wave",
    title: "Sine Wave",
    describe: "a sine wave on axes; set cycles (0.5–4) and amplitude (0–1); anchors peak, trough, start, end",
    tags: ["sine", "wave", "trigonometry", "signal", "frequency", "oscillation"],
    size: [100, 64],
    parts: [
      { id: "axes", label: "axes", shapes: [{ type: "path", d: `M${x0} 4 L${x0} 60 M${x0} ${mid} L98 ${mid}`, stroke: "ink" }] },
      { id: "wave", label: "wave", shapes: [{ type: "path", d: wave(x0, x1, mid, -amp, c), stroke: color }] },
    ],
    anchors: {
      ...edges(100, 64), origin: [x0, mid], start: [x0, mid], end: pt(x1, mid - amp * Math.sin(c * Math.PI * 2)),
      peak: pt(xAt(tPeak), mid - amp), trough: tTrough <= 1 ? pt(xAt(tTrough), mid + amp) : pt(x1, mid + amp),
      wavelength: c >= 1 ? pt(xAt(1 / c), mid) : pt(x1, mid),
    },
  };
}
export const sineWave = makeSineWave();

// ---------- heatmap ----------

export interface HeatmapOptions { rows?: number; cols?: number; values?: number[][]; color?: string }
/** A grid of cells (2–6 by 2–6) shaded by value 0–1: blank, tint, or solid colour. */
export function makeHeatmap({ rows = 3, cols = 4, values, color = "blue" }: HeatmapOptions = {}): Block {
  const R = clampInt(rows, 2, 6), C = clampInt(cols, 2, 6), s = 96 / Math.max(R, C), gap = Math.max(3, s * 0.16);
  const rand = rng(11);
  const v = (r: number, c: number) => {
    const given = values?.[r]?.[c];
    return typeof given === "number" ? clamp(given, 0, 1) : clamp((r + c) / (R + C - 2) * 0.8 + rand() * 0.35 - 0.1, 0, 1);
  };
  const w = C * s + 4, h = R * s + 4, parts: Part[] = [];
  const anchors: Record<string, [number, number]> = { ...edges(w, h) };
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const val = v(r, c), fill = val < 1 / 3 ? "board" : val < 2 / 3 ? tint(color) : color;
      parts.push({ id: `cell-${r}-${c}`, label: `cell row ${r + 1} column ${c + 1}`, shapes: [{ type: "rect", x: r1(2 + c * s + gap / 2), y: r1(2 + r * s + gap / 2), w: r1(s - gap), h: r1(s - gap), r: 1.5, stroke: color, fill }] });
      anchors[`cell-${r}-${c}`] = pt(2 + (c + 0.5) * s, 2 + (r + 0.5) * s);
    }
  return {
    id: "heatmap",
    title: "Heatmap",
    describe: "a grid of shaded cells; set rows and cols (2–6) and values (a 0–1 matrix: low blank, mid tint, high solid); cell-r-c anchors",
    tags: ["heatmap", "matrix", "grid", "data", "correlation", "chart"],
    size: [r1(w), r1(h)],
    parts,
    anchors,
  };
}
export const heatmap = makeHeatmap();

// ---------- gauge ----------

export interface GaugeOptions { value?: number; color?: string }
/** A half-round dial with ticks and a needle at `value` (0 left, 1 right). */
export function makeGauge({ value = 0.65, color = "blue" }: GaugeOptions = {}): Block {
  const cx = 50, cy = 56, r = 44, v = clamp(value, 0, 1), a = Math.PI + v * Math.PI;
  const ticks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = Math.PI + (i / 4) * Math.PI;
    ticks.push(poly([[cx + 32 * Math.cos(t), cy + 32 * Math.sin(t)], [cx + 39 * Math.cos(t), cy + 39 * Math.sin(t)]]));
  }
  const tip: P = [cx + 33 * Math.cos(a), cy + 33 * Math.sin(a)];
  return {
    id: "gauge",
    title: "Gauge",
    describe: "a half-round dial gauge with a needle; set value (0–1, left to right); anchors needle, min, max",
    tags: ["gauge", "dial", "meter", "speed", "measurement", "dashboard"],
    size: [100, 62],
    parts: [
      { id: "dial", label: "dial", shapes: [{ type: "path", d: `${arc(cx, cy, r, Math.PI, Math.PI * 2)} Z`, stroke: color, fill: tint(color) }] },
      { id: "ticks", label: "scale ticks", shapes: [{ type: "path", d: ticks.join(" "), stroke: color, width: 0.8 }] },
      { id: "needle", label: "needle", shapes: [{ type: "path", d: poly([[cx, cy], tip]), stroke: "red" }, circle(cx, cy, 3.5, "red", "red")] },
    ],
    anchors: { ...edges(100, 62), center: [cx, cy - 18], hub: [cx, cy], needle: pt(tip[0], tip[1]), min: [cx - r + 4, cy - 4], max: [cx + r - 4, cy - 4], dial: [cx, cy - r] },
  };
}
export const gauge = makeGauge();

// ---------- progress bar ----------

export interface ProgressBarOptions { value?: number; color?: string }
/** A rounded track with a solid fill to `value` (0–1). */
export function makeProgressBar({ value = 0.6, color = "green" }: ProgressBarOptions = {}): Block {
  const v = clamp(value, 0, 1), fw = Math.max(3, 82 * v);
  return {
    id: "progress-bar",
    title: "Progress Bar",
    describe: "a progress bar filled to value (0–1); anchors start, end, fill-end",
    tags: ["progress", "loading", "percentage", "status", "download", "bar"],
    size: [100, 32],
    parts: [
      { id: "track", label: "track", shapes: [{ type: "rect", x: 4, y: 5, w: 92, h: 22, r: 11, stroke: "ink", fill: "board" }] },
      { id: "fill", label: "progress", shapes: [{ type: "rect", x: 9, y: 10.5, w: r1(fw), h: 11, r: 5.5, stroke: color, fill: color }] },
    ],
    anchors: { ...edges(100, 32), start: [9, 16], end: [91, 16], "fill-end": pt(9 + fw, 16) },
  };
}
export const progressBar = makeProgressBar();

// ---------- timeline ----------

export interface TimelineOptions { events?: number | number[]; color?: string }
/** A line with an arrow and 2–6 event dots: a count (evenly spaced) or a list of times (spaced to scale). */
export function makeTimeline({ events = 4, color = "blue" }: TimelineOptions = {}): Block {
  let ts: number[];
  if (Array.isArray(events) && events.filter(Number.isFinite).length >= 2) {
    const es = events.filter(Number.isFinite).slice(0, 6).sort((a, b) => a - b);
    const lo = es[0], hi = es[es.length - 1] > lo ? es[es.length - 1] : lo + 1;
    ts = es.map((e) => (e - lo) / (hi - lo));
  } else {
    const n = clampInt(typeof events === "number" ? events : 4, 2, 6);
    ts = Array.from({ length: n }, (_, i) => i / (n - 1));
  }
  const y = 20, parts: Part[] = [{ id: "line", label: "time line", shapes: [{ type: "path", d: arrow([3, y], [96, y], 6), stroke: "ink" }] }];
  const anchors: Record<string, [number, number]> = { ...edges(100, 40), start: [3, y], end: [96, y] };
  ts.forEach((t, i) => {
    const x = 11 + 72 * t;
    parts.push({ id: `event-${i}`, label: `event ${i + 1}`, shapes: [circle(x, y, 5, color, tint(color))] });
    anchors[`event-${i}`] = pt(x, y);
    anchors[`event-${i}-above`] = pt(x, y - 13);
    anchors[`event-${i}-below`] = pt(x, y + 13);
  });
  return {
    id: "timeline",
    title: "Timeline",
    describe: "a timeline arrow with event ticks; set events (a count 2–6, or a list of times to space to scale); event-i anchors with -above and -below",
    tags: ["timeline", "history", "events", "sequence", "time", "schedule"],
    size: [100, 40],
    parts,
    anchors,
  };
}
export const timeline = makeTimeline();

// ---------- big-o ----------

export type Growth = "1" | "log n" | "n" | "n log n" | "n^2" | "2^n";
const GROWTH: Record<Growth, (t: number) => number> = {
  "1": () => 0.14,
  "log n": (t) => (0.42 * Math.log(1 + 9 * t)) / Math.log(10),
  n: (t) => 0.62 * t,
  "n log n": (t) => (0.95 * t * Math.log(1 + 9 * t)) / Math.log(10),
  "n^2": (t) => t * t,
  "2^n": (t) => (Math.pow(2, 10 * t) - 1) / (Math.pow(2, 7) - 1),
};
/** "n log n" → "n-log-n", "n^2" → "n2", "2^n" → "2n". */
export const growthSlug = (g: string) => g.replace(/\^/g, "").replace(/\s+/g, "-");

export interface BigOOptions { curves?: Growth[]; color?: string }
/** Growth curves on axes, each its own colour: any of "1", "log n", "n", "n log n", "n^2", "2^n". */
export function makeBigO({ curves = ["log n", "n", "n^2"], color = "blue" }: BigOOptions = {}): Block {
  const order = Object.keys(GROWTH) as Growth[];
  let list = order.filter((g) => curves.includes(g));
  if (!list.length) list = ["log n", "n", "n^2"];
  const x0 = 10, y0 = 90, w = 84, h = 82, colors = palette(color);
  const parts: Part[] = [inkAxes(x0, y0, 97, 4)];
  const anchors: Record<string, [number, number]> = { ...edges(100, 96), origin: [x0, y0] };
  list.forEach((g, i) => {
    const f = GROWTH[g], pts: P[] = [];
    const N = 48;
    for (let k = 0; k <= N; k++) {
      const t = k / N, v = f(t);
      if (v >= 1) {
        // Stop exactly at the top by bisecting for where the curve leaves the plot.
        let lo = (k - 1) / N, hi = t;
        for (let j = 0; j < 20; j++) { const m = (lo + hi) / 2; if (f(m) < 1) lo = m; else hi = m; }
        pts.push([x0 + 2 + w * lo, y0 - h]);
        break;
      }
      pts.push([x0 + 2 + w * t, y0 - 2 - (h - 2) * v]);
    }
    const id = `curve-${growthSlug(g)}`;
    parts.push({ id, label: `O(${g})`, shapes: [{ type: "path", d: g === "1" || g === "n" ? poly([pts[0], pts[pts.length - 1]]) : smooth(pts), stroke: colors[i % colors.length] }] });
    const end = pts[pts.length - 1];
    anchors[id] = pt(end[0], end[1]);
  });
  return {
    id: "big-o",
    title: "Big O Growth",
    describe: 'growth curves for algorithm complexity; set curves (any of "1", "log n", "n", "n log n", "n^2", "2^n"); parts and end anchors curve-log-n, curve-n, curve-n2, curve-2n…',
    tags: ["big o", "complexity", "algorithm", "growth", "performance", "scaling"],
    size: [100, 96],
    parts,
    anchors,
  };
}
export const bigO = makeBigO();

// ---------- number line ----------

export interface NumberLineOptions { from?: number; to?: number; marks?: number[]; color?: string }
/** A number line from `from` to `to` (integers, at most 12 ticks; longer ranges step), with dots at `marks`. */
export function makeNumberLine({ from = 0, to = 6, marks = [2], color = "blue" }: NumberLineOptions = {}): Block {
  let a = Math.round(clamp(from, -1e6, 1e6)), b = Math.round(clamp(to, -1e6, 1e6));
  if (a > b) [a, b] = [b, a];
  if (a === b) b = a + 1;
  const step = Math.ceil((b - a) / 11), n = Math.floor((b - a) / step);
  const y = 16, xa = 12, xb = 88, span = n * step;
  const xAt = (v: number) => xa + ((xb - xa) * (v - a)) / span;
  const ticks: string[] = [];
  const anchors: Record<string, [number, number]> = { ...edges(100, 34), start: [xa, y], end: [xb, y] };
  for (let i = 0; i <= n; i++) {
    const x = xAt(a + i * step);
    ticks.push(poly([[x, y - 7], [x, y + 7]]));
    anchors[`tick-${i}`] = pt(x, y);
    anchors[`label-${i}`] = pt(x, y + 13);
  }
  const parts: Part[] = [
    { id: "line", label: "number line", shapes: [{ type: "path", d: `${poly([[3, y], [97, y]])} ${head([97, y], [50, y], 5)} ${head([3, y], [50, y], 5)}`, stroke: "ink" }] },
    { id: "ticks", label: "ticks", shapes: [{ type: "path", d: ticks.join(" "), stroke: "ink" }] },
  ];
  (Array.isArray(marks) ? marks : []).filter(Number.isFinite).slice(0, 8).forEach((m, i) => {
    const x = xAt(clamp(m, a, a + span));
    parts.push({ id: `mark-${i}`, label: `mark ${i + 1}`, shapes: [circle(x, y, 4.5, color, color)] });
    anchors[`mark-${i}`] = pt(x, y);
    anchors[`mark-${i}-above`] = pt(x, y - 10);
  });
  return {
    id: "number-line",
    title: "Number Line",
    describe: "a number line; set from and to (integers, up to 12 ticks) and marks (values shown as dots); tick-i, label-i and mark-i anchors",
    tags: ["number line", "integers", "maths", "counting", "negative numbers", "values"],
    size: [100, 34],
    parts,
    anchors,
  };
}
export const numberLine = makeNumberLine();

// ---------- flow step ----------

export interface ColorOptions { color?: string }
/** A flowchart process box. */
export function makeFlowStep({ color = "orange" }: ColorOptions = {}): Block {
  return {
    id: "flow-step",
    title: "Flow Step",
    describe: "a flowchart process step: a rounded box; anchors input (top), output (bottom), left, right",
    tags: ["flowchart", "process", "step", "algorithm", "action", "box"],
    size: [100, 56],
    parts: [{ id: "box", label: "process step", shapes: [{ type: "rect", x: 4, y: 5, w: 92, h: 46, r: 8, stroke: color, fill: tint(color) }] }],
    anchors: { ...edges(100, 56), input: [50, 5], output: [50, 51], left: [4, 28], right: [96, 28] },
  };
}
export const flowStep = makeFlowStep();

// ---------- decision ----------

/** A flowchart decision diamond with a yes exit (down, green) and a no exit (right, red). */
export function makeDecision({ color = "orange" }: ColorOptions = {}): Block {
  const cx = 40, cy = 36, hw = 36, hh = 30;
  return {
    id: "decision",
    title: "Decision",
    describe: "a flowchart decision diamond with a yes exit down (green) and a no exit right (red); anchors input, yes, no",
    tags: ["flowchart", "decision", "if", "condition", "branch", "algorithm"],
    size: [100, 90],
    parts: [
      { id: "diamond", label: "decision", shapes: [{ type: "path", d: poly([[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]], true), stroke: color, fill: tint(color) }] },
      { id: "yes", label: "yes exit", shapes: [{ type: "path", d: arrow([cx, cy + hh + 2], [cx, 87]), stroke: "green" }] },
      { id: "no", label: "no exit", shapes: [{ type: "path", d: arrow([cx + hw + 2, cy], [97, cy]), stroke: "red" }] },
    ],
    anchors: {
      ...edges(100, 90), center: [cx, cy], input: [cx, cy - hh], yes: [cx, 87], no: [97, cy],
      "yes-label": [cx + 10, cy + hh + 10], "no-label": [cx + hw + 11, cy - 9], left: [cx - hw, cy],
    },
  };
}
export const decision = makeDecision();

// ---------- pipeline ----------

export interface PipelineOptions { stages?: number; color?: string }
/** 2–6 boxes in a row joined by arrows, left to right. */
export function makePipeline({ stages = 3, color = "orange" }: PipelineOptions = {}): Block {
  const n = clampInt(stages, 2, 6), gap = n > 4 ? 9 : 12, bw = (96 - (n - 1) * gap) / n;
  const bh = Math.min(26, Math.max(bw, 20)), H = Math.max(34, bh + 10), cy = H / 2;
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = { ...edges(100, H), input: [2, r1(cy)], output: [98, r1(cy)] };
  for (let i = 0; i < n; i++) {
    const x = 2 + i * (bw + gap);
    parts.push({ id: `stage-${i}`, label: `stage ${i + 1}`, shapes: [{ type: "rect", x: r1(x), y: r1(cy - bh / 2), w: r1(bw), h: r1(bh), r: Math.min(5, bw / 4), stroke: color, fill: tint(color) }] });
    anchors[`stage-${i}`] = pt(x + bw / 2, cy);
    anchors[`stage-${i}-top`] = pt(x + bw / 2, cy - bh / 2);
    anchors[`stage-${i}-bottom`] = pt(x + bw / 2, cy + bh / 2);
    if (i < n - 1) {
      parts.push({ id: `arrow-${i}-${i + 1}`, label: `arrow ${i + 1} to ${i + 2}`, shapes: [{ type: "path", d: arrow([x + bw + 1.5, cy], [x + bw + gap - 1.5, cy], n > 4 ? 3.5 : 4.5), stroke: "ink" }] });
    }
  }
  return {
    id: "pipeline",
    title: "Pipeline",
    describe: "a pipeline of stages: boxes in a row joined by arrows; set stages (2–6); stage-i parts and anchors, input and output",
    tags: ["pipeline", "process", "stages", "workflow", "data flow", "steps"],
    size: [100, r1(H)],
    parts,
    anchors,
  };
}
export const pipeline = makePipeline();

// ---------- state machine ----------

export interface StateMachineOptions { states?: number; transitions?: [number, number][]; color?: string }
/** 2–5 state circles in a ring with curved arrows between them (default a cycle). */
export function makeStateMachine({ states = 3, transitions, color = "orange" }: StateMachineOptions = {}): Block {
  const n = clampInt(states, 2, 5);
  const H = n === 2 ? 56 : 100, rad = n === 5 ? 11 : n === 4 ? 12 : n === 2 ? 14 : 15;
  const centres: P[] = n === 2
    ? [[20, 28], [80, 28]]
    : Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2, R = n === 3 ? 34 : 36;
        return [50 + R * Math.cos(a), (n === 3 ? 54 : 50) + R * Math.sin(a)];
      });
  const ring: P = n === 2 ? [50, 28] : [50, n === 3 ? 54 : 50];
  const list = (Array.isArray(transitions) && transitions.length ? transitions : Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]))
    .map(([a, b]) => [clampInt(a, 0, n - 1), clampInt(b, 0, n - 1)] as [number, number])
    .filter(([a, b], i, all) => all.findIndex(([c, d]) => c === a && d === b) === i)
    .slice(0, 12);
  const parts: Part[] = [];
  const anchors: Record<string, [number, number]> = { ...edges(100, H) };
  centres.forEach(([x, y], i) => {
    parts.push({ id: `state-${i}`, label: `state ${i + 1}`, shapes: [circle(x, y, rad, color, tint(color))] });
    anchors[`state-${i}`] = pt(x, y);
  });
  for (const [a, b] of list) {
    const A = centres[a], B = centres[b];
    let d: string, mid: P;
    if (a === b) {
      // A loop on the outside of the state, away from the ring's centre.
      const out = Math.atan2(A[1] - ring[1], A[0] - ring[0]) || -Math.PI / 2;
      const p0: P = [A[0] + rad * Math.cos(out - 0.5), A[1] + rad * Math.sin(out - 0.5)];
      const p3: P = [A[0] + rad * Math.cos(out + 0.5), A[1] + rad * Math.sin(out + 0.5)];
      const c1: P = [A[0] + (rad + 16) * Math.cos(out - 0.7), A[1] + (rad + 16) * Math.sin(out - 0.7)];
      const c2: P = [A[0] + (rad + 16) * Math.cos(out + 0.7), A[1] + (rad + 16) * Math.sin(out + 0.7)];
      d = `M${r1(p0[0])} ${r1(p0[1])} C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p3[0])} ${r1(p3[1])} ${head(p3, c2, 6.5)}`;
      mid = [A[0] + (rad + 12) * Math.cos(out), A[1] + (rad + 12) * Math.sin(out)];
    } else {
      // Bow to the left of the direction of travel, so a→b and b→a never overlap and a clockwise cycle bows outward.
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
      const bow = n === 2 ? 10 : 0.16 * len;
      const c: P = [(A[0] + B[0]) / 2 + (dy / len) * bow, (A[1] + B[1]) / 2 - (dx / len) * bow];
      const from = Math.atan2(c[1] - A[1], c[0] - A[0]), to = Math.atan2(c[1] - B[1], c[0] - B[0]);
      const p0: P = [A[0] + (rad + 2) * Math.cos(from), A[1] + (rad + 2) * Math.sin(from)];
      const p1: P = [B[0] + (rad + 2) * Math.cos(to), B[1] + (rad + 2) * Math.sin(to)];
      d = `M${r1(p0[0])} ${r1(p0[1])} Q${r1(c[0])} ${r1(c[1])} ${r1(p1[0])} ${r1(p1[1])} ${head(p1, c, 6.5)}`;
      mid = [(p0[0] + 2 * c[0] + p1[0]) / 4, (p0[1] + 2 * c[1] + p1[1]) / 4];
    }
    parts.push({ id: `transition-${a}-${b}`, label: `transition ${a + 1} to ${b + 1}`, shapes: [{ type: "path", d, stroke: "ink" }] });
    anchors[`transition-${a}-${b}`] = pt(mid[0], mid[1]);
  }
  return {
    id: "state-machine",
    title: "State Machine",
    describe: "a state machine: 2–5 state circles with curved arrows; set states and transitions ([from, to] pairs, default a cycle); state-i and transition-a-b parts",
    tags: ["state machine", "automaton", "states", "transitions", "finite state", "logic"],
    size: [100, H],
    parts,
    anchors,
  };
}
export const stateMachine = makeStateMachine();

// ---------- clock ----------

export interface ClockOptions { time?: number; color?: string }
/** A clock face with hour ticks and hands at `time` (hours 0–12; 3.5 is half past three). */
export function makeClock({ time = 10 + 10 / 60, color = "ink" }: ClockOptions = {}): Block {
  const t = ((clamp(time, -1e6, 1e6) % 12) + 12) % 12, cx = 50, cy = 50;
  const at = (a: number, l: number): P => [cx + l * Math.sin(a), cy - l * Math.cos(a)];
  const major: string[] = [], minor: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    (i % 3 ? minor : major).push(poly([at(a, i % 3 ? 35 : 31), at(a, 40)]));
  }
  const hour = at((t / 12) * Math.PI * 2, 21), minute = at((t % 1) * Math.PI * 2, 31);
  return {
    id: "clock",
    title: "Clock",
    describe: "an analogue clock face; set time (hours 0–12, 3.5 is half past three); anchors hour-hand, minute-hand, 12, 3, 6, 9",
    tags: ["clock", "time", "hours", "schedule", "timer", "deadline"],
    size: [100, 100],
    parts: [
      { id: "face", label: "clock face", shapes: [circle(cx, cy, 46, color, "board")] },
      { id: "ticks", label: "hour marks", shapes: [{ type: "path", d: major.join(" "), stroke: color }, { type: "path", d: minor.join(" "), stroke: color, width: 0.7 }] },
      { id: "hour-hand", label: "hour hand", shapes: [{ type: "path", d: poly([[cx, cy], hour]), stroke: color }] },
      { id: "minute-hand", label: "minute hand", shapes: [{ type: "path", d: poly([[cx, cy], minute]), stroke: color, width: 0.8 }, circle(cx, cy, 3, color, color)] },
    ],
    anchors: {
      ...edges(100, 100), hub: [cx, cy], "hour-hand": pt(hour[0], hour[1]), "minute-hand": pt(minute[0], minute[1]),
      "12": [50, 4], "3": [96, 50], "6": [50, 96], "9": [4, 50],
    },
  };
}
export const clock = makeClock();
