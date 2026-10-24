/**
 * Levels 1 and 2: a library of teaching primitives.
 *   Level 1 picks one primitive by name, default parameters, no labels.
 *   Level 2 picks up to three, sets their parameters and labels, and a layout.
 */
import { H, Scene, W, type Pt } from "./doc";

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Params = Record<string, unknown>;
type Draw = (s: Scene, slot: Slot, p: Params, t0: number, dur: number) => void;

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) =>
  Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : d));
const strs = (v: unknown, d: string[], max = 5) => (Array.isArray(v) && v.length ? v.slice(0, max).map((x) => String(x)) : d);

function sinePoints(slot: Slot, cycles: number, amp: number, phase: number, yMid: number): Pt[] {
  const pts: Pt[] = [];
  const n = Math.max(48, Math.round(cycles * 48));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([slot.x + slot.w * t, yMid - amp * Math.sin(t * cycles * Math.PI * 2 + phase)]);
  }
  return pts;
}

const CURVES: Record<string, (x: number) => number> = {
  linear: (x) => x,
  exponential: (x) => (Math.exp(3 * x) - 1) / (Math.exp(3) - 1),
  decay: (x) => Math.exp(-3 * x),
  log: (x) => Math.log(1 + 9 * x) / Math.log(10),
  sigmoid: (x) => 1 / (1 + Math.exp(-10 * (x - 0.5))),
  bell: (x) => Math.exp(-((x - 0.5) ** 2) / 0.03),
  down: (x) => 1 - x,
};

export const PRIMITIVES: Record<string, { describe: string; params: string; draw: Draw }> = {
  wave: {
    describe: "a sine wave drawing left to right",
    params: "cycles 1-8, amplitude 0.1-1, phase 0|180, color, label",
    draw: (s, slot, p, t0, dur) => {
      const amp = (slot.h / 2.6) * num(p.amplitude, 0.8, 0.1, 1);
      s.stroke([[slot.x, slot.y + slot.h / 2], [slot.x + slot.w, slot.y + slot.h / 2]], { at: t0, dur: 0.2, color: "grey", width: 3 });
      s.stroke(sinePoints(slot, num(p.cycles, 3, 1, 8), amp, num(p.phase, 0) === 180 ? Math.PI : 0, slot.y + slot.h / 2), {
        at: t0 + 0.1, dur: Math.min(1.6, dur), color: str(p.color, "red"), width: 10,
      });
      if (p.label) s.text(str(p.label), slot.x + slot.w / 2, slot.y + 36, { at: t0 + 0.2, size: 32 });
    },
  },
  waves_cancel: {
    describe: "a wave, its inverted copy, and their flat sum",
    params: "labels [top, middle, bottom]",
    draw: (s, slot, p, t0, dur) => {
      const labels = strs(p.labels, [], 3);
      const rowH = slot.h / 3;
      const step = Math.min(0.9, dur / 3);
      [0, 1, 2].forEach((i) => {
        const row = { ...slot, y: slot.y + rowH * i, h: rowH };
        const mid = row.y + rowH / 2;
        const amp = i === 2 ? 0 : rowH / 3.2;
        s.stroke(sinePoints(row, 3, amp, i === 1 ? Math.PI : 0, mid), { at: t0 + step * i, dur: step, color: ["red", "blue", "ink"][i], width: 8 });
        if (labels[i]) s.text(labels[i], row.x + 8, row.y + 22, { at: t0 + step * i, size: 26, align: "left", color: "grey" });
      });
    },
  },
  flow: {
    describe: "labelled boxes joined by arrows, a process left to right",
    params: "steps: 2-4 short labels, color",
    draw: (s, slot, p, t0, dur) => {
      const steps = strs(p.steps, ["Input", "Process", "Output"], 4);
      const n = steps.length;
      const bw = Math.min(260, (slot.w - (n - 1) * 60) / n);
      const bh = Math.min(140, slot.h * 0.4);
      const gap = (slot.w - n * bw) / Math.max(1, n - 1);
      const y = slot.y + slot.h / 2 - bh / 2;
      const per = dur / n;
      steps.forEach((label, i) => {
        const x = slot.x + i * (bw + gap);
        s.box(x, y, bw, bh, { at: t0 + per * i, color: str(p.color, "blue"), filled: false });
        s.text(label, x + bw / 2, y + bh / 2, { at: t0 + per * i + 0.1, size: Math.min(30, bw / 6), width: bw - 16 });
        if (i < n - 1) s.arrow([x + bw + 8, y + bh / 2], [x + bw + gap - 8, y + bh / 2], { at: t0 + per * i + per * 0.5, dur: per * 0.4 });
      });
    },
  },
  cycle: {
    describe: "labels around a circle with arrows, a repeating loop",
    params: "steps: 2-5 short labels, color",
    draw: (s, slot, p, t0, dur) => {
      const steps = strs(p.steps, ["One", "Two", "Three"], 5);
      const cx = slot.x + slot.w / 2, cy = slot.y + slot.h / 2;
      const r = Math.min(slot.w, slot.h) * 0.34;
      const n = steps.length;
      const per = dur / n;
      steps.forEach((label, i) => {
        const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
        s.text(label, cx + Math.cos(a0) * r * 1.25, cy + Math.sin(a0) * r * 1.2, { at: t0 + per * i, size: 28, width: 260 });
        const arc: Pt[] = [];
        for (let k = 0; k <= 24; k++) {
          const a = a0 + 0.25 + ((a1 - a0 - 0.5) * k) / 24;
          arc.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        s.stroke(arc, { at: t0 + per * i + 0.1, dur: per * 0.8, color: str(p.color, "green"), width: 8 });
        s.arrow(arc[arc.length - 2], arc[arc.length - 1], { at: t0 + per * i + per * 0.9, dur: 0.05, color: str(p.color, "green") });
      });
    },
  },
  bars: {
    describe: "a bar chart whose bars grow",
    params: "values: 2-6 numbers, labels: same count, color",
    draw: (s, slot, p, t0, dur) => {
      const values = (Array.isArray(p.values) ? p.values : [2, 4, 7]).slice(0, 6).map((v) => num(v, 1, 0));
      const labels = strs(p.labels, [], 6);
      const max = Math.max(...values, 1e-6);
      const n = values.length;
      const bw = (slot.w / n) * 0.6;
      const baseY = slot.y + slot.h - 50;
      s.stroke([[slot.x, baseY], [slot.x + slot.w, baseY]], { at: t0, dur: 0.2, color: "grey", width: 3 });
      values.forEach((v, i) => {
        const x = slot.x + (slot.w / n) * i + (slot.w / n - bw) / 2;
        const h = Math.max(4, (slot.h - 110) * (v / max));
        s.bar(x, baseY, bw, h, { at: t0 + (i * dur * 0.5) / n, dur: 0.5, color: str(p.color, "blue") });
        if (labels[i]) s.text(labels[i], x + bw / 2, baseY + 28, { at: t0 + (i * dur * 0.5) / n, size: 24, width: slot.w / n });
      });
    },
  },
  graph: {
    describe: "x/y axes with a curve that draws itself",
    params: "shape: linear|exponential|decay|log|sigmoid|bell|down, xLabel, yLabel, color",
    draw: (s, slot, p, t0, dur) => {
      const f = CURVES[str(p.shape, "exponential")] ?? CURVES.exponential;
      const ox = slot.x + 50, oy = slot.y + slot.h - 50, gw = slot.w - 80, gh = slot.h - 100;
      s.stroke([[ox, slot.y + 30], [ox, oy], [ox + gw, oy]], { at: t0, dur: 0.4, color: "ink", width: 5 });
      const pts: Pt[] = [];
      for (let i = 0; i <= 80; i++) pts.push([ox + (gw * i) / 80, oy - gh * f(i / 80)]);
      s.stroke(pts, { at: t0 + 0.4, dur: Math.max(0.6, dur - 0.6), color: str(p.color, "red"), width: 9 });
      if (p.xLabel) s.text(str(p.xLabel), ox + gw / 2, oy + 30, { at: t0 + 0.3, size: 26 });
      if (p.yLabel) s.text(str(p.yLabel), ox + 10, slot.y + 16, { at: t0 + 0.3, size: 26, align: "left" });
    },
  },
  split: {
    describe: "a tree: one labelled node splitting into children",
    params: "root: label, children: 2-4 labels, color",
    draw: (s, slot, p, t0, dur) => {
      const kids = strs(p.children, ["A", "B"], 4);
      const rx = slot.x + slot.w / 2, ry = slot.y + slot.h * 0.22;
      s.circle(rx, ry, 44, { at: t0, color: str(p.color, "purple") });
      s.text(str(p.root, ""), rx, ry - 70, { at: t0, size: 30 });
      kids.forEach((label, i) => {
        const kx = slot.x + (slot.w * (i + 0.5)) / kids.length, ky = slot.y + slot.h * 0.75;
        const at = t0 + 0.3 + (i * (dur - 0.5)) / kids.length;
        s.stroke([[rx, ry + 44], [kx, ky - 36]], { at, dur: 0.3, color: "grey", width: 5 });
        s.circle(kx, ky, 36, { at: at + 0.3, color: str(p.color, "purple") });
        s.text(label, kx, ky + 66, { at: at + 0.3, size: 26, width: slot.w / kids.length });
      });
    },
  },
  dots: {
    describe: "dots that spread out, gather together, or flow across",
    params: "mode: spread|gather|flow, count 6-40, color",
    draw: (s, slot, p, t0, dur) => {
      const count = Math.round(num(p.count, 18, 6, 40));
      const mode = str(p.mode, "spread");
      const cx = slot.x + slot.w / 2, cy = slot.y + slot.h / 2;
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < count; i++) {
        const out: Pt = [slot.x + 30 + rand() * (slot.w - 60), slot.y + 30 + rand() * (slot.h - 60)];
        const near: Pt = [cx + (rand() - 0.5) * 60, cy + (rand() - 0.5) * 60];
        const [from, to] =
          mode === "gather" ? [out, near] : mode === "flow" ? [[slot.x + 20, out[1]] as Pt, [slot.x + slot.w - 20, out[1]] as Pt] : [near, out];
        s.mover(from, to, 12, { at: t0 + (mode === "flow" ? (i / count) * dur * 0.5 : 0), dur: Math.min(1.5, dur), color: str(p.color, "blue") });
      }
    },
  },
  network: {
    describe: "layers of nodes fully connected left to right",
    params: "layers: 2-5 node counts (1-6 each), color",
    draw: (s, slot, p, t0, dur) => {
      const layers = (Array.isArray(p.layers) ? p.layers : [3, 4, 2]).slice(0, 5).map((v) => Math.round(num(v, 3, 1, 6)));
      const per = dur / layers.length;
      const xs = layers.map((_, i) => slot.x + 60 + ((slot.w - 120) * i) / Math.max(1, layers.length - 1));
      const ys = layers.map((n) => Array.from({ length: n }, (_, k) => slot.y + (slot.h * (k + 1)) / (n + 1)));
      layers.forEach((_, i) => {
        if (i > 0) for (const ya of ys[i - 1]) for (const yb of ys[i]) s.stroke([[xs[i - 1], ya], [xs[i], yb]], { at: t0 + per * i - per * 0.5, dur: per * 0.5, color: "grey", width: 2 });
        for (const y of ys[i]) s.circle(xs[i], y, 22, { at: t0 + per * i, color: str(p.color, "purple") });
      });
    },
  },
  label: {
    describe: "one big word or short phrase",
    params: "text, color",
    draw: (s, slot, p, t0) => {
      s.text(str(p.text, "Idea"), slot.x + slot.w / 2, slot.y + slot.h / 2, { at: t0, size: 64, color: str(p.color, "ink"), width: slot.w });
    },
  },
};

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES);

export interface Level2Spec {
  layout: "single" | "row" | "column";
  items: { primitive: string; params?: Params; startsAt?: number }[];
  caption?: string;
}

const MARGIN = 60;

function slots(layout: Level2Spec["layout"], n: number, top: number): Slot[] {
  const area: Slot = { x: MARGIN, y: top, w: W - 2 * MARGIN, h: H - top - MARGIN };
  if (n <= 1 || layout === "single") return Array.from({ length: n }, () => area);
  if (layout === "column") return Array.from({ length: n }, (_, i) => ({ ...area, y: area.y + (area.h / n) * i, h: area.h / n - 20 }));
  return Array.from({ length: n }, (_, i) => ({ ...area, x: area.x + (area.w / n) * i, w: area.w / n - 30 }));
}

/** Level 1: one primitive by name, defaults only. */
export function compileLevel1(name: string, id: string) {
  const prim = PRIMITIVES[name];
  if (!prim) throw new Error(`unknown primitive "${name}"; choose one of ${PRIMITIVE_NAMES.join(", ")}`);
  const s = new Scene();
  prim.draw(s, slots("single", 1, MARGIN)[0], {}, 0, 2.5);
  return s.build(id, `L1 ${name}`);
}

/** Level 2: up to three parameterized primitives in a layout. */
export function compileLevel2(spec: Level2Spec, id: string) {
  const items = (spec.items ?? []).slice(0, 3);
  if (!items.length) throw new Error("items must contain at least one primitive");
  const s = new Scene();
  const top = spec.caption ? 130 : MARGIN;
  if (spec.caption) s.text(spec.caption, W / 2, 70, { at: 0, size: 44, width: W - 120 });
  const areas = slots(spec.layout, items.length, top);
  items.forEach((item, i) => {
    const prim = PRIMITIVES[item.primitive];
    if (!prim) throw new Error(`unknown primitive "${item.primitive}"; choose one of ${PRIMITIVE_NAMES.join(", ")}`);
    const t0 = num(item.startsAt, i * 0.8, 0, 3.5);
    prim.draw(s, areas[i], item.params ?? {}, t0, Math.max(1, 3 - t0));
  });
  return s.build(id, "L2 scene");
}
