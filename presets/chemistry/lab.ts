// Lab equipment: glassware, heating, measuring and holding apparatus.
// Every block is a factory plus a default instance. The glassware is drawn to one scale (the main
// vessels are all about 90 units tall, walls and liquid drawn the same way), so placed at the same
// size a test tube, a beaker and a flask look like one set. Liquids are a pale fill plus strokes (a
// surface line and short waves or a scribble), so they still read in the chalk theme, which draws no fills.
import { poly, smooth, wave, pill, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Colours and options ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
const LINES = new Set(["ink", ...TINTED]);
/** The colour's pale fill, when it has one. */
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : undefined);
/** A line colour: one of the board's line names or a hex string, else `d`. */
const lineColor = (c: unknown, d = "ink"): string => (typeof c === "string" && (LINES.has(c) || /^#[0-9a-f]{3,8}$/i.test(c)) ? c : d);
type Liquid = { line: string; fill?: string };
/** A liquid's line and fill. Yellow lines are too faint on a white board, so yellow is orange lines on a yellow tint. */
const liquidPaint = (c: unknown, d = "blue"): Liquid => {
  if (c === "yellow") return { line: "orange", fill: "yellow-tint" };
  const line = lineColor(c, d);
  return { line, fill: tint(line) };
};
const num = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : d));
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const pick = <T,>(v: T | T[] | undefined, i: number): T | undefined => (Array.isArray(v) ? v[i % Math.max(1, v.length)] : v);

// ---- Shapes ----

type Style = { fill?: string; width?: number; r?: number };
const style = (o: Style) => ({ ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}) });
const rect = (x: number, y: number, w: number, h: number, stroke: string, o: Style = {}): Shape => ({ type: "rect", x, y, w, h, stroke, ...(o.r ? { r: o.r } : {}), ...style(o) });
const ellipse = (cx: number, cy: number, rx: number, ry: number, stroke: string, o: Style = {}): Shape => ({ type: "ellipse", cx, cy, rx, ry, stroke, ...style(o) });
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ellipse(cx, cy, r, r, stroke, o);
const path = (d: string, stroke: string | undefined, o: Style = {}): Shape => ({ type: "path", d, ...(stroke ? { stroke } : {}), ...style(o) });
const line = (pts: P[], stroke: string, width?: number): Shape => path(poly(pts), stroke, { width });
/** An invisible box: gives an empty part (no liquid, no flame) a place to be circled. */
const ghost = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });
/** Path pieces joined into one stroke (each later piece's M becomes an L). */
const join = (...segs: string[]) => segs.map((s, i) => (i ? s.replace(/^M/, "L") : s)).join(" ");
/** Points round an ellipse from angle a0 to a1 (degrees, 0 = right, 90 = down). */
const arcPts = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as P;
  });
/** A falling drop with its point at the top. */
const dropShape = (x: number, y: number, h: number, liq: Liquid): Shape =>
  path(`M${x} ${y} C${x + h * 0.36} ${y + h * 0.5} ${x + h * 0.42} ${y + h} ${x} ${y + h} C${x - h * 0.42} ${y + h} ${x - h * 0.36} ${y + h * 0.5} ${x} ${y} Z`, liq.line, { fill: liq.fill });

// ---- Sketch and fit ----

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
  const pathD = (d: string) => {
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
    return { ...sh, d: pathD(sh.d) };
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const anchors: Record<string, [number, number]> = {
    center: pt([cx, cy]), top: pt([cx, y0]), bottom: pt([cx, y1]), left: pt([x0, cy]), right: pt([x1, cy]),
  };
  for (const [k, p] of Object.entries(sk.anchors)) anchors[k] = pt(p);
  return { ...meta, size: [r1(W), r1(H)], parts: sk.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors };
}

// ---- Liquid in a vessel ----

/** How far the liquid's pale fill sits inside the glass line, so it never covers the glass. */
const INSET = 3;

/** A vessel's inside: centre line, the glass's half-width at each height, the highest level (fill 1) and the bottom. */
type Vessel = { cx: number; hw: (y: number) => number; top: number; bottom: number };
type PourOptions = {
  fill: number;
  liquid: Liquid;
  bubbles?: number;
  /** A curved surface (narrow measuring glassware). */
  meniscus?: boolean;
  /** Keep this much of the right-hand side clear of waves (for scale marks). */
  reserve?: number;
  /** Suffix for part and anchor names (a rack's "-0"). */
  key?: string;
  /** "auto": waves in a wide pool, shading strokes in a narrow column; "rows": waves only at `rows` (y). */
  cue?: "auto" | "rows";
  rows?: number[];
};

/**
 * Pours liquid into a vessel: parts `liquid` (pale fill plus waves or a scribble, so it shows without
 * fills) and `surface`, and `bubble-i` rising in a stream; anchors the same. Returns the surface's y.
 */
function pour(sk: Sketch, v: Vessel, o: PourOptions): number {
  const k = o.key ?? "";
  const { cx, hw, top } = v;
  const yb = v.bottom - INSET;
  const ys = o.fill < 0.02 ? yb : Math.min(yb - 6, yb - o.fill * (yb - top));
  const depth = yb - ys;
  if (o.fill < 0.02) {
    sk.part(`liquid${k}`, "liquid (empty)", ghost(cx - 3, yb - 3, 6, 3));
    sk.part(`surface${k}`, "liquid surface (empty)", ghost(cx - 3, yb - 3, 6, 3));
    sk.at(`liquid${k}`, [cx, yb]).at(`surface${k}`, [cx, yb]);
    return yb;
  }
  const half = (y: number) => Math.max(0, hw(y) - INSET);
  const reserve = o.reserve ?? 0;
  const lo = (y: number) => cx - half(y) + 1, hi = (y: number) => cx + half(y) - reserve - 1;
  const N = 20, left: P[] = [], right: P[] = [];
  for (let i = 0; i <= N; i++) {
    const y = ys + (depth * i) / N;
    left.push([cx - half(y), y]);
    right.push([cx + half(y), y]);
  }
  const shapes: Shape[] = [o.liquid.fill ? path(poly([...left, ...right.reverse()], true), undefined, { fill: o.liquid.fill }) : ghost(cx - half(ys), ys, half(ys) * 2, depth)];
  const bubbles = Math.max(0, Math.round(o.bubbles ?? 0));
  const narrow = 2 * hw(ys) < 32;
  const cue = o.cue ?? "auto";
  if (cue === "auto" && narrow && !bubbles) {
    // A narrow column: shading strokes slanting up to the right, like the side of the chalk.
    for (let y = ys + 5; ; y += 16) {
      const span = hi(y) - lo(y), y1 = y + span * 0.7;
      if (y1 > yb - 2 || span < 6) break;
      shapes.push(line([[lo(y1), y1], [hi(y), y]], o.liquid.line, 0.8));
    }
  } else if (cue === "rows" || !narrow) {
    // A wide pool: one or two short waves under the surface (left of the bubbles when there are some).
    const rows = cue === "rows" ? (o.rows ?? []).filter((y) => y > ys + 7 && y < yb - 5) : depth >= 34 ? [ys + 12, ys + 26] : depth >= 16 ? [ys + depth / 2] : [];
    for (const y of rows) {
      const h = half(y);
      const x0 = cx - (bubbles ? 0.72 : 0.5) * h, x1 = Math.min(cx + (bubbles ? 0.05 : 0.5) * h, hi(y) - 4);
      if (x1 - x0 >= 10) shapes.push(path(wave(x0, x1, y, 2.2, Math.max(1, Math.round((x1 - x0) / 14))), o.liquid.line, { width: 0.8 }));
    }
  }
  sk.part(`liquid${k}`, "liquid", ...shapes);
  const sw = Math.max(1, hw(ys) - 1.5);
  sk.part(`surface${k}`, "liquid surface",
    o.meniscus
      ? path(`M${cx - sw} ${ys - 1.5} Q${cx} ${ys + 4.5} ${cx + sw} ${ys - 1.5}`, o.liquid.line)
      : line([[cx - sw, ys], [cx + sw, ys]], o.liquid.line));
  sk.at(`surface${k}`, [cx, ys]).at(`liquid${k}`, [cx, (ys + yb) / 2]);
  // Bubbles rise in a stream from the bottom, growing towards the top.
  const step = 13;
  const fit = Math.max(0, Math.floor((depth - 13) / step) + 1);
  const n = Math.min(bubbles, fit);
  for (let i = 0; i < n; i++) {
    const y = yb - 7 - i * step, r = 2.6 + (n > 1 ? (1.3 * i) / (n - 1) : 0.6), h = half(y);
    let x = narrow ? cx + (i % 2 ? 0.3 : -0.3) * h : cx + (i % 2 ? 0.55 : 0.28) * h;
    x = Math.max(lo(y) + r, Math.min(x, (narrow ? cx + h - 1 : hi(y)) - r));
    sk.part(`bubble${k}-${i}`, `bubble ${i}`, circle(x, y, r, o.liquid.line, { width: 0.8 }));
    sk.at(`bubble${k}-${i}`, [x, y]);
  }
  return ys;
}

const GLASS_TAGS = ["lab", "glassware", "apparatus", "chemistry"];
const SET = "drawn to the same scale as the other glassware";

export interface GlassOptions { fill?: number; liquid?: string; bubbles?: number; color?: string }

// ---- Glassware ----

/** A beaker with a spout and volume marks, `fill` full (0–1, default 0.5) of `liquid`, with `bubbles` (0–10). */
export function makeBeaker({ fill = 0.5, liquid = "blue", bubbles = 0, color = "ink" }: GlassOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), W = 68, H = 88;
  sk.part("glass", "beaker", path(`M-6 -3 Q-1 -2 0 4 L0 ${H - 6} Q0 ${H} 6 ${H} L${W - 6} ${H} Q${W} ${H} ${W} ${H - 6} L${W} 3 Q${W} 0 ${W + 3} -1`, c));
  pour(sk, { cx: W / 2, hw: () => W / 2, top: 16, bottom: H }, { fill: num(fill, 0, 1, 0.5), liquid: liquidPaint(liquid), bubbles: int(bubbles, 0, 10, 0), reserve: 12 });
  sk.part("marks", "volume marks", ...[30, 48, 66].map((y) => line([[W - 12, y], [W, y]], c, 0.8)));
  sk.at("mouth", [W / 2, 0]).at("base", [W / 2, H]).at("spout", [-6, -3]);
  return finish(
    { id: "beaker", title: "Beaker", describe: `a beaker with a spout and volume marks; set fill (0-1), liquid (colour) and bubbles (0-10); ${SET}; anchors mouth, base, spout, surface, liquid, bubble-i`, tags: ["beaker", ...GLASS_TAGS, "liquid"] },
    sk, [-6, -3, W + 3, H],
  );
}
export const beaker = makeBeaker();

/** A conical (Erlenmeyer) flask, `fill` full (0–1, default 0.4) of `liquid`, with `bubbles` (0–10). */
export function makeConicalFlask({ fill = 0.4, liquid = "blue", bubbles = 0, color = "ink" }: GlassOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 33;
  sk.part("glass", "conical flask", path("M19 -2 L24 2 L24 28 L2 80 Q-1 88 7 88 L59 88 Q67 88 64 80 L42 28 L42 2 L47 -2", c));
  const hw = (y: number) => (y < 28 ? 9 : 9 + (22 * Math.min(52, y - 28)) / 52);
  pour(sk, { cx, hw, top: 42, bottom: 88 }, { fill: num(fill, 0, 1, 0.4), liquid: liquidPaint(liquid), bubbles: int(bubbles, 0, 10, 0) });
  sk.at("mouth", [cx, 0]).at("neck", [cx, 14]).at("base", [cx, 88]);
  return finish(
    { id: "conical-flask", title: "Conical Flask", describe: `a conical (Erlenmeyer) flask; set fill (0-1), liquid (colour) and bubbles (0-10); ${SET}; anchors mouth, neck, base, surface, liquid, bubble-i`, tags: ["conical flask", "Erlenmeyer", ...GLASS_TAGS] },
    sk, [-1, -2, 67, 88],
  );
}
export const conicalFlask = makeConicalFlask();

/** A round-bottom flask, `fill` full (0–1, default 0.45) of `liquid`, with `bubbles` (0–10). */
export function makeRoundBottomFlask({ fill = 0.45, liquid = "blue", bubbles = 0, color = "ink" }: GlassOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 33, cy = 59, R = 30, nw = 9;
  const join0 = cy - Math.sqrt(R * R - nw * nw), a = (Math.atan2(join0 - cy, -nw) * 180) / Math.PI; // left join, about -107°
  const ball = arcPts(cx, cy, R, R, 360 + a, -180 - a, 24);
  sk.part("glass", "round-bottom flask", path(join(`M${cx - nw - 5} -2 L${cx - nw} 2 L${cx - nw} ${r1(join0)}`, smooth(ball), `M${cx + nw} 2 L${cx + nw + 5} -2`), c));
  const hw = (y: number) => (y < join0 ? nw : Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)));
  pour(sk, { cx, hw, top: join0 + 6, bottom: cy + R }, { fill: num(fill, 0, 1, 0.45), liquid: liquidPaint(liquid), bubbles: int(bubbles, 0, 10, 0) });
  sk.at("mouth", [cx, 0]).at("neck", [cx, 14]).at("base", [cx, cy + R]).at("bulb", [cx, cy]);
  return finish(
    { id: "round-bottom-flask", title: "Round-Bottom Flask", describe: `a round-bottom flask with a long neck; set fill (0-1), liquid (colour) and bubbles (0-10); ${SET}; anchors mouth, neck, bulb, base, surface, liquid, bubble-i`, tags: ["round-bottom flask", "flask", ...GLASS_TAGS] },
    sk, [cx - R, -2, cx + R, cy + R],
  );
}
export const roundBottomFlask = makeRoundBottomFlask();

/** A test tube's outline at (ox, oy): 22 wide, 90 tall from the rim to the round bottom. */
const TUBE_W = 22, TUBE_H = 90;
function drawTube(sk: Sketch, ox: number, oy: number, c: string, key: string, fill: number, liq: Liquid, bubbles: number, top: number) {
  const r = TUBE_W / 2, yb = oy + TUBE_H - r;
  sk.part(`tube${key}`, key ? `test tube ${key.slice(1)}` : "test tube",
    path(`M${ox - 3} ${oy - 2} L${ox} ${oy + 2} L${ox} ${yb} C${ox} ${r1(yb + r * 1.34)} ${ox + TUBE_W} ${r1(yb + r * 1.34)} ${ox + TUBE_W} ${yb} L${ox + TUBE_W} ${oy + 2} L${ox + TUBE_W + 3} ${oy - 2}`, c));
  const hw = (y: number) => (y < yb ? r : Math.sqrt(Math.max(0, r * r - (y - yb) ** 2)));
  pour(sk, { cx: ox + r, hw, top, bottom: oy + TUBE_H }, { fill, liquid: liq, bubbles, key });
  sk.at(`mouth${key}`, [ox + r, oy]).at(`base${key}`, [ox + r, oy + TUBE_H]).at(`tube${key}`, [ox + r, oy + TUBE_H / 2]);
}

/** A test tube, `fill` full (0–1, default 0.4) of `liquid`, with `bubbles` (0–6). */
export function makeTestTube({ fill = 0.4, liquid = "blue", bubbles = 0, color = "ink" }: GlassOptions = {}): Block {
  const sk = new Sketch();
  drawTube(sk, 0, 0, lineColor(color), "", num(fill, 0, 1, 0.4), liquidPaint(liquid), int(bubbles, 0, 6, 0), 14);
  return finish(
    { id: "test-tube", title: "Test Tube", describe: `a test tube; set fill (0-1), liquid (colour) and bubbles (0-6); ${SET}; anchors mouth, base, surface, liquid, bubble-i`, tags: ["test tube", ...GLASS_TAGS, "reaction"] },
    sk, [-3, -2, TUBE_W + 3, TUBE_H],
  );
}
export const testTube = makeTestTube();

export interface TestTubeRackOptions { n?: number; fill?: number | number[]; liquid?: string | string[]; bubbles?: number | number[]; color?: string }
/** A rack of `n` test tubes (1–6, default 3); `fill`, `liquid` and `bubbles` are one value for all or a list, tube by tube. */
export function makeTestTubeRack({ n = 3, fill = [0.5, 0.35, 0.6], liquid = ["blue", "red", "green"], bubbles = 0, color = "ink" }: TestTubeRackOptions = {}): Block {
  n = int(n, 1, 6, 3);
  const c = lineColor(color), sk = new Sketch(), pitch = 42, pad = 12, W = pad * 2 + (n - 1) * pitch + TUBE_W;
  sk.part("stand", "rack", rect(0, 96, W, 10, c, { r: 2 }), line([[5, 40], [5, 96]], c), line([[W - 5, 40], [W - 5, 96]], c));
  for (let i = 0; i < n; i++) {
    drawTube(sk, pad + i * pitch, 0, c, `-${i}`, num(pick(fill, i), 0, 1, 0.5), liquidPaint(pick(liquid, i)), int(pick(bubbles, i), 0, 3, 0), 52);
  }
  sk.part("shelf", "top shelf of the rack", rect(0, 28, W, 12, c, { r: 2, fill: "board" }));
  sk.at("base", [W / 2, 106]).at("shelf", [W / 2, 34]);
  return finish(
    { id: "test-tube-rack", title: "Test Tube Rack", describe: `a rack of n test tubes; set n (1-6), and fill, liquid and bubbles as one value or a list per tube; ${SET}; anchors tube-i, mouth-i, base-i, surface-i, liquid-i, shelf`, tags: ["test tube rack", "test tubes", ...GLASS_TAGS] },
    sk, [-3, -2, W + 3, 106],
  );
}
export const testTubeRack = makeTestTubeRack();

/** A graduated (measuring) cylinder with scale marks, `fill` full (0–1, default 0.6) of `liquid`, with `bubbles` (0–6). */
export function makeGraduatedCylinder({ fill = 0.6, liquid = "blue", bubbles = 0, color = "ink" }: GlassOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), W = 28, H = 80;
  sk.part("glass", "graduated cylinder", path(`M-5 -2 Q-1 -1 0 4 L0 ${H} M${W} ${H} L${W} 2 Q${W} 0 ${W + 3} -1`, c), path(`M-2 ${H} L${W + 2} ${H} L${W + 7} ${H + 10} L-7 ${H + 10} Z`, c));
  pour(sk, { cx: W / 2, hw: () => W / 2, top: 14, bottom: H }, { fill: num(fill, 0, 1, 0.6), liquid: liquidPaint(liquid), bubbles: int(bubbles, 0, 6, 0), meniscus: true, reserve: 9 });
  const marks = [20, 32, 44, 56, 68];
  marks.forEach((y, i) => {
    sk.part(`mark-${i}`, `scale mark ${i}`, line([[W - (i % 2 ? 5 : 9), y], [W, y]], c, 0.8));
    sk.at(`mark-${i}`, [W, y]);
  });
  sk.at("mouth", [W / 2, 0]).at("base", [W / 2, H + 10]).at("spout", [-5, -2]).at("scale", [W + 6, 44]);
  return finish(
    { id: "graduated-cylinder", title: "Graduated Cylinder", describe: `a graduated (measuring) cylinder with scale marks and a curved meniscus; set fill (0-1), liquid (colour) and bubbles (0-6); ${SET}; anchors mouth, base, surface, liquid, mark-i (mark-0 at the top), scale`, tags: ["graduated cylinder", "measuring cylinder", "volume", "measuring", ...GLASS_TAGS] },
    sk, [-7, -2, W + 7, H + 10],
  );
}
export const graduatedCylinder = makeGraduatedCylinder();

export interface BuretteOptions { fill?: number; liquid?: string; open?: boolean; color?: string }
/** A burette with scale marks and a tap, `fill` full (0–1, default 0.85); `open` turns the tap in line and lets a drop fall. */
export function makeBurette({ fill = 0.85, liquid = "blue", open = false, color = "ink" }: BuretteOptions = {}): Block {
  const c = lineColor(color), liq = liquidPaint(liquid), sk = new Sketch(), W = 24, cx = 12, tap: P = [cx, 117];
  sk.part("glass", "burette tube",
    path(`M-3 -2 L0 2 L0 104 L7.5 111.5`, c), path(`M${W + 3} -2 L${W} 2 L${W} 104 L${W - 7.5} 111.5`, c),
    path(`M${cx - 3.5} 123 L${cx - 3.5} 132 L${cx - 1.5} 144 M${cx + 3.5} 123 L${cx + 3.5} 132 L${cx + 1.5} 144`, c));
  pour(sk, { cx, hw: () => W / 2, top: 6, bottom: 104 }, { fill: num(fill, 0, 1, 0.85), liquid: liq, meniscus: true, reserve: 9 });
  for (let i = 0, y = 12; y <= 96; i++, y += 12) {
    sk.part(`mark-${i}`, `scale mark ${i}`, line([[W - (i % 2 ? 5 : 9), y], [W, y]], c, 0.8));
    sk.at(`mark-${i}`, [W, y]);
  }
  const valve = circle(...tap, 7, c, { fill: "board" });
  if (open) sk.part("tap", "tap (open)", valve, rect(cx - 3, 101, 6, 32, c, { r: 3, fill: "board" }));
  else sk.part("tap", "tap (closed)", rect(cx + 7, 114, 21, 6, c, { r: 3, fill: "board" }), valve);
  if (open) sk.part("drop", "drop", dropShape(cx, 148, 12, liq));
  sk.at("mouth", [cx, 0]).at("tap", tap).at("tip", [cx, 144]).at("drop", [cx, 155]).at("base", [cx, 144]).at("scale", [W + 6, 54]);
  return finish(
    { id: "burette", title: "Burette", describe: "a burette: a long tube with scale marks (mark-0 at the top) and a tap; set fill (0-1), liquid (colour) and open (tap turned on, a drop falling); anchors mouth, surface, liquid, tap, tip, drop, mark-i, scale", tags: ["burette", "titration", "tap", "volume", ...GLASS_TAGS] },
    sk, [-3, -2, 40, 160],
  );
}
export const burette = makeBurette();

/** A volumetric pipette (bulb in the middle, a fill mark on the stem), `fill` full (0–1, default 0.75) of `liquid`. */
export function makePipette({ fill = 0.75, liquid = "blue", color = "ink" }: Omit<GlassOptions, "bubbles"> = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 16, cy = 52, rx = 16, ry = 18, sw = 7;
  const dy = ry * Math.sqrt(1 - (sw / rx) ** 2), a = (Math.atan2(-dy / ry, -sw / rx) * 180) / Math.PI; // top-left join, about -116°
  const lArc = arcPts(cx, cy, rx, ry, 360 + a, -a, 14); // from the top-left join round the left to the bottom-left join
  const rArc = arcPts(cx, cy, rx, ry, 180 + a, -(180 + a), 14); // from the bottom-right join round the right to the top-right join
  sk.part("glass", "pipette", path(join(`M${cx - sw} 0 L${cx - sw} ${r1(cy - dy)}`, smooth(lArc), `M${cx - sw} 92 L${cx - 2} 112 L${cx + 2} 112 L${cx + sw} 92 L${cx + sw} ${r1(cy + dy)}`, smooth(rArc), `M${cx + sw} 0`), c));
  const hw = (y: number) => (y > 92 ? sw - (5 * (y - 92)) / 20 : Math.abs(y - cy) < dy ? rx * Math.sqrt(1 - ((y - cy) / ry) ** 2) : sw);
  pour(sk, { cx, hw, top: 14, bottom: 112 }, { fill: num(fill, 0, 1, 0.75), liquid: liquidPaint(liquid), meniscus: true, cue: "rows", rows: [cy + 3] });
  sk.part("mark", "fill mark", line([[cx - sw, 14], [cx + sw, 14]], c, 0.8));
  sk.at("mouth", [cx, 0]).at("mark", [cx + sw, 14]).at("bulb", [cx, cy]).at("tip", [cx, 112]).at("base", [cx, 112]);
  return finish(
    { id: "pipette", title: "Pipette", describe: "a volumetric pipette: a bulb in the middle, a fill mark on the stem, a fine tip; set fill (0-1) and liquid (colour); anchors mouth, mark, bulb, tip, surface, liquid", tags: ["pipette", "volumetric", "measuring", "titration", ...GLASS_TAGS] },
    sk, [0, 0, 2 * cx, 112],
  );
}
export const pipette = makePipette();

export interface DropperOptions { fill?: number; liquid?: string; drop?: boolean; color?: string }
/** A dropper: rubber teat over a glass tube, `fill` full (0–1, default 0.5) of `liquid`, a drop falling unless `drop` is false. */
export function makeDropper({ fill = 0.5, liquid = "blue", drop = true, color = "ink" }: DropperOptions = {}): Block {
  const c = lineColor(color), liq = liquidPaint(liquid), sk = new Sketch(), cx = 12;
  sk.part("glass", "glass tube", path(`M${cx - 7} 38 L${cx - 7} 80 L${cx - 2} 96 L${cx + 2} 96 L${cx + 7} 80 L${cx + 7} 38`, c));
  pour(sk, { cx, hw: (y) => (y < 80 ? 7 : 7 - (5 * (y - 80)) / 16), top: 46, bottom: 96 }, { fill: num(fill, 0, 1, 0.5), liquid: liq });
  sk.part("teat", "rubber teat", path(`M0 36 L0 12 C0 -3 24 -3 24 12 L24 36 Z`, c, { fill: tint(c) ?? "grey-tint" }), rect(-3, 32, 30, 8, c, { r: 3, fill: "board" }));
  if (drop) sk.part("drop", "drop", dropShape(cx, 101, 13, liq));
  sk.at("teat", [cx, 16]).at("tip", [cx, 96]).at("drop", [cx, 109]).at("mouth", [cx, 96]).at("base", [cx, 96]);
  return finish(
    { id: "dropper", title: "Dropper", describe: "a dropper (dropping pipette): a rubber teat on a glass tube with a drop falling from the tip; set fill (0-1), liquid (colour) and drop (on/off); anchors teat, tip, drop, surface, liquid", tags: ["dropper", "pipette", "drop", "indicator", ...GLASS_TAGS] },
    sk, [-3, -2, 27, 115],
  );
}
export const dropper = makeDropper();

export interface GasJarOptions { fill?: number; liquid?: string; bubbles?: number; gas?: string | false; lid?: boolean; color?: string }
/** A gas jar with a ground flange and a glass lid: `gas` (a colour, or false) shows as wisps; `fill` (0–1, default 0) of `liquid` at the bottom. */
export function makeGasJar({ fill = 0, liquid = "blue", bubbles = 0, gas = "grey", lid = true, color = "ink" }: GasJarOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), W = 46, H = 92, cx = W / 2;
  sk.part("glass", "gas jar", path(`M-5 10 L0 10 L0 ${H - 6} Q0 ${H} 6 ${H} L${W - 6} ${H} Q${W} ${H} ${W} ${H - 6} L${W} 10 L${W + 5} 10`, c));
  const ys = pour(sk, { cx, hw: () => W / 2, top: 24, bottom: H }, { fill: num(fill, 0, 1, 0), liquid: liquidPaint(liquid), bubbles: int(bubbles, 0, 8, 0) });
  if (gas !== false) {
    const g = lineColor(gas, "grey"), wisps: Shape[] = [];
    for (let y = 26, j = 0; y <= ys - 12 && j < 4; y += 16, j++) {
      const x = j % 2 ? 22 : 8;
      wisps.push(path(`M${x} ${y} C${x + 4} ${y - 5} ${x + 8} ${y + 5} ${x + 12} ${y} C${x + 14} ${y - 3} ${x + 16} ${y - 3} ${x + 17} ${y - 1}`, g, { width: 0.8 }));
    }
    sk.part("gas", "gas", ...(wisps.length ? wisps : [ghost(cx - 3, 20, 6, 4)]));
    sk.at("gas", [cx, Math.min(40, (20 + ys) / 2)]);
  }
  if (lid) sk.part("lid", "glass lid", rect(-3, -5, W + 12, 5, c, { r: 2, fill: "board" }));
  sk.at("mouth", [cx, 10]).at("lid", [cx + 3, -2.5]).at("base", [cx, H]);
  return finish(
    { id: "gas-jar", title: "Gas Jar", describe: "a gas jar with a flanged rim and a glass lid; set gas (a colour for wisps, or false), lid (on/off), fill (0-1), liquid (colour) and bubbles (0-8); anchors mouth, lid, gas, base, surface, liquid, bubble-i", tags: ["gas jar", "gas", "collecting gas", ...GLASS_TAGS] },
    sk, [-5, -5, W + 9, H],
  );
}
export const gasJar = makeGasJar();

export interface FunnelOptions { fill?: number; liquid?: string; paper?: boolean; color?: string }
/** A filter funnel, optionally lined with filter `paper`, `fill` full (0–1, default 0) of `liquid`. */
export function makeFunnel({ fill = 0, liquid = "blue", paper = false, color = "ink" }: FunnelOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 32;
  sk.part("glass", "funnel", ellipse(cx, 0, 32, 6, c), path(`M0 0 L25 40 L25 90 L39 84 L39 40 L64 0`, c));
  if (paper) sk.part("paper", "filter paper", path(`M12 8 L${cx} 38 L52 8 Z`, "grey", { width: 0.8 }));
  const hw = paper ? (y: number) => Math.max(0, 20 - (20 * (y - 8)) / 30) + INSET - 0.5 : (y: number) => (y < 40 ? 32 - (25 * y) / 40 : 7);
  pour(sk, { cx, hw, top: paper ? 12 : 8, bottom: paper ? 38 : 44 }, { fill: num(fill, 0, 1, 0), liquid: liquidPaint(liquid) });
  sk.at("mouth", [cx, 0]).at("stem", [cx, 62]).at("tip", [cx, 88]).at("base", [cx, 88]).at("cone", [cx, 22]);
  return finish(
    { id: "funnel", title: "Funnel", describe: "a filter funnel: a cone and a stem; set paper (filter paper in the cone), fill (0-1) and liquid (colour); anchors mouth, cone, stem, tip, surface, liquid", tags: ["funnel", "filter", "filtration", "separating", ...GLASS_TAGS] },
    sk, [0, -6, 64, 90],
  );
}
export const funnel = makeFunnel();

export interface CondenserOptions { tilt?: number; water?: boolean; color?: string }
/** A Liebig condenser: an inner tube in a water jacket, vapour in on the left; `tilt` (0–30°, down to the right), `water` shows the flow arrows. */
export function makeCondenser({ tilt = 0, water = true, color = "ink" }: CondenserOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), L = 120, a = (num(tilt, 0, 30, 0) * Math.PI) / 180;
  const T = ([x, y]: P): P => [L / 2 + (x - L / 2) * Math.cos(a) - y * Math.sin(a), (x - L / 2) * Math.sin(a) + y * Math.cos(a)];
  const all: P[] = [];
  const pts = (ps: P[]) => ps.map((p) => (all.push(T(p)), T(p)));
  const d = (ps: P[], close = false) => poly(pts(ps), close);
  const jacket = [[24, -22], [96, -22], [102, -16], [102, 16], [96, 22], [24, 22], [18, 16], [18, -16]] as P[];
  sk.part("jacket", "water jacket", path(d(jacket, true), c, { fill: water ? "blue-tint" : undefined }),
    path(`${d([[26, -34], [26, -22]])} ${d([[40, -22], [40, -34]])}`, c), path(`${d([[80, 22], [80, 34]])} ${d([[94, 34], [94, 22]])}`, c));
  sk.part("inner-tube", "inner tube", path(d([[0, -6], [L, -6], [L, 6], [0, 6]], true), c, { fill: "board" }));
  if (water) {
    const arrow = (x: number, y0: number, y1: number) => {
      const dir = Math.sign(y1 - y0);
      return path(`${d([[x, y0], [x, y1]])} ${d([[x - 4, y1 - dir * 5], [x, y1], [x + 4, y1 - dir * 5]])}`, "blue", { width: 0.8 });
    };
    sk.part("water-in", "cold water in", arrow(87, 52, 38)).part("water-out", "warm water out", arrow(33, -38, -52));
    sk.at("water-in", T([87, 54])).at("water-out", T([33, -54]));
  } else {
    sk.at("water-in", T([87, 34])).at("water-out", T([33, -34]));
  }
  sk.at("inlet", T([0, 0])).at("outlet", T([L, 0])).at("jacket", T([L / 2, -14])).at("tube", T([L / 2, 0]));
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return finish(
    { id: "condenser", title: "Condenser", describe: "a Liebig condenser: an inner tube inside a water jacket, vapour in at the left, liquid out at the right, cold water in at the bottom and out at the top; set tilt (0-30 degrees, down to the right) and water (flow arrows); anchors inlet, outlet, water-in, water-out, jacket, tube", tags: ["condenser", "distillation", "cooling", "condensing", ...GLASS_TAGS] },
    sk, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  );
}
export const condenser = makeCondenser();

// ---- Heating ----

export interface BunsenOptions { flame?: "off" | "safe" | "roaring"; color?: string }
/** A Bunsen burner with its `flame` off, the yellow-orange safety flame (air hole closed), or the roaring blue flame (air hole open). */
export function makeBunsenBurner({ flame = "safe", color = "ink" }: BunsenOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 30;
  const kind = flame === "off" || flame === "roaring" ? flame : "safe";
  sk.part("base", "base", path(`M4 100 L56 100 L52 92 L8 92 Z`, c, { fill: tint(c) ?? "grey-tint" }));
  sk.part("gas-pipe", "gas inlet", rect(37, 80, 24, 8, c, { r: 2 }));
  sk.part("barrel", "barrel", rect(cx - 7, 40, 14, 52, c, { fill: "board" }));
  sk.part("collar", "air-hole collar", rect(cx - 10, 62, 20, 12, c, { r: 2, fill: "board" }), ...(kind === "roaring" ? [ellipse(cx, 68, 3.5, 3, c, { width: 0.8 })] : []));
  if (kind === "safe") {
    sk.part("flame", "yellow safety flame",
      path(smooth([[cx - 6, 40], [cx - 9, 28], [cx - 5, 16], [cx - 1, 7], [cx + 2, -1], [cx + 4, 9], [cx + 8, 20], [cx + 8, 31], [cx + 6, 40]]), "orange", { fill: "yellow-tint" }),
      path(smooth([[cx - 2, 38], [cx - 3, 30], [cx, 21], [cx + 3, 30], [cx + 2, 38]]), "orange", { width: 0.8 }));
  } else if (kind === "roaring") {
    sk.part("flame", "roaring blue flame",
      path(smooth([[cx - 6, 40], [cx - 7, 28], [cx - 3, 13], [cx, 2], [cx + 3, 13], [cx + 7, 28], [cx + 6, 40]]), "blue", { fill: "blue-tint" }),
      path(`M${cx - 3} 40 L${cx} 22 L${cx + 3} 40`, "blue", { width: 0.8 }));
  } else sk.part("flame", "no flame", ghost(cx - 4, 30, 8, 8));
  sk.at("flame", [cx, 24]).at("flame-tip", [cx, kind === "off" ? 38 : 2]).at("nozzle", [cx, 40]).at("air-hole", [cx, 68]).at("gas", [61, 84]).at("base", [cx, 100]);
  return finish(
    { id: "bunsen-burner", title: "Bunsen Burner", describe: "a Bunsen burner on its base with a gas inlet and air-hole collar; set flame: off, safe (yellow-orange, air hole closed) or roaring (blue, air hole open); anchors flame, flame-tip, nozzle, air-hole, gas, base", tags: ["Bunsen burner", "flame", "heating", "gas", "lab", "apparatus"] },
    sk, [4, -1, 61, 100],
  );
}
export const bunsenBurner = makeBunsenBurner();

export interface TripodOptions { gauze?: boolean; color?: string }
/** A tripod, with a wire gauze on top unless `gauze` is false. */
export function makeTripod({ gauze = true, color = "ink" }: TripodOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch();
  sk.part("legs", "legs", line([[42, 20], [42, 86]], c, 0.8), line([[12, 20], [2, 92]], c), line([[72, 20], [82, 92]], c));
  sk.part("ring", "ring", rect(8, 14, 68, 6, c, { r: 3, fill: "board" }));
  if (gauze) {
    const mesh = [21, 42, 63].map((x) => line([[x, 14], [14 + (x * 56) / 84, -4]], c, 0.8));
    sk.part("gauze", "wire gauze", path(`M0 14 L14 -4 L70 -4 L84 14 Z`, c, { fill: "grey-tint" }), ...mesh);
  }
  sk.at("on-top", [42, gauze ? 5 : 14]).at("under", [42, 60]).at("gauze", [42, 5]).at("base", [42, 92]);
  return finish(
    { id: "tripod", title: "Tripod and Gauze", describe: "a tripod stand with a wire gauze on top, for heating a beaker over a Bunsen burner; set gauze (on/off); anchors on-top (where a beaker sits), under (where the burner goes), gauze, base", tags: ["tripod", "gauze", "heating", "stand", "lab", "apparatus"] },
    sk, [0, gauze ? -4 : 14, 84, 92],
  );
}
export const tripod = makeTripod();

// ---- Measuring ----

export interface ThermometerOptions { reading?: number; liquid?: string; color?: string }
/** A thermometer with a scale, its column up to `reading` (0–1, default 0.5) of the way; `liquid` default red. */
export function makeThermometer({ reading = 0.5, liquid = "red", color = "ink" }: ThermometerOptions = {}): Block {
  const c = lineColor(color), liq = liquidPaint(liquid, "red"), sk = new Sketch(), W = 26, cx = W / 2, R = 16, by = 118;
  const jy = by - Math.sqrt(R * R - cx * cx), a = (Math.atan2(jy - by, cx) * 180) / Math.PI; // right join, about -36°
  sk.part("glass", "thermometer", path(join(`M0 ${r1(jy)} L0 ${cx} C0 -4 ${W} -4 ${W} ${cx} L${W} ${r1(jy)}`, smooth(arcPts(cx, by, R, R, a, 180 - a, 16))), c));
  const yr = 104 - num(reading, 0, 1, 0.5) * 88;
  sk.part("bulb", "bulb", circle(cx, by, 8, liq.line, { fill: liq.fill }));
  sk.part("column", "liquid column", line([[cx, by - 8], [cx, yr]], liq.line, 0.8));
  for (let i = 0, y = 20; y <= 104; i++, y += 12) {
    sk.part(`mark-${i}`, `scale mark ${i}`, line([[W + 4, y], [W + (i % 2 ? 9 : 14), y]], c, 0.8));
    sk.at(`mark-${i}`, [W + 18, y]);
  }
  sk.at("reading", [cx, yr]).at("bulb", [cx, by]).at("column", [cx, (yr + by - 8) / 2]).at("scale", [W + 18, 62]).at("base", [cx, by + R]);
  return finish(
    { id: "thermometer", title: "Thermometer", describe: "a thermometer with a scale beside it (mark-0 at the top), its liquid column up to the reading; set reading (0-1, empty to full scale) and liquid (colour, default red); anchors reading, bulb, column, scale, mark-i", tags: ["thermometer", "temperature", "measuring", "heat", "lab", "apparatus"] },
    sk, [cx - R, -2, W + 14, by + R],
  );
}
export const thermometer = makeThermometer();

export interface BalanceOptions { item?: "none" | "beaker" | "powder"; liquid?: string; color?: string }
/** A digital top-pan balance, with a beaker or a pile of powder on the pan, or nothing (`item`, default none). */
export function makeBalance({ item = "none", liquid = "blue", color = "ink" }: BalanceOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), on = item === "beaker" || item === "powder" ? item : "none";
  sk.part("body", "balance", path(`M0 90 L100 90 L94 54 L6 54 Z`, c, { fill: tint(c) ?? "grey-tint" }), rect(44, 46, 12, 8, c));
  sk.part("pan", "pan", rect(14, 40, 72, 6, c, { r: 3, fill: "board" }));
  sk.part("display", "display", rect(16, 64, 36, 16, c, { r: 2, fill: "blue-tint" }));
  sk.part("buttons", "buttons", circle(68, 72, 4, c, { width: 0.8 }), circle(82, 72, 4, c, { width: 0.8 }));
  let top = 40;
  if (on === "beaker") {
    const liq = liquidPaint(liquid);
    sk.part("item", "beaker on the pan", path(`M32 2 Q35 3 35 6 L35 37 Q35 40 38 40 L62 40 Q65 40 65 37 L65 4 Q65 2 67 2`, c),
      line([[37, 20], [63, 20]], liq.line), path(wave(41, 59, 30, 2, 1), liq.line, { width: 0.8 }));
    top = 2;
  } else if (on === "powder") {
    sk.part("item", "powder on the pan", path(`M28 40 Q50 18 72 40`, "grey", { fill: "grey-tint" }), circle(42, 34, 1.5, "grey", { width: 0.8 }), circle(56, 33, 1.5, "grey", { width: 0.8 }));
    top = 26;
  }
  sk.at("pan", [50, 40]).at("item", [50, on === "none" ? 34 : (top + 40) / 2]).at("display", [34, 72]).at("base", [50, 90]);
  return finish(
    { id: "balance", title: "Balance", describe: "a digital top-pan balance (scale) with a display; set item: none, beaker or powder on the pan; anchors pan, item, display, base", tags: ["balance", "scale", "mass", "weighing", "measuring", "lab"] },
    sk, [0, Math.min(top, 30), 100, 90],
  );
}
export const balance = makeBalance();

// ---- Holding and other apparatus ----

export interface RetortStandOptions { clamp?: number; color?: string }
/** A retort stand: a heavy base, a rod, and a boss and clamp `clamp` of the way up the rod (0–1, default 0.6). */
export function makeRetortStand({ clamp = 0.6, color = "ink" }: RetortStandOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cy = 76 - num(clamp, 0, 1, 0.6) * 62;
  sk.part("base", "base", rect(0, 92, 72, 8, c, { r: 2, fill: tint(c) ?? "grey-tint" }));
  sk.part("rod", "rod", rect(9, 0, 8, 92, c, { r: 3, fill: "board" }));
  sk.part("clamp", "clamp",
    rect(19, cy - 3, 38, 6, c, { r: 2, fill: "board" }),
    path(`M57 ${cy - 3} Q63 ${cy - 15} 74 ${cy - 13} M57 ${cy + 3} Q63 ${cy + 15} 74 ${cy + 13}`, c));
  sk.part("boss", "boss head", rect(4, cy - 8, 18, 16, c, { r: 2, fill: "board" }), line([[4, cy], [-3, cy]], c));
  sk.at("jaws", [68, cy]).at("boss", [13, cy]).at("rod", [13, 40]).at("base", [36, 100]);
  return finish(
    { id: "retort-stand", title: "Retort Stand", describe: "a retort stand: heavy base, upright rod, and a boss holding a clamp; set clamp (0-1, how high the clamp is); anchors jaws (where the clamp holds a tube or flask), boss, rod, base", tags: ["retort stand", "clamp", "stand", "holding", "lab", "apparatus"] },
    sk, [-3, 0, 76, 100],
  );
}
export const retortStand = makeRetortStand();

export interface MortarOptions { powder?: boolean | string; color?: string }
/** A mortar and pestle, with powder in the bowl unless `powder` is false (or a colour for it). */
export function makeMortarAndPestle({ powder = true, color = "ink" }: MortarOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch(), cx = 44, ry = 10, rx = 40, cy = 40;
  sk.part("bowl", "mortar", ellipse(cx, cy, rx, ry, c), path(`M30 76 L26 86 L62 86 L58 76`, c));
  if (powder !== false) {
    const p = lineColor(powder === true ? "grey" : powder, "grey");
    sk.part("powder", "powder", path(`M12 45 Q27 33 46 45 Z`, p, { width: 0.8, fill: tint(p) }));
  }
  sk.part("pestle", "pestle", path(pill(56, 56, 92, 2, 7), c, { fill: "board" }));
  const front = arcPts(cx, cy, rx, ry, 0, 180, 12);
  sk.part("bowl-front", "front of the mortar", path(join(`M${cx - rx} ${cy} C${cx - rx + 2} 64 22 76 ${cx} 76 C66 76 ${cx + rx - 2} 64 ${cx + rx} ${cy}`, smooth(front)) + " Z", c, { fill: "board" }));
  sk.at("bowl", [cx, cy + 2]).at("pestle", [84, 12]).at("powder", [30, 44]).at("base", [cx, 86]).at("mouth", [cx, cy - ry]);
  return finish(
    { id: "mortar-and-pestle", title: "Mortar and Pestle", describe: "a mortar (bowl) and pestle for grinding solids; set powder (on/off, or its colour); anchors bowl, pestle, powder, mouth, base", tags: ["mortar and pestle", "grinding", "powder", "solid", "lab", "apparatus"] },
    sk, [cx - rx, -6, 99, 86],
  );
}
export const mortarAndPestle = makeMortarAndPestle();

export interface GogglesOptions { color?: string }
/** Safety goggles from the front: a frame round two lenses, with the strap at the sides. */
export function makeSafetyGoggles({ color = "ink" }: GogglesOptions = {}): Block {
  const c = lineColor(color), sk = new Sketch();
  sk.part("strap", "strap", rect(0, 20, 12, 14, c, { r: 2 }), rect(88, 20, 12, 14, c, { r: 2 }));
  sk.part("frame", "frame", path(smooth([[10, 14], [24, 4], [50, 6], [76, 4], [90, 14], [92, 32], [84, 46], [64, 48], [56, 42], [50, 38], [44, 42], [36, 48], [16, 46], [8, 32]], true), c, { fill: "board" }));
  const lens = (s: number) => smooth([[50 + s * 33, 17], [50 + s * 22, 16], [50 + s * 12, 19], [50 + s * 11, 28], [50 + s * 16, 35], [50 + s * 29, 35], [50 + s * 34, 27]], true);
  sk.part("lens-left", "left lens", path(lens(-1), c, { fill: "blue-tint" }), line([[24, 30], [29, 23]], c, 0.8));
  sk.part("lens-right", "right lens", path(lens(1), c, { fill: "blue-tint" }), line([[69, 30], [74, 23]], c, 0.8));
  sk.at("lens-left", [27, 26]).at("lens-right", [73, 26]).at("bridge", [50, 40]).at("strap-left", [0, 27]).at("strap-right", [100, 27]);
  return finish(
    { id: "safety-goggles", title: "Safety Goggles", describe: "safety goggles seen from the front: a frame round two lenses with the strap at the sides; anchors lens-left, lens-right, bridge, strap-left, strap-right", tags: ["safety goggles", "safety", "eye protection", "lab", "PPE"] },
    sk, [0, 4, 100, 48],
  );
}
export const safetyGoggles = makeSafetyGoggles();

export interface PetriDishOptions { colonies?: number; colony?: string; agar?: boolean; color?: string }
/** A petri dish seen from a little above, with agar unless `agar` is false and `colonies` (0–10, default 5) growing in `colony` colour. */
export function makePetriDish({ colonies = 5, colony = "orange", agar = true, color = "ink" }: PetriDishOptions = {}): Block {
  const c = lineColor(color), col = liquidPaint(colony, "orange"), sk = new Sketch(), cx = 50, cy = 24, rx = 46, ry = 20, depth = 14;
  sk.part("dish", "dish", path(join(`M${cx - rx} ${cy} L${cx - rx} ${cy + depth}`, smooth(arcPts(cx, cy + depth, rx, ry, 180, 0, 12)), `M${cx + rx} ${cy}`), c), ellipse(cx, cy, rx, ry, c));
  if (agar) sk.part("agar", "agar", { type: "ellipse", cx, cy: cy + 1, rx: rx - 4, ry: ry - 3, fill: "yellow-tint" });
  const n = int(colonies, 0, 10, 5);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * 0.9, t = i * 2.4 + 0.6;
    const x = cx + Math.cos(t) * r * (rx - 12), y = cy + Math.sin(t) * r * (ry - 7), s = 2.6 + ((i * 7) % 3) * 0.7;
    sk.part(`colony-${i}`, `colony ${i}`, circle(x, y, s, col.line, { fill: col.fill, width: 0.8 }));
    sk.at(`colony-${i}`, [x, y]);
  }
  sk.at("agar", [cx, cy]).at("rim", [cx, cy - ry]).at("base", [cx, cy + depth + ry]).at("mouth", [cx, cy - ry]);
  return finish(
    { id: "petri-dish", title: "Petri Dish", describe: "a petri dish seen from a little above, with agar and bacterial colonies; set colonies (0-10), colony (colour) and agar (on/off); anchors agar, rim, base, colony-i", tags: ["petri dish", "agar", "bacteria", "culture", "microbiology", "lab"] },
    sk, [cx - rx, cy - ry, cx + rx, cy + depth + ry],
  );
}
export const petriDish = makePetriDish();
