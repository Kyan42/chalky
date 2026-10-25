// Solutions, acids and bases, separation and gases: pH scales, beakers of solute, lab set-ups for
// separating mixtures, and gas particles in syringes, boxes and balloons. Every block is a factory plus
// a default instance; each liquid, layer, particle, spot and piece of apparatus is its own part and anchor.
import { poly, smooth, wave, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Helpers: draw in any units, then fit the drawing into a box whose longer side is 100. ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
/** The colour's pale fill, when it has one. */
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : undefined);
/** A whole number in lo..hi (d when not a number). */
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = Math.round(typeof v === "number" && Number.isFinite(v) ? v : d);
  return Math.min(hi, Math.max(lo, x));
};
/** A number in lo..hi (d when not a number). */
const clampF = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, x));
};
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

type Style = { fill?: string; width?: number; r?: number };
const rect = (x: number, y: number, w: number, h: number, stroke: string | undefined, o: Style = {}): Shape => ({
  type: "rect", x, y, w, h, ...(stroke ? { stroke } : {}), ...(o.r ? { r: o.r } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const path = (d: string, stroke: string | undefined, o: Style = {}): Shape => ({
  type: "path", d, ...(stroke ? { stroke } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const line = (pts: P[], stroke: string, width?: number): Shape => path(poly(pts), stroke, { width });
/** A closed region with only a pale fill (a liquid); its lines are drawn separately. */
const region = (pts: P[], paint: string | undefined): Shape => path(poly(pts, true), undefined, { fill: paint });
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
const arrow = (a: P, b: P, stroke: string, size = 5, width?: number): Shape =>
  path(`${poly([a, b])} ${head(b, [b[0] - a[0], b[1] - a[1]], size)}`, stroke, { width });
/** A plus sign (or a minus, with `minus`), arms `s` long. */
const sign = (cx: number, cy: number, s: number, stroke: string, minus = false): Shape =>
  path(minus ? poly([[cx - s, cy], [cx + s, cy]]) : `${poly([[cx - s, cy], [cx + s, cy]])} ${poly([[cx, cy - s], [cx, cy + s]])}`, stroke);
/** Side-of-the-chalk shading: a zigzag between xl(y) and xr(y) from y0 to y1, a turn every `step`. */
const zig = (y0: number, y1: number, xl: (y: number) => number, xr: (y: number) => number, step: number, stroke: string): Shape => {
  const pts: P[] = [];
  for (let y = y0, k = 0; y <= y1 + 1e-6; y += step, k++) pts.push([k % 2 ? xr(y) : xl(y), y]);
  return line(pts, stroke, 0.8);
};
/** A short wavy line: a liquid's ripple, so liquids read in chalk. */
const ripple = (x0: number, x1: number, y: number, stroke: string): Shape =>
  path(wave(x0, x1, y, 1.8, Math.max(1, Math.round((x1 - x0) / 13))), stroke, { width: 0.8 });
/** A particle: a small blue ball. */
const dot = (p: P, r: number, stroke: string) => circle(p[0], p[1], r, stroke, { fill: tint(stroke) });
/** A crystal: a small square turned `deg` degrees. */
const crystal = (cx: number, cy: number, s: number, deg: number, stroke: string): Shape => {
  const a = (deg * Math.PI) / 180, h = s / 2;
  const pts: P[] = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  return path(poly(pts, true), stroke, { fill: tint(stroke), width: 0.8 });
};
/** A flame standing on (cx, base): orange outside, a red hot core. */
const flame = (cx: number, base: number, w: number, h: number): Shape[] => {
  const f = (w: number, h: number, stroke: string): Shape => {
    const t = base - h;
    return path(
      `M${cx} ${t} C${cx + w * 0.1} ${t + h * 0.3} ${cx + w * 0.5} ${t + h * 0.45} ${cx + w * 0.5} ${t + h * 0.72} C${cx + w * 0.5} ${t + h * 0.92} ${cx + w * 0.28} ${base} ${cx} ${base} C${cx - w * 0.28} ${base} ${cx - w * 0.5} ${t + h * 0.92} ${cx - w * 0.5} ${t + h * 0.72} C${cx - w * 0.5} ${t + h * 0.45} ${cx - w * 0.1} ${t + h * 0.3} ${cx} ${t} Z`,
      stroke, { fill: tint(stroke) },
    );
  };
  return [f(w, h, "orange"), f(w * 0.42, h * 0.48, "red")];
};

/** Up to `n` of the points, spread out: each next one as far as possible from those already taken. */
function spread(pts: P[], n: number, start: P): P[] {
  const left = [...pts], out: P[] = [];
  const d2 = (a: P, b: P) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  while (out.length < n && left.length) {
    let best = 0, score = -1;
    left.forEach((p, i) => {
      const s = out.length ? Math.min(...out.map((q) => d2(p, q))) : -d2(p, start);
      if (score === -1 || s > score) (score = s), (best = i);
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

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
  const tr = (d: string) => {
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
    return { ...sh, d: tr(sh.d) };
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const anchors: Record<string, [number, number]> = {
    center: pt([cx, cy]), top: pt([cx, y0]), bottom: pt([cx, y1]), left: pt([x0, cy]), right: pt([x1, cy]),
  };
  for (const [k, p] of Object.entries(sk.anchors)) anchors[k] = pt(p);
  return { ...meta, size: [r1(W), r1(H)], parts: sk.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors };
}

// ---- Glassware ----

/** A beaker's outline: straight sides, rounded bottom corners, a small lip at the top. */
const beakerOutline = (x: number, y: number, w: number, h: number, color: string): Shape => {
  const r = Math.min(6, w / 5);
  return path(`M${x - 4} ${y - 3} L${x} ${y} L${x} ${y + h - r} Q${x} ${y + h} ${x + r} ${y + h} L${x + w - r} ${y + h} Q${x + w} ${y + h} ${x + w} ${y + h - r} L${x + w} ${y} L${x + w + 4} ${y - 3}`, color);
};

type BeakerSpec = { x: number; y: number; w: number; h: number; fill: number; liquid: string; color: string; id?: string; label?: string; ripples?: boolean };
/**
 * A beaker with liquid: parts `<id>-liquid` (pale fill and ripples), `<id>` (the glass), `<id>-surface`.
 * With no `id`: `liquid`, `beaker`, `surface`. Returns the surface's y.
 * `inside` draws between the liquid and the glass (a dipped strip, particles).
 */
function addBeaker(sk: Sketch, b: BeakerSpec, inside?: (ys: number) => void): number {
  const { x, y, w, h, liquid, color } = b;
  const pre = b.id ? `${b.id}-` : "", id = b.id ?? "beaker";
  const fill = clampF(b.fill, 0, 0.95, 0.5);
  const ys = y + h - fill * h, depth = y + h - ys;
  if (fill > 0.02) {
    const shapes: Shape[] = [rect(x, ys, w, depth, undefined, { fill: tint(liquid), r: Math.min(5, depth / 2) })];
    if (b.ripples !== false && depth >= 20) shapes.push(ripple(x + w * 0.14, x + w * 0.5, ys + 10, liquid));
    if (b.ripples !== false && depth >= 32) shapes.push(ripple(x + w * 0.5, x + w * 0.86, ys + 21, liquid));
    sk.part(`${pre}liquid`, `${b.label ?? ""}${b.label ? " " : ""}liquid`, ...shapes);
    sk.part(`${pre}surface`, `${b.label ?? ""}${b.label ? " " : ""}liquid surface`, line([[x + 1, ys], [x + w - 1, ys]], liquid));
  }
  inside?.(ys);
  sk.part(id, b.label ?? "beaker", beakerOutline(x, y, w, h, color));
  sk.at(`${pre}liquid`, [x + w / 2, (ys + y + h) / 2]).at(`${pre}surface`, [x + w / 2, ys]).at(`${pre}mouth`, [x + w / 2, y - 2]).at(`${pre}base`, [x + w / 2, y + h]);
  if (b.id) sk.at(b.id, [x + w / 2, y + h / 2]);
  return ys;
}

/** pH colours, 0 to 14: red (acid) → orange → green (neutral) → blue → purple (alkali). */
const PH = ["red", "red", "red", "orange", "orange", "orange", "green", "green", "green", "blue", "blue", "blue", "purple", "purple", "purple"];
const phColor = (ph: number) => PH[clamp(ph, 0, 14, 7)];

/** Ink axes with arrowheads from origin (x0, y0) to xEnd and yEnd. */
function axes(sk: Sketch, o: P, xEnd: number, yEnd: number, color: string) {
  sk.part("x-axis", "x axis", path(`${poly([o, [xEnd, o[1]]])} ${head([xEnd, o[1]], [1, 0], 5)}`, color));
  sk.part("y-axis", "y axis", path(`${poly([o, [o[0], yEnd]])} ${head([o[0], yEnd], [0, -1], 5)}`, color));
  sk.at("origin", o).at("x-axis", [xEnd, o[1]]).at("y-axis", [o[0], yEnd]).at("x-label", [(o[0] + xEnd) / 2, o[1] + 9]).at("y-label", [o[0] - 9, (o[1] + yEnd) / 2]);
}
/** A dashed straight line. */
const dashed = (a: P, b: P, stroke: string, dash = 6, gap = 6): Shape => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), u: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], d: string[] = [];
  for (let s = 0; s < len - 1; s += dash + gap) {
    const e = Math.min(len, s + dash);
    d.push(poly([[a[0] + u[0] * s, a[1] + u[1] * s], [a[0] + u[0] * e, a[1] + u[1] * e]]));
  }
  return path(d.join(" "), stroke, { width: 0.8 });
};

// ---- Acids and bases ----

export interface PhScaleOptions { value?: number; marker?: boolean; color?: string }
/** The pH scale: 15 coloured segments, pH 0 (red, acid) to 14 (purple, alkali), with a marker at `value` (0–14, default 7). */
export function makePhScale({ value = 7, marker = true, color = "ink" }: PhScaleOptions = {}): Block {
  const v = clampF(value, 0, 14, 7);
  const sk = new Sketch(), w = 6.2, y0 = 13, h = 24;
  for (let i = 0; i <= 14; i++) {
    const x = i * w, c = PH[i];
    sk.part(`ph-${i}`, `pH ${i}`, rect(x, y0, w, h, c, { fill: tint(c), width: 0.8 }), zig(y0 + 2, y0 + h - 2, () => x + 1.3, () => x + w - 1.3, 4, c));
    sk.at(`ph-${i}`, [x + w / 2, y0 + h / 2]).at(`above-${i}`, [x + w / 2, y0 - 7]).at(`below-${i}`, [x + w / 2, y0 + h + 7]);
  }
  sk.part("acid", "acids (pH 0-6)", ghost(0, y0, 7 * w, h)).part("neutral", "neutral (pH 7)", ghost(7 * w, y0, w, h)).part("alkali", "alkalis (pH 8-14)", ghost(8 * w, y0, 7 * w, h));
  const mx = (v + 0.5) * w;
  if (marker) {
    sk.part("marker", `marker at pH ${r1(v)}`,
      path(poly([[mx - 4.5, y0 - 12], [mx + 4.5, y0 - 12], [mx, y0 - 3]], true), color),
      path(poly([[mx - 4.5, y0 + h + 12], [mx + 4.5, y0 + h + 12], [mx, y0 + h + 3]], true), color));
  }
  sk.at("marker", [mx, y0 - 12]).at("value", [mx, y0 + h / 2]).at("acid", [3.5 * w, y0 + h / 2]).at("neutral", [7.5 * w, y0 + h / 2]).at("alkali", [11.5 * w, y0 + h / 2]);
  return finish(
    { id: "ph-scale", title: "pH Scale", describe: "the pH scale: a strip of 15 coloured segments from pH 0 (red, acid) through 7 (green, neutral) to 14 (purple, alkali), with a marker; set value (0-14) and marker (on/off); parts ph-0..ph-14, acid, neutral, alkali; anchors ph-i, above-i, below-i, marker, value", tags: ["pH", "acid", "alkali", "base", "neutral", "indicator", "scale"] },
    sk, [-1, y0 - 13, 15 * w + 1, y0 + h + 13],
  );
}
export const phScale = makePhScale();

export interface IndicatorPaperOptions { ph?: number; liquid?: string; color?: string }
/** A strip of indicator paper dipped in a beaker, its wet end coloured by `ph` (0–14, default 2). */
export function makeIndicatorPaper({ ph = 2, liquid = "grey", color = "ink" }: IndicatorPaperOptions = {}): Block {
  const p = clamp(ph, 0, 14, 2), c = phColor(p);
  const sk = new Sketch(), bx = 0, by = 40, bw = 60, bh = 58, sx = 23, sw = 14, wet = 50, end = 86;
  addBeaker(sk, { x: bx, y: by, w: bw, h: bh, fill: 0.6, liquid, color, ripples: false }, (ys) => {
    sk.part("ripples", "ripples", ripple(bx + 5, sx - 4, ys + 11, liquid), ripple(sx + sw + 4, bx + bw - 5, ys + 22, liquid));
    sk.part("strip", "indicator paper", rect(sx, 0, sw, end, color, { fill: "board", width: 0.8 }));
    sk.part("colour", `wet end, coloured for pH ${p}`, rect(sx, wet, sw, end - wet, c, { fill: tint(c), width: 0.8 }), zig(wet + 3, end - 3, () => sx + 2, () => sx + sw - 2, 4.5, c));
  });
  sk.at("strip", [sx + sw / 2, 18]).at("colour", [sx + sw / 2, (wet + end) / 2]).at("dry-end", [sx + sw / 2, 2]).at("wet-end", [sx + sw / 2, end]);
  return finish(
    { id: "indicator-paper", title: "Indicator Paper", describe: "a strip of universal indicator paper dipped in a beaker of solution, its wet end coloured by the pH (red acid, green neutral, purple alkali); set ph (0-14) and liquid; anchors strip, colour, wet-end, dry-end, liquid, surface", tags: ["indicator", "litmus", "pH", "acid", "alkali", "test"] },
    sk, [bx - 4, 0, bx + bw + 4, by + bh],
  );
}
export const indicatorPaper = makeIndicatorPaper();

/** An H atom ball and an O atom ball, by the shared element colours. */
const hAtom = (p: P, r = 10) => circle(p[0], p[1], r, "ink", { fill: "board" });
const oAtom = (p: P, r = 13) => circle(p[0], p[1], r, "red", { fill: "red-tint" });

export interface AcidBaseOptions { arrow?: boolean; color?: string }
/** H+ (from an acid) and OH− (from a base) joining into a water molecule. */
export function makeAcidBase({ arrow: showArrow = true, color = "ink" }: AcidBaseOptions = {}): Block {
  const sk = new Sketch();
  const H: P = [14, 16], O1: P = [16, 58], H1: P = [35, 64], Ow: P = [96, 34], Hw1: P = [80, 50], Hw2: P = [112, 50];
  sk.part("hydrogen-ion", "hydrogen ion H+", hAtom(H), sign(32, 3, 5, "red"));
  sk.part("hydroxide-ion", "hydroxide ion OH-", hAtom(H1), oAtom(O1), sign(47, 46, 5, "purple", true));
  if (showArrow) sk.part("arrow", "they join", arrow([51, 34], [65, 34], color, 5));
  sk.part("water", "water molecule", hAtom(Hw1), hAtom(Hw2), oAtom(Ow));
  sk.part("reactants", "H+ and OH-", ghost(2, 2, 46, 74)).part("products", "water", ghost(70, 20, 52, 42));
  sk.at("hydrogen-ion", H).at("hydroxide-ion", O1).at("water", [96, 42]).at("arrow", [58, 34])
    .at("atom-0", H).at("atom-1", O1).at("atom-2", H1).at("water-oxygen", Ow).at("water-hydrogen-0", Hw1).at("water-hydrogen-1", Hw2)
    .at("reactants", [25, 38]).at("products", [96, 42]).at("charge-plus", [32, 3]).at("charge-minus", [47, 46]);
  return finish(
    { id: "acid-base", title: "Acid Meets Base", describe: "an H+ ion (acid, red plus) and an OH- ion (base, purple minus) joining into a water molecule: the heart of neutralisation; set arrow (on/off); anchors hydrogen-ion, hydroxide-ion, water, arrow, reactants, products, charge-plus, charge-minus", tags: ["acid", "base", "neutralisation", "hydrogen ion", "hydroxide", "water", "ions"] },
    sk, [2, -4, 124, 76],
  );
}
export const acidBase = makeAcidBase();

export interface NeutralizationOptions { acid?: string; base?: string; product?: string; color?: string }
/** An acid beaker (red) plus a base beaker (purple) making a beaker of salt and water (green, with salt crystals). */
export function makeNeutralization({ acid = "red", base = "purple", product = "green", color = "ink" }: NeutralizationOptions = {}): Block {
  const sk = new Sketch(), w = 34, h = 40;
  addBeaker(sk, { x: 0, y: 4, w, h, fill: 0.55, liquid: acid, color, id: "acid", label: "acid" });
  sk.part("plus", "plus", sign(43, 18, 5, color));
  addBeaker(sk, { x: 52, y: 4, w, h, fill: 0.55, liquid: base, color, id: "base", label: "base" });
  sk.part("arrow", "makes", arrow([43, 32], [43, 58], color, 5));
  addBeaker(sk, { x: 26, y: 64, w, h, fill: 0.6, liquid: product, color, id: "product", label: "salt and water" }, () => {
    sk.part("salt", "salt crystals", crystal(35, 96, 7, 10, "grey"), crystal(44, 97, 7, -15, "grey"), crystal(52, 96, 7, 25, "grey"));
  });
  sk.part("reactants", "acid and base", ghost(-4, 0, 94, 46)).part("products", "salt and water", ghost(22, 60, 42, 46));
  sk.at("salt", [44, 96]).at("water", [43, 80]).at("plus", [43, 18]).at("arrow", [43, 45]).at("reactants", [43, 24]).at("products", [43, 84]);
  return finish(
    { id: "neutralization", title: "Neutralisation", describe: "neutralisation: a beaker of acid (red) plus a beaker of base (purple) makes a beaker of salt and water (green, salt crystals at the bottom); set acid, base and product liquid colours; parts acid, base, product with -liquid and -surface; anchors acid, base, product, salt, water, plus, arrow, reactants, products", tags: ["neutralisation", "acid", "base", "salt", "water", "reaction"] },
    sk, [-4, 0, 90, 104],
  );
}
export const neutralization = makeNeutralization();

export interface TitrationCurveOptions { strong?: boolean; color?: string }
/** A titration curve: pH against volume of base added, flat then a steep jump at the equivalence point. `strong` acid (default) or weak. */
export function makeTitrationCurve({ strong = true, color = "blue" }: TitrationCurveOptions = {}): Block {
  const sk = new Sketch(), o: P = [10, 76];
  const X = (v: number) => 16 + 78 * v, Y = (ph: number) => 72 - 4.5 * ph;
  const before = (v: number) => (strong ? -Math.log10(0.1 * (0.5 - v) / 0.5 + 1e-7) : 4.75 + Math.log10((v + 0.012) / (0.5 - v + 0.002)));
  const after = (v: number) => 13 + Math.log10(Math.max(0.005, (v - 0.5) * 2));
  const vs = [...Array.from({ length: 24 }, (_, i) => i * 0.02), 0.48, 0.49, 0.495, 0.505, 0.51, 0.52, 0.55, 0.6, 0.7, 0.8, 0.9, 1];
  const pts: P[] = vs.map((v) => [X(v), Y(v < 0.5 ? before(v) : after(v))]);
  axes(sk, o, 98, 2, "ink");
  sk.part("neutral", "pH 7 line", dashed([o[0] + 4, Y(7)], [96, Y(7)], "grey"));
  sk.part("curve", strong ? "titration curve, strong acid" : "titration curve, weak acid", path(smooth(pts), color));
  const eq: P = [X(0.5), Y(strong ? 7 : 8.7)];
  sk.part("equivalence", "equivalence point", circle(eq[0], eq[1], 3, color, { fill: "board" }));
  sk.at("equivalence", eq).at("jump", eq).at("start", pts[0]).at("end", pts[pts.length - 1]).at("neutral", [96, Y(7)])
    .at("acid-region", [X(0.22), Y(before(0.22)) - 9]).at("alkali-region", [X(0.8), Y(after(0.8)) + 9]);
  if (!strong) sk.at("buffer", [X(0.25), Y(before(0.25))]);
  return finish(
    { id: "titration-curve", title: "Titration Curve", describe: "a titration curve: pH (up) against volume of base added (across), flat then a steep jump at the equivalence point, with a dashed pH 7 line; set strong (true: strong acid, jump through 7; false: weak acid, starts higher with a buffer region, jump above 7); anchors equivalence, start, end, neutral, buffer, origin, x-axis, y-axis", tags: ["titration", "pH", "curve", "equivalence point", "acid", "base", "graph"] },
    sk, [2, 0, 100, 84],
  );
}
export const titrationCurve = makeTitrationCurve();

// ---- Solutions ----

/** Particle spots in a grid over a box, rows offset, a little jitter: candidates for `spread`. */
function grid(x0: number, x1: number, ys: number[], cols: number, jitter = 2.5): P[] {
  const out: P[] = [];
  ys.forEach((y, r) => {
    for (let c = 0; c < cols; c++) {
      const t = cols === 1 ? 0.5 : c / (cols - 1), j = ((c * 7 + r * 3) % 5) - 2;
      out.push([x0 + (x1 - x0) * t + (r % 2 ? jitter : -jitter), y + j]);
    }
  });
  return out;
}

export interface ConcentrationOptions { n?: number; liquid?: string; solute?: string; color?: string }
/** A beaker of solution with `n` solute particles (0–15, default 5): few for dilute, many for concentrated. */
export function makeConcentration({ n = 5, liquid = "blue", solute = "blue", color = "ink" }: ConcentrationOptions = {}): Block {
  n = clamp(n, 0, 15, 5);
  const sk = new Sketch(), x = 0, y = 0, w = 96, h = 86;
  const spots = spread(grid(15, 81, [44, 59, 74], 5), n, [48, 59]);
  addBeaker(sk, { x, y, w, h, fill: 0.82, liquid, color, ripples: false }, (ys) => {
    sk.part("ripples", "ripples", ripple(10, 40, ys + 11, liquid), ripple(56, 86, ys + 11, liquid));
    spots.forEach((p, i) => sk.part(`particle-${i}`, `solute particle ${i}`, dot(p, 3.4, solute)).at(`particle-${i}`, p));
  });
  sk.part("solution", "solution", ghost(4, 20, 88, 62)).at("solution", [48, 59]);
  return finish(
    { id: "concentration", title: "Concentration", describe: "a beaker of solution with n solute particles dissolved in it: few for dilute, many for concentrated (place two side by side to compare); set n (0-15), liquid and solute colours; anchors particle-i, solution, liquid, surface, mouth, base", tags: ["concentration", "solution", "dilute", "concentrated", "solute", "particles"] },
    sk, [-4, -3, 100, 86],
  );
}
export const concentration = makeConcentration();

export interface SolubilityCurveOptions { curves?: number; color?: string }
/** Solubility against temperature: `curves` (1–3, default 2) rising curves, blue steep, orange gentle, green nearly flat. */
export function makeSolubilityCurve({ curves = 2, color = "blue" }: SolubilityCurveOptions = {}): Block {
  const n = clamp(curves, 1, 3, 2);
  const sk = new Sketch(), o: P = [10, 76];
  axes(sk, o, 98, 2, "ink");
  const colors = color === "blue" ? ["blue", "orange", "green"] : [color, color === "orange" ? "blue" : "orange", "green"];
  const shapes = [(t: number) => 0.08 + 0.9 * t ** 2.1, (t: number) => 0.24 + 0.42 * t, (t: number) => 0.58 + 0.06 * t];
  const X = (t: number) => 16 + 78 * t, Y = (s: number) => 72 - 64 * s;
  for (let i = 0; i < n; i++) {
    const pts: P[] = Array.from({ length: 13 }, (_, k) => [X(k / 12), Y(shapes[i](k / 12))]);
    sk.part(`curve-${i}`, `solubility curve ${i}`, path(smooth(pts), colors[i]));
    sk.at(`curve-${i}`, pts[12]).at(`curve-${i}-start`, pts[0]).at(`curve-${i}-mid`, pts[6]);
  }
  const m: P = [X(0.6), Y(shapes[0](0.6))];
  sk.at("above", [m[0] - 10, m[1] - 10]).at("below", [m[0] + 10, m[1] + 12]);
  return finish(
    { id: "solubility-curve", title: "Solubility Curve", describe: "solubility curves: how much solute dissolves (up) against temperature (across); set curves (1-3): blue rises steeply, orange gently, green is nearly flat; anchors curve-i (the hot end), curve-i-start, curve-i-mid, above (saturated beyond the line) and below (unsaturated) curve 0, origin, x-axis, y-axis", tags: ["solubility", "curve", "temperature", "saturated", "solution", "graph"] },
    sk, [2, 0, 100, 84],
  );
}
export const solubilityCurve = makeSolubilityCurve();

export interface SaturatedSolutionOptions { solid?: number; dissolved?: number; liquid?: string; solute?: string; color?: string }
/** A saturated solution: `dissolved` particles (0–8, default 5) in the liquid and a pile of undissolved solid `solid` rows high (1–3, default 2) at the bottom. */
export function makeSaturatedSolution({ solid = 2, dissolved = 5, liquid = "blue", solute = "blue", color = "ink" }: SaturatedSolutionOptions = {}): Block {
  solid = clamp(solid, 1, 3, 2);
  dissolved = clamp(dissolved, 0, 8, 5);
  const sk = new Sketch(), w = 90, h = 90, c = 11;
  const free: P[] = [[16, 40], [42, 38], [66, 42], [80, 34], [18, 54], [74, 54], [10, 70], [80, 70]];
  addBeaker(sk, { x: 0, y: 0, w, h, fill: 0.8, liquid, color, ripples: false }, (ys) => {
    sk.part("ripples", "ripples", ripple(10, 42, ys + 10, liquid), ripple(50, 80, ys + 10, liquid));
    spread(free, dissolved, [45, 40]).forEach((p, i) => sk.part(`particle-${i}`, `dissolved particle ${i}`, dot(p, 3.4, solute)).at(`particle-${i}`, p));
    const crystals: Shape[] = [];
    for (let r = 0; r < solid; r++) {
      const k = 5 - r, y0 = h - 1 - c * (r + 1);
      for (let j = 0; j < k; j++) crystals.push(rect(w / 2 - (k * c) / 2 + j * c, y0, c, c, solute, { fill: tint(solute), width: 0.8 }));
    }
    sk.part("solid", "undissolved solid", ...crystals);
  });
  sk.at("solid", [w / 2, h - 1 - (c * solid) / 2]).at("dissolved", [42, 46]).part("solution", "saturated solution", ghost(4, 22, w - 8, h - 24 - c * solid));
  return finish(
    { id: "saturated-solution", title: "Saturated Solution", describe: "a saturated solution: a beaker with some dissolved particles in the liquid and a pile of undissolved solid crystals at the bottom (no more will dissolve); set solid (1-3 rows), dissolved (0-8 particles), liquid and solute colours; anchors solid, dissolved, particle-i, liquid, surface, mouth, base", tags: ["saturated", "solution", "solubility", "undissolved", "solute", "crystals"] },
    sk, [-4, -3, w + 4, h],
  );
}
export const saturatedSolution = makeSaturatedSolution();

export interface MixtureCompoundOptions { kind?: "element" | "compound" | "mixture"; color?: string }
/** A box of particles: an `element` (single blue atoms), a `compound` (identical two-atom molecules) or a `mixture` of both. */
export function makeMixtureCompound({ kind = "mixture", color = "ink" }: MixtureCompoundOptions = {}): Block {
  const k = pick(kind, ["element", "compound", "mixture"] as const, "mixture");
  const sk = new Sketch(), W = 112, H = 84;
  const at: P[] = [[24, 22], [57, 19], [89, 25], [26, 62], [58, 64], [88, 60]];
  const turn = [20, -35, 60, -10, 40, -55];
  sk.part("box", "container", rect(0, 0, W, H, color, { r: 3 }));
  at.forEach((p, i) => {
    const molecule = k === "compound" || (k === "mixture" && i % 2 === 1);
    if (!molecule) {
      sk.part(`particle-${i}`, `atom ${i}`, circle(p[0], p[1], 9, "blue", { fill: "blue-tint" })).at(`particle-${i}`, p);
      return;
    }
    const a = (turn[i] * Math.PI) / 180, d = 7.5;
    const p0: P = [p[0] - Math.cos(a) * d, p[1] - Math.sin(a) * d], p1: P = [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d];
    sk.part(`particle-${i}`, `molecule ${i}`, circle(p0[0], p0[1], 8.5, "ink", { fill: "grey-tint" }), circle(p1[0], p1[1], 8.5, "red", { fill: "red-tint" }));
    sk.at(`particle-${i}`, p).at(`atom-${i}-0`, p0).at(`atom-${i}-1`, p1);
  });
  return finish(
    { id: "mixture-compound", title: k === "element" ? "Element" : k === "compound" ? "Compound" : "Mixture", describe: "a box of particles to compare kinds of matter: element (identical single atoms), compound (identical molecules of two different atoms bonded) or mixture (single atoms and molecules mixed, not bonded); set kind (element, compound, mixture); anchors particle-i, atom-i-0 and atom-i-1 in molecules", tags: ["element", "compound", "mixture", "particles", "atoms", "molecules", "matter"] },
    sk, [0, 0, W, H],
  );
}
export const mixtureCompound = makeMixtureCompound();

// ---- Separation ----

/** A conical (Erlenmeyer) flask: neck c±nw/2 from y0 to yN, body widening to c±bw at yB. Returns the outline and the half-width at y. */
function conical(c: number, y0: number, nw: number, yN: number, bw: number, yB: number, color: string) {
  const hn = nw / 2, r = 5;
  const half = (y: number) => (y <= yN ? hn : hn + ((bw - hn) * (y - yN)) / (yB - yN));
  const shape = path(
    `M${c - hn - 3} ${y0 - 2} L${c - hn} ${y0} L${c - hn} ${yN} L${c - bw + 1.5} ${yB - r} Q${c - bw} ${yB} ${c - bw + r} ${yB} L${c + bw - r} ${yB} Q${c + bw} ${yB} ${c + bw - 1.5} ${yB - r} L${c + hn} ${yN} L${c + hn} ${y0} L${c + hn + 3} ${y0 - 2}`,
    color,
  );
  return { shape, half };
}
/** Liquid in a conical flask from ys down to the bottom: a pale fill, the surface and a ripple. */
function conicalLiquid(sk: Sketch, c: number, half: (y: number) => number, ys: number, yB: number, liquid: string, id = "liquid", label = "liquid") {
  sk.part(id, label, region([[c - half(ys), ys], [c - half(yB), yB], [c + half(yB), yB], [c + half(ys), ys]], tint(liquid)),
    ...(yB - ys >= 16 ? [ripple(c - half(ys + 10) * 0.55, c + half(ys + 10) * 0.55, ys + 10, liquid)] : []));
  sk.part(id === "liquid" ? "surface" : `${id}-surface`, `${label} surface`, line([[c - half(ys) + 1, ys], [c + half(ys) - 1, ys]], liquid));
  sk.at(id, [c, (ys + yB) / 2]).at(id === "liquid" ? "surface" : `${id}-surface`, [c, ys]);
}

export interface FiltrationOptions { liquid?: string; residue?: string; color?: string }
/** Filtration: a funnel lined with filter paper over a conical flask; solid residue in the paper, filtrate dripping into the flask. */
export function makeFiltration({ liquid = "blue", residue = "brown", color = "ink" }: FiltrationOptions = {}): Block {
  const sk = new Sketch(), c = 50;
  const flask = conical(c, 58, 28, 70, 34, 100, color);
  conicalLiquid(sk, c, flask.half, 80, 100, liquid, "filtrate", "filtrate");
  sk.part("flask", "conical flask", flask.shape);
  sk.part("paper", "filter paper", path(poly([[26, 6], [c, 32], [74, 6]]), "grey", { width: 0.8 }));
  const py = (y: number) => (24 * (32 - y)) / 26;
  sk.part("residue", "residue", zig(17, 28, (y) => c - py(y) + 2.5, (y) => c + py(y) - 2.5, 4, residue));
  sk.part("funnel", "funnel", path(`${poly([[6, 2], [c, 46], [94, 2]])} ${poly([[c, 46], [c, 67]])}`, color));
  sk.part("drip", "drip of filtrate", path(`M${c} 71 C${c + 3} 75 ${c + 3} 78 ${c} 78 C${c - 3} 78 ${c - 3} 75 ${c} 71 Z`, liquid, { fill: tint(liquid) }));
  sk.at("funnel", [16, 14]).at("paper", [70, 12]).at("residue", [c, 22]).at("stem", [c, 56]).at("drip", [c, 74]).at("flask", [c, 76]).at("mouth", [c, 2]).at("base", [c, 100]).at("mixture", [c, -4]);
  return finish(
    { id: "filtration", title: "Filtration", describe: "filtration: a funnel lined with filter paper over a conical flask; the solid residue stays in the paper and the liquid filtrate drips through into the flask; set liquid and residue colours; anchors funnel, paper, residue, stem, drip, filtrate, filtrate-surface, flask, mouth (pour the mixture in here), base", tags: ["filtration", "separation", "filter", "residue", "filtrate", "mixture"] },
    sk, [4, 0, 96, 100],
  );
}
export const filtration = makeFiltration();

/** A round-bottomed flask outline: circle (cx, cy, r) with a neck nw wide up to neckTop. */
function roundFlask(cx: number, cy: number, r: number, nw: number, neckTop: number, color: string): Shape {
  const a = Math.asin(nw / 2 / r), N = 30, pts: P[] = [[cx + nw / 2, neckTop]];
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + a + (i * (2 * Math.PI - 2 * a)) / N;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  pts.push([cx - nw / 2, neckTop]);
  return line(pts, color);
}
/** The part of a circle below the line y = ys, as a polygon. */
function circleBelow(cx: number, cy: number, r: number, ys: number): P[] {
  const t0 = Math.asin(Math.max(-1, Math.min(1, (ys - cy) / r))), pts: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = t0 + (i * (Math.PI - 2 * t0)) / 16;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

export interface DistillationOptions { liquid?: string; color?: string }
/** Simple distillation: a round flask heated by a flame, a sloping water-cooled condenser, and a beaker collecting the distillate. */
export function makeDistillation({ liquid = "blue", color = "ink" }: DistillationOptions = {}): Block {
  const sk = new Sketch(), F: P = [18, 40], R = 14, ys = 45;
  const a: P = [23, 15], b: P = [78, 43], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: P = [-u[1], u[0]];
  const along = (t: number, off = 0): P => [a[0] + u[0] * t + n[0] * off, a[1] + u[1] * t + n[1] * off];
  const j0 = 10, j1 = len - 10, jw = 8;
  const half = Math.sqrt(R * R - (ys - F[1]) ** 2);
  sk.part("liquid", "mixture", region(circleBelow(F[0], F[1], R, ys), tint(liquid)));
  sk.part("surface", "liquid surface", line([[F[0] - half + 1, ys], [F[0] + half - 1, ys]], liquid));
  sk.part("flask", "round-bottomed flask", roundFlask(F[0], F[1], R, 10, 8, color), line([[11, 8], [25, 8]], color));
  sk.part("flame", "flame", ...flame(F[0], 74, 15, 19));
  sk.part("receiver", "collecting beaker", beakerOutline(68, 48, 22, 28, color));
  sk.part("distillate", "distillate", rect(68, 64, 22, 12, undefined, { fill: tint(liquid), r: 4 }), line([[69, 64], [89, 64]], liquid));
  sk.part("tube", "delivery tube", line([[F[0] + 5, 15], a, along(j0)], color), line([along(j1), b, [78, 57]], color));
  sk.part("condenser", "condenser", path(poly([along(j0, -jw), along(j1, -jw), along(j1, jw), along(j0, jw)], true), color));
  const wIn = along(j1 - 7, jw), wOut = along(j0 + 7, -jw);
  sk.part("water-in", "cold water in", line([wIn, [wIn[0], wIn[1] + 8]], color));
  sk.part("water-out", "water out", line([wOut, [wOut[0], wOut[1] - 8]], color));
  sk.at("flask", F).at("liquid", [F[0], 49]).at("flame", [F[0], 66]).at("heat", [F[0], 66]).at("vapour", [F[0], 13])
    .at("condenser", along(len / 2)).at("water-in", [wIn[0], wIn[1] + 8]).at("water-out", [wOut[0], wOut[1] - 8])
    .at("receiver", [79, 58]).at("distillate", [79, 70]).at("drip", [78, 58]).at("mouth", [F[0], 8]).at("base", [F[0], 74]);
  return finish(
    { id: "distillation", title: "Distillation", describe: "simple distillation: a round flask of mixture heated by a flame; vapour rises, cools in a sloping water-jacketed condenser and drips into a collecting beaker as distillate; set liquid; anchors flask, liquid, surface, flame, vapour, condenser, water-in, water-out, receiver, distillate, drip", tags: ["distillation", "separation", "condenser", "evaporation", "condensation", "boiling point"] },
    sk, [2, 4, 94, 76],
  );
}
export const distillation = makeDistillation();

export interface EvaporationOptions { fill?: number; crystals?: number; steam?: boolean; liquid?: string; solute?: string; color?: string }
/** Evaporation: an evaporating dish on a tripod over a burner flame; liquid `fill` (0–1, default 0.4), `crystals` (0–5, default 3), steam rising. */
export function makeEvaporation({ fill = 0.4, crystals = 3, steam = true, liquid = "blue", solute = "blue", color = "ink" }: EvaporationOptions = {}): Block {
  fill = clampF(fill, 0, 1, 0.4);
  crystals = clamp(crystals, 0, 5, 3);
  const sk = new Sketch(), cx = 50, ry0 = 26, rx = 33, ry = 22;
  const bowlY = (x: number) => ry0 + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
  const bowlX = (y: number) => rx * Math.sqrt(Math.max(0, 1 - ((y - ry0) / ry) ** 2));
  if (steam) {
    for (let i = 0; i < 2; i++) {
      const x = 40 + i * 20, pts: P[] = Array.from({ length: 6 }, (_, k) => [x + (k % 2 ? 3.5 : -3.5) * (i ? -1 : 1), 21 - k * 4]);
      sk.part(`steam-${i}`, `steam ${i}`, path(smooth(pts), "grey", { width: 0.8 })).at(`steam-${i}`, [x, 0]);
    }
  }
  const ys = ry0 + ry - fill * (ry - 3);
  if (fill > 0.03) {
    sk.part("liquid", "solution", region(circleBelowEllipse(cx, ry0, rx, ry, ys), tint(liquid)));
    sk.part("surface", "liquid surface", line([[cx - bowlX(ys) + 1.5, ys], [cx + bowlX(ys) - 1.5, ys]], liquid));
  }
  const cs: Shape[] = [];
  for (let i = 0; i < crystals; i++) {
    const x = cx + (i - (crystals - 1) / 2) * 12;
    const y = bowlY(x) - 6.5;
    cs.push(crystal(x, y, 8.5, [12, -18, 30, -8, 20][i], solute));
    sk.at(`crystal-${i}`, [x, y]);
  }
  if (crystals) sk.part("crystals", "crystals", ...cs);
  const bowl: P[] = Array.from({ length: 17 }, (_, i) => {
    const t = (i / 16) * Math.PI;
    return [cx + rx * Math.cos(t), ry0 + ry * Math.sin(t)];
  });
  sk.part("dish", "evaporating dish", path(`M${cx + rx + 4} ${ry0 - 2} ${poly(bowl).replace(/^M/, "L")} L${cx - rx - 4} ${ry0 - 2}`, color));
  sk.part("gauze", "gauze", line([[10, 52], [90, 52]], "grey"));
  sk.part("tripod", "tripod", line([[18, 52], [10, 96]], color), line([[82, 52], [90, 96]], color));
  sk.part("flame", "flame", ...flame(cx, 80, 16, 20));
  sk.part("burner", "Bunsen burner", rect(cx - 6, 80, 12, 15, color, { fill: "grey-tint" }), rect(cx - 15, 95, 30, 5, color, { fill: "grey-tint", r: 2 }));
  sk.at("dish", [cx, 40]).at("liquid", [cx, (ys + ry0 + ry) / 2]).at("surface", [cx, ys]).at("crystals", [cx, ry0 + ry - 5]).at("steam", [cx, 2])
    .at("gauze", [14, 52]).at("flame", [cx, 70]).at("heat", [cx, 70]).at("burner", [cx, 90]).at("mouth", [cx, ry0]).at("base", [cx, 100]);
  return finish(
    { id: "evaporation", title: "Evaporation", describe: "evaporation to get crystals: an evaporating dish of solution on a gauze and tripod over a Bunsen flame, steam rising and crystals forming; set fill (0-1 liquid left), crystals (0-5), steam (on/off), liquid and solute colours; anchors dish, liquid, surface, crystals, crystal-i, steam, gauze, flame, burner", tags: ["evaporation", "crystallisation", "crystals", "separation", "heating", "solution"] },
    sk, [6, 0, 94, 100],
  );
}
/** The part of an ellipse's lower half below y = ys, as a polygon. */
function circleBelowEllipse(cx: number, cy: number, rx: number, ry: number, ys: number): P[] {
  const t0 = Math.asin(Math.max(0, Math.min(1, (ys - cy) / ry))), pts: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = t0 + (i * (Math.PI - 2 * t0)) / 16;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}
export const evaporation = makeEvaporation();

const SPOT_COLORS = ["red", "blue", "green", "purple"];
export interface ChromatographyOptions { spots?: number; heights?: number[]; solvent?: string; color?: string }
/** Paper chromatography: paper hanging in a beaker of solvent, `spots` (1–4, default 3) that have risen to `heights` (0–1 of the way to the solvent front). */
export function makeChromatography({ spots = 3, heights, solvent = "blue", color = "ink" }: ChromatographyOptions = {}): Block {
  spots = clamp(spots, 1, 4, 3);
  const dflt = [0.82, 0.5, 0.24, 0.66];
  const hs = Array.from({ length: spots }, (_, i) => clampF(Array.isArray(heights) ? heights[i] : undefined, 0, 1, dflt[i]));
  const sk = new Sketch(), px0 = 18, px1 = 82, base = 76, front = 24, ys = 86;
  sk.part("solvent", "solvent", rect(4, ys, 92, 100 - ys, undefined, { fill: tint(solvent), r: 4 }));
  sk.part("paper", "chromatography paper", rect(px0, 10, px1 - px0, 84, color, { fill: "board", width: 0.8 }));
  sk.part("surface", "solvent surface", line([[5, ys], [95, ys]], solvent));
  sk.part("baseline", "pencil start line", line([[px0 + 3, base], [px1 - 3, base]], "grey", 0.8));
  sk.part("front", "solvent front", dashed([px0 + 3, front], [px1 - 3, front], solvent, 5, 5));
  hs.forEach((h, i) => {
    const x = px0 + ((px1 - px0) * (i + 0.5)) / spots, y = base - h * (base - front);
    sk.part(`spot-${i}`, `spot ${i}`, circle(x, y, 4, SPOT_COLORS[i], { fill: tint(SPOT_COLORS[i]) }));
    sk.at(`spot-${i}`, [x, y]).at(`origin-${i}`, [x, base]).at(`lane-${i}`, [x, 98]);
  });
  sk.part("beaker", "beaker", beakerOutline(4, 14, 92, 86, color));
  sk.part("rod", "rod holding the paper", line([[0, 10], [100, 10]], color));
  sk.at("paper", [px0 + 6, 50]).at("baseline", [px1 - 2, base]).at("front", [px1 - 2, front]).at("solvent", [10, 93]).at("surface", [10, ys]).at("rod", [96, 10]).at("mouth", [50, 12]).at("base", [50, 100]);
  return finish(
    { id: "chromatography", title: "Chromatography", describe: "paper chromatography: paper hanging from a rod into a beaker of solvent; coloured spots have risen from the pencil start line toward the dashed solvent front; set spots (1-4: red, blue, green, purple) and heights (0-1 of the way to the front); anchors spot-i, origin-i, baseline, front, solvent, surface, paper, rod", tags: ["chromatography", "separation", "solvent", "Rf value", "dyes", "paper"] },
    sk, [0, 8, 100, 100],
  );
}
export const chromatography = makeChromatography();

export interface SeparatingFunnelOptions { split?: number; top?: string; bottom?: string; color?: string }
/** A separating funnel with two layers that don't mix: a `top` layer (orange, like oil) over a `bottom` layer (blue, like water); `split` is the top layer's share (0.25–0.75, default 0.45). */
export function makeSeparatingFunnel({ split = 0.45, top = "orange", bottom = "blue", color = "ink" }: SeparatingFunnelOptions = {}): Block {
  split = clampF(split, 0.25, 0.75, 0.45);
  const sk = new Sketch(), c = 50;
  const prof: P[] = [[5, 14], [14, 20], [26, 31], [30, 42], [26, 53], [14, 65], [6, 74], [5, 78]];
  const hw = (y: number) => {
    for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) {
      const [w0, y0] = prof[i - 1], [w1, y1] = prof[i];
      return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
    }
    return 4;
  };
  const yt = 24, yb = 78, yi = yt + split * (yb - yt);
  const layer = (ya: number, yb2: number): P[] => {
    const ys = Array.from({ length: 9 }, (_, k) => ya + ((yb2 - ya) * k) / 8);
    return [...ys.map((y): P => [c - hw(y), y]), ...ys.reverse().map((y): P => [c + hw(y), y])];
  };
  const mid = (ya: number, yb2: number) => (ya + yb2) / 2;
  sk.part("top-layer", "top layer", region(layer(yt, yi), tint(top)), ...(yi - yt >= 16 ? [ripple(c - hw(mid(yt, yi) + 2) * 0.55, c + hw(mid(yt, yi) + 2) * 0.55, mid(yt, yi) + 2, top)] : []));
  sk.part("bottom-layer", "bottom layer", region([...layer(yi, yb), [c + 4, 86], [c - 4, 86]], tint(bottom)),
    ...(yb - yi >= 18 ? [ripple(c - hw(mid(yi, yb)) * 0.55, c + hw(mid(yi, yb)) * 0.55, mid(yi, yb), bottom)] : []));
  sk.part("surface", "top surface", line([[c - hw(yt) + 1.5, yt], [c + hw(yt) - 1.5, yt]], top));
  sk.part("boundary", "boundary between the layers", line([[c - hw(yi) + 1.5, yi], [c + hw(yi) - 1.5, yi]], bottom));
  const side = (s: number) => smooth([[c + s * 5, 8], ...prof.map(([w, y]): P => [c + s * w, y]), [c + s * 4, 100]]);
  sk.part("funnel", "separating funnel", path(`${side(-1)} ${side(1)}`, color));
  sk.part("stopper", "stopper", rect(c - 6, 0, 12, 8, color, { fill: "grey-tint", r: 2 }));
  sk.part("tap", "tap", rect(c - 12, 86, 24, 6, color, { fill: "grey-tint", r: 2 }));
  sk.at("top-layer", [c, mid(yt, yi)]).at("bottom-layer", [c, mid(yi, yb)]).at("surface", [c, yt]).at("boundary", [c, yi]).at("tap", [c + 12, 89])
    .at("stopper", [c, 0]).at("outlet", [c, 100]).at("mouth", [c, 0]).at("base", [c, 100]).at("funnel", [c + 30, 42]);
  return finish(
    { id: "separating-funnel", title: "Separating Funnel", describe: "a separating funnel holding two liquids that don't mix (immiscible): a top layer (orange, like oil) floating on a bottom layer (blue, like water), with a stopper and a tap to run off the bottom layer; set split (0.25-0.75 share of the top layer), top and bottom colours; anchors top-layer, bottom-layer, surface, boundary, tap, outlet, stopper", tags: ["separating funnel", "immiscible", "layers", "separation", "oil and water", "density"] },
    sk, [c - 32, 0, c + 32, 100],
  );
}
export const separatingFunnel = makeSeparatingFunnel();

export interface CentrifugeOptions { sediment?: number; spinning?: boolean; liquid?: string; solid?: string; color?: string }
/** A centrifuge rotor: two tubes spun out sideways round a hub, solid `sediment` (0–1, default 0.35) packed at their far ends, spin arrows. */
export function makeCentrifuge({ sediment = 0.35, spinning = true, liquid = "blue", solid = "brown", color = "ink" }: CentrifugeOptions = {}): Block {
  sediment = clampF(sediment, 0, 1, 0.35);
  const sk = new Sketch(), cy = 33, h = 11, x0 = 59, x1 = 98;
  sk.part("hub", "rotor hub", circle(50, cy, 6, color, { fill: "grey-tint" }));
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const X = (x: number) => 50 + s * (x - 50);
    const ls = 68, sedEnd = x1 - 3 - sediment * 20;
    sk.part(`liquid-${i}`, `liquid in tube ${i}`, rect(Math.min(X(ls), X(x1 - 2)), cy - h + 1, Math.abs(X(x1 - 2) - X(ls)), 2 * h - 2, undefined, { fill: tint(liquid) }),
      line([[X(ls), cy - h + 2], [X(ls), cy + h - 2]], liquid));
    if (sediment > 0.02) sk.part(`sediment-${i}`, `sediment in tube ${i}`, path(poly(Array.from({ length: Math.max(2, Math.round((x1 - 3 - sedEnd) / 4) + 1) }, (_, k): P => [X(sedEnd + k * 4), k % 2 ? cy + h - 2.5 : cy - h + 2.5])), solid, { width: 0.8 }));
    sk.part(`tube-${i}`, `tube ${i}`, path(`M${X(x0)} ${cy - h - 3} L${X(x0)} ${cy - h} L${X(x1 - 7)} ${cy - h} Q${X(x1)} ${cy - h} ${X(x1)} ${cy} Q${X(x1)} ${cy + h} ${X(x1 - 7)} ${cy + h} L${X(x0)} ${cy + h} L${X(x0)} ${cy + h + 3}`, color));
    sk.part(`arm-${i}`, `arm ${i}`, line([[X(56), cy], [X(x0), cy]], color));
    sk.at(`tube-${i}`, [X(78), cy]).at(`liquid-${i}`, [X(74), cy]).at(`sediment-${i}`, [X(x1 - 6), cy]).at(`end-${i}`, [X(x1), cy]);
  }
  if (spinning) {
    sk.part("spin", "spinning", path(`M28 6 Q50 -6 72 6 ${head([72, 6], [22, 12], 5)}`, color), path(`M72 60 Q50 72 28 60 ${head([28, 60], [-22, -12], 5)}`, color));
  }
  sk.at("hub", [50, cy]).at("spin", [50, 0]).at("sediment", [92, cy]).at("liquid", [74, cy]);
  return finish(
    { id: "centrifuge", title: "Centrifuge", describe: "a centrifuge seen from above: two tubes spun round a hub (spin arrows) so the solid sediment is packed at the far end of each tube, liquid above it; set sediment (0-1), spinning (arrows on/off), liquid and solid colours; anchors hub, tube-i, liquid-i, sediment-i, end-i, spin", tags: ["centrifuge", "sediment", "separation", "spinning", "suspension", "density"] },
    sk, [0, -2, 100, 68],
  );
}
export const centrifuge = makeCentrifuge();

// ---- Gases ----

export interface GasSyringeOptions { volume?: number; particles?: number; color?: string }
/** A gas syringe with the piston pulled out to `volume` (0–1, default 0.6), `particles` (0–8, default 4) of gas inside. */
export function makeGasSyringe({ volume = 0.6, particles = 4, color = "ink" }: GasSyringeOptions = {}): Block {
  volume = clampF(volume, 0, 1, 0.6);
  particles = clamp(particles, 0, 8, 4);
  const sk = new Sketch(), L = 86, xp = 16 + volume * (L - 24), ticks = [24, 38, 52, 66];
  sk.part("nozzle", "nozzle", line([[0, 20], [10, 20]], color));
  sk.part("barrel", "barrel", path(poly([[L, 0], [10, 0], [10, 40], [L, 40]]), color), line([[L, -8], [L, 48]], color));
  sk.part("scale", "scale marks", path(ticks.map((x) => poly([[x, 0], [x, -7]])).join(" "), color, { width: 0.8 }));
  ticks.forEach((x, i) => sk.at(`tick-${i}`, [x, -7]));
  if (volume > 0.05 && particles) {
    // A zigzag between two rows keeps neighbours apart however tight the gas is squeezed.
    const W = xp - 18;
    for (let i = 0; i < particles; i++) {
      const q: P = [17 + (W * (i + 0.5)) / particles, i % 2 ? 28 : 12];
      sk.part(`particle-${i}`, `gas particle ${i}`, dot(q, 3, "blue")).at(`particle-${i}`, q);
    }
  }
  sk.part("piston", "piston", rect(xp, 2, 6, 36, color, { fill: "grey-tint" }));
  sk.part("plunger", "plunger", line([[xp + 6, 20], [xp + 28, 20]], color), line([[xp + 28, 7], [xp + 28, 33]], color));
  sk.at("piston", [xp + 3, 20]).at("gas", [(10 + xp) / 2, 20]).at("handle", [xp + 28, 20]).at("nozzle", [0, 20]).at("barrel", [48, 0]).at("mouth", [0, 20]);
  return finish(
    { id: "gas-syringe", title: "Gas Syringe", describe: "a gas syringe: a barrel with scale marks, gas particles inside and a piston pulled out to the volume collected; set volume (0-1, 0 empty) and particles (0-8); the box stays the same size so volumes compare; anchors nozzle (gas comes in here), gas, piston, handle, barrel, tick-i, particle-i", tags: ["gas syringe", "volume", "gas", "piston", "rate of reaction", "measuring"] },
    sk, [0, -8, L + 30, 48],
  );
}
export const gasSyringe = makeGasSyringe();

export interface GasPressureOptions { pressure?: number; color?: string }
/** Gas in a sealed box: `pressure` (1–5, default 2) sets how many particles there are and how many hit the walls (tick marks). */
export function makeGasPressure({ pressure = 2, color = "ink" }: GasPressureOptions = {}): Block {
  const p = clamp(pressure, 1, 5, 2);
  const sk = new Sketch(), W = 100, H = 76;
  sk.part("container", "container", rect(0, 0, W, H, color, { r: 3 }));
  const all: { at: P; out: P }[] = [
    { at: [30, 0], out: [0, -1] }, { at: [W, 44], out: [1, 0] }, { at: [64, H], out: [0, 1] }, { at: [0, 26], out: [-1, 0] },
    { at: [74, 0], out: [0, -1] }, { at: [W, 16], out: [1, 0] }, { at: [24, H], out: [0, 1] }, { at: [0, 56], out: [-1, 0] },
  ];
  const hits = all.slice(0, [2, 3, 4, 6, 8][p - 1]);
  const inner = spread(grid(26, 74, [20, 38, 56], 4, 3), [3, 5, 7, 9, 12][p - 1], [50, 38]);
  let k = 0;
  for (const q of inner) sk.part(`particle-${k}`, `gas particle ${k}`, dot(q, 3.4, "blue")).at(`particle-${k++}`, q);
  hits.forEach(({ at, out }, i) => {
    const q: P = [at[0] - out[0] * 9, at[1] - out[1] * 9];
    sk.part(`particle-${k}`, `gas particle ${k}, hitting the wall`, dot(q, 3.4, "blue")).at(`particle-${k++}`, q);
    const v: P = [-out[1], out[0]], d: string[] = [];
    for (const s of [-1, 0, 1]) {
      const dir: P = [out[0] + v[0] * s * 0.8, out[1] + v[1] * s * 0.8];
      d.push(poly([[at[0] + dir[0] * 5, at[1] + dir[1] * 5], [at[0] + dir[0] * 11, at[1] + dir[1] * 11]]));
    }
    sk.part(`hit-${i}`, `wall hit ${i}`, path(d.join(" "), "orange", { width: 0.8 })).at(`hit-${i}`, [at[0] + out[0] * 9, at[1] + out[1] * 9]);
  });
  sk.part("gas", "gas", ghost(6, 6, W - 12, H - 12)).at("gas", [W / 2, H / 2]).at("wall", [W, H / 2]);
  return finish(
    { id: "gas-pressure", title: "Gas Pressure", describe: "gas pressure: a sealed box of gas particles, some hitting the walls (orange tick marks); higher pressure means more particles and more hits; set pressure (1-5); anchors particle-i, hit-i (outside the wall), gas, wall, container", tags: ["gas", "pressure", "particles", "collisions", "kinetic theory", "container"] },
    sk, [-12, -12, W + 12, H + 12],
  );
}
export const gasPressure = makeGasPressure();

export interface BalloonOptions { size?: number; particles?: number; color?: string }
/** A balloon of gas particles; `size` (0.5–1, default 0.75) swells it with the same `particles` (0–13, default 8) inside. */
export function makeBalloon({ size = 0.75, particles = 8, color = "pink" }: BalloonOptions = {}): Block {
  const s = clampF(size, 0.5, 1, 0.75);
  particles = clamp(particles, 0, 13, 8);
  const sk = new Sketch(), cx = 40, cy = 40, rx = 34 * s, ry = 38 * s, ky = cy + ry;
  const unit: P[] = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((k): P => [0.4 * Math.cos((k * Math.PI) / 3), 0.4 * Math.sin((k * Math.PI) / 3)]),
    ...[0, 1, 2, 3, 4, 5].map((k): P => [0.74 * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), 0.74 * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)])];
  sk.part("balloon", "balloon", { type: "ellipse", cx, cy, rx, ry, stroke: color, fill: tint(color) },
    path(poly([[cx, ky], [cx - 4, ky + 5], [cx + 4, ky + 5]], true), color, { width: 0.8 }));
  spread(unit, particles, [0, 0]).forEach(([u, v], i) => {
    const q: P = [cx + u * rx, cy + v * ry];
    sk.part(`particle-${i}`, `gas particle ${i}`, dot(q, 3, "blue")).at(`particle-${i}`, q);
  });
  sk.part("string", "string", path(smooth([[cx, ky + 5], [cx + 4, ky + 5 + (95 - ky) * 0.3], [cx - 4, ky + 5 + (95 - ky) * 0.65], [cx + 1, 98]]), "grey", { width: 0.8 }));
  sk.at("balloon", [cx, cy]).at("gas", [cx, cy]).at("skin", [cx + rx, cy]).at("knot", [cx, ky + 3]).at("string", [cx, 98]);
  return finish(
    { id: "balloon", title: "Balloon", describe: "a balloon of gas particles on a string; set size (0.5-1: bigger when warmer or at lower pressure, same particles spread out) and particles (0-13); the box stays the same size so two balloons compare; anchors gas, particle-i, skin (the right edge), knot, string", tags: ["balloon", "gas", "particles", "Charles's law", "expansion", "volume"] },
    sk, [2, 0, 78, 100],
  );
}
export const balloon = makeBalloon();

export interface GasLawGraphOptions { law?: "boyle" | "charles" | "gay-lussac"; inverse?: boolean; color?: string }
/** A gas law graph: `law` boyle (P against V, a falling curve; or P against 1/V, a straight line, with `inverse`), charles (V against T) or gay-lussac (P against T), both straight lines from absolute zero. */
export function makeGasLawGraph({ law = "boyle", inverse = false, color = "blue" }: GasLawGraphOptions = {}): Block {
  const l = pick(law, ["boyle", "charles", "gay-lussac"] as const, "boyle");
  const sk = new Sketch(), o: P = [10, 76];
  axes(sk, o, 98, 2, "ink");
  const X = (t: number) => o[0] + 84 * t, Y = (t: number) => o[1] - 66 * t;
  const curve = l === "boyle" && !inverse;
  const f = (t: number) => (curve ? 0.12 / (0.12 + t) : t * 0.9);
  const ts = [0.35, 0.6, 0.85];
  if (curve) {
    const pts: P[] = Array.from({ length: 15 }, (_, k): P => {
      const t = 0.05 + (k / 14) * 0.9;
      return [X(t), Y(0.14 + 0.82 * ((f(t) - f(0.95)) / (f(0.05) - f(0.95))))];
    });
    sk.part("line", "pressure against volume curve", path(smooth(pts), color));
    sk.at("line-start", pts[0]).at("line-end", pts[14]);
    ts.forEach((t, i) => {
      const q: P = [X(t), Y(0.14 + 0.82 * ((f(t) - f(0.95)) / (f(0.05) - f(0.95))))];
      sk.part(`point-${i}`, `reading ${i}`, circle(q[0], q[1], 2.8, color, { fill: "board" })).at(`point-${i}`, q);
    });
  } else {
    const a: P = [X(0), Y(0)], b: P = [X(0.25), Y(f(0.25))], e: P = [X(1), Y(f(1))];
    if (l === "boyle") sk.part("line", "straight line through the origin", line([a, e], color));
    else sk.part("extrapolation", "extended back to absolute zero", dashed(a, b, color, 4, 5)).part("line", "straight line", line([b, e], color));
    ts.forEach((t, i) => {
      const q: P = [X(t), Y(f(t))];
      sk.part(`point-${i}`, `reading ${i}`, circle(q[0], q[1], 2.8, color, { fill: "board" })).at(`point-${i}`, q);
    });
    sk.at("line-start", l === "boyle" ? a : b).at("line-end", e).at("zero", a);
  }
  const what = { boyle: inverse ? "Boyle's law: pressure against 1/volume" : "Boyle's law: pressure against volume", charles: "Charles's law: volume against temperature", "gay-lussac": "Gay-Lussac's law: pressure against temperature" }[l];
  return finish(
    { id: "gas-law-graph", title: l === "boyle" ? "Boyle's Law Graph" : l === "charles" ? "Charles's Law Graph" : "Gay-Lussac's Law Graph", describe: `a gas law graph (now ${what}) on ink axes with three readings; set law (boyle: falling curve, or a straight line with inverse; charles or gay-lussac: straight line in kelvin, dashed back to absolute zero at the origin); label the axes at x-label, y-label; anchors line-start, line-end, point-0..2, zero, origin, x-axis, y-axis`, tags: ["gas laws", "Boyle's law", "Charles's law", "pressure", "volume", "temperature", "graph"] },
    sk, [2, 0, 100, 84],
  );
}
export const gasLawGraph = makeGasLawGraph();

export interface MoleBagOptions { n?: number; particle?: string; color?: string }
/** A sack tied at the neck, full of many tiny particles (`n`, 8–30, default 24): a mole, about 6 × 10²³ of them. */
export function makeMoleBag({ n = 20, particle = "blue", color = "brown" }: MoleBagOptions = {}): Block {
  n = clamp(n, 8, 30, 20);
  const sk = new Sketch();
  const body: P[] = [[43, 24], [28, 36], [14, 58], [18, 84], [50, 97], [82, 84], [86, 58], [72, 36], [57, 24]];
  sk.part("sack", "sack", path(smooth(body), color, { fill: tint(color) }));
  sk.part("neck", "tied neck", path(`M43 22 Q36 12 32 6 Q41 10 46 6 Q50 10 54 6 Q59 10 68 6 Q64 12 57 22`, color), line([[40, 22], [60, 22]], color));
  const spots: P[] = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const q: P = [20 + c * 10 + (r % 2 ? 5 : 0), 42 + r * 9];
      if (((q[0] - 50) / 28) ** 2 + ((q[1] - 66) / 24) ** 2 < 1) spots.push(q);
    }
  }
  spread(spots, n, [50, 66]).forEach((q, i) => sk.part(`particle-${i}`, `particle ${i}`, circle(q[0], q[1], 1, particle)).at(`particle-${i}`, q));
  sk.at("sack", [50, 66]).at("particles", [50, 66]).at("neck", [50, 22]).at("mouth", [50, 6]).at("base", [50, 97]);
  return finish(
    { id: "mole-bag", title: "Mole Bag", describe: "a sack tied at the neck, full of many tiny particles: one mole, Avogadro's number (6 x 10^23) of particles; set n (8-30 dots drawn) and particle colour; anchors sack, particles, particle-i, neck, base", tags: ["mole", "Avogadro", "amount of substance", "particles", "counting", "stoichiometry"] },
    sk, [12, 4, 88, 98],
  );
}
export const moleBag = makeMoleBag();
