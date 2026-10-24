// A whiteboard you chain blocks and actions on. Each call is one step; steps run one after another
// unless told otherwise, so a script reads like the explanation it animates:
//
//   const b = new Board({ font: { uri: "fonts/Manrope.ttf", family: "Manrope" } });
//   const sun = b.place(SUN, { x: 300, y: 260, size: 220 });
//   const leaf = b.place(LEAF, { x: 1000, y: 560, size: 360 });
//   b.arrow(sun.at("right"), leaf.at("surface"), { color: "orange", bend: -0.2 });
//   b.travel(CO2, { from: { x: 1500, y: 300 }, to: leaf.at("surface"), size: 90, count: 3 });
//   b.highlight(leaf, { part: "veins" });
//   b.label("glucose", { x: 1000, y: 820, with: true });
//   writeFileSync("out.json", JSON.stringify(b.build("photosynthesis", "Photosynthesis")));
//
// Timing for every step: `at` (seconds from the start), or `with: true` to start alongside the
// previous step, plus an optional `delay`. Without them a step starts when the previous one ends.
// Coordinates are pixels on a 1920x1080 board.
import {
  ANIMATION_DOCUMENT_VERSION,
  assertValidAnimationDocument,
  base,
  constant,
  fill,
  hex,
  keyed,
  parseSvgPath,
  stroke,
  trim,
  withComputedRevision,
  type Animatable,
  type AnimationDocument,
  type Color,
  type CubicBezier,
  type Ease,
  type Key,
  type PathContour,
  type PathVertex,
  type SceneNode,
  type Spring,
  type Vec2,
  type Vec3,
} from "@clayzo/animation/authoring";
import { CHALK, WHITEBOARD, type Theme } from "./themes";
import type { Block, Paint, Shape } from "./types";

// ---- Look ----

// The board's look. `build` sets it before compiling, so every colour and width below follows it.
let theme: Theme = CHALK;
const paint = (p: Paint): Color => hex(theme.colors[p] ?? p);

/** The whiteboard's colours and marker width, for code that draws blocks outside a board. */
export const COLORS = WHITEBOARD.colors;
export const MARKER = WHITEBOARD.marker;
/** How fast the marker moves when drawing, in pixels per second. */
const DRAW_SPEED = 1500;

// ---- Time ----

const TPS = 240;
const FRAME = 8; // 30 fps
const snap = (tick: number) => Math.max(0, Math.round(tick / FRAME) * FRAME);
const tk = (seconds: number) => snap(seconds * TPS);

const EASE = {
  out: { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 } as CubicBezier,
  inOut: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } as CubicBezier,
  draw: { x1: 0.4, y1: 0, x2: 0.4, y2: 1 } as CubicBezier,
  pop: { mass: 1, stiffness: 300, damping: 18 } as Spring,
};

/** Keys in increasing ticks: a key at the same tick as the last replaces it, an earlier one is dropped. */
class Keys<T> {
  readonly list: Key<T>[] = [];
  constructor(first: T) {
    this.list.push([0, first]);
  }
  get last(): T {
    return this.list[this.list.length - 1][1];
  }
  /** Holds the current value until `tick`, then moves to `value` by `seconds` with `ease`. */
  to(tick: number, value: T, seconds: number, ease: Ease = EASE.inOut) {
    this.add(tick, this.last, ease);
    this.add(tick + Math.max(FRAME, tk(seconds)), value);
  }
  add(tick: number, value: T, ease?: Ease) {
    tick = snap(tick);
    const prev = this.list[this.list.length - 1];
    if (tick < prev[0]) return;
    if (tick === prev[0]) this.list.pop();
    else if (prev[2] === undefined) this.list[this.list.length - 1] = [prev[0], prev[1], "hold"];
    this.list.push(ease ? [tick, value, ease] : [tick, value]);
  }
  track(id: string): Animatable<T> {
    return this.list.length === 1 ? constant(this.list[0][1]) : keyed(id, this.list.map(([t, v, e], i) => (i === this.list.length - 1 ? [t, v] : [t, v, e ?? "hold"])));
  }
}

// ---- Geometry ----

export type Pt = { x: number; y: number };
const ZERO: Vec2 = { x: 0, y: 0 };
const vtx = (x: number, y: number): PathVertex => ({ point: { x, y }, inTangent: ZERO, outTangent: ZERO });

const svgCache = new Map<string, PathContour[]>();
function contoursOf(d: string): PathContour[] {
  let c = svgCache.get(d);
  if (!c) {
    const { path, diagnostics } = parseSvgPath(d);
    const bad = diagnostics.filter((x) => x.code !== "arc_flattened");
    if (bad.length) throw new Error(`bad path "${d.slice(0, 40)}…": ${bad.map((x) => x.message).join("; ")}`);
    c = path.contours;
    svgCache.set(d, c);
  }
  return c;
}

/**
 * Straight steps along every curve, open, with the first point repeated on a closed contour: `trim`
 * draws chords between vertices and leaves a closed contour's closing edge out until it ends.
 */
function polyline(contours: PathContour[]): PathContour[] {
  return contours.map((c) => {
    const vs = c.vertices;
    const out: PathVertex[] = [vtx(vs[0].point.x, vs[0].point.y)];
    const n = c.closed ? vs.length : vs.length - 1;
    for (let i = 0; i < n; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const p0 = a.point, p3 = b.point;
      const p1 = { x: p0.x + a.outTangent.x, y: p0.y + a.outTangent.y };
      const p2 = { x: p3.x + b.inTangent.x, y: p3.y + b.inTangent.y };
      const curved = a.outTangent.x || a.outTangent.y || b.inTangent.x || b.inTangent.y;
      const steps = curved ? 12 : 1;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        out.push(vtx(
          u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        ));
      }
    }
    return { closed: false, vertices: out };
  });
}

function outline(shape: Shape): PathContour[] {
  switch (shape.type) {
    case "path":
      return contoursOf(shape.d);
    case "ellipse": {
      const vs: PathVertex[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = -Math.PI / 2 + (i / 48) * Math.PI * 2;
        vs.push(vtx(shape.cx + Math.cos(a) * shape.rx, shape.cy + Math.sin(a) * shape.ry));
      }
      return [{ closed: false, vertices: vs }];
    }
    case "rect": {
      const { x, y, w, h } = shape;
      const r = Math.min(shape.r ?? 0, w / 2, h / 2);
      const d = r
        ? `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`
        : `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;
      return contoursOf(d);
    }
  }
}

const lengthOf = (contours: PathContour[]) =>
  contours.reduce((sum, c) => sum + c.vertices.slice(1).reduce((s, v, i) => s + Math.hypot(v.point.x - c.vertices[i].point.x, v.point.y - c.vertices[i].point.y), 0), 0);

function shapeBox(shape: Shape): [number, number, number, number] {
  const pts = polyline(outline(shape)).flatMap((c) => c.vertices.map((v) => v.point));
  return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
}

// ---- Steps ----

export type When = { at?: number; with?: boolean; delay?: number };
export type Placement = { x: number; y: number; /** Length of the block's longer side, in pixels. */ size: number };
type Box = { x: number; y: number; width: number; height: number };

type Instance = {
  id: string;
  block: Block;
  first: Placement;
  enter: { kind: "draw" | "pop"; start: number; seconds: number };
  /** Position and size changes, in order: moves, pulses, an exit. */
  events: (
    | { kind: "move"; start: number; seconds: number; to: Placement; ease: Ease }
    | { kind: "pulse"; start: number }
    | { kind: "exit"; start: number; seconds: number; shrink: boolean }
  )[];
};

/** A block on the board: where its anchors and parts are, for later steps to aim at. */
export class BlockRef {
  constructor(readonly instance: Instance) {}
  get id() {
    return this.instance.id;
  }
  /** Where the block is now (after any moves so far in the script). */
  get placement(): Placement {
    const moves = this.instance.events.filter((e) => e.kind === "move");
    return moves.length ? (moves[moves.length - 1] as { to: Placement }).to : this.instance.first;
  }
  private get scale() {
    return this.placement.size / Math.max(...this.instance.block.size);
  }
  /** A named anchor's point on the board. `dx`/`dy` nudge it in pixels. */
  at(name: string, dx = 0, dy = 0): Pt {
    const { block } = this.instance;
    const a = block.anchors[name];
    if (!a) throw new Error(`${block.id} has no anchor "${name}" (it has ${Object.keys(block.anchors).join(", ")})`);
    const p = this.placement, s = this.scale;
    return { x: p.x + (a[0] - block.size[0] / 2) * s + dx, y: p.y + (a[1] - block.size[1] / 2) * s + dy };
  }
  /** The board box of the whole block, or of one part. */
  bounds(part?: string): Box {
    const { block } = this.instance;
    let box: [number, number, number, number] = [0, 0, block.size[0], block.size[1]];
    if (part) {
      const p = block.parts.find((x) => x.id === part);
      if (!p) throw new Error(`${block.id} has no part "${part}" (it has ${block.parts.map((x) => x.id).join(", ")})`);
      const bs = p.shapes.map(shapeBox);
      box = [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    }
    const pl = this.placement, s = this.scale;
    const x0 = pl.x + (box[0] - block.size[0] / 2) * s, y0 = pl.y + (box[1] - block.size[1] / 2) * s;
    return { x: x0, y: y0, width: (box[2] - box[0]) * s, height: (box[3] - box[1]) * s };
  }
  /** The centre of the block, or of one part. */
  center(part?: string): Pt {
    const b = this.bounds(part);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
}

type Draw = { color: Paint; width?: number; seconds?: number };

export class Board {
  readonly width: number;
  readonly height: number;
  private font?: { uri: string; family: string };
  private theme: Theme;
  private cursor = 0;
  private lastStart = 0;
  private count = 0;
  private instances: Instance[] = [];
  private marks: ((end: number, nodes: Record<string, SceneNode>, roots: string[]) => void)[] = [];

  constructor(o: { width?: number; height?: number; font?: { uri: string; family: string }; theme?: Theme } = {}) {
    this.width = o.width ?? 1920;
    this.height = o.height ?? 1080;
    this.font = o.font;
    this.theme = o.theme ?? CHALK;
  }

  /** The time a step starts and reserves `seconds` from; moves the cursor past it. */
  private slot(w: When, seconds: number): number {
    const start = w.at ?? (w.with ? this.lastStart : this.cursor) + (w.delay ?? 0);
    this.lastStart = start;
    this.cursor = Math.max(this.cursor, start + seconds);
    return start;
  }
  private nextId(prefix: string) {
    return `${prefix}-${++this.count}`;
  }
  /** Seconds since the start where the next step would begin. */
  get now() {
    return this.cursor;
  }

  /** Draws a block on the board, stroke by stroke (`enter: "draw"`) or popping in (`"pop"`). */
  place(block: Block, o: Placement & When & { id?: string; enter?: "draw" | "pop"; seconds?: number }): BlockRef {
    const s = o.size / Math.max(...block.size);
    const strokeLength = block.parts.flatMap((p) => p.shapes).filter((sh) => sh.stroke).reduce((sum, sh) => sum + lengthOf(polyline(outline(sh))), 0) * s;
    const kind = o.enter ?? "draw";
    const seconds = o.seconds ?? (kind === "pop" ? 0.45 : Math.min(2, Math.max(0.6, strokeLength / DRAW_SPEED)));
    const start = this.slot(o, seconds);
    const instance: Instance = { id: o.id ?? this.nextId(block.id), block, first: { x: o.x, y: o.y, size: o.size }, enter: { kind, start, seconds }, events: [] };
    this.instances.push(instance);
    return new BlockRef(instance);
  }

  /** Glides a block to a new place and/or size. */
  move(ref: BlockRef, o: Partial<Placement> & When & { seconds?: number }) {
    const seconds = o.seconds ?? 0.7;
    const start = this.slot(o, seconds);
    ref.instance.events.push({ kind: "move", start, seconds, to: { ...ref.placement, ...strip(o) }, ease: EASE.inOut });
  }

  /** A quick bounce to say "this one". */
  pulse(ref: BlockRef, o: When = {}) {
    const start = this.slot(o, 0.45);
    ref.instance.events.push({ kind: "pulse", start });
  }

  /** Takes a block off the board. */
  remove(ref: BlockRef, o: When & { seconds?: number } = {}) {
    const seconds = o.seconds ?? 0.35;
    const start = this.slot(o, seconds);
    ref.instance.events.push({ kind: "exit", start, seconds, shrink: false });
  }

  /**
   * Copies of a small block (a molecule, a drop) travelling from one point to another, one after
   * another. They pop in at `from`, glide along a gentle curve, and pop out at `to` unless `stay`.
   */
  travel(block: Block, o: When & { from: Pt; to: Pt; size: number; count?: number; stagger?: number; seconds?: number; bend?: number; stay?: boolean }): BlockRef[] {
    const count = o.count ?? 1, stagger = o.stagger ?? 0.3, seconds = o.seconds ?? 1.2;
    const total = 0.3 + seconds + stagger * (count - 1) + (o.stay ? 0 : 0.25);
    const start = this.slot(o, total);
    const refs: BlockRef[] = [];
    const bend = o.bend ?? 0.15;
    for (let i = 0; i < count; i++) {
      const t0 = start + i * stagger;
      // Copies fan out a little so a stream reads as several things, not one.
      const spread = (i - (count - 1) / 2) * o.size * 0.35;
      const nx = -(o.to.y - o.from.y), ny = o.to.x - o.from.x;
      const len = Math.hypot(nx, ny) || 1;
      const mid = {
        x: (o.from.x + o.to.x) / 2 + (nx / len) * (bend * len + spread),
        y: (o.from.y + o.to.y) / 2 + (ny / len) * (bend * len + spread),
      };
      const instance: Instance = {
        id: this.nextId(block.id),
        block,
        first: { ...o.from, size: o.size },
        enter: { kind: "pop", start: t0, seconds: 0.3 },
        events: [
          { kind: "move", start: t0 + 0.3, seconds: seconds / 2, to: { ...mid, size: o.size }, ease: { x1: 0.45, y1: 0, x2: 0.8, y2: 0.6 } },
          // Copies that stay settle side by side instead of on top of each other.
          { kind: "move", start: t0 + 0.3 + seconds / 2, seconds: seconds / 2, to: { x: o.to.x + (o.stay ? (nx / len) * spread * 2 : 0), y: o.to.y + (o.stay ? (ny / len) * spread * 2 : 0), size: o.size }, ease: { x1: 0.2, y1: 0.4, x2: 0.55, y2: 1 } },
        ],
      };
      if (!o.stay) instance.events.push({ kind: "exit", start: t0 + 0.3 + seconds, seconds: 0.25, shrink: true });
      this.instances.push(instance);
      refs.push(new BlockRef(instance));
    }
    return refs;
  }

  /** A marker arrow from one point to another, drawn on. `bend` curves it (fraction of its length, + is clockwise). */
  arrow(from: Pt, to: Pt, o: When & Partial<Draw> & { bend?: number; gap?: number; until?: number } = {}) {
    const gap = o.gap ?? 14;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const a = { x: from.x + ux * gap, y: from.y + uy * gap }, b = { x: to.x - ux * gap, y: to.y - uy * gap };
    const bend = (o.bend ?? 0) * len;
    const c = { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend };
    const pts: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
    }
    const end = pts[24], before = pts[21];
    const ang = Math.atan2(end.y - before.y, end.x - before.x), head = 26;
    const headPts = [-1, 1].map((side) => ({ x: end.x - Math.cos(ang + side * 0.5) * head, y: end.y - Math.sin(ang + side * 0.5) * head }));
    const seconds = o.seconds ?? Math.min(1.2, Math.max(0.4, len / DRAW_SPEED));
    const start = this.slot(o, seconds + 0.15);
    const id = this.nextId("arrow");
    this.marks.push((endTick, nodes, roots) => {
      const color = paint(o.color ?? "ink"), width = o.width ?? theme.marker;
      const opacity = o.until !== undefined ? fadeOut(`${id}.o`, o.until) : undefined;
      const shaft = { closed: false, vertices: pts.map((p) => vtx(p.x, p.y)) };
      const heads = { closed: false, vertices: [vtx(headPts[0].x, headPts[0].y), vtx(end.x, end.y), vtx(headPts[1].x, headPts[1].y)] };
      for (const [suffix, contour, t0, t1] of [["", shaft, start, start + seconds], ["-head", heads, start + seconds, start + seconds + 0.15]] as const) {
        nodes[id + suffix] = {
          ...base(id + suffix, { outTick: endTick }),
          type: "path",
          path: constant({ contours: [contour] }),
          style: { stroke: stroke(color, width, opacity ? { opacity } : {}) },
          operators: [trim(`${id}${suffix}.trim`, { end: drawOn(`${id}${suffix}.end`, t0, t1) })],
        };
        roots.push(id + suffix);
      }
    });
    return id;
  }

  /**
   * Circles a block, one of its parts, or any box with a marker loop (`style: "circle"`), or swipes
   * a highlighter behind it (`style: "highlighter"`). `until` (seconds) takes it away again.
   */
  highlight(target: BlockRef | Box, o: When & Partial<Draw> & { part?: string; style?: "circle" | "highlighter"; pad?: number; until?: number } = {}) {
    const box = target instanceof BlockRef ? target.bounds(o.part) : target;
    const style = o.style ?? "circle";
    const seconds = o.seconds ?? 0.6;
    const start = this.slot(o, seconds);
    const id = this.nextId("highlight");
    const pad = o.pad ?? 18;
    this.marks.push((endTick, nodes, roots) => {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const opacity = o.until !== undefined ? fadeOut(`${id}.o`, o.until) : undefined;
      let contour: PathContour, color: Color, width: number;
      if (style === "circle") {
        // A hand-drawn loop: a little more than one turn, its radius drifting so the ends don't meet.
        const rx = box.width / 2 + pad, ry = box.height / 2 + pad;
        const vs: PathVertex[] = [];
        for (let i = 0; i <= 56; i++) {
          const t = i / 56, a = (-110 + t * 385) * (Math.PI / 180), k = 1.04 - t * 0.1;
          vs.push(vtx(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
        }
        contour = { closed: false, vertices: vs };
        color = paint(o.color ?? "red");
        width = o.width ?? theme.marker;
      } else {
        // A highlighter stroke across the box, behind everything drawn so far.
        contour = { closed: false, vertices: [vtx(box.x - pad / 2, cy), vtx(box.x + box.width + pad / 2, cy)] };
        color = paint(o.color ?? "highlighter");
        width = o.width ?? box.height + pad;
      }
      nodes[id] = {
        ...base(id, { outTick: endTick }),
        type: "path",
        path: constant({ contours: [contour] }),
        style: { stroke: stroke(color, width, { cap: style === "circle" ? "round" : "butt", opacity: opacity ?? (style === "circle" ? 1 : theme.highlighter) }) },
        operators: [trim(`${id}.trim`, { end: drawOn(`${id}.end`, start, start + seconds) })],
      };
      if (style === "circle") roots.push(id);
      else roots.splice(1, 0, id); // right above the board
    });
    return id;
  }

  /** Handwritten-size text, fading in. Needs a font on the board. */
  label(text: string, o: Pt & When & { size?: number; color?: Paint; align?: "left" | "center" | "right"; width?: number; until?: number }) {
    if (!this.font) throw new Error("label needs a font: new Board({ font: { uri, family } })");
    const seconds = 0.35;
    const start = this.slot(o, seconds);
    const id = this.nextId("label");
    const size = o.size ?? 40, width = o.width ?? 700, align = o.align ?? "center";
    this.marks.push((endTick, nodes, roots) => {
      const left = align === "center" ? o.x - width / 2 : align === "right" ? o.x - width : o.x;
      const keys = new Keys(0);
      keys.to(tk(start), 1, seconds, EASE.out);
      if (o.until !== undefined) keys.to(tk(o.until), 0, 0.3, EASE.inOut);
      nodes[id] = {
        ...base(id, { outTick: endTick, x: left, y: o.y - size * 0.75, opacity: keys.track(`${id}.o`) }),
        type: "text",
        runs: constant([{ text, fontAssetId: "font", fontSize: size, fontWeight: 700, letterSpacing: 0, lineHeight: size * 1.2, color: paint(o.color ?? "ink") }]),
        box: { width, height: size * 1.5 },
        wrap: "none",
        align,
        verticalAlign: "top",
      };
      roots.push(id);
    });
    return id;
  }

  /** Leaves a pause before the next step. */
  wait(seconds: number) {
    this.cursor += seconds;
  }

  build(id: string, name: string, o: { hold?: number } = {}): AnimationDocument {
    theme = this.theme;
    const end = tk(this.cursor + (o.hold ?? 1));
    const nodes: Record<string, SceneNode> = {
      board: {
        ...base("board", { outTick: end, x: this.width / 2, y: this.height / 2 }),
        type: "rect",
        size: constant({ width: this.width, height: this.height }),
        cornerRadius: constant(0),
        style: { fill: fill(paint("board")) },
      },
    };
    const roots = ["board"];
    for (const instance of this.instances) {
      compileInstance(instance, end, nodes);
      roots.push(instance.id);
    }
    for (const mark of this.marks) mark(end, nodes, roots);
    const size = { width: this.width, height: this.height };
    if (theme.chalk) {
      // Everything drawn goes through the chalk shader as one layer.
      nodes.drawing = { ...base("drawing", { outTick: end }), type: "group", children: roots.splice(1) };
      nodes.chalk = effect("chalk", "drawing", "custom-sksl", end, [["grain", theme.chalk.grain, 0, 1]], CHALK_SKSL);
      roots.push("chalk");
    }
    if (theme.smudges) {
      Object.assign(nodes, smudges(size, end));
      roots.splice(1, 0, "smudge-blur");
    }
    const doc = withComputedRevision({
      version: ANIMATION_DOCUMENT_VERSION,
      id,
      revision: "",
      name,
      canvas: { ...size, pixelAspectRatio: 1, backgroundColor: paint("board") },
      timing: { ticksPerSecond: TPS, frameRate: { numerator: 30, denominator: 1 }, durationTicks: end, displayStartTick: 0 },
      assets: this.font ? { font: { id: "font", type: "font", uri: this.font.uri, family: this.font.family, style: "normal", weight: 400 } } : {},
      compositions: { main: { id: "main", name, ...size, durationTicks: end, nodes, rootNodeIds: roots } },
      rootCompositionId: "main",
      components: {},
      markers: [],
      capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
    } as AnimationDocument);
    try {
      assertValidAnimationDocument(doc);
    } catch (e) {
      const diagnostics = (e as { diagnostics?: { path?: string; message: string }[] }).diagnostics ?? [];
      throw new Error(`${id} is invalid:\n${diagnostics.map((d) => `  ${d.path ?? ""} ${d.message}`).join("\n") || e}`);
    }
    return doc;
  }
}

function strip(o: Partial<Placement>): Partial<Placement> {
  const out: Partial<Placement> = {};
  if (o.x !== undefined) out.x = o.x;
  if (o.y !== undefined) out.y = o.y;
  if (o.size !== undefined) out.size = o.size;
  return out;
}

/** 0 → 1 between two times in seconds, for `trim`. */
function drawOn(id: string, from: number, to: number): Animatable<number> {
  const keys = new Keys(0);
  keys.to(tk(from), 1, Math.max(to - from, 1 / 30), EASE.draw);
  return keys.track(id);
}

function fadeOut(id: string, at: number): Animatable<number> {
  const keys = new Keys(1);
  keys.to(tk(at), 0, 0.3, EASE.inOut);
  return keys.track(id);
}

// ---- A placed block as nodes ----

function compileInstance(inst: Instance, end: number, nodes: Record<string, SceneNode>) {
  const { block, first } = inst;
  const [w, h] = block.size;
  const scaleOf = (p: Placement) => p.size / Math.max(w, h);
  const s0 = scaleOf(first);
  const v3 = (s: number): Vec3 => ({ x: s, y: s, z: 1 });

  // Position, scale and opacity of the whole block over time.
  const pos = new Keys<Vec3>({ x: first.x, y: first.y, z: 0 });
  const scale = new Keys<Vec3>(v3(s0));
  const opacity = new Keys(1);
  const { enter } = inst;
  if (enter.kind === "pop") {
    // Almost nothing rather than 0: a clip path inside a block cannot be drawn at scale 0.
    scale.list.splice(0, 1, [0, v3(0.0001)]);
    scale.add(tk(enter.start), v3(0.0001), EASE.pop);
    scale.add(tk(enter.start + 0.5), v3(s0));
  }
  let s = s0;
  for (const e of inst.events) {
    if (e.kind === "move") {
      pos.to(tk(e.start), { x: e.to.x, y: e.to.y, z: 0 }, e.seconds, e.ease);
      const next = scaleOf(e.to);
      if (next !== s) scale.to(tk(e.start), v3(next), e.seconds, e.ease);
      s = next;
    } else if (e.kind === "pulse") {
      scale.to(tk(e.start), v3(s * 1.12), 0.15, EASE.out);
      scale.to(tk(e.start + 0.15), v3(s), 0.3, EASE.inOut);
    } else if (e.kind === "exit") {
      if (e.shrink) scale.to(tk(e.start), v3(0.0001), e.seconds, EASE.inOut);
      else opacity.to(tk(e.start), 0, e.seconds, EASE.inOut);
    }
  }

  // Draw windows: each outline gets a share of the entrance by its length, in order, like a hand drawing.
  const shapes = block.parts.flatMap((p) => p.shapes.map((shape) => ({ part: p.id, shape })));
  const lengths = shapes.map(({ shape }) => (shape.stroke ? lengthOf(polyline(outline(shape))) : 0));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let t = enter.start;
  const windows = lengths.map((len) => {
    const from = t;
    t += (len / total) * enter.seconds;
    return [from, t] as const;
  });

  const markerWidth = (shape: Shape) => ((shape.width ?? 1) * theme.marker) / s0;
  const partChildren: Record<string, string[]> = {};
  shapes.forEach(({ part, shape }, i) => {
    const sid = `${inst.id}-${part}-${i}`;
    (partChildren[part] ??= []);
    const [from, to] = windows[i];
    const drawing = enter.kind === "draw";
    const contours = outline(shape);
    if (shape.fill) {
      const fid = `${sid}-fill`;
      // The fill arrives once its outline is drawn (or with the previous outline when it has none).
      const at = shape.stroke ? to : from;
      if (theme.fill === "hatch" && theme.hatch && shape.fill.endsWith("-tint")) {
        // Shaded in with the side of the chalk: a zigzag scribble clipped to the shape.
        const { spacing, width, opacity, angle, seconds } = theme.hatch;
        const clip = `${fid}-clip`, scribble = `${fid}-hatch`;
        nodes[clip] = { ...base(clip, { outTick: end }), type: "path", path: constant({ contours }), style: {} };
        nodes[scribble] = {
          ...base(scribble, { outTick: end }),
          type: "path",
          path: constant({ contours: [hatch(shapeBox(shape), spacing / s0, angle, i)] }),
          style: { stroke: stroke(paint(shape.fill), width / s0, { opacity }) },
          ...(drawing ? { operators: [trim(`${scribble}.trim`, { end: drawOn(`${scribble}.end`, at, at + seconds) })] } : {}),
        };
        nodes[fid] = { ...base(fid, { outTick: end }), type: "group", children: [scribble], clipPathId: clip };
      } else {
        // With no fills, a tint becomes the board colour, arriving as its outline starts.
        const blank = theme.fill === "none" && shape.fill.endsWith("-tint");
        const fillOpacity = drawing ? new Keys(0) : new Keys(1);
        if (drawing) fillOpacity.to(tk(blank ? from : at), 1, blank ? 0.1 : 0.3, EASE.out);
        nodes[fid] = {
          ...base(fid, { outTick: end }),
          type: "path",
          path: constant({ contours }),
          style: { fill: fill(paint(blank ? "board" : shape.fill), fillOpacity.track(`${fid}.o`)) },
        };
      }
      partChildren[part].push(fid);
    }
    if (shape.stroke) {
      nodes[sid] = {
        ...base(sid, { outTick: end }),
        type: "path",
        path: constant({ contours: drawing ? polyline(contours) : contours }),
        style: { stroke: stroke(paint(shape.stroke), markerWidth(shape)) },
        ...(drawing ? { operators: [trim(`${sid}.trim`, { end: drawOn(`${sid}.end`, from, to) })] } : {}),
      };
      partChildren[part].push(sid);
    }
  });

  for (const part of block.parts) {
    const pid = `${inst.id}-${part.id}`;
    nodes[pid] = { ...base(pid, { outTick: end }), type: "group", children: partChildren[part.id] ?? [] };
  }
  const fading = opacity.list.length > 1;
  nodes[inst.id] = {
    ...base(inst.id, {
      outTick: end,
      inTick: tk(enter.start),
      position: pos.track(`${inst.id}.pos`),
      anchor: { x: w / 2, y: h / 2 },
      scale: scale.track(`${inst.id}.scale`),
      opacity: opacity.track(`${inst.id}.o`),
    }),
    type: "group",
    children: block.parts.map((p) => `${inst.id}-${p.id}`),
    ...(fading ? { isolation: true } : {}),
  };
}

// ---- Chalk ----

/**
 * Back-and-forth strokes across a box at `angle` degrees, `spacing` apart, each a little uneven,
 * running past the box so the clip cuts their turns off.
 */
function hatch([x0, y0, x1, y1]: [number, number, number, number], spacing: number, angle: number, seed: number): PathContour {
  const a = (angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) }, n = { x: -Math.sin(a), y: Math.cos(a) };
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const along = corners.map(([x, y]) => x * u.x + y * u.y), across = corners.map(([x, y]) => x * n.x + y * n.y);
  const [u0, u1] = [Math.min(...along) - spacing * 2, Math.max(...along) + spacing * 2];
  const [n0, n1] = [Math.min(...across), Math.max(...across)];
  const rand = (k: number) => {
    const v = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  const vs: PathVertex[] = [];
  for (let k = 0, c = n0 + spacing * 0.3; c <= n1 + spacing * 0.5; k++, c += spacing) {
    const ends = [u0 + rand(k) * spacing * 1.5, u1 + rand(k + 50) * spacing * 1.5];
    if (k % 2) ends.reverse();
    for (const [j, e] of ends.entries()) {
      const cc = c + rand(k * 3 + j) * spacing * 0.35;
      vs.push(vtx(u.x * e + n.x * cc, u.y * e + n.y * cc));
    }
  }
  return { closed: false, vertices: vs };
}

/** Grain and slightly broken edges, like chalk dragged over slate. Works in board pixels at any render size. */
const CHALK_SKSL = `
uniform shader inputImage;
uniform float grain;
uniform float2 renderScale;
float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float vnoise(float2 p) {
  float2 i = floor(p); float2 f = fract(p);
  float a = hash(i), b = hash(i + float2(1, 0)), c = hash(i + float2(0, 1)), d = hash(i + float2(1, 1));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
half4 main(float2 p) {
  float2 q = p / renderScale.x;
  float2 wobble = (float2(vnoise(q * 0.3), vnoise(q * 0.3 + 17.0)) - 0.5) * 2.5;
  half4 src = inputImage.eval((q + wobble) * renderScale.x);
  if (src.a < 0.002) { return half4(0.0); }
  half4 c = unpremul(src);
  float fine = hash(floor(q * 1.3));
  float mid = vnoise(q * 0.55);
  float streak = vnoise(float2(q.x * 0.12 + q.y * 0.04, q.y * 1.1));
  float keep = smoothstep(0.22, 0.6, fine * 0.5 + mid * 0.3 + streak * 0.2);
  float a = float(c.a) * mix(1.0, keep, grain);
  return half4(c.rgb * half(a), half(a));
}`;

function effect(id: string, inputId: string, kind: "custom-sksl" | "blur", end: number, params: [string, number, number, number][], sksl?: string): SceneNode {
  return {
    ...base(id, { outTick: end }),
    type: "effect",
    inputId,
    effect: kind,
    ...(sksl ? { implementation: sksl } : {}),
    parameters: params.map(([name, value, minimum, maximum]) => ({ id: `${id}-${name}`, name, valueType: "number" as const, value: constant(value), minimum, maximum })),
    capability: { requires: [kind === "blur" ? "image-filter" : "runtime-effect"], fallback: "passthrough", maxTemporarySurfaces: 1 },
  } as SceneNode;
}

/** A few broad, faint, blurred strokes: a board that has been wiped before. */
function smudges(size: { width: number; height: number }, end: number): Record<string, SceneNode> {
  const { width: W, height: H } = size;
  const swipes = [
    [[0.08, 0.3], [0.3, 0.22], [0.52, 0.3]],
    [[0.55, 0.72], [0.75, 0.62], [0.95, 0.7]],
    [[0.2, 0.85], [0.4, 0.78], [0.6, 0.86]],
    [[0.62, 0.15], [0.8, 0.1], [0.92, 0.2]],
  ];
  const contours = swipes.map((pts) => ({ closed: false, vertices: pts.map(([x, y]) => vtx(x * W, y * H)) }));
  return {
    smudges: { ...base("smudges", { outTick: end }), type: "path", path: constant({ contours }), style: { stroke: stroke(paint("ink"), 150, { opacity: 0.045 }) } },
    "smudge-blur": effect("smudge-blur", "smudges", "blur", end, [["radius", 60, 0, 200]]),
  };
}
