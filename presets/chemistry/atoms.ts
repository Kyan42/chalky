// Atoms and elements: Bohr atoms, nuclei, particles, orbitals, the periodic table, electron
// arrangements, energy levels and radioactive decay. Every block is a factory plus a default instance.
// Each particle, shell, electron, cell and level is its own part with its own anchor, so lessons can
// point at, circle and label single elements. Protons red, neutrons grey, electrons blue.
import { poly, smooth, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Helpers: draw in any units, then fit the drawing into a box whose longer side is 100. ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
/** The colour's pale fill, when it has one. */
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : undefined);
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = Math.round(typeof v === "number" && Number.isFinite(v) ? v : d);
  return Math.min(hi, Math.max(lo, x));
};
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

type Style = { fill?: string; width?: number; r?: number };
const rect = (x: number, y: number, w: number, h: number, stroke: string, o: Style = {}): Shape => ({
  type: "rect", x, y, w, h, stroke, ...(o.r ? { r: o.r } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const line = (pts: P[], stroke: string, width?: number): Shape => ({ type: "path", d: poly(pts), stroke, ...(width ? { width } : {}) });
const path = (d: string, stroke: string, o: Style = {}): Shape => ({ type: "path", d, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}) });
/** An invisible box: gives a group part (a column, a nucleus) a place to be circled. */
const ghost = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });
const ghostCircle = (cx: number, cy: number, r: number): Shape => ({ type: "ellipse", cx, cy, rx: r, ry: r });

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
/** A dashed straight line: dashes `dash` long with `gap` between (gaps must beat the thick chalk). */
const dashed = (a: P, b: P, stroke: string, dash = 3, gap = 9, width = 0.8): Shape => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const segs: string[] = [];
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash);
    segs.push(poly([[a[0] + ux * t, a[1] + uy * t], [a[0] + ux * e, a[1] + uy * e]]));
  }
  return { type: "path", d: segs.join(" "), stroke, width };
};
/** A dashed circle: `n` short arcs. */
const dashedCircle = (cx: number, cy: number, r: number, stroke: string, n = 8, width = 0.8): Shape => {
  const segs: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / n * 0.45;
    const pts: P[] = [0, 0.5, 1].map((t) => { const a = a0 + (a1 - a0) * t; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
    segs.push(smooth(pts));
  }
  return { type: "path", d: segs.join(" "), stroke, width };
};
/** A wavy line from a to b (`cycles` waves of amplitude `amp` across it), optionally with an arrowhead at b. */
const wavy = (a: P, b: P, amp: number, cycles: number, stroke: string, arrowSize = 0, width?: number): Shape => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, u: P = [dx / len, dy / len], v: P = [-u[1], u[0]];
  const tail = arrowSize ? arrowSize * 0.8 : 0, steps = Math.max(8, Math.round(cycles * 8)), pts: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (len - tail), s = amp * Math.sin((i / steps) * cycles * Math.PI * 2);
    pts.push([a[0] + u[0] * t + v[0] * s, a[1] + u[1] * t + v[1] * s]);
  }
  let d = smooth(pts);
  if (arrowSize) d += ` ${poly([pts[pts.length - 1], b])} ${head(b, u, arrowSize)}`;
  return { type: "path", d, stroke, ...(width ? { width } : {}) };
};
/** Side-of-the-chalk shading over a rectangle: a zigzag along its longer side (shows in every theme). */
const zigzag = (x: number, y: number, w: number, h: number, step: number, stroke: string, inset = 0): Shape => {
  const x0 = x + inset, y0 = y + inset, x1 = x + w - inset, y1 = y + h - inset, pts: P[] = [];
  if (w >= h) {
    const n = Math.max(2, Math.round((x1 - x0) / step));
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, i % 2 ? y1 : y0]);
  } else {
    const n = Math.max(2, Math.round((y1 - y0) / step));
    for (let i = 0; i <= n; i++) pts.push([i % 2 ? x1 : x0, y0 + ((y1 - y0) * i) / n]);
  }
  return line(pts, stroke, 0.8);
};

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

/** Scales and centres a sketch drawn inside `bounds` into a box with longer side 100 (never thinner than 3:1). */
function finish(meta: Meta, sk: Sketch, bounds: [number, number, number, number], margin = 5): Block {
  const [x0, y0, x1, y1] = bounds;
  const w = x1 - x0, h = y1 - y0;
  const s = (100 - 2 * margin) / Math.max(w, h);
  let W = w * s + 2 * margin, H = h * s + 2 * margin;
  if (W >= H) (W = 100), (H = Math.max(H, 100 / 3));
  else (H = 100), (W = Math.max(W, 100 / 3));
  const ox = (W - w * s) / 2 - x0 * s, oy = (H - h * s) / 2 - y0 * s;
  const fx = (x: number) => r1(x * s + ox), fy = (y: number) => r1(y * s + oy);
  const pt = (p: P): [number, number] => [fx(p[0]), fy(p[1])];
  const fitPath = (d: string) => {
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
    return { ...sh, d: fitPath(sh.d) };
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const anchors: Record<string, [number, number]> = {
    center: pt([cx, cy]), top: pt([cx, y0]), bottom: pt([cx, y1]), left: pt([x0, cy]), right: pt([x1, cy]),
  };
  for (const [k, p] of Object.entries(sk.anchors)) anchors[k] = pt(p);
  return { ...meta, size: [r1(W), r1(H)], parts: sk.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors };
}

/** Deterministic pseudo-random numbers (mulberry32), so a block draws the same every time. */
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

// ---- Particles ----

type Kind = "proton" | "neutron" | "electron";
const KIND_COLOR: Record<Kind, string> = { proton: "red", neutron: "grey", electron: "blue" };

/** A plus (or minus) sign drawn as strokes, `s` from centre to tip. */
const sign = (cx: number, cy: number, s: number, plus: boolean, stroke: string, width?: number): Shape => ({
  type: "path", d: plus ? `${poly([[cx - s, cy], [cx + s, cy]])} ${poly([[cx, cy - s], [cx, cy + s]])}` : poly([[cx - s, cy], [cx + s, cy]]), stroke, ...(width ? { width } : {}),
});

/** One particle ball, its colour by kind (or `color`); `mark` adds the +/− sign for a big one. */
function ball(kind: Kind, cx: number, cy: number, r: number, o: { color?: string; mark?: boolean; width?: number } = {}): Shape[] {
  const c = o.color ?? KIND_COLOR[kind];
  const shapes = [circle(cx, cy, r, c, { fill: tint(c) ?? "board", width: o.width ?? 0.8 })];
  if (o.mark && kind !== "neutron") shapes.push(sign(cx, cy, r * 0.5, kind === "proton", c, 0.8));
  return shapes;
}

/**
 * A tidy, round cluster of `n` balls on a hex lattice `d` apart: centres ordered from the middle out
 * (ties spread round the ring), recentred on (0, 0).
 */
function cluster(n: number, d: number): P[] {
  if (n <= 0) return [];
  const R = Math.ceil(Math.sqrt(n)) + 2, h = (d * Math.sqrt(3)) / 2, lattice: P[] = [];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) lattice.push([(i + j / 2) * d, j * h]);
  let best: P[] = [], bestR = Infinity;
  for (const c of [[0, 0], [d / 2, 0], [d / 2, h / 3]] as P[]) {
    const ranked = lattice.map((p) => ({ p, r: Math.hypot(p[0] - c[0], p[1] - c[1]), a: Math.atan2(p[1] - c[1], p[0] - c[0]) })).sort((x, y) => x.r - y.r || x.a - y.a);
    // Spread each ring of equal-distance points (van der Corput order), so a part-filled ring stays balanced.
    const ordered: P[] = [];
    for (let k = 0; k < ranked.length && ordered.length < n; ) {
      let e = k;
      while (e < ranked.length && Math.abs(ranked[e].r - ranked[k].r) < 1e-6) e++;
      const ring = ranked.slice(k, e), m = ring.length, taken = new Set<number>();
      for (let q = 0; taken.size < m; q++) {
        let x = 0, f = 0.5, z = q;
        while (z) (x += (z & 1) * f), (z >>= 1), (f /= 2);
        const idx = Math.floor(x * m);
        if (!taken.has(idx)) taken.add(idx), ordered.push([ring[idx].p[0] - c[0], ring[idx].p[1] - c[1]]);
        if (q > m * 64) break;
      }
      for (let idx = 0; idx < m; idx++) if (!taken.has(idx)) ordered.push([ring[idx].p[0] - c[0], ring[idx].p[1] - c[1]]);
      k = e;
    }
    const pts = ordered.slice(0, n), far = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
    if (far < bestR - 1e-6) (bestR = far), (best = pts);
  }
  const mx = best.reduce((s, p) => s + p[0], 0) / best.length, my = best.reduce((s, p) => s + p[1], 0) / best.length;
  return best.map((p) => [p[0] - mx, p[1] - my]);
}

type NucleusBall = { kind: "proton" | "neutron"; index: number; p: P };
/** Protons and neutrons in one packed cluster, mixed evenly. Returns the balls (drawing order) and the radius. */
function nucleusLayout(protons: number, neutrons: number, r: number, cx = 0, cy = 0): { balls: NucleusBall[]; radius: number } {
  const n = protons + neutrons, pts = cluster(n, r * 1.45), balls: NucleusBall[] = [];
  let pi = 0, ni = 0;
  pts.forEach((p, k) => {
    // Bresenham: keep the share of protons placed so far close to the overall share.
    const wantP = Math.round(((k + 1) * protons) / n) > pi;
    const kind = (wantP && pi < protons) || ni >= neutrons ? "proton" : "neutron";
    balls.push({ kind, index: kind === "proton" ? pi++ : ni++, p: [p[0] + cx, p[1] + cy] });
  });
  // Draw outer balls first, so the middle of the heap sits on top.
  balls.sort((a, b) => Math.hypot(b.p[0] - cx, b.p[1] - cy) - Math.hypot(a.p[0] - cx, a.p[1] - cy));
  const radius = pts.length ? Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))) + r : 0;
  return { balls, radius };
}
/** Ball radius so `n` particles pack inside about `maxR` (never bigger than `rMax`). */
const ballRadius = (n: number, maxR: number, rMax: number) => Math.min(rMax, maxR / (1 + 1.45 * Math.sqrt(Math.max(1, n) / 3.1)));

/** Draws a nucleus as parts `${prefix}proton-i` / `${prefix}neutron-i` plus a ghost `nucleusId`. */
function drawNucleus(sk: Sketch, protons: number, neutrons: number, r: number, cx: number, cy: number, o: { prefix?: string; nucleusId?: string; label?: string } = {}) {
  const { balls, radius } = nucleusLayout(protons, neutrons, r, cx, cy), pre = o.prefix ?? "";
  sk.part(o.nucleusId ?? "atomic-nucleus", o.label ?? "nucleus", ghostCircle(cx, cy, radius));
  for (const b of balls) {
    sk.part(`${pre}${b.kind}-${b.index}`, `${b.kind} ${b.index}`, ...ball(b.kind, b.p[0], b.p[1], r));
    sk.at(`${pre}${b.kind}-${b.index}`, b.p);
  }
  return radius;
}
/** A nucleus drawn as one part (for decay pictures). */
function nucleusShapes(protons: number, neutrons: number, r: number, cx = 0, cy = 0) {
  const { balls, radius } = nucleusLayout(protons, neutrons, r, cx, cy);
  return { shapes: balls.flatMap((b) => ball(b.kind, b.p[0], b.p[1], r)), radius };
}

/**
 * Angles of `n` electrons in a shell with four slots (top, right, bottom, left): one in each slot
 * first, then pairs, as in Lewis and Bohr diagrams. `spread` is the half-angle between a pair.
 */
function slotAngles(n: number, spread: number, start = -Math.PI / 2): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const s = j % 4, paired = n > s + 4, a = start + (s * Math.PI) / 2;
    out.push(paired ? a + (j < 4 ? -spread : spread) : a);
  }
  return out;
}
/** Where the k-th electron of shell `shell` (radius R) of `count` sits. */
function shellAngles(shell: number, count: number, R: number): number[] {
  if (shell === 0) return count === 1 ? [Math.PI] : [Math.PI, 0];
  return slotAngles(count, 8.5 / R);
}
const SHELL_CAP = [2, 8, 8];
const fillShells = (e: number) => {
  const out: number[] = [];
  for (const cap of SHELL_CAP) if (e > 0) out.push(Math.min(cap, e)), (e -= Math.min(cap, e));
  return out.length ? out : [0];
};

type AtomGeo = { R: number[]; electrons: { shell: number; p: P; angle: number }[]; nucleusR: number };
/** A Bohr atom at (0, 0): nucleus, shells and electrons as parts. */
function drawAtom(sk: Sketch, protons: number, neutrons: number, electrons: number, color: string): AtomGeo {
  const counts = fillShells(electrons), S = counts.length, er = 4;
  const r = ballRadius(protons + neutrons, 16 + (3 - S) * 2, 4.6);
  const nucleusR = drawNucleus(sk, protons, neutrons, r, 0, 0);
  sk.at("nucleus", [0, 0]);
  const R = counts.map((_, k) => Math.max(nucleusR + 11, 15) + k * 15);
  R.forEach((rad, k) => {
    sk.part(`shell-${k}`, `shell ${k} (${k === S - 1 ? "outer" : "inner"})`, circle(0, 0, rad, color, { width: 0.8 }));
    sk.at(`shell-${k}`, [rad * Math.SQRT1_2, -rad * Math.SQRT1_2]);
  });
  const geo: AtomGeo = { R, electrons: [], nucleusR };
  let i = 0;
  counts.forEach((c, k) => {
    for (const a of shellAngles(k, c, R[k])) {
      const p: P = [Math.cos(a) * R[k], Math.sin(a) * R[k]];
      sk.part(`electron-${i}`, `electron ${i} (shell ${k})`, ...ball("electron", p[0], p[1], er));
      sk.at(`electron-${i}`, p);
      geo.electrons.push({ shell: k, p, angle: a });
      i++;
    }
  });
  sk.at("outer-shell", [R[S - 1] * Math.SQRT1_2, -R[S - 1] * Math.SQRT1_2]);
  return geo;
}

// ---- Atoms and particles ----

export interface AtomOptions { protons?: number; neutrons?: number; electrons?: number; color?: string }
/** A Bohr atom: `protons` (1–18) and `neutrons` (0–22) packed in the nucleus, `electrons` (0–18) on shells of 2, 8, 8. */
export function makeAtom({ protons = 6, neutrons, electrons, color = "ink" }: AtomOptions = {}): Block {
  protons = clamp(protons, 1, 18, 6);
  neutrons = clamp(neutrons, 0, 22, protons === 1 ? 0 : protons);
  electrons = clamp(electrons, 0, 18, protons);
  const sk = new Sketch();
  const geo = drawAtom(sk, protons, neutrons, electrons, color);
  const E = geo.R[geo.R.length - 1] + 5;
  return finish(
    { id: "atom", title: "Atom", describe: "a Bohr model atom: a packed nucleus of red protons and grey neutrons, blue electrons on shells of 2, 8, 8; set protons (1-18), neutrons (0-22), electrons (0-18); parts atomic-nucleus, proton-i, neutron-i, shell-i, electron-i (inner shell first)", tags: ["atom", "Bohr model", "electron shell", "nucleus", "proton", "electron"] },
    sk, [-E, -E, E, E],
  );
}
export const atom = makeAtom();

export interface AtomicNucleusOptions { protons?: number; neutrons?: number; color?: string }
/** A nucleus: `protons` (1–30) red and `neutrons` (0–36) grey balls in one tidy packed cluster. `color` outlines it (none by default). */
export function makeAtomicNucleus({ protons = 6, neutrons, color }: AtomicNucleusOptions = {}): Block {
  protons = clamp(protons, 1, 30, 6);
  neutrons = clamp(neutrons, 0, 36, protons);
  const sk = new Sketch(), r = 8;
  const R = drawNucleus(sk, protons, neutrons, r, 0, 0);
  if (color) sk.part("outline", "nucleus outline", dashedCircle(0, 0, R + 6, color, 12));
  const E = R + (color ? 7 : 1);
  return finish(
    { id: "atomic-nucleus", title: "Atomic Nucleus", describe: "an atomic nucleus: a packed cluster of red protons and grey neutrons; set protons (1-30), neutrons (0-36); parts proton-i, neutron-i", tags: ["nucleus", "proton", "neutron", "atom", "nuclear", "mass number"] },
    sk, [-E, -E, E, E],
  );
}
export const atomicNucleus = makeAtomicNucleus();

function particleBlock(kind: Kind, meta: Meta, color: string): Block {
  const sk = new Sketch(), r = 40;
  sk.part("particle", kind, ...ball(kind, 0, 0, r, { color, width: 1 }).slice(0, 1));
  if (kind !== "neutron") sk.part("charge", kind === "proton" ? "positive charge" : "negative charge", sign(0, 0, r * 0.45, kind === "proton", color));
  sk.at("charge", [0, 0]);
  return finish(meta, sk, [-r, -r, r, r]);
}
export interface ParticleOptions { color?: string }
/** A proton: a red ball with a plus sign. */
export function makeProton({ color = "red" }: ParticleOptions = {}): Block {
  return particleBlock("proton", { id: "proton", title: "Proton", describe: "a proton: a red ball with a + sign; part charge", tags: ["proton", "positive", "nucleus", "particle", "atom"] }, color);
}
export const proton = makeProton();
/** A neutron: a plain grey ball. */
export function makeNeutron({ color = "grey" }: ParticleOptions = {}): Block {
  return particleBlock("neutron", { id: "neutron", title: "Neutron", describe: "a neutron: a plain grey ball, no charge", tags: ["neutron", "neutral", "nucleus", "particle", "atom"] }, color);
}
export const neutron = makeNeutron();
/** An electron: a blue ball with a minus sign. */
export function makeElectron({ color = "blue" }: ParticleOptions = {}): Block {
  return particleBlock("electron", { id: "electron", title: "Electron", describe: "an electron: a blue ball with a − sign; part charge", tags: ["electron", "negative", "shell", "particle", "atom"] }, color);
}
export const electron = makeElectron();

export interface ElectronCloudOptions { dots?: number; color?: string }
/** A fuzzy electron cloud: `dots` (30–120, default 70) specks, densest near a small nucleus. */
export function makeElectronCloud({ dots = 70, color = "blue" }: ElectronCloudOptions = {}): Block {
  dots = clamp(dots, 30, 120, 70);
  const sk = new Sketch(), R = 46, rand = rng(7 + dots), placed: P[] = [];
  const minGap = 9 - dots / 30; // more dots, closer together
  for (let tries = 0; placed.length < dots && tries < dots * 60; tries++) {
    const a = rand() * Math.PI * 2, rr = R * Math.pow(rand(), 0.9);
    if (rr < 9) continue; // keep the nucleus clear
    const p: P = [Math.cos(a) * rr, Math.sin(a) * rr];
    // Thinner towards the edge: accept with falling probability.
    if (rand() > 1.15 - rr / R) continue;
    if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minGap)) continue;
    placed.push(p);
  }
  const specks = placed.map((p) => poly([p, [p[0] + 0.6, p[1] + 0.4]])).join(" ");
  sk.part("cloud", "electron cloud", { type: "path", d: specks, stroke: color, width: 0.8 }, ghostCircle(0, 0, R));
  sk.part("atomic-nucleus", "nucleus", ...ball("proton", 0, 0, 4));
  sk.at("nucleus", [0, 0]).at("edge", [R * Math.SQRT1_2, -R * Math.SQRT1_2]);
  return finish(
    { id: "electron-cloud", title: "Electron Cloud", describe: "an electron cloud: a fuzzy haze of specks round a tiny nucleus, densest in the middle; set dots (30-120); parts cloud, atomic-nucleus; anchors nucleus, edge", tags: ["electron cloud", "orbital", "probability", "quantum", "atom", "electron"] },
    sk, [-R - 2, -R - 2, R + 2, R + 2],
  );
}
export const electronCloud = makeElectronCloud();

export interface OrbitalOptions { type?: "s" | "p" | "p-set"; axis?: "x" | "y"; color?: string }
/** An orbital: `type` "s" (a sphere), "p" (a dumbbell along `axis`) or "p-set" (px, py and pz together), on faint axes. */
export function makeOrbital({ type = "p", axis = "x", color = "blue" }: OrbitalOptions = {}): Block {
  type = pick(type, ["s", "p", "p-set"] as const, "p");
  axis = pick(axis, ["x", "y"] as const, "x");
  const sk = new Sketch(), L = 46, fill = tint(color);
  sk.part("axes", "axes", line([[-L, 0], [L, 0]], "grey", 0.6), line([[0, -L], [0, L]], "grey", 0.6));
  /** A teardrop lobe from the nucleus out to `len` at angle `a`. */
  const lobe = (a: number, len: number, wid: number) => {
    const c = Math.cos(a), s = Math.sin(a), rot = (x: number, y: number): P => [x * c - y * s, x * s + y * c];
    const pts: P[] = [rot(0, 0), rot(len * 0.25, -wid * 0.7), rot(len * 0.7, -wid), rot(len, -wid * 0.45), rot(len, wid * 0.45), rot(len * 0.7, wid), rot(len * 0.25, wid * 0.7)];
    return path(smooth(pts, true, 0.85), color, { fill });
  };
  if (type === "s") {
    sk.part("lobe-0", "s orbital", circle(0, 0, 34, color, { fill }));
    sk.at("lobe-0", [0, -34]);
  } else {
    const dirs = type === "p" ? [axis === "x" ? 0 : -Math.PI / 2] : [0, -Math.PI / 2, -Math.PI / 4 - Math.PI / 12];
    const names = type === "p" ? [axis === "x" ? "px" : "py"] : ["px", "py", "pz"];
    dirs.forEach((a, k) => {
      const len = type === "p" ? 44 : k === 2 ? 30 : 42, wid = type === "p" ? 17 : 11;
      const id = type === "p" ? "" : `${names[k]}-`;
      sk.part(`${id}lobe-0`, `${names[k]} lobe 0`, lobe(a, len, wid));
      sk.part(`${id}lobe-1`, `${names[k]} lobe 1`, lobe(a + Math.PI, len, wid));
      sk.at(`${id}lobe-0`, [Math.cos(a) * len * 0.6, Math.sin(a) * len * 0.6]).at(`${id}lobe-1`, [-Math.cos(a) * len * 0.6, -Math.sin(a) * len * 0.6]);
    });
  }
  sk.part("atomic-nucleus", "nucleus", ...ball("proton", 0, 0, 3));
  sk.at("nucleus", [0, 0]).at("x-axis", [L, 0]).at("y-axis", [0, -L]);
  return finish(
    { id: "orbital", title: "Orbital", describe: "an atomic orbital on faint axes: type s (sphere), p (dumbbell along axis x or y) or p-set (px, py, pz together); parts lobe-0, lobe-1 (p-set: px-lobe-0 …), axes, atomic-nucleus", tags: ["orbital", "s orbital", "p orbital", "quantum", "electron", "atom"] },
    sk, [-L, -L, L, L],
  );
}
export const orbital = makeOrbital();

export interface IsotopesOptions { protons?: number; neutrons?: number[]; color?: string }
/** Isotopes: two or three nuclei side by side with the same `protons` (1–8) and differing `neutrons` (each 0–10). */
export function makeIsotopes({ protons = 1, neutrons = [0, 1, 2], color = "grey" }: IsotopesOptions = {}): Block {
  protons = clamp(protons, 1, 8, 1);
  const ns = (Array.isArray(neutrons) ? neutrons : [0, 1, 2]).slice(0, 3).map((n) => clamp(n, 0, 10, protons));
  while (ns.length < 2) ns.push((ns[ns.length - 1] ?? protons) + 1);
  const sk = new Sketch(), r = 6;
  const radii = ns.map((n) => nucleusLayout(protons, n, r).radius), gap = 13;
  let x = 0;
  const xs = radii.map((R, i) => { const c = x + R; x += 2 * R + gap; return c; });
  const H = Math.max(...radii);
  ns.forEach((n, i) => {
    drawNucleus(sk, protons, n, r, xs[i], 0, { prefix: `isotope-${i}-`, nucleusId: `isotope-${i}`, label: `isotope ${i} (${n} neutrons)` });
    sk.at(`isotope-${i}`, [xs[i], 0]).at(`above-${i}`, [xs[i], -H - 10]).at(`below-${i}`, [xs[i], H + 10]);
  });
  void color;
  return finish(
    { id: "isotopes", title: "Isotopes", describe: "isotopes: two or three nuclei side by side, same protons, different neutrons; set protons (1-8) and neutrons, e.g. [0, 1, 2]; parts isotope-i, isotope-i-proton-j, isotope-i-neutron-j; anchors isotope-i, above-i, below-i", tags: ["isotope", "neutron", "nucleus", "mass number", "element", "atom"] },
    sk, [-1, -H - 1, x - gap + 1, H + 1],
  );
}
export const isotopes = makeIsotopes();

export interface IonicChargeOptions { protons?: number; charge?: number; color?: string }
/**
 * An ion: an atom of `protons` (1–18) that has lost (`charge` +1 to +3) or gained (−1 to −3) electrons.
 * Lost electrons fly off with arrows; gained ones are arrowed in; the charge shows as + or − signs.
 */
export function makeIonicCharge({ protons = 11, charge = 1, color = "ink" }: IonicChargeOptions = {}): Block {
  protons = clamp(protons, 1, 18, 11);
  charge = clamp(charge, Math.max(-3, protons - 18), Math.min(3, protons), 1);
  const neutrons = protons === 1 ? 0 : protons + (protons >= 11 ? 1 : 0);
  const electrons = protons - charge, sk = new Sketch();
  const geo = drawAtom(sk, protons, neutrons, electrons, color);
  const Ro = geo.R[geo.R.length - 1];
  let x1 = Ro + 5, yLow = Ro + 5;
  const k = Math.abs(charge);
  if (charge > 0) {
    // Lost electrons, off to the right.
    const angles = k === 1 ? [0.2] : k === 2 ? [0.05, 0.6] : [-0.05, 0.45, 0.95];
    angles.forEach((a, i) => {
      const far = Ro + 34, p: P = [Math.cos(a) * far, Math.sin(a) * far];
      sk.part(`arrow-${i}`, `electron ${i} leaving`, arrow([Math.cos(a) * (Ro + 7), Math.sin(a) * (Ro + 7)], [Math.cos(a) * (far - 8), Math.sin(a) * (far - 8)], "blue", 4, 0.8));
      sk.part(`moving-electron-${i}`, `lost electron ${i}`, ...ball("electron", p[0], p[1], 4));
      sk.at(`moving-electron-${i}`, p);
      x1 = Math.max(x1, p[0] + 5), (yLow = Math.max(yLow, p[1] + 5));
    });
  } else if (charge < 0) {
    // Gained electrons are the last ones placed; arrows point in at them from outside.
    geo.electrons.slice(-k).forEach((e, i) => {
      const u: P = [Math.cos(e.angle), Math.sin(e.angle)], R = geo.R[e.shell];
      sk.part(`arrow-${i}`, `electron ${i} arriving`, arrow([u[0] * (R + 28), u[1] * (R + 28)], [u[0] * (R + 7), u[1] * (R + 7)], "blue", 4, 0.8));
      sk.at(`moving-electron-${i}`, e.p);
    });
    x1 = Ro + 30;
  }
  // The charge: one sign per unit, top right.
  const plus = charge > 0, sc = plus ? "red" : "blue", sy = -Ro - 2, sx0 = Ro * 0.75;
  const signs: Shape[] = [];
  for (let i = 0; i < k; i++) signs.push(sign(sx0 + i * 17, sy, 6.5, plus, sc));
  if (k) sk.part("charge", plus ? `charge ${charge}+` : `charge ${k}−`, ...signs), sk.at("charge", [sx0 + ((k - 1) * 17) / 2, sy]);
  const top = Math.min(-Ro - 5, sy - 8), xr = Math.max(x1, sx0 + (k - 1) * 17 + 8);
  const xl = charge < 0 ? -(Ro + 30) : -Ro - 5, yb = charge < 0 ? Ro + 30 : yLow, yt = charge < 0 ? Math.min(top, -(Ro + 30)) : top;
  return finish(
    { id: "ionic-charge", title: "Ionic Charge", describe: "an ion: a Bohr atom that has lost (charge +1 to +3, electrons fly off) or gained (−1 to −3, arrows in) electrons, with + or − signs; set protons (1-18), charge; parts atom parts, charge, arrow-i, moving-electron-i", tags: ["ion", "charge", "electron", "cation", "anion", "ionic bonding"] },
    sk, [xl, yt, xr, yb],
  );
}
export const ionicCharge = makeIonicCharge();

// ---- The periodic table ----

/** Columns (0-based groups) present in each period of the main table. */
const PERIOD_COLS: number[][] = [
  [0, 17],
  [0, 1, 12, 13, 14, 15, 16, 17],
  [0, 1, 12, 13, 14, 15, 16, 17],
  [...Array(18).keys()],
  [...Array(18).keys()],
  [...Array(18).keys()],
  [...Array(18).keys()],
];
const hasCell = (row: number, col: number) => row >= 0 && row < 7 && PERIOD_COLS[row].includes(col);
/** Which block (s, p, d) a main-table cell is in. */
const blockOf = (row: number, col: number) => (col <= 1 || (row === 0 && col === 17) ? "s" : col >= 12 ? "p" : "d");
const FAMILIES: Record<string, number> = { "alkali-metals": 1, "alkaline-earth-metals": 2, halogens: 17, "noble-gases": 18 };

/** The grid lines between cells that exist on both sides, merged into runs. */
function gridLines(rows: number, cols: number, has: (r: number, c: number) => boolean, c: number, ox = 0, oy = 0): string {
  const segs: string[] = [];
  for (let y = 1; y < rows; y++) {
    let start = -1;
    for (let x = 0; x <= cols; x++) {
      const on = x < cols && has(y - 1, x) && has(y, x);
      if (on && start < 0) start = x;
      if (!on && start >= 0) segs.push(poly([[ox + start * c, oy + y * c], [ox + x * c, oy + y * c]])), (start = -1);
    }
  }
  for (let x = 1; x < cols; x++) {
    let start = -1;
    for (let y = 0; y <= rows; y++) {
      const on = y < rows && has(y, x - 1) && has(y, x);
      if (on && start < 0) start = y;
      if (!on && start >= 0) segs.push(poly([[ox + x * c, oy + start * c], [ox + x * c, oy + y * c]])), (start = -1);
    }
  }
  return segs.join(" ");
}

export interface PeriodicTableOptions {
  /** Shade: "group-N" (1–18), "period-N" (1–7), "s-block", "p-block", "d-block", "f-block", "cell-P-G", or a family: "alkali-metals", "alkaline-earth-metals", "halogens", "noble-gases", "transition-metals". */
  highlight?: string;
  /** Draw the f-block (lanthanides and actinides) as two separate rows underneath (default true). */
  fBlock?: boolean;
  /** Draw every cell's grid lines (default false: just the outline and the lines between the s, d and p blocks, which read at small sizes). */
  grid?: boolean;
  /** Colour of the shading. */
  shade?: string;
  color?: string;
}
/** The periodic table's real outline: 18 groups by 7 periods, the f-block as two rows below, with one region shaded. */
export function makePeriodicTable({ highlight, fBlock = true, grid = false, shade = "orange", color = "ink" }: PeriodicTableOptions = {}): Block {
  const sk = new Sketch(), c = 10, F0 = 3, fy = 7 * c + c * 0.6;
  fBlock = fBlock !== false;
  grid = grid === true;
  const hl = typeof highlight === "string" ? highlight.toLowerCase().trim() : "";
  // Which cells are shaded: main [row, col] and f [row, i].
  const main = new Set<string>(), fset = new Set<string>();
  const m = /^(group|period)-(\d+)$/.exec(hl), cellM = /^cell-(\d+)-(\d+)$/.exec(hl);
  const g = m?.[1] === "group" ? +m[2] : FAMILIES[hl], per = m?.[1] === "period" ? +m[2] : 0;
  const blk = /^([spdf])(-block)?$/.exec(hl)?.[1] ?? (hl === "transition-metals" ? "d" : "");
  for (let row = 0; row < 7; row++) {
    for (const col of PERIOD_COLS[row]) {
      const on = (g && col === g - 1 && !(hl === "alkali-metals" && row === 0)) || per === row + 1 || (blk && blk === blockOf(row, col)) || (cellM && +cellM[1] === row + 1 && +cellM[2] === col + 1);
      if (on) main.add(`${row},${col}`);
    }
  }
  if (fBlock) for (let fr = 0; fr < 2; fr++) for (let i = 0; i < 14; i++) if (blk === "f" || per === fr + 6) fset.add(`${fr},${i}`);

  // Shaded regions: runs per row merged down into rectangles, each washed and zigzagged.
  const rects: [number, number, number, number][] = [];
  const addRuns = (set: Set<string>, rows: number, cols: number, ox: number, oy: number) => {
    let open: Map<string, [number, number, number, number]> = new Map();
    for (let row = 0; row <= rows; row++) {
      const runs: [number, number][] = [];
      let start = -1;
      for (let col = 0; col <= cols; col++) {
        const on = row < rows && col < cols && set.has(`${row},${col}`);
        if (on && start < 0) start = col;
        if (!on && start >= 0) runs.push([start, col]), (start = -1);
      }
      const next = new Map<string, [number, number, number, number]>();
      for (const [a, b] of runs) {
        const key = `${a}-${b}`, prev = open.get(key);
        if (prev) prev[3] += c, next.set(key, prev), open.delete(key);
        else next.set(key, [ox + a * c, oy + row * c, (b - a) * c, c]);
      }
      for (const r of open.values()) rects.push(r);
      open = next;
    }
  };
  addRuns(main, 7, 18, 0, 0);
  addRuns(fset, 2, 14, F0 * c, fy);
  // The wash behind the lines (the shading's outline and zigzag go on top, after the grid).
  if (rects.length) sk.part("highlight-fill", "shading wash", ...rects.map(([x, y, w, h]): Shape => ({ type: "rect", x, y, w, h, fill: tint(shade) ?? "yellow-tint" })));
  // The outline of the main table, then the grid inside it.
  const O: P[] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 3], [12, 3], [12, 1], [17, 1], [17, 0], [18, 0], [18, 7], [0, 7]];
  sk.part("outline", "periodic table outline", path(poly(O.map(([x, y]) => [x * c, y * c]), true), color, { width: 0.9 }));
  if (grid) sk.part("grid", "cell grid", path(gridLines(7, 18, hasCell, c), color, { width: 0.4 }));
  else sk.part("dividers", "lines between the s, d and p blocks", line([[2 * c, 3 * c], [2 * c, 7 * c]], color, 0.6), line([[12 * c, 3 * c], [12 * c, 7 * c]], color, 0.6));
  if (fBlock) {
    sk.part("f-block", "f-block: lanthanides and actinides", rect(F0 * c, fy, 14 * c, 2 * c, color), ...(grid ? [path(gridLines(2, 14, () => true, c, F0 * c, fy), color, { width: 0.4 })] : []));
    sk.at("f-block", [(F0 + 7) * c, fy + c]).at("lanthanides", [F0 * c - 4, fy + c / 2]).at("actinides", [F0 * c - 4, fy + 1.5 * c]);
  }

  if (rects.length) {
    sk.part("highlight", `shaded: ${hl}`, ...rects.flatMap(([x, y, w, h]) => [rect(x, y, w, h, shade, { width: 0.8 }), zigzag(x, y, w, h, c * 0.8, shade, c * 0.15)]));
    const [x, y, w, h] = rects[0];
    sk.at("highlight", [x + w / 2, y + h / 2]);
  }

  // Groups, periods and cells: invisible parts to circle, and anchors.
  for (let col = 0; col < 18; col++) {
    const rows = PERIOD_COLS.map((cols, row) => (cols.includes(col) ? row : -1)).filter((r) => r >= 0);
    const r0 = rows[0], r1 = rows[rows.length - 1];
    sk.part(`group-${col + 1}`, `group ${col + 1}`, ghost(col * c, r0 * c, c, (r1 - r0 + 1) * c));
    sk.at(`group-${col + 1}`, [col * c + c / 2, r0 * c - c * 0.6]);
  }
  for (let row = 0; row < 7; row++) {
    const cols = PERIOD_COLS[row];
    sk.part(`period-${row + 1}`, `period ${row + 1}`, ghost(0, row * c, 18 * c, c));
    sk.at(`period-${row + 1}`, [-c * 0.6, row * c + c / 2]);
    for (const col of cols) {
      sk.part(`cell-${row + 1}-${col + 1}`, `period ${row + 1}, group ${col + 1}`, ghost(col * c, row * c, c, c));
      sk.at(`cell-${row + 1}-${col + 1}`, [col * c + c / 2, row * c + c / 2]);
    }
  }
  if (fBlock) for (let fr = 0; fr < 2; fr++) for (let i = 0; i < 14; i++) {
    sk.part(`f-cell-${fr + 6}-${i}`, `f-block period ${fr + 6}, cell ${i}`, ghost((F0 + i) * c, fy + fr * c, c, c));
    sk.at(`f-cell-${fr + 6}-${i}`, [(F0 + i + 0.5) * c, fy + (fr + 0.5) * c]);
  }
  sk.at("s-block", [c, 4.5 * c]).at("d-block", [7 * c, 5 * c]).at("p-block", [15 * c, 3 * c]).at("hydrogen", [c / 2, c / 2]).at("helium", [17.5 * c, c / 2]);
  return finish(
    { id: "periodic-table", title: "Periodic Table", describe: "the periodic table's outline, 18 groups by 7 periods with the f-block as two rows below, no symbols; set highlight to shade group-N, period-N, s/p/d/f-block, cell-P-G, alkali-metals, halogens, noble-gases or transition-metals; fBlock false hides the f rows; grid true draws every cell line (place it large); parts and anchors group-N, period-N (from 1), cell-P-G, f-cell-6-i, f-cell-7-i", tags: ["periodic table", "element", "group", "period", "block", "chemistry"] },
    sk, [-1, -1, 18 * c + 1, (fBlock ? fy + 2 * c : 7 * c) + 1], 3,
  );
}
export const periodicTable = makePeriodicTable({ highlight: "group-1" });

export interface ElementTileOptions { fill?: string; color?: string }
/** One periodic-table square, empty: anchors where a lesson writes the number, symbol, name and mass. */
export function makeElementTile({ fill, color = "ink" }: ElementTileOptions = {}): Block {
  const sk = new Sketch(), S = 80;
  sk.part("tile", "element tile", rect(0, 0, S, S, color, { r: 5, fill: (fill && tint(fill)) || tint(color) || "board" }));
  const zones: [string, string, number, number, number, number][] = [
    ["number", "atomic number", 8, 6, 26, 16],
    ["symbol", "symbol", 18, 22, 44, 28],
    ["name", "name", 10, 50, 60, 12],
    ["mass", "relative atomic mass", 14, 62, 52, 12],
  ];
  for (const [id, label, x, y, w, h] of zones) sk.part(id, label, ghost(x, y, w, h)), sk.at(id, [x + w / 2, y + h / 2]);
  return finish(
    { id: "element-tile", title: "Element Tile", describe: "one empty periodic-table square to label: anchors number (top left), symbol (middle), name and mass (bottom); set fill for a family colour", tags: ["element", "periodic table", "symbol", "atomic number", "atomic mass"] },
    sk, [0, 0, S, S],
  );
}
export const elementTile = makeElementTile();

// ---- Electron arrangements ----

const SUBSHELLS: { name: string; n: number; l: "s" | "p"; boxes: number }[] = [
  { name: "1s", n: 1, l: "s", boxes: 1 },
  { name: "2s", n: 2, l: "s", boxes: 1 },
  { name: "2p", n: 2, l: "p", boxes: 3 },
  { name: "3s", n: 3, l: "s", boxes: 1 },
  { name: "3p", n: 3, l: "p", boxes: 3 },
  { name: "4s", n: 4, l: "s", boxes: 1 },
];
export interface ElectronConfigurationOptions { electrons?: number; color?: string }
/** Orbital boxes with up and down arrows for `electrons` (1–20): 1s at the bottom, a row per shell, p boxes filled singly first. */
export function makeElectronConfiguration({ electrons = 8, color = "ink" }: ElectronConfigurationOptions = {}): Block {
  electrons = clamp(electrons, 1, 20, 8);
  // Rows up to the shell holding the last electron.
  let left = electrons, lastShell = 1;
  for (const s of SUBSHELLS) if (left > 0) (lastShell = s.n), (left -= Math.min(left, s.boxes * 2));
  const subs = SUBSHELLS.filter((s) => s.n <= lastShell);
  const sk = new Sketch(), B = 26, gap = 10, step = B + 14, rows = lastShell;
  const rowY = (n: number) => (rows - n) * step;
  let box = 0, e = 0, remaining = electrons;
  for (const s of subs) {
    const x0 = s.l === "s" ? 0 : B + gap, y = rowY(s.n);
    const first = box, k = s.boxes;
    const boxes = Array.from({ length: k }, (_, j) => rect(x0 + j * B, y, B, B, color, { fill: "board" }));
    sk.part(`subshell-${s.name}`, `${s.name} subshell`, ghost(x0, y, k * B, B));
    boxes.forEach((b, j) => { sk.part(`box-${first + j}`, `${s.name} box ${j}`, b); sk.at(`box-${first + j}`, [x0 + j * B + B / 2, y + B / 2]); });
    sk.at(s.name, [x0 + (k * B) / 2, y + B + 6]);
    // Hund's rule: one up arrow in each box, then the down arrows.
    const here = Math.min(remaining, 2 * k);
    remaining -= here;
    for (let q = 0; q < here; q++) {
      const j = q % k, up = q < k, ax = x0 + j * B + B / 2 + (up ? -6 : 6), yt = y + 5, yb = y + B - 5;
      const d = up ? `${poly([[ax, yb], [ax, yt]])} ${poly([[ax - 3, yt + 4.5], [ax, yt], [ax + 3, yt + 4.5]])}` : `${poly([[ax, yt], [ax, yb]])} ${poly([[ax - 3, yb - 4.5], [ax, yb], [ax + 3, yb - 4.5]])}`;
      sk.part(`electron-${e}`, `electron ${e} (${s.name}, spin ${up ? "up" : "down"})`, path(d, "blue", { width: 0.65 }));
      sk.at(`electron-${e}`, [ax, y + B / 2]);
      e++;
    }
    box += k;
  }
  for (let n = 1; n <= rows; n++) sk.at(`shell-${n}`, [-8, rowY(n) + B / 2]);
  const W = B + gap + 3 * B, H = (rows - 1) * step + B;
  return finish(
    { id: "electron-configuration", title: "Electron Configuration", describe: "orbital box diagram: a row of boxes per shell (1s at the bottom; 2s, 2p; 3s, 3p; 4s) holding up and down arrows; set electrons (1-20); parts box-i, subshell-1s, subshell-2p …, electron-i; anchors 1s, 2p … (below each subshell), shell-n (left of each row)", tags: ["electron configuration", "orbital", "subshell", "Hund's rule", "spin", "electron"] },
    sk, [-2, -2, W + 2, H + 2],
  );
}
export const electronConfiguration = makeElectronConfiguration();

/** Heights of `n` energy levels from the bottom (0) up, gaps narrowing upward but never under 14. */
const levelYs = (n: number, gap0 = 32) => {
  const ys = [0];
  for (let i = 1; i < n; i++) ys.push(ys[i - 1] - Math.max(17, gap0 * Math.pow(0.8, i - 1)));
  return ys;
};

export interface EnergyLevelsOptions { levels?: number; electron?: number; color?: string }
/** `levels` (2–6) horizontal energy levels, closer together going up, an energy axis, and an electron on level `electron` (0 = ground). */
export function makeEnergyLevels({ levels = 4, electron = 0, color = "ink" }: EnergyLevelsOptions = {}): Block {
  levels = clamp(levels, 2, 6, 4);
  electron = clamp(electron, 0, levels - 1, 0);
  const sk = new Sketch(), ys = levelYs(levels, 36 - levels * 2), x0 = 16, x1 = 92, top = ys[levels - 1] - 12;
  sk.part("axis", "energy axis", arrow([0, 6], [0, top], color, 5));
  sk.at("energy", [0, top - 6]);
  ys.forEach((y, i) => {
    sk.part(`level-${i}`, i ? `energy level ${i}` : "ground state", line([[x0, y], [x1, y]], color));
    sk.at(`level-${i}`, [(x0 + x1) / 2, y]).at(`label-${i}`, [x1 + 8, y]);
  });
  const ex = (x0 + x1) / 2;
  sk.part("electron", "electron", ...ball("electron", ex, ys[electron], 5.5));
  sk.at("electron", [ex, ys[electron]]);
  return finish(
    { id: "energy-levels", title: "Energy Levels", describe: "energy levels: horizontal lines closer together going up, an energy axis, and an electron on one; set levels (2-6), electron (0 = ground state); parts level-i (0 at the bottom), electron, axis; anchors level-i, label-i (right of each)", tags: ["energy level", "electron", "ground state", "excited state", "quantum", "atom"] },
    sk, [-5, top - 1, x1, 6],
  );
}
export const energyLevels = makeEnergyLevels();

export interface PhotonEmissionOptions { levels?: number; from?: number; to?: number; photon?: string; color?: string }
/** An electron dropping from level `from` to level `to` (of 2–5 levels), giving out a wavy photon (`photon` colour, default orange). */
export function makePhotonEmission({ levels = 3, from, to = 0, photon = "orange", color = "ink" }: PhotonEmissionOptions = {}): Block {
  levels = clamp(levels, 2, 5, 3);
  from = clamp(from, 1, levels - 1, levels - 1);
  to = clamp(to, 0, from - 1, 0);
  const sk = new Sketch(), ys = levelYs(levels, 30), x0 = 0, x1 = 52, ex = 20, er = 5.5;
  ys.forEach((y, i) => {
    sk.part(`level-${i}`, i ? `energy level ${i}` : "ground state", line([[x0, y], [x1, y]], color));
    sk.at(`level-${i}`, [(x0 + x1) / 2, y]).at(`label-${i}`, [x0 - 8, y]);
  });
  const yf = ys[from], yt = ys[to];
  sk.part("electron-before", "where the electron was", dashedCircle(ex, yf, er, "blue", 6));
  sk.part("drop", "the electron drops", arrow([ex, yf + er + 4], [ex, yt - er - 4], "blue", 4.5, 0.8));
  sk.part("electron", "electron", ...ball("electron", ex, yt, er));
  const ym = (yf + yt) / 2, p0: P = [ex + 12, ym], p1: P = [100, ym - 14];
  sk.part("photon", "photon of light", wavy(p0, p1, 5, Math.max(2.5, 3.2 - levels * 0.1), pick(photon, ["orange", "red", "green", "blue", "purple", "pink", "ink", "brown", "grey"] as const, "orange"), 5));
  sk.at("electron", [ex, yt]).at("electron-before", [ex, yf]).at("drop", [ex, ym]).at("photon-start", p0).at("photon", p1);
  return finish(
    { id: "photon-emission", title: "Photon Emission", describe: "an electron dropping from a higher energy level to a lower one (dashed circle where it was, arrow down) giving out a wavy photon; set levels (2-5), from, to, photon colour; parts level-i, electron-before, drop, electron, photon; anchors photon-start, photon (its tip)", tags: ["photon", "emission", "energy level", "electron", "light", "spectrum"] },
    sk, [x0 - 2, ys[levels - 1] - 8, 101, 6],
  );
}
export const photonEmission = makePhotonEmission();

// ---- Radioactivity ----

const decayNucleus = (particles: number, r: number) => {
  const p = Math.floor(particles * 0.45);
  return nucleusShapes(p, particles - p, r);
};
export interface DecayOptions { particles?: number; color?: string }

/** Alpha decay: a nucleus of `particles` (8–40) throwing out an alpha particle (2 protons, 2 neutrons). */
export function makeAlphaDecay({ particles = 20, color = "red" }: DecayOptions = {}): Block {
  particles = clamp(particles, 8, 40, 20);
  const sk = new Sketch(), r = 5.5, { shapes, radius } = decayNucleus(particles, r);
  sk.part("atomic-nucleus", "nucleus", ...shapes);
  const ax = radius + 30, alpha = cluster(4, r * 1.45).map(([x, y]): P => [x + ax, y]), ar = r * 2.3;
  sk.part("alpha", "alpha particle", ...alpha.flatMap((p, i) => ball(i % 2 ? "neutron" : "proton", p[0], p[1], r)));
  sk.part("arrow", "direction", arrow([ax + ar + 3, 0], [ax + ar + 21, 0], color, 5));
  sk.at("nucleus", [0, 0]).at("alpha", [ax, 0]).at("out", [ax + ar + 21, 0]);
  return finish(
    { id: "alpha-decay", title: "Alpha Decay", describe: "alpha decay: a big nucleus shooting out an alpha particle (2 protons and 2 neutrons stuck together) to the right; set particles (8-40) in the parent; parts atomic-nucleus, alpha, arrow; anchors nucleus, alpha, out", tags: ["alpha decay", "radioactivity", "nucleus", "alpha particle", "nuclear", "radiation"] },
    sk, [-radius - 1, -radius - 1, ax + ar + 22, radius + 1],
  );
}
export const alphaDecay = makeAlphaDecay();

export interface BetaDecayOptions extends DecayOptions { type?: "minus" | "plus" }
/** Beta decay: a nucleus of `particles` (8–40) shooting out an electron (`type` "minus") or a positron ("plus"). */
export function makeBetaDecay({ particles = 20, type = "minus", color }: BetaDecayOptions = {}): Block {
  particles = clamp(particles, 8, 40, 20);
  type = pick(type, ["minus", "plus"] as const, "minus");
  const c = color ?? (type === "minus" ? "blue" : "pink");
  const sk = new Sketch(), r = 5.5, { shapes, radius } = decayNucleus(particles, r);
  sk.part("atomic-nucleus", "nucleus", ...shapes);
  const bx = radius + 26, br = 9;
  sk.part("beta", type === "minus" ? "beta particle (an electron)" : "positron", circle(bx, 0, br, c, { fill: tint(c) }), sign(bx, 0, br * 0.5, type === "plus", c, 0.8));
  sk.part("arrow", "direction", arrow([bx + br + 4, 0], [bx + br + 22, 0], c, 5));
  sk.at("nucleus", [0, 0]).at("beta", [bx, 0]).at("out", [bx + br + 22, 0]);
  return finish(
    { id: "beta-decay", title: "Beta Decay", describe: "beta decay: a nucleus shooting out a fast electron (type minus, blue with −) or positron (type plus, pink with +); set particles (8-40), type; parts atomic-nucleus, beta, arrow; anchors nucleus, beta, out", tags: ["beta decay", "radioactivity", "electron", "nucleus", "nuclear", "radiation"] },
    sk, [-radius - 1, -radius - 1, bx + br + 23, radius + 1],
  );
}
export const betaDecay = makeBetaDecay();

export interface GammaRayOptions extends DecayOptions { rays?: number }
/** Gamma rays: a nucleus of `particles` (8–40) giving out `rays` (1–3) wavy rays of energy. */
export function makeGammaRay({ particles = 20, rays = 1, color = "orange" }: GammaRayOptions = {}): Block {
  particles = clamp(particles, 8, 40, 20);
  rays = clamp(rays, 1, 3, 1);
  const sk = new Sketch(), r = 5.5, { shapes, radius } = decayNucleus(particles, r);
  sk.part("atomic-nucleus", "nucleus", ...shapes);
  const angles = rays === 1 ? [0] : rays === 2 ? [-0.36, 0.36] : [-0.6, 0, 0.6], L = radius + 50;
  let y0 = -radius - 1, y1 = radius + 1;
  angles.forEach((a, i) => {
    const s: P = [Math.cos(a) * (radius + 6), Math.sin(a) * (radius + 6)], e: P = [Math.cos(a) * L, Math.sin(a) * L];
    sk.part(`ray-${i}`, `gamma ray ${i}`, wavy(s, e, 5, 3.5, color, 5));
    sk.at(`ray-${i}`, e);
    y0 = Math.min(y0, e[1] - 6), y1 = Math.max(y1, e[1] + 6);
  });
  sk.at("nucleus", [0, 0]).at("out", [L, 0]);
  return finish(
    { id: "gamma-ray", title: "Gamma Ray", describe: "gamma radiation: a nucleus giving out wavy rays of energy; set particles (8-40), rays (1-3); parts atomic-nucleus, ray-i; anchors nucleus, ray-i (each tip), out", tags: ["gamma ray", "radioactivity", "radiation", "nucleus", "energy", "electromagnetic"] },
    sk, [-radius - 1, y0, L + 2, y1],
  );
}
export const gammaRay = makeGammaRay();

export interface HalfLifeOptions { halves?: number; color?: string }
/** A decay curve on axes, halving `halves` (1–5) times, with a dot and guide lines at each half-life. */
export function makeHalfLife({ halves = 3, color = "blue" }: HalfLifeOptions = {}): Block {
  halves = clamp(halves, 1, 5, 3);
  const sk = new Sketch(), X = 100, Y = 72, top = 8, T = (X - 8) / (halves + 0.75);
  const yAt = (x: number) => Y - (Y - top) * Math.pow(0.5, x / T);
  sk.part("axes", "axes", arrow([0, Y], [X, Y], "ink", 5), arrow([0, Y], [0, 0], "ink", 5));
  const pts: P[] = [];
  for (let i = 0; i <= 40; i++) { const x = ((X - 6) * i) / 40; pts.push([x, yAt(x)]); }
  sk.part("curve", "decay curve", path(smooth(pts), color));
  for (let k = 0; k <= halves; k++) {
    const p: P = [k * T, yAt(k * T)], guides: Shape[] = [];
    if (k > 0) {
      guides.push(dashed([p[0], Y - 4], [p[0], p[1] + 5], "grey"));
      if ((Y - top) / 2 ** k >= 12) guides.push(dashed([4, p[1]], [p[0] - 5, p[1]], "grey"));
      sk.part(`half-${k}`, `after ${k} half-li${k > 1 ? "ves" : "fe"}`, ...guides);
    }
    sk.part(`point-${k}`, k ? `${1 / 2 ** k} left` : "start amount", circle(p[0], p[1], 3.2, color, { fill: "board", width: 0.8 }));
    sk.at(`point-${k}`, p).at(`time-${k}`, [p[0], Y + 7]).at(`amount-${k}`, [-7, p[1]]);
  }
  sk.at("origin", [0, Y]).at("time", [X, Y + 7]).at("amount", [0, -5]);
  return finish(
    { id: "half-life", title: "Half-Life", describe: "a radioactive decay curve on axes, halving each half-life, with dots and dashed guides at each half; set halves (1-5); parts axes, curve, point-k (k = 0 start), half-k; anchors point-k, time-k (on the time axis), amount-k (on the amount axis), origin", tags: ["half-life", "radioactive decay", "exponential", "graph", "nuclear", "radioactivity"] },
    sk, [-2, -1, X + 1, Y + 3],
  );
}
export const halfLife = makeHalfLife();

export interface ValenceElectronsOptions { n?: number; color?: string }
/** Just the outer shell: `n` (1–8) valence electrons round a grey core (nucleus and inner shells), singly then in pairs. */
export function makeValenceElectrons({ n = 4, color = "ink" }: ValenceElectronsOptions = {}): Block {
  n = clamp(n, 1, 8, 4);
  const sk = new Sketch(), Rs = 40, er = 5.5;
  sk.part("core", "core: nucleus and inner electrons", circle(0, 0, 18, "grey", { fill: "grey-tint" }), ...ball("proton", 0, 0, 6));
  sk.part("shell", "outer shell", circle(0, 0, Rs, color, { width: 0.8 }));
  slotAngles(n, 13 / Rs).forEach((a, i) => {
    const p: P = [Math.cos(a) * Rs, Math.sin(a) * Rs];
    sk.part(`electron-${i}`, `valence electron ${i}`, ...ball("electron", p[0], p[1], er));
    sk.at(`electron-${i}`, p);
  });
  sk.at("core", [0, 0]).at("shell", [Rs * Math.SQRT1_2, -Rs * Math.SQRT1_2]);
  const E = Rs + er + 1;
  return finish(
    { id: "valence-electrons", title: "Valence Electrons", describe: "valence electrons: only the outer shell, n blue electrons (one per side, then pairs) round a grey core standing for the nucleus and inner shells; set n (1-8); parts core, shell, electron-i", tags: ["valence electron", "outer shell", "bonding", "electron", "atom", "group"] },
    sk, [-E, -E, E, E],
  );
}
export const valenceElectrons = makeValenceElectrons();

export interface LewisDotOptions { dots?: number; color?: string }
/** A Lewis dot diagram: a blank centre for the symbol and `dots` (0–8) round it on 4 sides, singly then in pairs. */
export function makeLewisDot({ dots = 6, color = "blue" }: LewisDotOptions = {}): Block {
  dots = clamp(dots, 0, 8, 6);
  const sk = new Sketch(), D = 34, half = 7.5, r = 3.4;
  sk.part("symbol", "element symbol (blank)", ghost(-20, -20, 40, 40));
  const sides: [string, P, P][] = [["top", [0, -1], [1, 0]], ["right", [1, 0], [0, 1]], ["bottom", [0, 1], [1, 0]], ["left", [-1, 0], [0, 1]]];
  for (let i = 0; i < dots; i++) {
    const s = i % 4, paired = dots > s + 4, [, n, t] = sides[s], off = paired ? (i < 4 ? -half : half) : 0;
    const p: P = [n[0] * D + t[0] * off, n[1] * D + t[1] * off];
    sk.part(`dot-${i}`, `electron dot ${i} (${sides[s][0]})`, circle(p[0], p[1], r, color, { fill: tint(color) ?? "board" }));
    sk.at(`dot-${i}`, p);
  }
  for (const [name, n] of sides) sk.at(`side-${name}`, [n[0] * D, n[1] * D]).at(`bond-${name}`, [n[0] * (D + 14), n[1] * (D + 14)]);
  sk.at("symbol", [0, 0]);
  const E = D + 12;
  return finish(
    { id: "lewis-dot", title: "Lewis Dot", describe: "a Lewis dot diagram: a blank centre for the element symbol and 0-8 electron dots on its four sides, one per side then in pairs; set dots; parts symbol, dot-i; anchors symbol, side-top/right/bottom/left, bond-top/right/bottom/left (just outside, to start a bond line)", tags: ["Lewis structure", "dot diagram", "valence electron", "bonding", "electron pair"] },
    sk, [-E, -E, E, E],
  );
}
export const lewisDot = makeLewisDot();
