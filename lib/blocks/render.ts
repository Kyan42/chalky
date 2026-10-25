/**
 * Draws Janani's blocks (lib/blocks/biology) onto our Scene (experiments/visual-flex/doc.ts):
 * the 1200x800 stage, 240 ticks/s on the 60 fps grid, 20 s documents, time 0 = the anchor word.
 *
 * Ported from her presets/board.ts: draw-on in stroke order at a constant marker speed with
 * tints fading in after their outline, a pop entrance, copies travelling along a bend, a
 * hand-drawn loop. Her Board class, 1920x1080 pixels, Manrope and 30 fps are not used.
 *
 * Units: inputs the model speaks (cx, cy, size, from, to) are GRID units on the 100x100 board;
 * everything returned (boxes, anchors) is in STAGE pixels, which is what lib/lesson/presets.ts
 * registers for layout, label avoidance and arrow snapping. `size` is the block's longer side
 * in grid x units; the block keeps its aspect on screen, so its y extent spans 1.5x as many
 * grid y units as grid x units.
 */
import {
  base,
  constant,
  fill,
  hex,
  keyed,
  parseSvgPath,
  stroke,
  trim,
  type Animatable,
  type Color,
  type CubicBezier,
  type Ease,
  type Key,
  type PathContour,
  type PathVertex,
  type SceneNode,
  type Vec3,
} from "@clayzo/animation/authoring";
import { END, H, hatchContour, Scene, safeId, tick, W, type Box } from "@/experiments/visual-flex/doc";
import { DEFAULT_THEME, themeHex, tintHex, type Theme } from "@/lib/board/theme";
import type { Block, Paint, Shape } from "./types";

// ---- Units ----

export type Pt = [number, number];
export type { Box };

/** Grid x / y to stage pixels. */
export const gx = (x: number) => (x / 100) * W;
export const gy = (y: number) => (y / 100) * H;
/** Stage pixels back to grid x / y. */
export const ungx = (px: number) => (px / W) * 100;
export const ungy = (px: number) => (px / H) * 100;

// ---- Look ----

/** A colour name or hex on the theme (the scene's own theme when drawing). */
export function paint(p: Paint | undefined, fallback = "ink", theme: Theme = DEFAULT_THEME): Color {
  return hex(themeHex(theme, p, fallback));
}

/** Marker thickness in stage pixels on the default theme (CHALK); a scene draws with its own theme's. */
export const MARKER = DEFAULT_THEME.marker;
/** How fast the marker moves when drawing, in stage pixels per second (hers: 1500 on 1920). */
const DRAW_SPEED = 940;

// ---- Time ----

const FRAME = 4; // 240 ticks/s at 60 fps
const tk = (seconds: number) => tick(seconds);

const EASE = {
  out: { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 } as CubicBezier,
  inOut: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } as CubicBezier,
  draw: { x1: 0.4, y1: 0, x2: 0.4, y2: 1 } as CubicBezier,
  travelOut: { x1: 0.45, y1: 0, x2: 0.8, y2: 0.6 } as CubicBezier,
  travelIn: { x1: 0.2, y1: 0.4, x2: 0.55, y2: 1 } as CubicBezier,
};

/** Keys in increasing ticks: a key at the same tick as the last replaces it, an earlier one is dropped. */
class Keys<T> {
  readonly list: [number, T, Ease?][] = [];
  constructor(first: T) {
    this.list.push([0, first]);
  }
  get last(): T {
    return this.list[this.list.length - 1][1];
  }
  /** Holds the current value until `tick`, then moves to `value` by `seconds` with `ease`. */
  to(tick: number, value: T, seconds: number, ease: Ease = EASE.inOut) {
    this.add(tick, this.last, ease);
    this.add(tick + Math.max(FRAME, Math.round((seconds * 240) / FRAME) * FRAME), value);
  }
  add(tick: number, value: T, ease?: Ease) {
    tick = Math.min(END - FRAME, Math.max(0, Math.round(tick / FRAME) * FRAME));
    const prev = this.list[this.list.length - 1];
    if (tick < prev[0]) return;
    if (tick === prev[0]) this.list.pop();
    else if (prev[2] === undefined) this.list[this.list.length - 1] = [prev[0], prev[1], "hold"];
    this.list.push(ease ? [tick, value, ease] : [tick, value]);
  }
  track(id: string): Animatable<T> {
    if (this.list.length === 1) return constant(this.list[0][1]);
    return keyed(id, this.list.map(([t, v, e], i): Key<T> => (i === this.list.length - 1 ? [t, v] : [t, v, e ?? "hold"])));
  }
}

/** 0 → 1 between two times in seconds, for `trim`. */
function drawOn(id: string, from: number, to: number): Animatable<number> {
  const keys = new Keys(0);
  keys.to(tk(from), 1, Math.max(to - from, 1 / 60), EASE.draw);
  return keys.track(id);
}

// ---- Geometry (hers) ----

const ZERO = { x: 0, y: 0 };
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
export function polyline(contours: PathContour[]): PathContour[] {
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

export function outline(shape: Shape): PathContour[] {
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

export const lengthOf = (contours: PathContour[]) =>
  contours.reduce((sum, c) => sum + c.vertices.slice(1).reduce((s, v, i) => s + Math.hypot(v.point.x - c.vertices[i].point.x, v.point.y - c.vertices[i].point.y), 0), 0);

/** A shape's box in block units [x0, y0, x1, y1]. */
export function shapeBox(shape: Shape): [number, number, number, number] {
  const pts = polyline(outline(shape)).flatMap((c) => c.vertices.map((v) => v.point));
  return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
}

/** A part's box in block units. */
export function partBox(block: Block, partId: string): [number, number, number, number] | null {
  const p = block.parts.find((x) => x.id === partId);
  if (!p) return null;
  const bs = p.shapes.map(shapeBox);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

/** Stroke length of a block drawn at scale 1 (block units). */
export function strokeLength(block: Block): number {
  return block.parts.flatMap((p) => p.shapes).filter((sh) => sh.stroke).reduce((sum, sh) => sum + lengthOf(polyline(outline(sh))), 0);
}

// ---- Placement ----

export interface Placement {
  /** Centre on the grid. */
  cx: number;
  cy: number;
  /** The block's longer side, in grid x units. */
  size: number;
}

/** Where a block placed like this lands, in stage pixels: its box, each part's box and each anchor. */
export function placeBlock(block: Block, p: Placement): { center: Pt; scale: number; box: Box; parts: Record<string, Box>; anchors: Record<string, Pt> } {
  const [w, h] = block.size;
  const scale = gx(p.size) / Math.max(w, h);
  const center: Pt = [gx(p.cx), gy(p.cy)];
  const toStage = ([x0, y0, x1, y1]: [number, number, number, number]): Box => ({
    x1: center[0] + (x0 - w / 2) * scale,
    y1: center[1] + (y0 - h / 2) * scale,
    x2: center[0] + (x1 - w / 2) * scale,
    y2: center[1] + (y1 - h / 2) * scale,
  });
  const parts: Record<string, Box> = {};
  for (const part of block.parts) {
    const b = partBox(block, part.id);
    if (b) parts[part.id] = toStage(b);
  }
  const anchors: Record<string, Pt> = {};
  for (const [name, [ax, ay]] of Object.entries(block.anchors)) anchors[name] = [center[0] + (ax - w / 2) * scale, center[1] + (ay - h / 2) * scale];
  return { center, scale, box: toStage([0, 0, w, h]), parts, anchors };
}

/** The grid-unit box a placement would cover (for fitting a beat into its region). */
export function gridBox(block: Block, p: Placement): [number, number, number, number] {
  const { box } = placeBlock(block, p);
  return [ungx(box.x1), ungy(box.y1), ungx(box.x2), ungy(box.y2)];
}

/** Seconds the marker needs to draw a block at this size (0.6 to 2). */
export function drawSeconds(block: Block, size: number): number {
  const scale = gx(size) / Math.max(...block.size);
  return Math.min(2, Math.max(0.6, (strokeLength(block) * scale) / DRAW_SPEED));
}

// ---- Nodes ----

const counters = new WeakMap<Scene, number>();
function nextId(scene: Scene, prefix: string): string {
  const n = (counters.get(scene) ?? 0) + 1;
  counters.set(scene, n);
  return safeId(`blk-${n}-${prefix}`);
}
/** Adds a node to the scene without drawing it at the root (children of a group). */
function child(scene: Scene, node: SceneNode) {
  scene.nodes[node.id] = node;
}
/** Adds a node drawn at the root, in order. */
function root(scene: Scene, node: SceneNode) {
  scene.nodes[node.id] = node;
  scene.order.push(node.id);
}

const v3 = (s: number): Vec3 => ({ x: s, y: s, z: 1 });

interface Motion {
  /** Group position over time (stage pixels); constant when never moved. */
  pos: Keys<Vec3>;
  /** Group scale over time. */
  scale: Keys<Vec3>;
  opacity: Keys<number>;
}

/**
 * A block as one group of part groups of path nodes, in block units, positioned and scaled by
 * `motion` (her compileInstance). `enter` draws it stroke by stroke from `start` over `seconds`
 * (`"draw"`), or leaves that to the scale track (`"pop"`); `finished` draws it complete.
 */
function compileBlock(scene: Scene, block: Block, o: { id: string; scale: number; motion: Motion; inTick: number; enter: "draw" | "pop" | "finished"; start: number; seconds: number }): () => void {
  const [w, h] = block.size;
  const rootId = o.id;
  const drawing = o.enter === "draw";

  // Draw windows: each outline gets a share of the entrance by its length, in order, like a hand drawing.
  const shapes = block.parts.flatMap((p) => p.shapes.map((shape) => ({ part: p.id, shape })));
  const lengths = shapes.map(({ shape }) => (shape.stroke ? lengthOf(polyline(outline(shape))) : 0));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let t = o.start;
  const windows = lengths.map((len) => {
    const from = t;
    t += (len / total) * o.seconds;
    return [from, t] as const;
  });

  const { theme } = scene;
  const markerWidth = (shape: Shape) => ((shape.width ?? 1) * theme.marker) / o.scale;
  const partChildren: Record<string, string[]> = {};
  shapes.forEach(({ part, shape }, i) => {
    const sid = `${rootId}-${part}-${i}`;
    partChildren[part] ??= [];
    const [from, to] = windows[i];
    const contours = outline(shape);
    if (shape.fill) {
      const fid = `${sid}-fill`;
      // The tint arrives once its outline is drawn (or with the previous outline when it has none).
      const at = shape.stroke ? to : from;
      if (theme.fill === "hatch" && theme.hatch && shape.fill.endsWith("-tint")) {
        // Shaded in with the side of the chalk: a zigzag scribble clipped to the shape.
        const { spacing, width, opacity, angle, seconds } = theme.hatch;
        const clip = `${fid}-clip`, scribble = `${fid}-hatch`;
        child(scene, { ...base(clip, { outTick: END }), type: "path", path: constant({ contours }), style: {} } as SceneNode);
        child(scene, {
          ...base(scribble, { outTick: END }),
          type: "path",
          path: constant({ contours: [hatchContour(shapeBox(shape), spacing / o.scale, angle, i)] }),
          style: { stroke: stroke(hex(tintHex(theme, shape.fill)), width / o.scale, { opacity }) },
          ...(drawing ? { operators: [trim(`${scribble}.trim`, { end: drawOn(`${scribble}.end`, at, at + seconds) })] } : {}),
        } as SceneNode);
        child(scene, { ...base(fid, { outTick: END }), type: "group", children: [scribble], clipPathId: clip } as SceneNode);
      } else {
        // With no fills, a tint becomes the board colour, arriving as its outline starts.
        const blank = theme.fill === "none" && shape.fill.endsWith("-tint");
        const fillOpacity = new Keys(drawing ? 0 : 1);
        if (drawing) fillOpacity.to(tk(blank ? from : at), 1, blank ? 0.1 : 0.3, EASE.out);
        child(scene, {
          ...base(fid, { outTick: END }),
          type: "path",
          path: constant({ contours }),
          style: { fill: fill(paint(blank ? "board" : shape.fill, "ink", theme), fillOpacity.track(`${fid}.o`)) },
        });
      }
      partChildren[part].push(fid);
    }
    if (shape.stroke) {
      child(scene, {
        ...base(sid, { outTick: END }),
        type: "path",
        path: constant({ contours: drawing ? polyline(contours) : contours }),
        style: { stroke: stroke(paint(shape.stroke, "ink", theme), markerWidth(shape)) },
        ...(drawing ? { operators: [trim(`${sid}.trim`, { end: drawOn(`${sid}.end`, from, to) })] } : {}),
      });
      partChildren[part].push(sid);
    }
  });

  for (const part of block.parts) {
    const pid = `${rootId}-${part.id}`;
    child(scene, { ...base(pid, { outTick: END }), type: "group", children: partChildren[part.id] ?? [] });
  }
  const { pos, scale, opacity } = o.motion;
  // The root group is rebuilt from `motion` whenever a later step (a pulse) changes it.
  const node = (): SceneNode => ({
    ...base(rootId, {
      outTick: END,
      inTick: o.inTick,
      position: pos.track(`${rootId}.pos`),
      anchor: { x: w / 2, y: h / 2 },
      scale: scale.track(`${rootId}.scale`),
      opacity: opacity.track(`${rootId}.o`),
    }),
    type: "group",
    children: block.parts.map((p) => `${rootId}-${p.id}`),
    ...(opacity.list.length > 1 ? { isolation: true } : {}),
  }) as SceneNode;
  root(scene, node());
  return () => {
    scene.nodes[rootId] = node();
  };
}

/** A quick scale bounce at `at` seconds, to say "this one". */
function pulse(scale: Keys<Vec3>, s: number, at: number) {
  scale.to(tk(at), v3(s * 1.12), 0.15, EASE.out);
  scale.to(tk(at + 0.15), v3(s), 0.3, EASE.inOut);
}

/** The pop entrance: scale 0 → overshoot → 1 over half a second (hers is a spring; ours is a cubic on the 60 fps grid). */
function pop(scale: Keys<Vec3>, s: number, at: number) {
  scale.list.splice(0, 1, [0, v3(0)]);
  scale.add(tk(at), v3(0), EASE.out);
  scale.add(tk(at) + 6 * FRAME, v3(s * 1.08), EASE.out);
  scale.add(tk(at) + 10 * FRAME, v3(s));
}

export interface RenderBlockOptions extends Placement {
  /** Seconds after the anchor word; negative draws the block already finished. */
  at: number;
  /** Seconds the entrance takes; default from the stroke length (draw) or 0.5 (pop). */
  dur?: number;
  enter?: "draw" | "pop";
  /** Draw it complete with no animation (an earlier beat's block). Same as `at < 0`. */
  finished?: boolean;
  /** Seconds after the anchor word to bounce it (each once). */
  pulseAt?: number[];
  /** Node id prefix; default from the block id. */
  id?: string;
}

export interface Rendered {
  /** The root node's id in the document. */
  node: string;
  /** Bounces the block at `at` seconds after the anchor word (her pulse). */
  pulse: (at: number) => void;
  /** Seconds the entrance takes (0 when finished). */
  seconds: number;
  box: Box;
  parts: Record<string, Box>;
  anchors: Record<string, Pt>;
}

/** Draws a block on the board, stroke by stroke or popping in; finished for blocks from earlier beats. */
export function renderBlock(scene: Scene, block: Block, o: RenderBlockOptions): Rendered {
  const placed = placeBlock(block, o);
  const finished = o.finished || o.at < 0;
  const enter = o.enter ?? "draw";
  const start = Math.max(0, o.at);
  const seconds = finished ? 0 : enter === "pop" ? 0.5 : Math.max(0.3, Math.min(3, o.dur ?? drawSeconds(block, o.size)));
  const motion: Motion = {
    pos: new Keys<Vec3>({ x: placed.center[0], y: placed.center[1], z: 0 }),
    scale: new Keys<Vec3>(v3(placed.scale)),
    opacity: new Keys(1),
  };
  if (!finished && enter === "pop") pop(motion.scale, placed.scale, start);
  for (const at of o.pulseAt ?? []) if (at >= 0) pulse(motion.scale, placed.scale, at);
  const id = nextId(scene, o.id ?? block.id);
  const rebuild = compileBlock(scene, block, {
    id,
    scale: placed.scale,
    motion,
    inTick: finished ? 0 : tk(start),
    enter: finished ? "finished" : enter,
    start,
    seconds,
  });
  const bounce = (at: number) => {
    if (at < 0) return;
    pulse(motion.scale, placed.scale, at);
    rebuild();
  };
  return { node: id, pulse: bounce, seconds, box: placed.box, parts: placed.parts, anchors: placed.anchors };
}

export interface RenderTravelOptions {
  /** Grid points the copies travel between. */
  from: Pt;
  to: Pt;
  /** Each copy's longer side, in grid x units. */
  size: number;
  count?: number;
  /** Sideways bow of the path, as a fraction of its length (+ is to the right of travel). */
  bend?: number;
  /** Copies stay at `to` instead of popping out there. */
  stay?: boolean;
  /** Seconds after the anchor word the first copy appears; negative shows only staying copies, finished. */
  at: number;
  /** Seconds each copy travels (default 1.2). */
  seconds?: number;
  /** Seconds between copies (default 0.3). */
  stagger?: number;
  id?: string;
}

/**
 * Copies of a small block (a molecule, a drop) travelling from one point to another, one after
 * another: they pop in at `from`, glide along a gentle curve and pop out at `to` unless `stay`.
 * Returns how long the whole stream takes and the stage boxes where staying copies end up.
 */
export function renderTravel(scene: Scene, block: Block, o: RenderTravelOptions): { seconds: number; ends: Box[]; box: Box } {
  const count = Math.max(1, Math.min(6, Math.round(o.count ?? 3)));
  const stagger = o.stagger ?? 0.3, seconds = o.seconds ?? 1.2;
  const total = 0.3 + seconds + stagger * (count - 1) + (o.stay ? 0 : 0.25);
  const finished = o.at < 0;
  const start = Math.max(0, o.at);
  const from: Pt = [gx(o.from[0]), gy(o.from[1])], to: Pt = [gx(o.to[0]), gy(o.to[1])];
  const sizePx = gx(o.size);
  const bend = o.bend ?? 0.15;
  const nx = -(to[1] - from[1]), ny = to[0] - from[0];
  const len = Math.hypot(nx, ny) || 1;
  const ends: Box[] = [];
  for (let i = 0; i < count; i++) {
    // Copies fan out a little so a stream reads as several things, not one.
    const spread = (i - (count - 1) / 2) * sizePx * 0.35;
    const settle: Pt = o.stay ? [to[0] + (nx / len) * spread * 2, to[1] + (ny / len) * spread * 2] : to;
    // Earlier beats' streams are over; only copies that stayed remain, finished where they settled.
    if (finished && !o.stay) continue;
    const scale = sizePx / Math.max(...block.size);
    const placedEnd = placeBlock(block, { cx: ungx(settle[0]), cy: ungy(settle[1]), size: o.size });
    if (o.stay) ends.push(placedEnd.box);
    if (finished) {
      renderBlock(scene, block, { cx: ungx(settle[0]), cy: ungy(settle[1]), size: o.size, at: -1, id: o.id ?? `${block.id}-stay` });
      continue;
    }
    const t0 = start + i * stagger;
    const mid: Pt = [(from[0] + to[0]) / 2 + (nx / len) * (bend * len + spread), (from[1] + to[1]) / 2 + (ny / len) * (bend * len + spread)];
    const motion: Motion = { pos: new Keys<Vec3>({ x: from[0], y: from[1], z: 0 }), scale: new Keys<Vec3>(v3(scale)), opacity: new Keys(1) };
    pop(motion.scale, scale, t0);
    motion.pos.to(tk(t0 + 0.3), { x: mid[0], y: mid[1], z: 0 }, seconds / 2, EASE.travelOut);
    motion.pos.to(tk(t0 + 0.3 + seconds / 2), { x: settle[0], y: settle[1], z: 0 }, seconds / 2, EASE.travelIn);
    if (!o.stay) motion.scale.to(tk(t0 + 0.3 + seconds), v3(0.0001), 0.25, EASE.inOut);
    const id = nextId(scene, o.id ?? `${block.id}-travel`);
    compileBlock(scene, block, { id, scale, motion, inTick: tk(t0), enter: "pop", start: t0, seconds: 0.5 });
  }
  const xs = [from[0], to[0]], ys = [from[1], to[1]];
  const pad = sizePx / 2;
  return { seconds: total, ends, box: { x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad } };
}

/**
 * Her hand-drawn loop around a stage box (now Scene.loop, drawn by theme). `at < 0` draws it
 * finished; `until` fades it.
 */
export function renderLoop(scene: Scene, box: Box, o: { at: number; dur?: number; color?: string; pad?: number; width?: number; until?: number; word?: boolean }): string {
  return scene.loop(box, o);
}
