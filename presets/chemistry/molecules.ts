// Molecules and bonding: ball-and-stick molecules built from data, skeletal rings, and pictures of
// single, double, triple, ionic, covalent, hydrogen and metallic bonds, a salt lattice, a polymer chain
// and a space-filling model. Every block is a factory plus a default instance. Each atom and bond is
// its own part (`atom-3`, `bond-0-3`) with its own anchor, so a lesson can label, circle and point at it.
import { poly, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Elements: one colour per element, the same in every chemistry file. ----

export interface ElementStyle {
  /** Line colour of the atom's ball. */
  stroke: string;
  /** Fill of the ball (a tint, or `board`). */
  fill: string;
  /** Ball radius, in the units of a molecule drawn at its natural size (a bond is about 36 long). */
  r: number;
}

const heavy = (c: string): ElementStyle => ({ stroke: c, fill: c === "ink" ? "grey-tint" : `${c}-tint`, r: 13 });
/** Ball colour and size for each element: H board with an ink outline, C ink, O red, N blue, Cl and F green, S orange, Na and K purple, metals grey. */
export const ELEMENTS: Record<string, ElementStyle> = {
  H: { stroke: "ink", fill: "board", r: 10 },
  C: heavy("ink"),
  O: heavy("red"),
  N: heavy("blue"),
  F: heavy("green"),
  Cl: heavy("green"),
  S: heavy("orange"),
  Na: heavy("purple"),
  K: heavy("purple"),
  ...Object.fromEntries(["Li", "Be", "Mg", "Al", "Ca", "Ti", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ag", "Sn", "Pt", "Au", "Hg", "Pb"].map((m) => [m, heavy("grey")])),
};
/** Any element's style: from `ELEMENTS`, else brown (P, Br, I, …). */
export function elementStyle(el: string): ElementStyle {
  return ELEMENTS[el] ?? heavy("brown");
}
/** The usual bond length (centre to centre) at a molecule's natural size. */
export const BOND_LENGTH = 36;
/** Outer-shell electrons, for the covalent-bond picture. */
const VALENCE: Record<string, number> = { H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, C: 4, Si: 4, N: 5, P: 5, O: 6, S: 6, F: 7, Cl: 7, Br: 7, I: 7 };

// ---- Helpers: draw in natural units, then fit the drawing into a box whose longer side is 100. ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : c === "ink" ? "grey-tint" : undefined);
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = Math.round(typeof v === "number" && Number.isFinite(v) ? v : d);
  return Math.min(hi, Math.max(lo, x));
};
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

type Style = { fill?: string; width?: number };
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const line = (pts: P[], stroke: string, width?: number): Shape => ({ type: "path", d: poly(pts), stroke, ...(width ? { width } : {}) });
const path = (d: string, stroke: string, width?: number): Shape => ({ type: "path", d, stroke, ...(width ? { width } : {}) });
/** An invisible box: gives a part with nothing drawn (a ring carbon, a repeat unit) a place to be circled. */
const ghost = (cx: number, cy: number, r: number): Shape => ({ type: "rect", x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });

const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);
const unit = (a: P): P => mul(a, 1 / (len(a) || 1));
const dir = (deg: number): P => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Arrowhead lines at `tip`, pointing along `d`. */
const head = (tip: P, d: P, size: number) => {
  const u = unit(d), v: P = [-u[1], u[0]];
  return poly([add(tip, add(mul(u, -size), mul(v, size * 0.75))), tip, add(tip, add(mul(u, -size), mul(v, -size * 0.75)))]);
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
type Bounds = [number, number, number, number];
const r1 = (v: number) => +v.toFixed(1);
const MARGIN = 5;
/** How much `finish` will scale a drawing inside `bounds`: drawing code uses it to keep dots and gaps legible after fitting. */
const scaleOf = ([x0, y0, x1, y1]: Bounds) => (100 - 2 * MARGIN) / Math.max(x1 - x0, y1 - y0, 1);

/** Scales and centres a sketch drawn inside `bounds` into a box with longer side 100 (never thinner than 3:1). */
function finish(meta: Meta, sk: Sketch, bounds: Bounds): Block {
  const [x0, y0, x1, y1] = bounds;
  const w = x1 - x0, h = y1 - y0;
  const s = scaleOf(bounds);
  let W = w * s + 2 * MARGIN, H = h * s + 2 * MARGIN;
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

/** Bounds of a set of circles (centre, radius), grown by `pad`. */
const circleBounds = (cs: { p: P; r: number }[], pad = 0): Bounds => [
  Math.min(...cs.map((c) => c.p[0] - c.r)) - pad, Math.min(...cs.map((c) => c.p[1] - c.r)) - pad,
  Math.max(...cs.map((c) => c.p[0] + c.r)) + pad, Math.max(...cs.map((c) => c.p[1] + c.r)) + pad,
];
const merge = (a: Bounds, b: Bounds): Bounds => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** An electron: a small blue dot that stays a dot at any fitted size (`s` is the fit scale). */
const electron = (p: P, s: number): Shape => circle(p[0], p[1], 2.6 / s, "blue", { fill: "blue-tint" });
/** A dashed line from a to b, dashes and gaps sized to survive thick chalk after fitting. */
function dashed(a: P, b: P, s: number, stroke: string, width?: number): Shape {
  const L = len(sub(b, a)), u = unit(sub(b, a)), dash = 5 / s, gap = 11 / s;
  const n = Math.max(1, Math.floor((L + gap) / (dash + gap)));
  const start = (L - (n * dash + (n - 1) * gap)) / 2;
  const segs: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * (dash + gap);
    segs.push(poly([add(a, mul(u, t)), add(a, mul(u, t + dash))]));
  }
  return path(segs.join(" "), stroke, width);
}
/** A + sign (or a − when `minus`) centred on p, `k` half-length. */
const charge = (p: P, k: number, stroke: string, minus = false): Shape =>
  path(minus ? poly([[p[0] - k, p[1]], [p[0] + k, p[1]]]) : `${poly([[p[0] - k, p[1]], [p[0] + k, p[1]]])} ${poly([[p[0], p[1] - k], [p[0], p[1] + k]])}`, stroke, 0.8);

// ---- Ball-and-stick: the core of every molecule here. ----

export type Element = "H" | "C" | "O" | "N" | "Cl" | "F" | "S" | "Na" | "K" | (string & {});
export interface Atom { el: Element; x: number; y: number }
/**
 * Bond order: 1, 2 or 3 parallel sticks; "wedge" (towards you) or "dash" (away from you) for a 3D
 * single bond; "hbond" for a dashed hydrogen bond.
 */
export type BondOrder = 1 | 2 | 3 | "wedge" | "dash" | "hbond";
export type Bond = [a: number, b: number, order?: BondOrder];

type Ball = { p: P; r: number; style: ElementStyle };

/** Sticks between two balls, stopping at the ball edges. */
function stickShapes(A: Ball, B: Ball, order: BondOrder, s: number, stroke: string): Shape[] {
  const u = unit(sub(B.p, A.p)), v: P = [-u[1], u[0]];
  const edge = (ball: Ball, o: number) => Math.sqrt(Math.max(0, ball.r * ball.r - o * o));
  const seg = (o: number): [P, P] => [add(A.p, add(mul(u, edge(A, o)), mul(v, o))), add(B.p, add(mul(u, -edge(B, o)), mul(v, o)))];
  if (order === "hbond") return [dashed(...seg(0), s, stroke)];
  if (order === "dash") return [dashed(...seg(0), s, stroke)];
  if (order === "wedge") {
    const [a, b] = seg(0), w = Math.min(7 / s, B.r * 0.7);
    return [{ type: "path", d: poly([a, add(b, mul(v, w)), add(b, mul(v, -w))], true), stroke, fill: "grey-tint", width: 0.8 }];
  }
  const n = order === 2 ? 2 : order === 3 ? 3 : 1;
  const gap = stickGap(n, Math.min(A.r, B.r), s);
  // A triple bond's sticks are detail-width, so the three stay apart in thick chalk.
  return Array.from({ length: n }, (_, k) => line(seg((k - (n - 1) / 2) * gap), stroke, n === 3 ? 0.8 : undefined));
}
/** Distance between the parallel sticks of an n-fold bond: 16 box units after fitting, as far as the balls allow. */
const stickGap = (n: number, rmin: number, s: number) => Math.min(16 / s, n === 2 ? 1.5 * rmin : 0.95 * rmin);

/** Atoms with sanitised coordinates, rescaled so the bonds average `BOND_LENGTH` when they come in other units. */
function normalise(atoms: Atom[] | undefined, bonds: Bond[] | undefined, fallback: Atom[], fallbackBonds: Bond[]) {
  let list = (Array.isArray(atoms) && atoms.length ? atoms : fallback).slice(0, 40).map((a) => ({ el: typeof a?.el === "string" && a.el ? a.el : "C", x: num(a?.x, 0), y: num(a?.y, 0) }));
  const raw = Array.isArray(bonds) ? bonds : atoms ? [] : fallbackBonds;
  const seen = new Set<string>();
  const list2: [number, number, BondOrder][] = [];
  for (const b of raw) {
    if (!Array.isArray(b)) continue;
    const a = Math.round(num(b[0], -1)), c = Math.round(num(b[1], -1));
    if (a < 0 || c < 0 || a >= list.length || c >= list.length || a === c) continue;
    const key = `${Math.min(a, c)}-${Math.max(a, c)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = b[2];
    list2.push([a, c, o === 2 || o === 3 || o === "wedge" || o === "dash" || o === "hbond" ? o : 1]);
  }
  // Typical spacing: the mean bond, or the closest pair of atoms when nothing is bonded.
  const d = (i: number, j: number) => Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
  let typical = list2.length ? list2.reduce((t, [a, c]) => t + d(a, c), 0) / list2.length : Infinity;
  if (!list2.length) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) typical = Math.min(typical, d(i, j));
  if (Number.isFinite(typical) && typical > 0 && (typical < 22 || typical > 80)) {
    const k = BOND_LENGTH / typical;
    list = list.map((a) => ({ ...a, x: a.x * k, y: a.y * k }));
  }
  return { atoms: list, bonds: list2 };
}

/** Draws atoms and bonds into a sketch: parts bond-a-b (first) and atom-i, anchors atom-i and bond-a-b. */
function drawBallStick(sk: Sketch, atoms: Atom[], bonds: [number, number, BondOrder][], s: number, o: { recolor?: string; offset?: number; sticks?: string; label?: string } = {}) {
  const off = o.offset ?? 0, sticks = o.sticks ?? "ink";
  const balls: Ball[] = atoms.map((a) => {
    const st = elementStyle(a.el);
    const style = o.recolor ? { stroke: o.recolor, fill: tint(o.recolor) ?? "board", r: st.r } : st;
    return { p: [a.x, a.y], r: st.r, style };
  });
  for (const [a, b, order] of bonds) {
    const what = order === "hbond" ? "hydrogen bond" : order === 2 ? "double bond" : order === 3 ? "triple bond" : "bond";
    sk.part(`bond-${a + off}-${b + off}`, `${what} between atom ${a + off} (${atoms[a].el}) and atom ${b + off} (${atoms[b].el})`, ...stickShapes(balls[a], balls[b], order, s, sticks));
    sk.at(`bond-${a + off}-${b + off}`, mid(balls[a].p, balls[b].p));
  }
  balls.forEach((ball, i) => {
    sk.part(`atom-${i + off}`, `${o.label ? o.label + " " : ""}atom ${i + off} (${atoms[i].el})`, circle(ball.p[0], ball.p[1], ball.r, ball.style.stroke, { fill: ball.style.fill }));
    sk.at(`atom-${i + off}`, ball.p);
  });
  return balls;
}

/** Two dots (a lone or shared pair) at `p`, side by side across direction `d`. */
const pair = (p: P, d: P, s: number): Shape[] => {
  const v = mul([-unit(d)[1], unit(d)[0]], 6.5 / s);
  return [electron(add(p, v), s), electron(sub(p, v), s)];
};

const ballBounds = (atoms: Atom[]) => circleBounds(atoms.map((a) => ({ p: [a.x, a.y] as P, r: elementStyle(a.el).r })));

interface DrawnMolecule { meta: Meta; atoms: Atom[]; bonds: Bond[]; recolor?: string; lonePairs?: { atom: number; angles: number[] }[] }
/** Builds a ball-and-stick block, with lone pairs drawn as dot pairs outside the named atoms. */
function moleculeBlock({ meta, atoms: a0, bonds: b0, recolor, lonePairs = [] }: DrawnMolecule): Block {
  const { atoms, bonds } = normalise(a0, b0, a0, b0);
  // The fit scale depends on the lone pairs, which depend on the scale: one pass with a guess is enough.
  const lpAt = (s: number) => lonePairs.flatMap(({ atom, angles }) => {
    const a = atoms[atom];
    if (!a) return [];
    const r = elementStyle(a.el).r + 9 / s;
    return angles.map((deg) => ({ atom, deg, p: add([a.x, a.y], mul(dir(deg), r)) }));
  });
  let bounds = ballBounds(atoms);
  let s = scaleOf(bounds);
  const pad = (ps: { p: P }[], ss: number) => (ps.length ? circleBounds(ps.map((q) => ({ p: q.p, r: 9 / ss }))) : bounds);
  bounds = merge(ballBounds(atoms), pad(lpAt(s), s));
  s = scaleOf(bounds);
  const sk = new Sketch();
  drawBallStick(sk, atoms, bonds, s, { recolor });
  lpAt(s).forEach((lp, i) => {
    sk.part(`lone-pair-${i}`, `lone pair ${i} on atom ${lp.atom}`, ...pair(lp.p, dir(lp.deg), s));
    sk.at(`lone-pair-${i}`, lp.p);
  });
  return finish(meta, sk, merge(ballBounds(atoms), pad(lpAt(s), s)));
}

export interface MoleculeOptions {
  /** Atoms: element symbol and position. Positions in any units (a bond about 36 long is natural; others are rescaled). */
  atoms?: Atom[];
  /** Bonds: [atom index, atom index, order 1 | 2 | 3 | "wedge" | "dash" | "hbond"]. */
  bonds?: Bond[];
  /** Block id and title for a named molecule (default "molecule"). */
  id?: string;
  title?: string;
  /** Recolours every atom in this colour (default: each element's own colour). Bonds stay ink. */
  color?: string;
}
const ETHENE: Atom[] = [
  { el: "C", x: 0, y: 0 }, { el: "C", x: 40, y: 0 },
  { el: "H", x: -21, y: -27 }, { el: "H", x: -21, y: 27 }, { el: "H", x: 61, y: -27 }, { el: "H", x: 61, y: 27 },
];
const ETHENE_BONDS: Bond[] = [[0, 1, 2], [0, 2], [0, 3], [1, 4], [1, 5]];
/**
 * Any ball-and-stick molecule from data: `atoms` ({ el, x, y }) and `bonds` ([a, b, order]). Element
 * colours from `ELEMENTS`; parts and anchors atom-i and bond-a-b. Default: ethene.
 */
export function makeMolecule({ atoms, bonds, id = "molecule", title = "Molecule", color }: MoleculeOptions = {}): Block {
  const { atoms: A, bonds: B } = normalise(atoms, bonds, ETHENE, ETHENE_BONDS);
  return moleculeBlock({
    meta: { id: typeof id === "string" && id ? id : "molecule", title: typeof title === "string" && title ? title : "Molecule", describe: "a ball-and-stick molecule built from atoms ({el, x, y}) and bonds ([a, b, order 1-3]); balls coloured by element; anchors atom-i, bond-a-b", tags: ["molecule", "atoms", "bonds", "ball and stick", "structure", "chemistry"] },
    atoms: A, bonds: B, recolor: color,
  });
}

// ---- Named molecules ----

export interface WaterMoleculeOptions { angle?: number; lonePairs?: boolean; color?: string }
/** A bent water molecule: O with two H below at `angle` degrees apart (90–180, default 104.5), lone pairs optional. */
export function makeWaterMolecule({ angle = 104.5, lonePairs = false, color }: WaterMoleculeOptions = {}): Block {
  const half = Math.min(180, Math.max(90, num(angle, 104.5))) / 2;
  const h1 = mul(dir(90 + half), BOND_LENGTH), h2 = mul(dir(90 - half), BOND_LENGTH);
  return moleculeBlock({
    meta: { id: "water-molecule", title: "Water Molecule", describe: "a water molecule (H2O), bent: red oxygen atom-0 with hydrogens atom-1 and atom-2 below; set angle (90-180) and lonePairs; anchors atom-i, bond-0-1, bond-0-2, lone-pair-i", tags: ["water", "H2O", "molecule", "bent", "covalent", "polar"] },
    atoms: [{ el: "O", x: 0, y: 0 }, { el: "H", x: h1[0], y: h1[1] }, { el: "H", x: h2[0], y: h2[1] }],
    bonds: [[0, 1], [0, 2]], recolor: color,
    lonePairs: lonePairs ? [{ atom: 0, angles: [-90 - 38, -90 + 38] }] : [],
  });
}
export const waterMolecule = makeWaterMolecule();

export interface CarbonDioxideOptions { lonePairs?: boolean; color?: string }
/** Carbon dioxide: O=C=O in a line, two double bonds. */
export function makeCarbonDioxide({ lonePairs = false, color }: CarbonDioxideOptions = {}): Block {
  const d = 42;
  return moleculeBlock({
    meta: { id: "carbon-dioxide", title: "Carbon Dioxide", describe: "a carbon dioxide molecule (CO2): O=C=O in a straight line, two double bonds; carbon atom-1 in the middle; set lonePairs; anchors atom-0, atom-1, atom-2, bond-0-1, bond-1-2", tags: ["carbon dioxide", "CO2", "molecule", "linear", "double bond", "gas"] },
    atoms: [{ el: "O", x: -d, y: 0 }, { el: "C", x: 0, y: 0 }, { el: "O", x: d, y: 0 }],
    bonds: [[0, 1, 2], [1, 2, 2]], recolor: color,
    lonePairs: lonePairs ? [{ atom: 0, angles: [-130, 130] }, { atom: 2, angles: [-50, 50] }] : [],
  });
}
export const carbonDioxide = makeCarbonDioxide();

export interface MethaneOptions { tetrahedral?: boolean; color?: string }
/** Methane: a carbon with four hydrogens, flat in an X, or `tetrahedral` with a wedge and a dashed bond. */
export function makeMethane({ tetrahedral = false, color }: MethaneOptions = {}): Block {
  const k = BOND_LENGTH; // in 3D the wedge and dash bonds are a little longer, so the dashes show
  const hs: P[] = tetrahedral ? [mul(dir(-90), k), mul(dir(200), k), mul(dir(78), k * 1.25), mul(dir(10), k * 1.25)] : [45, 135, 225, 315].map((deg) => mul(dir(deg - 90), k));
  return moleculeBlock({
    meta: { id: "methane", title: "Methane", describe: "a methane molecule (CH4): carbon atom-0 bonded to four hydrogens atom-1..4; set tetrahedral for a 3D wedge-and-dash drawing; anchors atom-i, bond-0-i", tags: ["methane", "CH4", "molecule", "hydrocarbon", "tetrahedral", "covalent"] },
    atoms: [{ el: "C", x: 0, y: 0 }, ...hs.map((p) => ({ el: "H", x: p[0], y: p[1] }))],
    bonds: [[0, 1], [0, 2], [0, 3, tetrahedral ? "wedge" : 1], [0, 4, tetrahedral ? "dash" : 1]], recolor: color,
  });
}
export const methane = makeMethane();

export interface AmmoniaOptions { lonePair?: boolean; color?: string }
/** Ammonia: a blue nitrogen above three hydrogens (a pyramid seen from the side), with its lone pair on top. */
export function makeAmmonia({ lonePair = true, color }: AmmoniaOptions = {}): Block {
  const hs: P[] = [mul(dir(150), BOND_LENGTH), mul(dir(30), BOND_LENGTH), mul(dir(90), BOND_LENGTH)];
  return moleculeBlock({
    meta: { id: "ammonia", title: "Ammonia", describe: "an ammonia molecule (NH3): blue nitrogen atom-0 above three hydrogens atom-1..3, its lone pair (lone-pair-0) on top; set lonePair; anchors atom-i, bond-0-i", tags: ["ammonia", "NH3", "molecule", "lone pair", "pyramidal", "base"] },
    atoms: [{ el: "N", x: 0, y: 0 }, ...hs.map((p) => ({ el: "H", x: p[0], y: p[1] }))],
    bonds: [[0, 1], [0, 2], [0, 3]], recolor: color,
    lonePairs: lonePair ? [{ atom: 0, angles: [-90] }] : [],
  });
}
export const ammonia = makeAmmonia();

export interface DiatomicOptions { lonePairs?: boolean; color?: string }
function diatomic(meta: Meta, el: string, order: 1 | 2 | 3, lonePairs: boolean, color?: string, pairs: number[] = []): Block {
  const d = order === 1 ? BOND_LENGTH : 44;
  return moleculeBlock({
    meta, atoms: [{ el, x: 0, y: 0 }, { el, x: d, y: 0 }], bonds: [[0, 1, order]], recolor: color,
    lonePairs: lonePairs ? [{ atom: 0, angles: pairs.map((a) => 180 + a) }, { atom: 1, angles: pairs }] : [],
  });
}
/** An oxygen molecule: O=O, a double bond. */
export function makeOxygenMolecule({ lonePairs = false, color }: DiatomicOptions = {}): Block {
  return diatomic({ id: "oxygen-molecule", title: "Oxygen Molecule", describe: "an oxygen molecule (O2): two red oxygen atoms joined by a double bond; set lonePairs (two on each atom); anchors atom-0, atom-1, bond-0-1", tags: ["oxygen", "O2", "molecule", "double bond", "diatomic", "gas"] }, "O", 2, lonePairs, color, [-55, 55]);
}
export const oxygenMolecule = makeOxygenMolecule();
/** A hydrogen molecule: H–H, a single bond. */
export function makeHydrogenMolecule({ color }: { color?: string } = {}): Block {
  return diatomic({ id: "hydrogen-molecule", title: "Hydrogen Molecule", describe: "a hydrogen molecule (H2): two hydrogen atoms joined by a single bond; anchors atom-0, atom-1, bond-0-1", tags: ["hydrogen", "H2", "molecule", "single bond", "diatomic", "gas"] }, "H", 1, false, color);
}
export const hydrogenMolecule = makeHydrogenMolecule();
/** A nitrogen molecule: N≡N, a triple bond. */
export function makeNitrogenMolecule({ lonePairs = false, color }: DiatomicOptions = {}): Block {
  return diatomic({ id: "nitrogen-molecule", title: "Nitrogen Molecule", describe: "a nitrogen molecule (N2): two blue nitrogen atoms joined by a triple bond; set lonePairs (one on each atom); anchors atom-0, atom-1, bond-0-1", tags: ["nitrogen", "N2", "molecule", "triple bond", "diatomic", "air"] }, "N", 3, lonePairs, color, [0]);
}
export const nitrogenMolecule = makeNitrogenMolecule();

export interface EthanolOptions { color?: string }
/** Ethanol: CH3–CH2–OH, every hydrogen drawn. */
export function makeEthanol({ color }: EthanolOptions = {}): Block {
  const c = 34, d = 38; // C–H a little short, so the nine atoms stay big
  const atoms: Atom[] = [
    { el: "C", x: 0, y: 0 }, { el: "C", x: d, y: 0 }, { el: "O", x: 2 * d, y: 0 },
    { el: "H", x: -c, y: 0 }, { el: "H", x: 0, y: -c }, { el: "H", x: 0, y: c },
    { el: "H", x: d, y: -c }, { el: "H", x: d, y: c },
    { el: "H", x: 2 * d, y: -c },
  ];
  return moleculeBlock({
    meta: { id: "ethanol", title: "Ethanol", describe: "an ethanol molecule (C2H5OH): carbons atom-0 and atom-1, red oxygen atom-2, hydrogens atom-3..8 (atom-8 is the OH hydrogen); anchors atom-i, bond-a-b", tags: ["ethanol", "alcohol", "molecule", "organic", "hydroxyl", "C2H5OH"] },
    atoms, bonds: [[0, 1], [1, 2], [0, 3], [0, 4], [0, 5], [1, 6], [1, 7], [2, 8]], recolor: color,
  });
}
export const ethanol = makeEthanol();

export interface BenzeneOptions { style?: "kekule" | "circle"; color?: string }
/** Benzene as a skeletal hexagon: alternating double bonds (`kekule`, default) or a ring inside (`circle`). */
export function makeBenzene({ style = "kekule", color = "ink" }: BenzeneOptions = {}): Block {
  const R = 40, s = scaleOf([-R, -R, R, R]);
  const v = Array.from({ length: 6 }, (_, i) => mul(dir(-90 + i * 60), R));
  const sk = new Sketch();
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6, a = v[i], b = v[j];
    const shapes = [line([a, b], color)];
    if (style !== "circle" && i % 2 === 0) {
      // The second line of a double bond: inside the ring, shortened at both ends.
      const inward = mul(unit(mul(mid(a, b), -1)), Math.max(12 / s, 9)), t = 0.2;
      shapes.push(line([add(add(a, mul(sub(b, a), t)), inward), add(add(a, mul(sub(b, a), 1 - t)), inward)], color));
    }
    const lo = Math.min(i, j), hi = Math.max(i, j);
    sk.part(`bond-${lo}-${hi}`, `${style !== "circle" && i % 2 === 0 ? "double" : "single"} bond between carbons ${lo} and ${hi}`, ...shapes);
    sk.at(`bond-${lo}-${hi}`, mid(a, b));
  }
  sk.part("ring", "the ring of shared electrons", ...(style === "circle" ? [circle(0, 0, R * 0.52, color)] : [ghost(0, 0, R * 0.5)]));
  v.forEach((p, i) => sk.part(`atom-${i}`, `carbon ${i}`, ghost(p[0], p[1], 7)).at(`atom-${i}`, p));
  return finish(
    { id: "benzene", title: "Benzene", describe: "a benzene ring (C6H6), skeletal: a hexagon of six carbons (atom-0 at the top, clockwise) with alternating double bonds, or style circle for a ring inside; anchors atom-i, bond-a-b, ring", tags: ["benzene", "aromatic", "ring", "hexagon", "organic", "skeletal"] },
    sk, [v[4][0], -R, v[1][0], R],
  );
}
export const benzene = makeBenzene();

export interface GlucoseRingOptions { anomer?: "alpha" | "beta"; color?: string }
/** Glucose as a Haworth ring: a skeletal hexagon with its ring oxygen and OH groups as red balls. */
export function makeGlucoseRing({ anomer = "alpha", color = "ink" }: GlucoseRingOptions = {}): Block {
  const O = elementStyle("O");
  const ring: P[] = [[122, 15], [76, 52], [0, 52], [-46, 15], [0, -22], [76, -22]]; // C1, C2, C3, C4, C5, ring O
  const c6: P = [0, -54];
  const up = -1, down = 1;
  // Substituent oxygens: on C1 (down for alpha), C2 down, C3 up (inside the ring's back), C4 down, and C6.
  const subs: { from: number; p: P }[] = [
    { from: 0, p: [122, anomer === "beta" ? 15 + up * 36 : 15 + down * 36] },
    { from: 1, p: [76, 52 + down * 36] },
    { from: 2, p: [0, 52 + up * 32] },
    { from: 3, p: [-46, 15 + down * 36] },
    { from: 6, p: add(c6, mul(dir(-150), 36)) },
  ];
  const pts: P[] = [...ring, c6, ...subs.map((q) => q.p)];
  const isBall = (i: number) => i === 5 || i >= 7;
  const r = (i: number) => (isBall(i) ? O.r : 0);
  const stick = (a: number, b: number, width?: number) => {
    const u = unit(sub(pts[b], pts[a]));
    return line([add(pts[a], mul(u, r(a))), add(pts[b], mul(u, -r(b)))], color, width);
  };
  const sk = new Sketch();
  const bonds: [number, number, number?][] = [[0, 1, 1.4], [1, 2, 1.4], [2, 3, 1.4], [3, 4], [4, 5], [0, 5], [4, 6], ...subs.map((q, k) => [q.from, 7 + k] as [number, number])];
  for (const [a, b, w] of bonds) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    sk.part(`bond-${lo}-${hi}`, `bond between atom ${lo} and atom ${hi}`, stick(a, b, w));
    sk.at(`bond-${lo}-${hi}`, mid(pts[a], pts[b]));
  }
  const names = ["carbon 1", "carbon 2", "carbon 3", "carbon 4", "carbon 5", "ring oxygen", "carbon 6", "OH on carbon 1", "OH on carbon 2", "OH on carbon 3", "OH on carbon 4", "OH on carbon 6"];
  pts.forEach((p, i) => {
    sk.part(`atom-${i}`, names[i], isBall(i) ? circle(p[0], p[1], O.r, O.stroke, { fill: O.fill }) : ghost(p[0], p[1], 7));
    sk.at(`atom-${i}`, p);
  });
  sk.part("ring", "the six-membered ring", ghost(38, 15, 26));
  sk.at("ring", [38, 15]);
  return finish(
    { id: "glucose-ring", title: "Glucose Ring", describe: "glucose as a Haworth ring: a skeletal hexagon, carbons atom-0..4 (C1-C5) and C6 atom-6, ring oxygen atom-5 and OH oxygens atom-7..11 as red balls; set anomer (alpha, beta); anchors atom-i, bond-a-b, ring", tags: ["glucose", "sugar", "ring", "carbohydrate", "Haworth", "skeletal"] },
    sk, circleBounds(pts.map((p, i) => ({ p, r: Math.max(r(i), 4) }))),
  );
}
export const glucoseRing = makeGlucoseRing();

// ---- Bonds ----

export interface BondPairOptions {
  /** The two elements (default carbon and carbon). */
  atoms?: [Element, Element];
  /** Shows each shared pair as two electrons on its stick. */
  electrons?: boolean;
  color?: string;
}
function bondPair(meta: Meta, order: 1 | 2 | 3, { atoms = ["C", "C"], electrons = false, color }: BondPairOptions): Block {
  const els = (Array.isArray(atoms) ? atoms : []).map((e) => (typeof e === "string" && e ? e : "C"));
  const a = els[0] ?? "C", b = els[1] ?? a;
  const d = 52;
  const list: Atom[] = [{ el: a, x: 0, y: 0 }, { el: b, x: d, y: 0 }];
  const bounds = ballBounds(list), s = scaleOf(bounds);
  const sk = new Sketch();
  const balls = drawBallStick(sk, list, [[0, 1, order]], s, { recolor: color });
  if (electrons) {
    const gap = stickGap(order, Math.min(balls[0].r, balls[1].r), s);
    const x = (balls[0].r + d - balls[1].r) / 2;
    for (let k = 0; k < order; k++) {
      const y = (k - (order - 1) / 2) * gap;
      // A shared pair sits on its stick, one electron from each atom.
      sk.part(`electron-${2 * k}`, `shared electron from atom 0, pair ${k}`, circle(x - 5 / s, y, 2.8 / s, "blue", { fill: "blue-tint" }));
      sk.part(`electron-${2 * k + 1}`, `shared electron from atom 1, pair ${k}`, circle(x + 5 / s, y, 2.8 / s, "blue", { fill: "blue-tint" }));
      sk.at(`pair-${k}`, [x, y]);
    }
  }
  return finish(meta, sk, bounds);
}
const pairDescribe = (what: string) => `${what}; set atoms ([el, el], default C and C) and electrons (shows each shared pair on its stick); anchors atom-0, atom-1, bond-0-1, pair-k`;
/** A single bond: two atoms joined by one stick. */
export function makeSingleBond(o: BondPairOptions = {}): Block {
  return bondPair({ id: "single-bond", title: "Single Bond", describe: pairDescribe("a single covalent bond: two atoms joined by one stick (one shared pair)"), tags: ["single bond", "covalent", "bond", "shared pair", "electrons"] }, 1, o);
}
export const singleBond = makeSingleBond();
/** A double bond: two atoms joined by two parallel sticks. */
export function makeDoubleBond(o: BondPairOptions = {}): Block {
  return bondPair({ id: "double-bond", title: "Double Bond", describe: pairDescribe("a double covalent bond: two atoms joined by two parallel sticks (two shared pairs)"), tags: ["double bond", "covalent", "bond", "shared pairs", "alkene"] }, 2, o);
}
export const doubleBond = makeDoubleBond();
/** A triple bond: two atoms joined by three parallel sticks. */
export function makeTripleBond(o: BondPairOptions = {}): Block {
  return bondPair({ id: "triple-bond", title: "Triple Bond", describe: pairDescribe("a triple covalent bond: two atoms joined by three parallel sticks (three shared pairs)"), tags: ["triple bond", "covalent", "bond", "shared pairs", "alkyne"] }, 3, o);
}
export const tripleBond = makeTripleBond();

/** Electrons evenly round a shell, in pairs, keeping clear of `avoid` (degrees, ± `spread`). */
function shellElectrons(c: P, R: number, n: number, s: number, avoid?: number, spread = 0): P[] {
  if (n <= 0) return [];
  const pairs = Math.ceil(n / 2);
  const from = avoid === undefined ? -90 : avoid + spread, span = avoid === undefined ? 360 : 360 - 2 * spread;
  const step = avoid === undefined ? span / pairs : span / pairs;
  const half = (Math.asin(Math.min(1, 6.5 / s / R)) * 180) / Math.PI;
  const out: P[] = [];
  for (let k = 0; k < pairs; k++) {
    const a = from + step * (k + 0.5);
    const two = 2 * k + 1 < n;
    for (const da of two ? [-half, half] : [0]) out.push(add(c, mul(dir(a + da), R)));
  }
  return out;
}

export interface IonicBondOptions { stage?: "before" | "after"; color?: string }
/**
 * Ionic bonding: a sodium atom handing its one outer electron to a chlorine atom (an arrow), or, at
 * `stage` "after", the two ions it makes: Na+ (shell empty) and Cl− (a full shell of eight).
 */
export function makeIonicBond({ stage = "before", color = "ink" }: IonicBondOptions = {}): Block {
  const after = stage === "after";
  const na: P = [0, 0], cl: P = [112, 0], Rna = 30, Rcl = 34;
  const NA = elementStyle("Na"), CL = elementStyle("Cl");
  const bounds: Bounds = [-Rna - 4, -Rcl - 22, cl[0] + Rcl + 4, Rcl + 4];
  const s = scaleOf(bounds);
  const sk = new Sketch();
  sk.part("sodium", "sodium nucleus and inner shells", circle(na[0], na[1], NA.r, NA.stroke, { fill: NA.fill }));
  if (after) {
    // The emptied shell, dashed: a ring of short arcs.
    const segs: string[] = [];
    for (let k = 0; k < 8; k++) {
      const a0 = k * 45 + 8;
      segs.push(poly(Array.from({ length: 4 }, (_, t) => add(na, mul(dir(a0 + (22.5 * t) / 3), Rna)))));
    }
    sk.part("shell-0", "sodium's emptied outer shell", path(segs.join(" "), "grey", 0.8));
  } else sk.part("shell-0", "sodium's outer shell", circle(na[0], na[1], Rna, NA.stroke, { width: 0.8 }));
  sk.part("chlorine", "chlorine nucleus and inner shells", circle(cl[0], cl[1], CL.r, CL.stroke, { fill: CL.fill }));
  sk.part("shell-1", "chlorine's outer shell", circle(cl[0], cl[1], Rcl, CL.stroke, { width: 0.8 }));
  // Chlorine's own seven outer electrons, leaving the slot facing sodium empty.
  const slot = add(cl, mul(dir(180), Rcl));
  const own = shellElectrons(cl, Rcl, 7, s, 180, 24);
  own.forEach((p, i) => sk.part(`electron-${i}`, `chlorine outer electron ${i}`, electron(p, s)).at(`electron-${i}`, p));
  const moving: P = after ? slot : add(na, mul(dir(0), Rna));
  sk.part("electron", "the electron that moves from sodium to chlorine", circle(moving[0], moving[1], 3 / s, "blue", { fill: "blue-tint" }));
  sk.at("electron", moving).at("slot", slot);
  if (!after) {
    const a = add(na, mul(dir(-30), Rna + 6)), b = add(cl, mul(dir(-168), Rcl + 8)), c: P = [(a[0] + b[0]) / 2, -Rcl - 42];
    const end = b;
    sk.part("arrow", "the electron's move", path(`M${a[0].toFixed(1)} ${a[1].toFixed(1)} Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)} ${head(end, sub(end, c), 5 / s)}`, color));
    sk.at("arrow", [c[0], (a[1] + c[1]) / 2 - 2]);
  } else {
    const k = 5 / s;
    sk.part("sodium-charge", "the plus charge on the sodium ion", charge(add(na, mul(dir(-45), Rna + k + 3)), k, NA.stroke));
    sk.part("chlorine-charge", "the minus charge on the chloride ion", charge(add(cl, mul(dir(-45), Rcl + k + 3)), k, CL.stroke, true));
    sk.at("sodium-charge", add(na, mul(dir(-45), Rna + k + 3))).at("chlorine-charge", add(cl, mul(dir(-45), Rcl + k + 3)));
  }
  sk.at("sodium", na).at("chlorine", cl).at("shell-0", [na[0], -Rna]).at("shell-1", [cl[0], -Rcl]);
  return finish(
    { id: "ionic-bond", title: "Ionic Bond", describe: "ionic bonding: a sodium atom (purple) giving its one outer electron to a chlorine atom (green) with a curved arrow; set stage (before, after: the Na+ and Cl- ions, with charge signs); anchors sodium, chlorine, electron, slot, arrow, shell-0, shell-1, electron-i", tags: ["ionic bond", "electron transfer", "sodium chloride", "ions", "NaCl", "salt"] },
    sk, bounds,
  );
}
export const ionicBond = makeIonicBond();

export interface CovalentBondOptions { atoms?: [Element, Element]; order?: number; color?: string }
/** Covalent bonding: two atoms whose outer shells overlap, sharing `order` (1–3) pairs of electrons in the overlap. */
export function makeCovalentBond({ atoms = ["Cl", "Cl"], order = 1, color }: CovalentBondOptions = {}): Block {
  order = clamp(order, 1, 3, 1);
  const els = (Array.isArray(atoms) ? atoms : []).map((e) => (typeof e === "string" && e ? e : "Cl"));
  const ea = els[0] ?? "Cl", eb = els[1] ?? ea;
  const R = 36, d = 50, nr = 9, A: P = [0, 0], B: P = [d, 0];
  const bounds: Bounds = [-R - 4, -R - 4, d + R + 4, R + 4];
  const s = scaleOf(bounds);
  const sk = new Sketch();
  const style = (el: string) => (color ? { ...elementStyle(el), stroke: color, fill: tint(color) ?? "board" } : elementStyle(el));
  const SA = style(ea), SB = style(eb);
  sk.part("shell-0", `outer shell of atom 0 (${ea})`, circle(A[0], A[1], R, SA.stroke, { width: 0.8 }));
  sk.part("shell-1", `outer shell of atom 1 (${eb})`, circle(B[0], B[1], R, SB.stroke, { width: 0.8 }));
  sk.part("atom-0", `nucleus of atom 0 (${ea})`, circle(A[0], A[1], nr, SA.stroke, { fill: SA.fill }));
  sk.part("atom-1", `nucleus of atom 1 (${eb})`, circle(B[0], B[1], nr, SB.stroke, { fill: SB.fill }));
  let e = 0;
  // The shared pairs, side by side in the overlap: one electron from each atom.
  const x = d / 2, half = Math.sqrt(R * R - x * x);
  const gap = Math.min(Math.max(13 / s, 11), (2 * half - 8) / Math.max(1, order - 1 || 1));
  for (let k = 0; k < order; k++) {
    const y = (k - (order - 1) / 2) * gap;
    sk.part(`electron-${e++}`, `shared electron from atom 0, pair ${k}`, electron([x - 5.5 / s, y], s));
    sk.part(`electron-${e++}`, `shared electron from atom 1, pair ${k}`, electron([x + 5.5 / s, y], s));
    sk.at(`pair-${k}`, [x, y]);
  }
  sk.part("overlap", "the overlap where the electrons are shared", { type: "rect", x: x - 10, y: -half, w: 20, h: 2 * half });
  // Each atom's other outer electrons, round the far side of its shell.
  for (const [c, el, avoid, k] of [[A, ea, 0, 0], [B, eb, 180, 1]] as const) {
    const rest = Math.max(0, (VALENCE[el] ?? 4) - order);
    for (const p of shellElectrons(c, R, rest, s, avoid, 55)) sk.part(`electron-${e++}`, `outer electron of atom ${k}`, electron(p, s));
  }
  sk.at("atom-0", A).at("atom-1", B).at("overlap", [x, 0]).at("shell-0", [A[0], -R]).at("shell-1", [B[0], -R]);
  return finish(
    { id: "covalent-bond", title: "Covalent Bond", describe: "covalent bonding: two atoms with overlapping outer shells sharing electron pairs (blue dots) in the overlap, their other outer electrons round the shells; set atoms ([el, el], default Cl and Cl) and order (1-3 shared pairs); anchors atom-0, atom-1, overlap, pair-k, shell-0, shell-1", tags: ["covalent bond", "shared pair", "electrons", "outer shell", "dot and cross", "molecule"] },
    sk, bounds,
  );
}
export const covalentBond = makeCovalentBond();

export interface HydrogenBondOptions { count?: number; color?: string }
/** Hydrogen bonding: `count` (2–4, default 2) water molecules in a chain, each H of one dashed to the O of the next. */
export function makeHydrogenBond({ count = 2, color }: HydrogenBondOptions = {}): Block {
  count = clamp(count, 2, 4, 2);
  const half = 52.25, hb = 60;
  const atoms: Atom[] = [];
  const bonds: [number, number, BondOrder][] = [];
  let o: P = [0, 0], bis = 70;
  for (let w = 0; w < count; w++) {
    const i = atoms.length;
    const h1 = add(o, mul(dir(bis - half), BOND_LENGTH)), h2 = add(o, mul(dir(bis + half), BOND_LENGTH));
    atoms.push({ el: "O", x: o[0], y: o[1] }, { el: "H", x: h1[0], y: h1[1] }, { el: "H", x: h2[0], y: h2[1] });
    bonds.push([i, i + 1, 1], [i, i + 2, 1]);
    if (w < count - 1) {
      // The H pointing most to the right reaches to the next oxygen.
      const donor = bis - half;
      const next = add(h1, mul(dir(donor), hb));
      bonds.push([i + 1, i + 3, "hbond"]);
      o = next;
      bis = w % 2 === 0 ? donor - 20 : donor + 125;
    }
  }
  const bounds = ballBounds(atoms), s = scaleOf(bounds);
  const sk = new Sketch();
  drawBallStick(sk, atoms, bonds, s, { recolor: color });
  let k = 0;
  for (const [a, b, ord] of bonds) {
    if (ord !== "hbond") continue;
    sk.at(`hydrogen-bond-${k}`, mid([atoms[a].x, atoms[a].y], [atoms[b].x, atoms[b].y]));
    const part = sk.parts.find((p) => p.id === `bond-${a}-${b}`);
    if (part) part.id = `hydrogen-bond-${k}`, (part.label = `hydrogen bond ${k}: H of water ${k} to O of water ${k + 1}`);
    k++;
  }
  for (let w = 0; w < count; w++) sk.at(`water-${w}`, [atoms[3 * w].x, atoms[3 * w].y]);
  return finish(
    { id: "hydrogen-bond", title: "Hydrogen Bond", describe: "hydrogen bonding: water molecules in a chain, a hydrogen of each dashed to the oxygen of the next; set count (2-4 waters); atoms atom-i (water w is atom-3w O, then its two H); anchors water-w, hydrogen-bond-k, atom-i", tags: ["hydrogen bond", "water", "intermolecular", "polar", "dashed bond", "forces"] },
    sk, bounds,
  );
}
export const hydrogenBond = makeHydrogenBond();

/** A small deterministic jitter in -1..1. */
const jitter = (i: number, j: number) => Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1;

export interface MetallicBondOptions { rows?: number; cols?: number; color?: string }
/** Metallic bonding: a `rows` × `cols` grid (2–5 × 2–6, default 3 × 3) of + metal ions in a sea of electrons. */
export function makeMetallicBond({ rows = 3, cols = 3, color = "grey" }: MetallicBondOptions = {}): Block {
  rows = clamp(rows, 2, 5, 3);
  cols = clamp(cols, 2, 6, 3);
  const sp = 50, r = 16, pad = 20;
  const w = (cols - 1) * sp, h = (rows - 1) * sp;
  const bounds: Bounds = [-r - pad, -r - pad, w + r + pad, h + r + pad];
  const s = scaleOf(bounds);
  const sk = new Sketch();
  sk.part("sea", "the sea of free electrons", { type: "rect", x: bounds[0], y: bounds[1], w: bounds[2] - bounds[0], h: bounds[3] - bounds[1], r: 14, stroke: "blue", fill: "blue-tint", width: 0.8 });
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const p: P = [j * sp, i * sp];
      sk.part(`ion-${i}-${j}`, `metal ion, row ${i} column ${j}`, circle(p[0], p[1], r, color, { fill: tint(color) ?? "board" }), charge(p, 6, color));
      sk.at(`ion-${i}-${j}`, p);
    }
  }
  // Electrons in the gaps between ions (and round the edge), each nudged a little.
  let e = 0;
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      if ((i === 0 || i === rows) && (j === 0 || j === cols)) continue; // leave the sea's corners clear
      const p: P = [(j - 0.5) * sp + jitter(i, j) * 5, (i - 0.5) * sp + jitter(j, i + 7) * 5];
      const q: P = [Math.min(Math.max(p[0], bounds[0] + 7), bounds[2] - 7), Math.min(Math.max(p[1], bounds[1] + 7), bounds[3] - 7)];
      sk.part(`electron-${e}`, `free electron ${e}`, electron(q, s)).at(`electron-${e}`, q);
      e++;
    }
  }
  return finish(
    { id: "metallic-bond", title: "Metallic Bond", describe: "metallic bonding: a grid of positive metal ions (grey circles with +) in a sea of free electrons (blue dots); set rows (2-5) and cols (2-6); anchors ion-r-c, electron-i, sea", tags: ["metallic bond", "metal", "sea of electrons", "ions", "conductor", "lattice"] },
    sk, bounds,
  );
}
export const metallicBond = makeMetallicBond();

export interface CrystalLatticeOptions { size?: number; lines?: boolean; color?: string }
/** An ionic lattice: a `size` × `size` grid (2–6, default 3) of alternating small Na+ (purple) and big Cl− (green) ions. */
export function makeCrystalLattice({ size = 3, lines = true, color }: CrystalLatticeOptions = {}): Block {
  size = clamp(size, 2, 6, 3);
  const sp = 44, rNa = 10, rCl = 15;
  const w = (size - 1) * sp;
  const bounds: Bounds = [-rCl, -rCl, w + rCl, w + rCl];
  const sk = new Sketch();
  const NA = elementStyle("Na"), CL = elementStyle("Cl");
  const isNa = (i: number, j: number) => (i + j) % 2 === 1;
  const rad = (i: number, j: number) => (isNa(i, j) ? rNa : rCl);
  if (lines) {
    const segs: string[] = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (j < size - 1) segs.push(poly([[j * sp + rad(i, j), i * sp], [(j + 1) * sp - rad(i, j + 1), i * sp]]));
        if (i < size - 1) segs.push(poly([[j * sp, i * sp + rad(i, j)], [j * sp, (i + 1) * sp - rad(i + 1, j)]]));
      }
    }
    sk.part("lattice", "the lattice lines between neighbouring ions", path(segs.join(" "), "grey", 0.8));
  }
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p: P = [j * sp, i * sp], na = isNa(i, j);
      const st = color ? { stroke: color, fill: tint(color) ?? "board" } : na ? NA : CL;
      sk.part(`ion-${i}-${j}`, `${na ? "sodium ion (Na+)" : "chloride ion (Cl-)"}, row ${i} column ${j}`, circle(p[0], p[1], rad(i, j), st.stroke, { fill: st.fill }));
      sk.at(`ion-${i}-${j}`, p);
    }
  }
  sk.at("sodium", [sp, 0]).at("chloride", [0, 0]);
  return finish(
    { id: "crystal-lattice", title: "Crystal Lattice", describe: "an ionic crystal lattice (sodium chloride): a square grid of alternating small purple Na+ and big green Cl- ions joined by lattice lines; set size (2-6 per side) and lines; anchors ion-r-c (ion-0-0 is Cl-), sodium, chloride", tags: ["crystal lattice", "ionic", "sodium chloride", "NaCl", "giant structure", "salt"] },
    sk, bounds,
  );
}
export const crystalLattice = makeCrystalLattice();

export interface PolymerChainOptions { units?: number; side?: Element; bracket?: number; color?: string }
/**
 * A polymer chain, skeletal: a zigzag of carbons in `units` (1–5, default 3) repeating –CH2–CH2– units
 * (poly(ethene)), carrying on at both ends. `side` hangs one atom per unit off the chain as a ball (Cl
 * for PVC; default H, not drawn); square brackets round unit `bracket` (default the middle; -1 for none).
 */
export function makePolymerChain({ units = 3, side = "H", bracket, color = "ink" }: PolymerChainOptions = {}): Block {
  units = clamp(units, 1, 5, 3);
  const sideEl = typeof side === "string" && side && side !== "H" ? side : undefined;
  const br = bracket === undefined ? Math.floor((units - 1) / 2) : clamp(bracket, -1, units - 1, 0);
  const SR = sideEl ? elementStyle(sideEl).r : 0, sideLen = 22;
  const dx = sideEl ? 46 : 36, amp = sideEl ? 14 : 11, n = 2 * units, tail = 0.75; // wider with side groups, so the brackets clear their balls
  const C = (k: number): P => [k * dx, k % 2 ? amp : -amp];
  const sideAt = (u: number): P => add(C(2 * u + 1), [0, sideLen + SR]); // odd carbons sit low, so side groups hang down
  const top = -amp - 24, bot = sideEl ? amp + sideLen + 2 * SR + 8 : amp + 24;
  const start = add(C(0), mul(sub(C(-1), C(0)), tail)), end = add(C(n - 1), mul(sub(C(n), C(n - 1)), tail));
  const bounds: Bounds = [start[0] - 2, top - 2, end[0] + 2, bot + 2];
  const sk = new Sketch();
  sk.part("chain-start", "the chain carrying on to the left", line([C(0), start], color));
  for (let k = 0; k < n - 1; k++) sk.part(`bond-${k}-${k + 1}`, `bond between carbons ${k} and ${k + 1}`, line([C(k), C(k + 1)], color)).at(`bond-${k}-${k + 1}`, mid(C(k), C(k + 1)));
  sk.part("chain-end", "the chain carrying on to the right", line([C(n - 1), end], color));
  for (let k = 0; k < n; k++) sk.part(`atom-${k}`, `carbon ${k}`, ghost(...C(k), 6)).at(`atom-${k}`, C(k));
  if (sideEl) {
    const st = elementStyle(sideEl);
    for (let u = 0; u < units; u++) {
      const c = C(2 * u + 1), p = sideAt(u);
      sk.part(`bond-${2 * u + 1}-${n + u}`, `bond to the side group of unit ${u}`, line([c, sub(p, [0, SR])], color));
      sk.part(`atom-${n + u}`, `side group (${sideEl}) of unit ${u}`, circle(p[0], p[1], SR, st.stroke, { fill: st.fill }));
      sk.at(`atom-${n + u}`, p);
    }
  }
  for (let u = 0; u < units; u++) {
    sk.part(`unit-${u}`, `repeating unit ${u}`, { type: "rect", x: (2 * u - 0.5) * dx, y: top, w: 2 * dx, h: bot - top });
    sk.at(`unit-${u}`, [(2 * u + 0.5) * dx, 0]);
  }
  if (br >= 0) {
    const xl = (2 * br - 0.5) * dx, xr = (2 * br + 1.5) * dx, k = 9;
    sk.part("bracket-left", "left bracket of the repeating unit", line([[xl + k, top], [xl, top], [xl, bot], [xl + k, bot]], color));
    sk.part("bracket-right", "right bracket of the repeating unit", line([[xr - k, top], [xr, top], [xr, bot], [xr - k, bot]], color));
    sk.at("n", [xr + 8, bot]);
  }
  sk.at("start", start).at("end", end);
  return finish(
    { id: "polymer-chain", title: "Polymer Chain", describe: "a polymer chain (poly(ethene)), skeletal: a zigzag of carbons in repeating -CH2-CH2- units, carrying on at both ends, one unit in square brackets; set units (1-5), side (an element hung off each unit as a ball, Cl for PVC) and bracket (unit index, -1 none); anchors unit-u, atom-i (carbons, then side atoms), bond-a-b, start, end, n (for the subscript)", tags: ["polymer", "monomer", "repeating unit", "plastic", "polyethene", "chain"] },
    sk, bounds,
  );
}
export const polymerChain = makePolymerChain();

export interface SpaceFillingOptions {
  /** Atoms as for makeMolecule (default water). Big atoms are drawn in front of hydrogens, unless `z` orders them (higher in front). */
  atoms?: (Atom & { z?: number })[];
  /** Bonds as for makeMolecule; used only to read the scale of the positions. */
  bonds?: Bond[];
  color?: string;
}
/** A space-filling model: each atom a big sphere, overlapping its neighbours, with a shine mark. */
export function makeSpaceFilling({ atoms, bonds, color }: SpaceFillingOptions = {}): Block {
  const water: Atom[] = [{ el: "O", x: 0, y: 0 }, { el: "H", x: -28.5, y: 22 }, { el: "H", x: 28.5, y: 22 }];
  const { atoms: A } = normalise(atoms, bonds, water, [[0, 1], [0, 2]]);
  // Drawn back to front: by z when any atom has one, else small atoms (H) behind the big ones.
  const given = A.map((_, i) => (atoms?.[i] as { z?: number } | undefined)?.z);
  const anyZ = given.some((z) => typeof z === "number" && Number.isFinite(z));
  const zs = A.map((a, i) => (anyZ ? num(given[i], 0) : elementStyle(a.el).r));
  const order = A.map((_, i) => i).sort((a, b) => zs[a] - zs[b] || a - b);
  const R = (el: string) => elementStyle(el).r * 2;
  const cs = A.map((a) => ({ p: [a.x, a.y] as P, r: R(a.el) }));
  const bounds = circleBounds(cs);
  const sk = new Sketch();
  for (const i of order) {
    const a = A[i], st = color ? { stroke: color, fill: tint(color) ?? "board" } : elementStyle(a.el), r = cs[i].r;
    const shine = poly(Array.from({ length: 5 }, (_, t) => add(cs[i].p, mul(dir(-165 + t * 15), r * 0.62))));
    sk.part(`atom-${i}`, `atom ${i} (${a.el})`, circle(a.x, a.y, r, st.stroke, { fill: st.fill }), path(shine, st.stroke, 0.8));
    sk.at(`atom-${i}`, cs[i].p);
  }
  return finish(
    { id: "space-filling", title: "Space-Filling Model", describe: "a space-filling molecule model: each atom a big overlapping sphere coloured by element (default water); set atoms ({el, x, y, z?}) and bonds as for a ball-and-stick molecule; anchors atom-i", tags: ["space-filling", "molecule", "model", "atoms", "spheres", "3D"] },
    sk, bounds,
  );
}
export const spaceFilling = makeSpaceFilling();
