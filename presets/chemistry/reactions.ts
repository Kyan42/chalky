// States of matter, energy and reactions: particle boxes, state changes, heating curves, energy profiles,
// rates, reaction arrows and equations, and the reactions you can see (flames, precipitates, bubbles,
// electrolysis, cells). Every block is a factory plus a default instance; each particle, arrow, electrode
// and level is its own part with its own anchor, so lessons can point at, circle and label it.
import { cubicAt, poly, smooth, wave, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Helpers: draw in any units, then fit the drawing into a box whose longer side is 100. ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
/** The colour's pale fill, when it has one. */
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : undefined);
/** A whole number in lo..hi (d when missing). */
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = Math.round(typeof v === "number" && Number.isFinite(v) ? v : d);
  return Math.min(hi, Math.max(lo, x));
};
/** A fraction in lo..hi (d when missing). */
const frac = (v: number | undefined, d: number, lo = 0, hi = 1) => {
  const x = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, x));
};
const pick = <T extends string>(v: string | undefined, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

type Style = { fill?: string; width?: number; r?: number };
const rect = (x: number, y: number, w: number, h: number, stroke: string, o: Style = {}): Shape => ({
  type: "rect", x, y, w, h, stroke, ...(o.r ? { r: o.r } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const path = (d: string, stroke: string, o: Style = {}): Shape => ({ type: "path", d, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}) });
const line = (pts: P[], stroke: string, width?: number): Shape => ({ type: "path", d: poly(pts), stroke, ...(width ? { width } : {}) });
/** A fill with no outline (a liquid's body): a knockout in chalk, a pale wash elsewhere. */
const wash = (d: string, fill: string | undefined): Shape[] => (fill ? [{ type: "path", d, fill }] : []);
/** An invisible box: gives a group part a place to be circled. */
const ghost = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });

/** Arrowhead lines at `tip`, pointing along `dir`. */
const head = (tip: P, dir: P, size: number) => {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const u: P = [dir[0] / len, dir[1] / len], v: P = [-u[1], u[0]];
  const a: P = [tip[0] - u[0] * size + v[0] * size * 0.75, tip[1] - u[1] * size + v[1] * size * 0.75];
  const b: P = [tip[0] - u[0] * size - v[0] * size * 0.75, tip[1] - u[1] * size - v[1] * size * 0.75];
  return poly([a, tip, b]);
};
/** A straight arrow from a to b. */
const arrow = (a: P, b: P, stroke: string, size = 5, width?: number): Shape => ({
  type: "path", d: `${poly([a, b])} ${head(b, [b[0] - a[0], b[1] - a[1]], size)}`, stroke, ...(width ? { width } : {}),
});
/** A wavy arrow (heat) from a to b. */
const wavyArrow = (a: P, b: P, stroke: string, amp = 2.6, cycles = 1.5, size = 5): Shape => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const u: P = [dx / len, dy / len], v: P = [-u[1], u[0]];
  const body = len - size * 0.6, pts: P[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, s = Math.sin(t * cycles * Math.PI * 2) * amp * Math.min(1, (1 - t) * 4);
    pts.push([a[0] + u[0] * body * t + v[0] * s, a[1] + u[1] * body * t + v[1] * s]);
  }
  return { type: "path", d: `${smooth(pts)} ${head(b, u, size)}`, stroke };
};
/** A dashed line through the points: dashes `dash` long with `gap` between. */
const dashed = (pts: P[], stroke: string, dash = 6, gap = 5, width = 0.8): Shape => {
  const segs: string[] = [];
  let on = true, left = dash, cur: P[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > 1e-6) {
      const step = Math.min(left, seg), t = step / seg;
      const p: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (on) cur.push(p);
      seg -= step, left -= step, (a = p);
      if (left <= 1e-6) {
        if (on && cur.length > 1) segs.push(poly(cur));
        on = !on, (left = on ? dash : gap), (cur = [p]);
      }
    }
  }
  if (on && cur.length > 1) segs.push(poly(cur));
  return { type: "path", d: segs.join(" "), stroke, width };
};
/** Points along a cubic. */
const cubicPts = (p0: P, p1: P, p2: P, p3: P, n = 16): P[] => Array.from({ length: n + 1 }, (_, i) => cubicAt(p0, p1, p2, p3, i / n));
/** A short wavy line (a liquid's ripple). */
const ripple = (x0: number, x1: number, y: number, stroke: string) => path(wave(x0, x1, y, 1.6, Math.max(1, (x1 - x0) / 12)), stroke, { width: 0.8 });
/** A repeatable pseudo-random sequence in 0..1. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A particle of matter: a tinted ball. */
const ball = (c: P, r: number, color: string) => circle(c[0], c[1], r, color, { fill: tint(color) });
// Atom balls, one colour per element (radius 13, H 10, scaled with the molecule).
const ATOM = {
  H: { r: 10, stroke: "ink", fill: "board" },
  C: { r: 13, stroke: "ink", fill: "grey-tint" },
  O: { r: 13, stroke: "red", fill: "red-tint" },
} as const;
const atom = (el: keyof typeof ATOM, c: P, m: number) => circle(c[0], c[1], ATOM[el].r * m, ATOM[el].stroke, { fill: ATOM[el].fill });
/** CO2 (O=C=O, in a line) centred at c, scaled by m. */
const co2 = (c: P, m: number): Shape[] => {
  const d = 26 * m;
  return [atom("O", [c[0] - d, c[1]], m), atom("O", [c[0] + d, c[1]], m), atom("C", c, m)];
};
/** H2O (bent) with the O at c, hydrogens below, scaled by m. */
const h2o = (c: P, m: number): Shape[] => {
  const d = 23 * m, a = (52 * Math.PI) / 180;
  return [atom("H", [c[0] - Math.sin(a) * d, c[1] + Math.cos(a) * d], m), atom("H", [c[0] + Math.sin(a) * d, c[1] + Math.cos(a) * d], m), atom("O", c, m)];
};

// Glassware.
/** A beaker's outline: open top with lips, from (x0, y0) w wide and h tall. */
const beakerOutline = (x0: number, y0: number, w: number, h: number): string => {
  const x1 = x0 + w, y1 = y0 + h;
  return `M${x0 - 4} ${y0 - 3} L${x0} ${y0} L${x0} ${y1 - 5} Q${x0} ${y1} ${x0 + 5} ${y1} L${x1 - 5} ${y1} Q${x1} ${y1} ${x1} ${y1 - 5} L${x1} ${y0} L${x1 + 4} ${y0 - 3}`;
};
/** The liquid in a beaker: its body, from the surface down. */
const beakerLiquid = (x0: number, w: number, ySurf: number, y1: number): string =>
  `M${x0} ${ySurf} L${x0} ${y1 - 5} Q${x0} ${y1} ${x0 + 5} ${y1} L${x0 + w - 5} ${y1} Q${x0 + w} ${y1} ${x0 + w} ${y1 - 5} L${x0 + w} ${ySurf} Z`;

class Sketch {
  parts: Part[] = [];
  anchors: Record<string, P> = {};
  part(id: string, label: string, ...shapes: Shape[]) {
    this.parts.push({ id, label, shapes });
    return this;
  }
  at(name: string, p: P) {
    this.anchors[name] = p;
    return this;
  }
}

type Meta = Pick<Block, "id" | "title" | "describe" | "tags">;
const r1 = (v: number) => +v.toFixed(1);

/** The drawing's extent (control points included), for fitting. */
function extent(sk: Sketch): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)));
  for (const sh of sk.parts.flatMap((p) => p.shapes)) {
    if (sh.type === "rect") add(sh.x, sh.y), add(sh.x + sh.w, sh.y + sh.h);
    else if (sh.type === "ellipse") add(sh.cx - sh.rx, sh.cy - sh.ry), add(sh.cx + sh.rx, sh.cy + sh.ry);
    else {
      const nums = (sh.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) add(nums[i], nums[i + 1]);
    }
  }
  return [x0, y0, x1, y1];
}

/** Scales and centres a sketch (inside `bounds`, or its own extent) into a box with longer side 100 (never thinner than 3:1). */
function finish(meta: Meta, sk: Sketch, bounds = extent(sk), margin = 5): Block {
  const [x0, y0, x1, y1] = bounds;
  const w = x1 - x0, h = y1 - y0;
  const s = (100 - 2 * margin) / Math.max(w, h);
  let W = w * s + 2 * margin, H = h * s + 2 * margin;
  if (W >= H) (W = 100), (H = Math.max(H, 100 / 3));
  else (H = 100), (W = Math.max(W, 100 / 3));
  const ox = (W - w * s) / 2 - x0 * s, oy = (H - h * s) / 2 - y0 * s;
  const fx = (x: number) => r1(x * s + ox), fy = (y: number) => r1(y * s + oy);
  const pt = (p: P): [number, number] => [fx(p[0]), fy(p[1])];
  const fit = (d: string) => {
    const out: string[] = [];
    let pending: number | null = null;
    for (const tok of d.match(/[MLCQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []) {
      if (/^[A-Z]$/i.test(tok)) out.push(tok.toUpperCase());
      else if (pending === null) pending = +tok;
      else out.push(`${fx(pending)} ${fy(+tok)}`), (pending = null);
    }
    return out.join(" ").replace(/([MLCQ]) /g, "$1");
  };
  const shape = (sh: Shape): Shape => {
    if (sh.type === "rect") return { ...sh, x: fx(sh.x), y: fy(sh.y), w: r1(sh.w * s), h: r1(sh.h * s), ...(sh.r ? { r: r1(sh.r * s) } : {}) };
    if (sh.type === "ellipse") return { ...sh, cx: fx(sh.cx), cy: fy(sh.cy), rx: r1(sh.rx * s), ry: r1(sh.ry * s) };
    return { ...sh, d: fit(sh.d) };
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const anchors: Record<string, [number, number]> = {
    center: pt([cx, cy]), top: pt([cx, y0]), bottom: pt([cx, y1]), left: pt([x0, cy]), right: pt([x1, cy]),
  };
  for (const [k, p] of Object.entries(sk.anchors)) anchors[k] = pt(p);
  return { ...meta, size: [r1(W), r1(H)], parts: sk.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors };
}

// ---- Matter ----

export type MatterState = "solid" | "liquid" | "gas";
const STATES = ["solid", "liquid", "gas"] as const;

export interface ParticlesOptions { state?: MatterState; n?: number; color?: string }
/** A sealed box of `n` particles (2–20, default 8) as a solid (neat lattice), liquid (touching, jumbled) or gas (spread out, moving). */
export function makeParticles({ state = "solid", n = 8, color = "blue" }: ParticlesOptions = {}): Block {
  state = pick(state, STATES, "solid");
  n = clamp(n, 2, 20, 8);
  const W = 100, H = 78, floor = H - 3;
  let r = n > 12 ? 6 : 7.5;
  const d = 2 * r + 3, rand = rng(n * 7 + state.length);
  let pts: P[] = [];
  if (state === "solid") {
    const cols = Math.min(Math.floor((W - 6) / d), Math.ceil(Math.sqrt(n * 1.3)));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols, k = i - row * cols;
      pts.push([W / 2 + (k - (inRow - 1) / 2) * d, floor - r - row * d]);
    }
  } else if (state === "liquid") {
    // Loosely hex-packed along the floor, jiggled, then nudged apart so they touch without overlapping.
    const cols = Math.min(Math.floor((W - 6) / d), Math.max(2, Math.ceil(n * 0.75))), dy = d * 0.87;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - row * cols);
      const x = W / 2 - ((inRow - 1) * d) / 2 + k * d + (row % 2 ? d * 0.4 : -d * 0.1) + (rand() - 0.5) * 5;
      pts.push([x, floor - r - row * dy - rand() * 3]);
    }
    for (let pass = 0; pass < 30; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pts[j][0] - pts[i][0], dyy = pts[j][1] - pts[i][1], l = Math.hypot(dx, dyy) || 1, push = (2 * r + 2 - l) / 2;
          if (push > 0) (pts[i] = [pts[i][0] - (dx / l) * push, pts[i][1] - (dyy / l) * push]), (pts[j] = [pts[j][0] + (dx / l) * push, pts[j][1] + (dyy / l) * push]);
        }
      }
      pts = pts.map(([x, y]) => [Math.min(W - r - 2.5, Math.max(r + 2.5, x)), Math.min(floor - r, Math.max(r + 3, y))] as P);
    }
  } else {
    // Spread out evenly but at random: each particle is the best of many tries, as far as it can get from the others and the walls.
    r = n > 12 ? 3.5 : n > 4 ? 4.5 : 5.5;
    for (let i = 0; i < n; i++) {
      let best: P = [W / 2, H / 2], bestScore = -Infinity;
      for (let k = 0; k < 80; k++) {
        const c: P = [r + 4 + rand() * (W - 2 * r - 8), r + 4 + rand() * (H - 2 * r - 8)];
        const wall = Math.min(c[0], W - c[0], c[1], H - c[1]) - r;
        const score = Math.min(wall * 3 + 8, ...pts.map((q) => Math.hypot(c[0] - q[0], c[1] - q[1]) - 2 * r));
        if (score > bestScore) (bestScore = score), (best = c);
      }
      pts.push(best);
    }
    // Then nudge them apart towards an even spacing, inside the walls.
    const lo = r + 4, A = (W - 2 * lo) * (H - 2 * lo), target = 0.92 * Math.sqrt((2 * A) / (Math.sqrt(3) * n));
    for (let pass = 0; pass < 60; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1], l = Math.hypot(dx, dy) || 1, push = (target - l) / 4;
          if (push > 0) (pts[i] = [pts[i][0] - (dx / l) * push, pts[i][1] - (dy / l) * push]), (pts[j] = [pts[j][0] + (dx / l) * push, pts[j][1] + (dy / l) * push]);
        }
      }
      pts = pts.map(([x, y]) => [Math.min(W - lo, Math.max(lo, x)), Math.min(H - lo, Math.max(lo, y))] as P);
    }
  }
  const sk = new Sketch();
  sk.part("container", "container", rect(0, 0, W, H, "ink", { r: 3 }));
  pts.forEach((p, i) => {
    const shapes = [ball(p, r, color)];
    if (state === "gas" && n <= 10) {
      // A small arrow ahead of each particle, in the first direction (from a random start) that stays in the box and clear of the others.
      const a0 = rand() * Math.PI * 2, reach = r + 14;
      let u: P = [Math.cos(a0), Math.sin(a0)], best = -Infinity;
      for (let k = 0; k < 12; k++) {
        const a = a0 + (k * Math.PI) / 6, v: P = [Math.cos(a), Math.sin(a)];
        const samples = [0.4, 0.7, 1].map((t): P => [p[0] + v[0] * reach * t + v[0] * 0, p[1] + v[1] * reach * t]);
        const wall = Math.min(...samples.map(([x, y]) => Math.min(x, W - x, y, H - y)));
        const gap = Math.min(...pts.filter((_, j) => j !== i).flatMap((q) => samples.map(([x, y]) => Math.hypot(x - q[0], y - q[1]) - r)));
        const score = Math.min(wall - 3, gap - 3);
        if (score > best) (best = score), (u = v);
        if (score > 0) break;
      }
      shapes.push(arrow([p[0] + u[0] * (r + 3), p[1] + u[1] * (r + 3)], [p[0] + u[0] * (r + 13), p[1] + u[1] * (r + 13)], "grey", 3.5, 0.8));
    }
    sk.part(`particle-${i}`, `particle ${i}`, ...shapes);
    sk.at(`particle-${i}`, p);
  });
  sk.at("container", [W / 2, 0]).at("floor", [W / 2, H]);
  if (state !== "gas") sk.at("surface", [W / 2, Math.min(...pts.map((p) => p[1])) - r]);
  return finish(
    {
      id: "particles", title: "Particles",
      describe: "a sealed box of particles in one state: solid (neat lattice), liquid (touching, jumbled) or gas (spread out, smaller, each with a small motion arrow up to 10 particles); set state and n (2-20, default 8); anchors particle-i, container, surface (top of a solid or liquid)",
      tags: ["particles", "states of matter", "solid", "liquid", "gas", "kinetic theory"],
    },
    sk, [0, 0, W, H],
  );
}
export const particles = makeParticles();

export interface StateChangesOptions { reverse?: boolean; color?: string }
/**
 * Solid, liquid and gas in a triangle, joined by arrows: melt, boil and sublime (orange, heating) and,
 * with `reverse` (default true), freeze, condense and deposit (blue, cooling).
 */
export function makeStateChanges({ reverse = true, color = "blue" }: StateChangesOptions = {}): Block {
  const sk = new Sketch(), half = 22, r = 5.5;
  const node: Record<MatterState, P> = { gas: [84, 22], solid: [22, 114], liquid: [146, 114] };
  const inner: Record<MatterState, P[]> = {
    solid: [[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]],
    liquid: [[-11, 12], [2, 13], [13.5, 6], [-4.5, 0.5]],
    gas: [[-11, -10], [11, -6], [-3, 11]],
  };
  for (const s of STATES) {
    const [cx, cy] = node[s];
    sk.part(s, s, rect(cx - half, cy - half, half * 2, half * 2, "ink", { r: 4 }), ...inner[s].map(([dx, dy]) => ball([cx + dx, cy + dy], r, color)));
    sk.at(s, [cx, cy]);
  }
  const centre: P = [84, 82];
  const edge = (from: MatterState, to: MatterState, fwd: string, back: string) => {
    const a = node[from], b = node[to];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const u: P = [dx / len, dy / len];
    let v: P = [-u[1], u[0]];
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((mid[0] + v[0] - centre[0]) ** 2 + (mid[1] + v[1] - centre[1]) ** 2 < (mid[0] - centre[0]) ** 2 + (mid[1] - centre[1]) ** 2) v = [-v[0], -v[1]];
    // Trim each arrow to the node boxes: how far along u until it leaves a box of half-size `half`.
    const out = half / Math.max(Math.abs(u[0]), Math.abs(u[1])) + 5;
    const off = reverse ? 7 : 0;
    const p = (t: number, o: number): P => [a[0] + u[0] * t + v[0] * o, a[1] + u[1] * t + v[1] * o];
    sk.part(fwd, fwd, arrow(p(out, off), p(len - out, off), "orange", 5));
    sk.at(fwd, p(len / 2, off + 10));
    if (reverse) {
      sk.part(back, back, arrow(p(len - out, -off), p(out, -off), "blue", 5));
      sk.at(back, p(len / 2, -off - 10));
    }
  };
  edge("solid", "liquid", "melt", "freeze");
  edge("liquid", "gas", "boil", "condense");
  edge("solid", "gas", "sublime", "deposit");
  return finish(
    {
      id: "state-changes", title: "State Changes",
      describe: "solid, liquid and gas boxes of particles in a triangle joined by arrows: melt, boil, sublime (orange) and freeze, condense, deposit (blue); set reverse (false shows heating arrows only); anchors solid, liquid, gas and one per change for its label",
      tags: ["states of matter", "melting", "boiling", "condensing", "freezing", "sublimation"],
    },
    sk,
  );
}
export const stateChanges = makeStateChanges();

export interface HeatingCurveOptions { cooling?: boolean; color?: string }
/** Temperature against time for heating ice to steam: rising lines with plateaus at melting and boiling (or the cooling curve, falling). */
export function makeHeatingCurve({ cooling = false, color = "red" }: HeatingCurveOptions = {}): Block {
  const x0 = 10, yB = 84;
  let pts: P[] = [[16, 76], [36, 58], [54, 58], [70, 32], [100, 32], [116, 12]];
  if (cooling) pts = pts.map(([x, y]) => [132 - x, y] as P).reverse();
  const at = (i: number): P => [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
  const sk = new Sketch();
  sk.part("axes", "axes: temperature against time", line([[x0, 4], [x0, yB], [124, yB]], "ink", 0.8));
  sk.part("curve", cooling ? "cooling curve" : "heating curve", line(pts, color));
  const [lo, hi] = cooling ? [3, 1] : [1, 3]; // segment index of the melting and boiling plateaus
  const [sol, liq, gas] = cooling ? [4, 2, 0] : [0, 2, 4];
  sk.part("melting", cooling ? "freezing plateau" : "melting plateau", ghost(Math.min(pts[lo][0], pts[lo + 1][0]), pts[lo][1] - 4, Math.abs(pts[lo + 1][0] - pts[lo][0]), 8));
  sk.part("boiling", cooling ? "condensing plateau" : "boiling plateau", ghost(Math.min(pts[hi][0], pts[hi + 1][0]), pts[hi][1] - 4, Math.abs(pts[hi + 1][0] - pts[hi][0]), 8));
  const up = (p: P, d = 9): P => [p[0], p[1] - d];
  sk.at("melting", up(at(lo))).at("freezing", up(at(lo))).at("boiling", up(at(hi))).at("condensing", up(at(hi)));
  sk.at("solid", [at(sol)[0] + (cooling ? -9 : 9), at(sol)[1]]).at("liquid", [at(liq)[0] + (cooling ? -9 : 9), at(liq)[1]]).at("gas", [at(gas)[0] + (cooling ? -9 : 9), at(gas)[1]]);
  sk.at("start", pts[0]).at("end", pts[pts.length - 1]).at("origin", [x0, yB]).at("axis-x", [67, yB + 6]).at("axis-y", [x0 - 6, 44]);
  sk.at("melting-point", [x0, pts[lo][1]]).at("boiling-point", [x0, pts[hi][1]]);
  return finish(
    {
      id: "heating-curve", title: "Heating Curve",
      describe: "temperature against time as a substance is heated: rising lines with flat plateaus while it melts and boils; set cooling (the falling cooling curve); anchors melting, boiling, solid, liquid, gas, melting-point and boiling-point (on the axis), start, end",
      tags: ["heating curve", "melting point", "boiling point", "temperature", "states of matter", "latent heat"],
    },
    sk, [x0 - 6, 4, 124, yB + 6],
  );
}
export const heatingCurve = makeHeatingCurve();

export interface DiffusionOptions { spread?: number; n?: number; arrow?: boolean; color?: string }
/** `n` particles (4–16, default 10) spreading from the left of a box; `spread` 0 (all on the left) to 1 (even). */
export function makeDiffusion({ spread = 0.5, n = 10, arrow: showArrow = true, color = "blue" }: DiffusionOptions = {}): Block {
  spread = frac(spread, 0.5);
  n = clamp(n, 4, 16, 10);
  const W = 130, H = 66, r = 6.5, d = 2 * r + 4.5, rows = n <= 6 ? 2 : 3, per = Math.ceil(n / rows), rand = rng(n);
  const sk = new Sketch();
  sk.part("container", "container", rect(0, 0, W, H, "ink", { r: 3 }));
  let i = 0;
  for (let j = 0; j < rows; j++) {
    const inRow = Math.min(per, n - j * per), y = H / 2 + (j - (rows - 1) / 2) * 19.5;
    for (let k = 0; k < inRow; k++, i++) {
      const start = 4 + r + k * d + (j % 2) * (d / 2);
      const cell = (W - 8 - 2 * r) / inRow, end = 4 + r + (k + 0.5) * cell + (j % 2 ? 0.2 : -0.2) * cell;
      const p: P = [start + (end - start) * spread, y + (rand() - 0.5) * 2.5 * spread];
      sk.part(`particle-${i}`, `particle ${i}`, ball(p, r, color));
      sk.at(`particle-${i}`, p);
    }
  }
  if (showArrow && spread < 0.9) sk.part("arrow", "direction of spreading", arrow([W * 0.3, -13], [W * 0.7, -13], "grey", 5, 0.8));
  sk.at("arrow", [W / 2, -13]).at("high", [W * 0.15, H / 2]).at("low", [W * 0.85, H / 2]);
  return finish(
    {
      id: "diffusion", title: "Diffusion",
      describe: "particles spreading out from the left of a box towards the right, from high to low concentration; set spread (0 all bunched on the left, 1 evenly spread), n (4-16) and arrow; anchors particle-i, high, low, arrow",
      tags: ["diffusion", "particles", "concentration", "spreading", "gas", "random motion"],
    },
    sk, [0, -18, W, H],
  );
}
export const diffusion = makeDiffusion();

export interface DissolvingOptions { dissolved?: number; liquid?: string; color?: string }
/** A beaker of solvent with a crystal at the bottom whose particles are leaving into the liquid; `dissolved` 0–1 (default 0.5). */
export function makeDissolving({ dissolved = 0.5, liquid = "blue", color = "blue" }: DissolvingOptions = {}): Block {
  dissolved = frac(dissolved, 0.5);
  const sk = new Sketch(), x0 = 0, w = 120, y0 = 0, h = 100, ySurf = 20, r = 7, d = 17;
  // The crystal: a 4 x 3 lattice on the floor; its top row and corners leave first.
  const sites: P[] = [];
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++) sites.push([w / 2 + (k - 1.5) * d, h - 1 - r - row * d]);
  const order = [8, 11, 9, 10, 4, 7, 5, 6]; // site indices, the order they leave in
  const gone = Math.round(dissolved * order.length);
  const left = new Set(order.slice(0, gone));
  const spots: P[] = [[18, 40], [100, 44], [44, 34], [78, 32], [16, 70], [104, 74], [60, 50], [30, 56]];
  sk.part("beaker", "beaker", path(beakerOutline(x0, y0, w, h), "ink"));
  sk.part("liquid", "solvent", ...wash(beakerLiquid(x0, w, ySurf, h), tint(liquid)), line([[x0, ySurf], [x0 + w, ySurf]], liquid), ripple(90, 108, 62, liquid), ripple(6, 19, 90, liquid));
  sk.part("crystal", "crystal", ...sites.filter((_, i) => !left.has(i)).map((p) => ball(p, r, color)));
  for (let i = 0; i < gone; i++) {
    const p = spots[i];
    sk.part(`particle-${i}`, `dissolved particle ${i}`, ball(p, r, color));
    sk.at(`particle-${i}`, p);
  }
  const top = Math.min(...sites.filter((_, i) => !left.has(i)).map((p) => p[1]));
  sk.at("crystal", [w / 2, top]).at("surface", [w / 2, ySurf]).at("liquid", [w * 0.8, 40]).at("mouth", [w / 2, y0]).at("base", [w / 2, h]);
  return finish(
    {
      id: "dissolving", title: "Dissolving",
      describe: "a beaker of solvent with a crystal at the bottom whose particles break away and spread into the liquid; set dissolved (0-1, how many have left) and liquid colour; anchors crystal, particle-i (the dissolved ones), liquid, surface, mouth, base",
      tags: ["dissolving", "solution", "solute", "solvent", "crystal", "particles"],
    },
    sk,
  );
}
export const dissolving = makeDissolving();

export interface BrownianMotionOptions { steps?: number; n?: number; color?: string }
/** A microscope view: one particle's zig-zag path (`steps` 3–12, default 8) among `n` small fluid particles (0–20, default 12). */
export function makeBrownianMotion({ steps = 8, n = 12, color = "blue" }: BrownianMotionOptions = {}): Block {
  steps = clamp(steps, 3, 12, 8);
  n = clamp(n, 0, 20, 12);
  const C: P = [50, 50], R = 47;
  const route: P[] = [[30, 66], [42, 38], [56, 62], [70, 46], [60, 26], [36, 24], [24, 46], [48, 52], [62, 76], [76, 64], [80, 36], [66, 16], [50, 34]];
  const pts = route.slice(0, steps + 1), end = pts[pts.length - 1];
  const sk = new Sketch(), rand = rng(steps * 31 + n);
  sk.part("view", "field of view", circle(C[0], C[1], R, "ink"));
  // Small fluid particles, kept clear of the path, the particle and each other.
  const segDist = (p: P, a: P, b: P) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const small: P[] = [];
  for (let tries = 0; small.length < n && tries < 4000; tries++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * (R - 8);
    const p: P = [C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr];
    const clear = pts.every((q, i) => i === 0 || segDist(p, pts[i - 1], q) > 9) && Math.hypot(p[0] - end[0], p[1] - end[1]) > 18 && small.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 13);
    if (clear) small.push(p);
  }
  small.forEach((p, i) => sk.part(`molecule-${i}`, `fluid particle ${i}`, circle(p[0], p[1], 3, "grey", { width: 0.8 })));
  sk.part("path", "zig-zag path", line(pts, color, 0.8));
  sk.part("particle", "the particle", ball(end, 9, color));
  sk.at("particle", end).at("start", pts[0]).at("path", pts[Math.floor(pts.length / 2)]).at("view", [C[0], C[1] - R]);
  return finish(
    {
      id: "brownian-motion", title: "Brownian Motion",
      describe: "a microscope view of one particle's random zig-zag path, knocked about by small fluid particles; set steps (3-12 turns) and n (0-20 small particles); anchors particle, start, path, view",
      tags: ["brownian motion", "particles", "random motion", "diffusion", "kinetic theory", "microscope"],
    },
    sk, [C[0] - R, C[1] - R, C[0] + R, C[1] + R],
  );
}
export const brownianMotion = makeBrownianMotion();

// ---- Energy and rates ----

export interface EnergyProfileOptions { exothermic?: boolean; activation?: number; catalyst?: boolean; color?: string }
/** An energy profile: reactants, a hump, products; `exothermic` (default true), `activation` 0–1 (hump height), `catalyst` (a lower dashed hump). */
export function makeEnergyProfile({ exothermic = true, activation = 0.5, catalyst = false, color = "orange" }: EnergyProfileOptions = {}): Block {
  activation = frac(activation, 0.5);
  const x0 = 10, yB = 94, [yR, yP] = exothermic ? [56, 82] : [82, 56];
  const hump = 10 + activation * 36, yPk = Math.min(yR, yP) - hump, yC = Math.min(yR, yP) - hump * 0.45;
  const xa = 40, xp = 68, xb = 96;
  const sk = new Sketch();
  sk.part("axes", "axes: energy against progress of reaction", line([[x0, 4], [x0, yB], [130, yB]], "ink", 0.8));
  sk.part("guide", "reactant energy level, continued", dashed([[xa + 3, yR], [124, yR]], "grey", 4, 6, 0.8));
  sk.part("reactants", "reactants", line([[16, yR], [xa, yR]], color));
  const up = cubicPts([xa, yR], [xa + 12, yR], [xp - 12, yPk], [xp, yPk]), down = cubicPts([xp, yPk], [xp + 12, yPk], [xb - 12, yP], [xb, yP]);
  sk.part("hump", "energy barrier", path(smooth([...up, ...down.slice(1)]), color));
  sk.part("products", "products", line([[xb, yP], [124, yP]], color));
  if (catalyst) {
    const cu = cubicPts([xa, yR], [xa + 12, yR], [xp - 12, yC], [xp, yC]), cd = cubicPts([xp, yC], [xp + 12, yC], [xb - 12, yP], [xb, yP]);
    sk.part("catalyst", "lower barrier with a catalyst", dashed([...cu, ...cd.slice(1)], color, 6, 5, 1));
    sk.at("catalyst-peak", [xp, yC - 8]);
  }
  const gap = 3;
  sk.part("activation", "activation energy", arrow([xp, yR - (exothermic ? 0 : 0)], [xp, yPk + gap], "ink", 4, 0.8));
  sk.part("delta-h", "energy change", arrow([116, yR], [116, yP + (yP > yR ? -gap : gap)], "ink", 4, 0.8));
  sk.at("reactants", [28, yR - 8]).at("products", [110, yP + (exothermic ? 8 : -8)]).at("peak", [xp, yPk - 7]);
  sk.at("activation", [xp + 9, (yR + yPk) / 2]).at("delta-h", [124, (yR + yP) / 2]).at("origin", [x0, yB]).at("axis-x", [70, yB + 6]).at("axis-y", [x0 - 6, 50]);
  return finish(
    {
      id: "energy-profile", title: "Energy Profile",
      describe: "an energy profile diagram: reactant level, a hump over the activation energy, product level, with arrows for the activation energy and the energy change; set exothermic (products lower, default) or false (endothermic, products higher), activation (0-1, hump height) and catalyst (adds a lower dashed hump); anchors reactants, products, peak, activation, delta-h, catalyst-peak",
      tags: ["energy profile", "activation energy", "exothermic", "endothermic", "catalyst", "enthalpy"],
    },
    sk, [x0 - 6, Math.min(4, yPk - 8), 130, yB + 6],
  );
}
export const energyProfile = makeEnergyProfile();

export interface HeatFlowOptions { arrows?: number; liquid?: string; color?: string }
function heatFlow(out: boolean, { arrows = 3, liquid = "blue", color = "orange" }: HeatFlowOptions): Block {
  arrows = clamp(arrows, 2, 4, 3);
  const sk = new Sketch(), bx = 30, by = 26, bw = 60, bh = 66, ySurf = 46;
  sk.part("beaker", "beaker", path(beakerOutline(bx, by, bw, bh), "ink"));
  sk.part("liquid", "reaction mixture", ...wash(beakerLiquid(bx, bw, ySurf, by + bh), tint(liquid)), line([[bx, ySurf], [bx + bw, ySurf]], liquid), ripple(bx + 12, bx + 30, 62, liquid), ripple(bx + 28, bx + 48, 78, liquid));
  const all: [P, P][] = [
    [[bx - 6, 66], [bx - 36, 66]],
    [[bx + bw + 6, 66], [bx + bw + 36, 66]],
    [[60, by - 8], [60, by - 38]],
    [[bx - 4, by - 6], [bx - 26, by - 28]],
    [[bx + bw + 4, by - 6], [bx + bw + 26, by - 28]],
  ];
  const which = arrows === 2 ? [0, 1] : arrows === 3 ? [0, 1, 2] : [0, 1, 3, 4];
  which.forEach((w, i) => {
    const [a, b] = all[w];
    sk.part(`heat-${i}`, out ? `heat given out ${i}` : `heat taken in ${i}`, out ? wavyArrow(a, b, color, 2.2, 1.5, 6) : wavyArrow(b, a, color, 2.2, 1.5, 6));
    sk.at(`heat-${i}`, b);
  });
  sk.at("mouth", [60, by]).at("base", [60, by + bh]).at("surface", [60, ySurf]).at("liquid", [60, 70]);
  const kind = out ? "exothermic" : "endothermic";
  return finish(
    {
      id: kind, title: out ? "Exothermic" : "Endothermic",
      describe: out
        ? "an exothermic reaction: a beaker with wavy orange heat arrows pointing outwards (heat given out to the surroundings); set arrows (2-4); anchors heat-i (the outer ends), liquid, mouth, base"
        : "an endothermic reaction: a beaker with wavy orange heat arrows pointing inwards (heat taken in from the surroundings); set arrows (2-4); anchors heat-i (the outer ends), liquid, mouth, base",
      tags: [kind, "heat", "energy", "temperature", "reaction", "surroundings"],
    },
    sk,
  );
}
/** A beaker giving out heat: `arrows` (2–4, default 3) wavy heat arrows pointing outwards. */
export function makeExothermic(o: HeatFlowOptions = {}): Block {
  return heatFlow(true, o);
}
export const exothermic = makeExothermic();
/** A beaker taking in heat: `arrows` (2–4, default 3) wavy heat arrows pointing inwards. */
export function makeEndothermic(o: HeatFlowOptions = {}): Block {
  return heatFlow(false, o);
}
export const endothermic = makeEndothermic();

export interface CollisionOptions { stage?: "approach" | "impact"; other?: string; color?: string }
/** Two particles colliding: `stage` "impact" (touching, with impact marks; default) or "approach" (heading for each other). */
export function makeCollision({ stage = "impact", other, color = "blue" }: CollisionOptions = {}): Block {
  stage = pick(stage, ["approach", "impact"] as const, "impact");
  const second = other ?? color, r = 16, y = 30, hit = stage === "impact";
  const a: P = hit ? [44, y] : [30, y], b: P = hit ? [76, y] : [90, y];
  const sk = new Sketch();
  sk.part("particle-0", "particle 0", ball(a, r, color));
  sk.part("particle-1", "particle 1", ball(b, r, second));
  const trail = (c: P, s: number) => [-7, 7].map((dy) => line([[c[0] - s * (r + 4), c[1] + dy], [c[0] - s * (r + 16), c[1] + dy]], "grey", 0.8));
  sk.part("motion-0", "motion lines", ...trail(a, 1));
  sk.part("motion-1", "motion lines", ...trail(b, -1));
  if (hit) {
    const marks: Shape[] = [];
    for (const s of [-1, 1]) for (const [dx, k] of [[0, 1], [-9, 0.85], [9, 0.85]] as const) {
      const p0: P = [60 + dx * 0.6, y + s * (r - 2)], p1: P = [60 + dx * 1.3, y + s * (r - 2 + 12 * k)];
      marks.push(line([p0, p1], "orange", 0.8));
    }
    sk.part("impact", "impact marks", ...marks);
  } else {
    sk.part("arrow-0", "moving right", arrow([a[0] + r + 3, y], [a[0] + r + 13, y], "grey", 4, 0.8));
    sk.part("arrow-1", "moving left", arrow([b[0] - r - 3, y], [b[0] - r - 13, y], "grey", 4, 0.8));
  }
  sk.at("particle-0", a).at("particle-1", b).at("contact", [60, y]).at("impact", [60, y - r - 12]);
  return finish(
    {
      id: "collision", title: "Collision",
      describe: "two particles colliding, with motion lines behind them; set stage (impact: touching with orange impact marks; approach: heading for each other) and other (the second particle's colour); anchors particle-0, particle-1, contact, impact",
      tags: ["collision theory", "particles", "reaction rate", "activation energy", "impact", "kinetic"],
    },
    sk, [a[0] - r - 16, y - r - 12, b[0] + r + 16, y + r + 12],
  );
}
export const collision = makeCollision();

export interface ReactionRateOptions { rate?: number; compare?: boolean; color?: string }
/** Amount of product against time, steep then levelling off; `rate` 0–1 (default 0.5); `compare` adds a slower dashed curve. */
export function makeReactionRate({ rate = 0.5, compare = false, color = "blue" }: ReactionRateOptions = {}): Block {
  rate = frac(rate, 0.5);
  const x0 = 10, yB = 84, xs = 14, xe = 118, top = 18;
  const curve = (k: number): P[] => Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return [xs + (xe - xs) * t, yB - 2 - (yB - 2 - top) * (1 - Math.exp(-k * t))] as P;
  });
  const k = 1.2 + rate * 9, pts = curve(k);
  const sk = new Sketch();
  sk.part("axes", "axes: amount of product against time", line([[x0, 4], [x0, yB], [124, yB]], "ink", 0.8));
  if (compare) {
    const slow = curve(k * 0.35);
    sk.part("slower", "slower reaction", dashed(slow, "grey", 6, 5, 1));
    sk.at("slower", [slow[16][0], slow[16][1] + 8]);
  }
  sk.part("curve", "amount of product", path(smooth(pts), color));
  const at = (t: number) => pts[Math.round(t * 24)];
  sk.at("start", pts[0]).at("end", pts[24]).at("slope", [at(0.08)[0] - 6, at(0.08)[1] - 6]).at("plateau", [at(0.8)[0], at(0.8)[1] - 8]);
  sk.at("origin", [x0, yB]).at("axis-x", [66, yB + 6]).at("axis-y", [x0 - 6, 44]);
  return finish(
    {
      id: "reaction-rate", title: "Reaction Rate",
      describe: "amount of product against time: a curve rising steeply then levelling off when the reaction ends; set rate (0-1, how steep) and compare (adds a slower dashed grey curve); anchors start, slope, plateau, end, slower",
      tags: ["rate of reaction", "graph", "product", "time", "kinetics", "experiment"],
    },
    sk, [x0 - 6, 4, 124, yB + 6],
  );
}
export const reactionRate = makeReactionRate();

export interface CatalystOptions { bound?: number; incoming?: boolean; color?: string }
/** A catalyst surface with `bound` molecules (0–3, default 2) held on it and, with `incoming`, one arriving. */
export function makeCatalyst({ bound = 2, incoming = true, color = "blue" }: CatalystOptions = {}): Block {
  bound = clamp(bound, 0, 3, 2);
  const sk = new Sketch(), yS = 54, r = 8, sites = [24, 72, 120];
  const hatch: string[] = [];
  for (let x = 10; x <= 144; x += 12) hatch.push(poly([[x, yS + 1], [x - 9, yS + 13]]));
  sk.part("surface", "catalyst surface", line([[0, yS], [144, yS]], "ink"), { type: "path", d: hatch.join(" "), stroke: "grey", width: 0.8 });
  const pair = (c: P, tilt: number): Shape[] => {
    const dx = Math.cos(tilt) * r, dy = Math.sin(tilt) * r;
    return [ball([c[0] - dx, c[1] - dy], r, color), ball([c[0] + dx, c[1] + dy], r, color)];
  };
  for (let i = 0; i < bound; i++) {
    const c: P = [sites[i], yS - r - 0.5];
    sk.part(`molecule-${i}`, `bound molecule ${i}`, ...pair(c, 0));
    sk.at(`molecule-${i}`, c);
  }
  sites.forEach((x, i) => sk.at(`site-${i}`, [x, yS]));
  if (incoming) {
    const x = bound >= 3 ? 96 : sites[bound], c: P = [x, 12];
    sk.part("incoming", "arriving molecule", ...pair(c, -0.45));
    sk.part("arrow", "molecule moving to the surface", arrow([x, 26], [x, 36], "grey", 4, 0.8));
    sk.at("incoming", c);
  }
  sk.at("surface", [72, yS + 8]);
  return finish(
    {
      id: "catalyst", title: "Catalyst",
      describe: "a catalyst surface (a line with hatching underneath) with molecules held on it and one arriving from above; set bound (0-3 molecules on the surface) and incoming; anchors surface, site-i, molecule-i, incoming",
      tags: ["catalyst", "surface", "adsorption", "rate of reaction", "molecules", "activation energy"],
    },
    sk, [-2, 0, 144, yS + 13],
  );
}
export const catalyst = makeCatalyst();

// ---- Reactions ----

export type ArrowKind = "forward" | "reversible" | "resonance";
const ARROWS = ["forward", "reversible", "resonance"] as const;
/** The arrow shapes between x0 and x1 on the line y: forward, equilibrium half-arrows, or double-headed. */
const reactionArrowShapes = (kind: ArrowKind, x0: number, x1: number, y: number, color: string, size = 7): Shape[] => {
  if (kind === "forward") return [arrow([x0, y], [x1, y], color, size)];
  if (kind === "resonance") return [{ type: "path", d: `${poly([[x0, y], [x1, y]])} ${head([x1, y], [1, 0], size)} ${head([x0, y], [-1, 0], size)}`, stroke: color }];
  const t = y - 6, b = y + 6;
  return [
    path(`${poly([[x0, t], [x1, t]])} ${poly([[x1 - size * 1.2, t - size * 0.8], [x1, t]])}`, color),
    path(`${poly([[x1, b], [x0, b]])} ${poly([[x0 + size * 1.2, b + size * 0.8], [x0, b]])}`, color),
  ];
};

export interface ReactionArrowOptions { kind?: ArrowKind; color?: string }
/** A reaction arrow: `kind` forward (default), reversible (equilibrium half-arrows) or resonance (double-headed). */
export function makeReactionArrow({ kind = "forward", color = "ink" }: ReactionArrowOptions = {}): Block {
  kind = pick(kind, ARROWS, "forward");
  const sk = new Sketch(), y = 17;
  sk.part("arrow", `${kind} arrow`, ...reactionArrowShapes(kind, 10, 90, y, color));
  sk.at("above", [50, 2]).at("below", [50, 32]).at("tail", [10, y]).at("tip", [90, y]);
  return finish(
    {
      id: "reaction-arrow", title: "Reaction Arrow",
      describe: "a reaction arrow; set kind: forward (one way), reversible (two half-arrows for equilibrium) or resonance (double-headed); anchors above and below (for conditions), tail, tip",
      tags: ["reaction arrow", "equilibrium", "reversible", "resonance", "equation", "symbol"],
    },
    sk, [0, 0, 100, 34], 0,
  );
}
export const reactionArrow = makeReactionArrow();

export interface ReactionEquationOptions { reactants?: number; products?: number; reversible?: boolean; color?: string }
/** A word or symbol equation frame: `reactants` (1–4, default 2) empty boxes joined by +, an arrow, then `products` (1–4, default 1). */
export function makeReactionEquation({ reactants = 2, products = 1, reversible = false, color = "ink" }: ReactionEquationOptions = {}): Block {
  reactants = clamp(reactants, 1, 4, 2);
  products = clamp(products, 1, 4, 1);
  const sk = new Sketch(), bw = 30, bh = 28, plusGap = 24, arrowLen = 40, pad = 7;
  let x = 0, plus = 0;
  const slots = (n: number, name: string) => {
    for (let i = 0; i < n; i++) {
      if (i) {
        const c: P = [x + plusGap / 2, bh / 2];
        sk.part(`plus-${plus}`, "plus sign", path(`${poly([[c[0] - 6, c[1]], [c[0] + 6, c[1]]])} ${poly([[c[0], c[1] - 6], [c[0], c[1] + 6]])}`, color, { width: 0.8 }));
        sk.at(`plus-${plus++}`, c);
        x += plusGap;
      }
      sk.part(`${name}-${i}`, `${name} ${i}`, rect(x, 0, bw, bh, color, { r: 5, fill: "board" }));
      sk.at(`${name}-${i}`, [x + bw / 2, bh / 2]).at(`above-${name}-${i}`, [x + bw / 2, -8]);
      x += bw;
    }
  };
  slots(reactants, "reactant");
  const a0 = x + pad, a1 = x + pad + arrowLen;
  sk.part("arrow", reversible ? "equilibrium arrow" : "reaction arrow", ...reactionArrowShapes(reversible ? "reversible" : "forward", a0, a1, bh / 2, color, 6));
  sk.at("arrow", [(a0 + a1) / 2, -6]).at("below-arrow", [(a0 + a1) / 2, bh + 6]);
  x = a1 + pad;
  slots(products, "product");
  return finish(
    {
      id: "reaction-equation", title: "Reaction Equation",
      describe: "an equation frame to fill with labels: empty rounded boxes for reactants joined by plus signs, an arrow, then boxes for products; set reactants (1-4), products (1-4) and reversible; anchors reactant-i, product-i (box centres), above-reactant-i, above-product-i, arrow (above it, for conditions), plus-i",
      tags: ["chemical equation", "word equation", "reactants", "products", "reaction", "balancing"],
    },
    sk, [0, -2, x, bh + 2],
  );
}
export const reactionEquation = makeReactionEquation();

export interface CombustionOptions { fuel?: "candle" | "burner" | "none"; pairs?: number; color?: string }
/** A flame (orange, red core) on a candle or burner, with CO2 and H2O molecules rising off it (`pairs` 1–2). */
export function makeCombustion({ fuel = "candle", pairs = 1, color = "orange" }: CombustionOptions = {}): Block {
  fuel = pick(fuel, ["candle", "burner", "none"] as const, "candle");
  pairs = clamp(pairs, 1, 2, 1);
  const sk = new Sketch(), m = 0.72;
  sk.part("flame", "flame", path("M50 40 C58 58 72 68 72 84 C72 97 62 104 50 104 C38 104 28 97 28 84 C28 68 42 58 50 40 Z", color, { fill: tint(color) }));
  sk.part("core", "hot core of the flame", path("M50 66 C55 75 60 81 60 89 C60 95 55 98 50 98 C45 98 40 95 40 89 C40 81 45 75 50 66 Z", "red", { fill: "red-tint" }));
  if (fuel === "candle") {
    sk.part("candle", "candle", rect(38, 108, 24, 40, "ink", { r: 2, fill: "board" }), line([[50, 103], [50, 108]], "ink", 0.8));
    sk.at("fuel", [50, 126]);
  } else if (fuel === "burner") {
    sk.part("burner", "Bunsen burner", rect(43, 106, 14, 34, "ink", { fill: "grey-tint" }), path("M32 148 L36 140 L64 140 L68 148 Z", "ink", { fill: "grey-tint" }));
    sk.at("fuel", [50, 120]);
  }
  const mol: [string, P][] = [["co2-0", [12, 26]], ["h2o-0", [90, 14]], ["co2-1", [88, -36]], ["h2o-1", [16, -34]]];
  mol.slice(0, pairs * 2).forEach(([id, c]) => {
    const isCo2 = id.startsWith("co2");
    sk.part(id, isCo2 ? "carbon dioxide molecule" : "water molecule", ...(isCo2 ? co2(c, m) : h2o(c, m)));
    sk.part(`rise-${id}`, "rising", arrow([c[0], c[1] + (isCo2 ? 28 : 38)], [c[0], c[1] + (isCo2 ? 15 : 26)], "grey", 4, 0.8));
    sk.at(id, c);
  });
  sk.at("flame", [50, 70]).at("core", [50, 88]).at("tip", [50, 40]);
  return finish(
    {
      id: "combustion", title: "Combustion",
      describe: "a burning flame (orange, red core) with carbon dioxide and water molecules rising from it; set fuel (candle, burner or none) and pairs (1-2 sets of molecules); anchors flame, core, tip, fuel, co2-i, h2o-i",
      tags: ["combustion", "burning", "flame", "carbon dioxide", "water", "fuel"],
    },
    sk,
  );
}
export const combustion = makeCombustion();

export interface PrecipitateOptions { amount?: number; falling?: boolean; liquid?: string; color?: string }
/** A test tube of liquid with a precipitate (dots) settled at the bottom; `amount` 0–1 (default 0.4); `falling` adds a few sinking specks. */
export function makePrecipitate({ amount = 0.4, falling = true, liquid = "blue", color = "ink" }: PrecipitateOptions = {}): Block {
  amount = frac(amount, 0.4);
  const sk = new Sketch(), w = 34, yS = 30, yBot = 120, rb = w / 2, yRound = yBot - rb;
  const tube = `M-4 -3 L0 0 L0 ${yRound} C0 ${yBot + 5} ${w} ${yBot + 5} ${w} ${yRound} L${w} 0 L${w + 4} -3`;
  const body = `M0 ${yS} L0 ${yRound} C0 ${yBot + 5} ${w} ${yBot + 5} ${w} ${yRound} L${w} ${yS} Z`;
  const none = amount < 0.04, yTop = none ? yBot - 4 : yBot - 9 - amount * 53;
  /** Half the tube's inner width at height y (round bottom). */
  const halfAt = (y: number) => (y <= yRound ? rb : Math.sqrt(Math.max(0, rb * rb - (y - yRound) ** 2)));
  sk.part("tube", "test tube", path(tube, "ink"));
  const ripples = yTop > yS + 30 ? [ripple(9, 25, yS + 10, liquid)] : [];
  sk.part("liquid", "solution", ...wash(body, tint(liquid)), line([[0, yS], [w, yS]], liquid), ...ripples);
  // The settled solid: a bumpy top and dots packed beneath it.
  const hw = halfAt(yTop) - 1.5;
  const dots: Shape[] = [path(smooth([[rb - hw, yTop + 1], [rb - hw / 2, yTop - 1.5], [rb, yTop + 0.5], [rb + hw / 2, yTop - 1.5], [rb + hw, yTop + 1]]), color, { width: 0.8 })];
  for (let y = yTop + 8, row = 0; y < yBot - 3; y += 9, row++) {
    const half = halfAt(y) - 5;
    for (let x = rb - half + (row % 2 ? 4.5 : 0); x <= rb + half; x += 9) dots.push(circle(x, y, 1.2, color, { width: 0.8 }));
  }
  sk.part("precipitate", "precipitate", ...(none ? [ghost(rb - 6, yBot - 8, 12, 8)] : dots));
  if (falling && yTop - yS > 26) {
    const span = yTop - yS;
    sk.part("falling", "sinking specks", ...([[10, 0.45], [24, 0.62], [15, 0.82]] as const).map(([x, t]) => circle(x, yS + span * t, 1.2, color, { width: 0.8 })));
  }
  sk.at("mouth", [rb, 0]).at("base", [rb, yBot]).at("surface", [rb, yS]).at("liquid", [rb, (yS + yTop) / 2]).at("precipitate", [rb, (yTop + yBot) / 2]).at("precipitate-top", [rb, yTop]);
  return finish(
    {
      id: "precipitate", title: "Precipitate",
      describe: "a test tube of solution with a solid precipitate (dots) settled at the bottom; set amount (0-1; 0 shows none settled yet), falling (a few specks still sinking), liquid colour and color (the precipitate's); anchors precipitate, precipitate-top, liquid, surface, mouth, base",
      tags: ["precipitate", "precipitation", "test tube", "solid", "solution", "reaction"],
    },
    sk,
  );
}
export const precipitate = makePrecipitate();

export interface GasEvolutionOptions { bubbles?: number; solid?: boolean; liquid?: string; color?: string }
/** A beaker of liquid with gas bubbles (`bubbles` 0–9, default 6) rising from a lump of solid, and the gas escaping at the top. */
export function makeGasEvolution({ bubbles = 6, solid = true, liquid = "blue", color = "ink" }: GasEvolutionOptions = {}): Block {
  bubbles = clamp(bubbles, 0, 9, 6);
  const sk = new Sketch(), w = 100, h = 96, yS = 22, cx = w / 2;
  sk.part("beaker", "beaker", path(beakerOutline(0, 0, w, h), "ink"));
  sk.part("liquid", "liquid", ...wash(beakerLiquid(0, w, yS, h), tint(liquid)), line([[0, yS], [w, yS]], liquid), ripple(6, 22, yS + 10, liquid), ripple(78, 94, yS + 10, liquid));
  if (solid) sk.part("solid", "solid reacting", path(smooth([[36, h - 4], [38, h - 12], [50, h - 15], [62, h - 11], [64, h - 4], [50, h - 3]], true), "grey", { fill: "grey-tint" }));
  // Bubbles rise in one to three streams off the solid, growing as they go up.
  const streams = bubbles <= 3 ? 1 : bubbles <= 6 ? 2 : 3, per = Math.ceil(bubbles / streams);
  const floor = solid ? h - 23 : h - 10, top = yS + 21, step = Math.min(16, (floor - top) / Math.max(1, per - 1));
  for (let i = 0; i < bubbles; i++) {
    const st = i % streams, j = Math.floor(i / streams), t = per > 1 ? j / (per - 1) : 0;
    const p: P = [cx + (st - (streams - 1) / 2) * 28 + (j % 2 ? 3 : -3) * (st % 2 ? -1 : 1), floor - j * step];
    sk.part(`bubble-${i}`, `bubble ${i}`, circle(p[0], p[1], 3.2 + t * 1.8, color, { width: 0.8 }));
    sk.at(`bubble-${i}`, p);
  }
  sk.part("gas", "gas escaping", arrow([cx, -6], [cx, -22], "grey", 4.5, 0.8));
  sk.at("gas", [cx, -24]).at("mouth", [cx, 0]).at("base", [cx, h]).at("surface", [cx, yS]).at("liquid", [14, yS + 12]).at("solid", [cx, h - 9]);
  return finish(
    {
      id: "gas-evolution", title: "Gas Evolution",
      describe: "a beaker of liquid with bubbles of gas rising from a lump of solid and an arrow for the gas escaping (fizzing); set bubbles (0-9), solid and liquid colour; anchors bubble-i, solid, gas, liquid, surface, mouth, base",
      tags: ["gas", "bubbles", "effervescence", "reaction", "fizzing", "acid and metal"],
    },
    sk,
  );
}
export const gasEvolution = makeGasEvolution();

export interface ElectrolysisOptions { bubbles?: number; liquid?: string; color?: string }
/** A beaker of electrolyte with two electrodes wired to a battery, gas bubbles at each (`bubbles` 0–6 at the cathode, half that at the anode). */
export function makeElectrolysis({ bubbles = 4, liquid = "blue", color = "ink" }: ElectrolysisOptions = {}): Block {
  bubbles = clamp(bubbles, 0, 6, 4);
  const sk = new Sketch(), by = 40, bw = 110, bh = 82, yS = 58, ew = 10, eTop = 22, eBot = 106, yW = -2;
  const xa = 24, xc = bw - 24 - ew; // electrode left edges: anode (+) on the left, cathode (-) on the right
  sk.part("beaker", "beaker", path(beakerOutline(0, by, bw, bh), "ink"));
  sk.part("liquid", "electrolyte", ...wash(beakerLiquid(0, bw, yS, by + bh), tint(liquid)), line([[0, yS], [bw, yS]], liquid), ripple(46, 57, 70, liquid), ripple(46, 57, 104, liquid));
  sk.part("anode", "anode (positive electrode)", rect(xa, eTop, ew, eBot - eTop, color, { fill: "grey-tint" }));
  sk.part("cathode", "cathode (negative electrode)", rect(xc, eTop, ew, eBot - eTop, color, { fill: "grey-tint" }));
  const pl = bw / 2 - 7, ps = bw / 2 + 7; // long (+) and short (-) battery plates
  sk.part("wires", "wires", line([[xa + ew / 2, eTop], [xa + ew / 2, yW], [pl, yW]], "ink", 0.8), line([[xc + ew / 2, eTop], [xc + ew / 2, yW], [ps, yW]], "ink", 0.8));
  sk.part("battery", "battery", line([[pl, yW - 12], [pl, yW + 12]], "ink"), line([[ps, yW - 6], [ps, yW + 6]], "ink"));
  const rise = (x0: number, x1: number, n: number, id: string, label: string) => {
    const shapes: Shape[] = [];
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0, row = Math.floor(i / 2);
      shapes.push(circle(left ? x0 - 10 : x1 + 10, eBot - 9 - row * 13 - (left ? 0 : 7), 4.2, "ink", { width: 0.8 }));
    }
    if (n) sk.part(id, label, ...shapes);
  };
  rise(xa, xa + ew, Math.ceil(bubbles / 2), "anode-bubbles", "gas at the anode");
  rise(xc, xc + ew, bubbles, "cathode-bubbles", "gas at the cathode");
  sk.at("anode", [xa + ew / 2, 84]).at("cathode", [xc + ew / 2, 84]).at("anode-top", [xa + ew / 2, eTop]).at("cathode-top", [xc + ew / 2, eTop]);
  sk.at("battery", [bw / 2, yW - 16]).at("positive", [pl, yW - 16]).at("negative", [ps, yW - 16]);
  sk.at("liquid", [bw / 2, 92]).at("surface", [bw / 2, yS]).at("base", [bw / 2, by + bh]).at("mouth", [bw / 2, by]);
  return finish(
    {
      id: "electrolysis", title: "Electrolysis",
      describe: "electrolysis: a beaker of electrolyte with two electrodes wired to a battery (long plate positive) and gas bubbles at each electrode, twice as many at the cathode; set bubbles (0-6) and liquid colour; anchors anode (left, +), cathode (right, -), anode-top, cathode-top, battery, positive, negative, liquid",
      tags: ["electrolysis", "electrodes", "anode", "cathode", "electrolyte", "battery"],
    },
    sk,
  );
}
export const electrolysis = makeElectrolysis();

export interface GalvanicCellOptions { meter?: boolean; flow?: "right" | "left"; left?: string; right?: string; color?: string }
/** Two half-cells (beakers with electrodes) joined by a salt bridge and a wire, with an electron arrow along the wire (`flow`). */
export function makeGalvanicCell({ meter = true, flow = "right", left = "grey", right = "blue", color = "ink" }: GalvanicCellOptions = {}): Block {
  flow = pick(flow, ["right", "left"] as const, "right");
  const sk = new Sketch(), by = 52, bw = 72, bh = 66, gapX = 112, yS = 68, ew = 10, eTop = 10, eBot = 106, yW = -8;
  const lx = 0, rx = gapX, xe0 = 12, xe1 = rx + bw - 12 - ew;
  sk.part("left-beaker", "left beaker", path(beakerOutline(lx, by, bw, bh), "ink"));
  sk.part("right-beaker", "right beaker", path(beakerOutline(rx, by, bw, bh), "ink"));
  sk.part("left-liquid", "left solution", ...wash(beakerLiquid(lx, bw, yS, by + bh), tint(left)), line([[lx, yS], [lx + bw, yS]], left), ripple(32, 52, 109, left));
  sk.part("right-liquid", "right solution", ...wash(beakerLiquid(rx, bw, yS, by + bh), tint(right)), line([[rx, yS], [rx + bw, yS]], right), ripple(rx + 20, rx + 40, 109, right));
  // Salt bridge: an upside-down U tube, two lines 12 apart, its legs dipping into each solution.
  const o0 = 42, o1 = rx + bw - o0, t = 12, top = 26, legEnd = 96;
  sk.part("salt-bridge", "salt bridge",
    path(`M${o0} ${legEnd} L${o0} ${top + 10} Q${o0} ${top} ${o0 + 10} ${top} L${o1 - 10} ${top} Q${o1} ${top} ${o1} ${top + 10} L${o1} ${legEnd}`, color),
    path(`M${o0 + t} ${legEnd} L${o0 + t} ${top + t + 4} Q${o0 + t} ${top + t} ${o0 + t + 4} ${top + t} L${o1 - t - 4} ${top + t} Q${o1 - t} ${top + t} ${o1 - t} ${top + t + 4} L${o1 - t} ${legEnd}`, color),
    line([[o0, legEnd], [o0 + t, legEnd]], color, 0.8), line([[o1 - t, legEnd], [o1, legEnd]], color, 0.8));
  sk.part("anode", "left electrode", rect(xe0, eTop, ew, eBot - eTop, color, { fill: "grey-tint" }));
  sk.part("cathode", "right electrode", rect(xe1, eTop, ew, eBot - eTop, color, { fill: "grey-tint" }));
  const a: P = [xe0 + ew / 2, eTop], b: P = [xe1 + ew / 2, eTop], mid = (a[0] + b[0]) / 2, mr = 11;
  if (meter) {
    sk.part("wire", "wire", line([a, [a[0], yW], [mid - mr, yW]], "ink", 0.8), line([b, [b[0], yW], [mid + mr, yW]], "ink", 0.8));
    sk.part("meter", "voltmeter", circle(mid, yW, mr, "ink", { fill: "board" }), line([[mid - 3, yW + 5], [mid + 4, yW - 6]], "ink", 0.8));
    sk.at("meter", [mid, yW - mr - 6]);
  } else sk.part("wire", "wire", line([a, [a[0], yW], [b[0], yW], b], "ink", 0.8));
  const ex0 = a[0] + 10, ex1 = (meter ? mid - mr : mid + 20) - 8, ey = yW - 10;
  sk.part("electrons", "electron flow", flow === "right" ? arrow([ex0, ey], [ex1, ey], "blue", 4.5) : arrow([ex1, ey], [ex0, ey], "blue", 4.5));
  sk.at("electrons", [(ex0 + ex1) / 2, ey - 7]).at("wire", [a[0], yW]);
  sk.at("anode", [xe0 + ew / 2, 90]).at("cathode", [xe1 + ew / 2, 90]).at("salt-bridge", [(o0 + o1) / 2, top - 6]);
  sk.at("left-liquid", [lx + 32, 90]).at("right-liquid", [rx + bw - 32, 90]).at("left-beaker", [lx + bw / 2, by + bh]).at("right-beaker", [rx + bw / 2, by + bh]);
  return finish(
    {
      id: "galvanic-cell", title: "Galvanic Cell",
      describe: "a voltaic (galvanic) cell: two beakers of solution, each with a metal electrode, joined by a salt bridge and by a wire through a voltmeter, with a blue arrow for electrons flowing along the wire; set meter, flow (right or left) and left and right liquid colours; anchors anode (left), cathode (right), salt-bridge, wire, meter, electrons, left-liquid, right-liquid",
      tags: ["electrochemical cell", "galvanic cell", "electrodes", "salt bridge", "electrons", "redox"],
    },
    sk,
  );
}
export const galvanicCell = makeGalvanicCell();

export interface ConservationOfMassOptions { tilt?: number; stoppers?: boolean; left?: string; right?: string; color?: string }
/** A balance with a conical flask on each pan (before and after a reaction); `tilt` -1..1 (0 balanced, positive: right side down). */
export function makeConservationOfMass({ tilt = 0, stoppers = true, left = "blue", right = "green", color = "ink" }: ConservationOfMassOptions = {}): Block {
  tilt = frac(tilt, 0, -1, 1);
  const sk = new Sketch(), pv: P = [80, 92], half = 68, ang = tilt * 0.17, base = 116;
  const end = (s: number): P => [pv[0] + s * half * Math.cos(ang), pv[1] + s * half * Math.sin(ang)];
  const L = end(-1), R = end(1);
  sk.part("stand", "stand", path(`M${pv[0]} ${pv[1]} L${pv[0] - 8} ${pv[1] + 12} L${pv[0] + 8} ${pv[1] + 12} Z M${pv[0]} ${pv[1] + 12} L${pv[0]} ${base} M${pv[0] - 26} ${base} L${pv[0] + 26} ${base}`, color));
  sk.part("beam", "beam", line([L, R], color));
  const tipLen = 22;
  sk.part("pointer", "pointer", line([pv, [pv[0] + Math.sin(ang) * tipLen, pv[1] - Math.cos(ang) * tipLen]], color, 0.8));
  const side = (e: P, name: "left" | "right", liquid: string) => {
    const py = e[1] - 12, cx = e[0];
    sk.part(`${name}-pan`, `${name} pan`, line([e, [cx, py]], color, 0.8), line([[cx - 30, py], [cx + 30, py]], color));
    const fb = py - 1, ft = fb - 60, nw = 8, bw2 = 25, shoulder = ft + 18;
    sk.part(`${name}-flask`, `${name} flask`, path(`M${cx - nw} ${ft} L${cx - nw} ${shoulder} L${cx - bw2} ${fb} L${cx + bw2} ${fb} L${cx + nw} ${shoulder} L${cx + nw} ${ft}`, "ink"),
      ...(stoppers ? [rect(cx - nw - 1.5, ft - 8, 2 * nw + 3, 9, "brown", { r: 1.5, fill: "brown-tint" })] : []));
    const ys = fb - 24, hw = nw + ((bw2 - nw) * (ys - shoulder)) / (fb - shoulder);
    sk.part(`${name}-liquid`, `${name} liquid`, ...wash(`M${cx - hw} ${ys} L${cx - bw2} ${fb} L${cx + bw2} ${fb} L${cx + hw} ${ys} Z`, tint(liquid)), line([[cx - hw, ys], [cx + hw, ys]], liquid), ripple(cx - 9, cx + 9, fb - 11, liquid));
    sk.at(`${name}-flask`, [cx, fb - 16]).at(`${name}-pan`, [cx, py + 8]).at(`${name}-top`, [cx, ft - 12]).at(`${name}-liquid`, [cx, fb - 10]);
  };
  side(L, "left", left);
  side(R, "right", right);
  sk.at("pivot", pv).at("pointer", [pv[0], pv[1] - tipLen - 6]).at("base", [pv[0], base]);
  return finish(
    {
      id: "conservation-of-mass", title: "Conservation of Mass",
      describe: "a balance with a stoppered conical flask on each pan (before and after a reaction) showing the mass stays the same; set tilt (-1 to 1; 0 balanced, positive tips the right side down), stoppers, and left and right liquid colours; anchors left-flask, right-flask, left-pan, right-pan, left-top, right-top, pivot, pointer",
      tags: ["conservation of mass", "balance", "mass", "closed system", "reaction", "law"],
    },
    sk,
  );
}
export const conservationOfMass = makeConservationOfMass();
