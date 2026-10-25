/**
 * Shared Clayzo building blocks for the board. Levels 1–3 and the preset
 * compiler (lib/lesson/presets.ts) compile into these; level 4 writes Clayzo
 * code directly.
 *
 * Stage: 1200×800 document units, 240 ticks/s, 60 fps (4 ticks per frame).
 * Visual time 0 is the moment the beat's anchor word is spoken.
 *
 * Everything draws by theme (lib/board/theme.ts): colours by role, the marker
 * width, how fills are drawn (outline only on chalk, with the shape filled in
 * the board colour so overlaps stay clean), the chalk grain over the whole
 * drawing, and eraser smudges on the chalkboard.
 */
import {
  ANIMATION_DOCUMENT_VERSION,
  assertValidAnimationDocument,
  base,
  constant,
  fill,
  hex,
  keyed,
  stroke,
  trim,
  withComputedRevision,
  type AnimationDocument,
  type Color,
  type PathContour,
  type PathVertex,
  type SceneNode,
} from "@clayzo/animation/authoring";
import { chalkEffect, effectNode } from "@/lib/board/chalk";
import { currentTheme, DEFAULT_THEME, themeHex, tintHex, type Theme } from "@/lib/board/theme";

export const W = 1200;
export const H = 800;
export const TPS = 240;
export const FPS = 60;
const FRAME = TPS / FPS;
/** Every visual is this long; the beat's speech is shorter, so it holds at the end. */
export const MAX_SECONDS = 20;
export const END = MAX_SECONDS * TPS;

export const FONT_ID = "inter";
export const FONT_URI = "/fonts/Inter-SemiBold.otf";

/** The default theme's board colour and marker colours, for prompts and code that draw without a Scene. */
export const PAPER = DEFAULT_THEME.colors.board;
export const PALETTE: Record<string, string> = Object.fromEntries(
  ["ink", "red", "blue", "green", "yellow", "orange", "purple", "brown", "grey"].map((k) => [k, DEFAULT_THEME.colors[k]]),
);
export type PaletteName = keyof typeof PALETTE;

/** A colour on the theme in force (the Scene's own `paint` is preferred). */
export function color(name: string | undefined, fallback: PaletteName = "ink", theme: Theme = currentTheme()): Color {
  return hex(themeHex(theme, name, fallback));
}

/** Seconds → tick on the 60 fps grid, clamped into the visual. */
export function tick(seconds: number): number {
  const t = Math.round((Math.max(0, seconds) * TPS) / FRAME) * FRAME;
  return Math.min(t, END - FRAME);
}

const OUT = { x1: 0.2, y1: 0.6, x2: 0.35, y2: 1 };
const IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
const DRAW = { x1: 0.4, y1: 0, x2: 0.4, y2: 1 };
const zero = { x: 0, y: 0 };

export type Pt = readonly [number, number];
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const vtx = (x: number, y: number): PathVertex => ({ point: { x, y }, inTangent: zero, outTangent: zero });

/** Polyline vertices, subdivided so a trim draw-on follows the shape. */
function vertices(points: readonly Pt[], maxStep = 12): PathVertex[] {
  const out: PathVertex[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i > 0) {
      const [px, py] = points[i - 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / maxStep));
      for (let s = 1; s < steps; s++) {
        out.push({ point: { x: px + ((x - px) * s) / steps, y: py + ((y - py) * s) / steps }, inTangent: zero, outTangent: zero });
      }
    }
    out.push({ point: { x, y }, inTangent: zero, outTangent: zero });
  }
  return out;
}

/** An ellipse as a polyline, starting at the top and going clockwise, first point repeated. */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 - 0.35 + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** A rounded rectangle as a polyline, from the top-left corner clockwise, first point repeated. */
function rectPoints(x: number, y: number, w: number, h: number, radius: number): Pt[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const arc = (cx: number, cy: number, a0: number): Pt[] => Array.from({ length: 5 }, (_, i) => {
    const a = a0 + (i / 4) * (Math.PI / 2);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
  return [
    ...arc(x + r, y + r, Math.PI),
    ...arc(x + w - r, y + r, -Math.PI / 2),
    ...arc(x + w - r, y + h - r, 0),
    ...arc(x + r, y + h - r, Math.PI / 2),
    [x, y + r],
  ];
}

/** Ids must be stable-id safe. */
export function safeId(raw: string): string {
  const id = raw.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return (id || "n").slice(0, 100);
}

/** Deterministic noise in -0.5..0.5 from a seed and an index. */
function rand(seed: number, k: number): number {
  const v = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

/**
 * Back-and-forth strokes across a box at `angle` degrees, `spacing` apart, each a little uneven,
 * running past the box so a clip cuts their turns off (her hatch).
 */
export function hatchContour([x0, y0, x1, y1]: [number, number, number, number], spacing: number, angle: number, seed: number): PathContour {
  const a = (angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) }, n = { x: -Math.sin(a), y: Math.cos(a) };
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const along = corners.map(([x, y]) => x * u.x + y * u.y), across = corners.map(([x, y]) => x * n.x + y * n.y);
  const [u0, u1] = [Math.min(...along) - spacing * 2, Math.max(...along) + spacing * 2];
  const [n0, n1] = [Math.min(...across), Math.max(...across)];
  const vs: PathVertex[] = [];
  for (let k = 0, c = n0 + spacing * 0.3; c <= n1 + spacing * 0.5; k++, c += spacing) {
    const ends = [u0 + rand(seed, k) * spacing * 1.5, u1 + rand(seed, k + 50) * spacing * 1.5];
    if (k % 2) ends.reverse();
    for (const [j, e] of ends.entries()) {
      const cc = c + rand(seed, k * 3 + j) * spacing * 0.35;
      vs.push(vtx(u.x * e + n.x * cc, u.y * e + n.y * cc));
    }
  }
  return { closed: false, vertices: vs };
}

export class Scene {
  readonly nodes: Record<string, SceneNode> = {};
  readonly order: string[] = [];
  readonly theme: Theme;
  private count = 0;

  constructor(theme: Theme = currentTheme()) {
    this.theme = theme;
  }

  /** The theme's marker width in stage units. */
  get marker(): number {
    return this.theme.marker;
  }

  /** A colour name or hex on this theme. */
  paint(name: string | undefined, fallback = "ink"): Color {
    return hex(themeHex(this.theme, name, fallback));
  }

  private add(prefix: string, node: Record<string, unknown>): string {
    const id = safeId(`${prefix}-${this.count++}`);
    this.nodes[id] = { ...node, id, name: id } as SceneNode;
    this.order.push(id);
    return id;
  }

  /** 0 → 1 between two times (seconds), for `trim`; constant 1 when drawn finished. */
  private drawOn(from: number, to: number) {
    const t0 = tick(from), t1 = Math.max(t0 + FRAME, tick(to));
    return keyed("e", [[t0, 0, DRAW], [t1, 1]]);
  }

  /** A stroke that draws itself along `points` from `at` over `dur` seconds. */
  stroke(points: readonly Pt[], o: { at: number; dur: number; color?: string; width?: number; closed?: boolean; fillColor?: string; opacity?: number }) {
    const start = tick(o.at);
    const end = Math.max(start + FRAME, tick(o.at + o.dur));
    const pts = o.closed ? [...points, points[0]] : points;
    return this.add("stroke", {
      ...base("s", { inTick: start, outTick: END }),
      type: "path",
      path: constant({ contours: [{ closed: false, vertices: vertices(pts) }] }),
      style: {
        stroke: stroke(this.paint(o.color), o.width ?? this.marker, o.opacity !== undefined ? { opacity: o.opacity } : {}),
        ...(o.fillColor ? { fill: fill(this.paint(o.fillColor), 0.18) } : {}),
      },
      operators: o.at < 0 ? [] : [trim("t", { end: this.drawOn(o.at, o.at + o.dur) })],
    });
  }

  /**
   * The inside of a shape, by theme: on `none` the board colour (so what the shape overlaps
   * stays hidden), on `wash` the colour's pale tint fading in, on `hatch` a scribble clipped to
   * the shape. Added before the outline. `at < 0` draws it finished.
   */
  private fillShape(prefix: string, points: readonly Pt[], box: [number, number, number, number], colorName: string | undefined, at: number, dur: number, seed: number) {
    const contours: PathContour[] = [{ closed: true, vertices: points.slice(0, -1).map(([x, y]) => vtx(x, y)) }];
    const t = tick(Math.max(0, at));
    const mode = this.theme.fill;
    if (mode === "hatch" && this.theme.hatch) {
      const { spacing, width, opacity, angle, seconds } = this.theme.hatch;
      const clipId = safeId(`${prefix}-clip-${this.count}`);
      const scribbleId = safeId(`${prefix}-hatch-${this.count}`);
      this.nodes[clipId] = { ...base(clipId, { outTick: END }), type: "path", path: constant({ contours }), style: {} } as SceneNode;
      this.nodes[scribbleId] = {
        ...base(scribbleId, { outTick: END }),
        type: "path",
        path: constant({ contours: [hatchContour(box, spacing, angle, seed)] }),
        style: { stroke: stroke(hex(tintHex(this.theme, colorName)), width, { opacity }) },
        ...(at < 0 ? {} : { operators: [trim("t", { end: this.drawOn(at + dur * 0.6, at + dur * 0.6 + seconds) })] }),
      } as SceneNode;
      return this.add(`${prefix}-fill`, { ...base("f", { outTick: END, inTick: at < 0 ? 0 : t }), type: "group", children: [scribbleId], clipPathId: clipId });
    }
    const blank = mode === "none";
    const colour = blank ? hex(this.theme.colors.board) : hex(tintHex(this.theme, colorName));
    // The board colour arrives as the outline starts; a wash once it is mostly drawn.
    const from = blank ? at : at + dur * 0.5;
    const opacity = at < 0 ? 1 : keyed("o", [[tick(from), 0, OUT], [tick(from) + (blank ? 3 : 8) * FRAME, 1]]);
    return this.add(`${prefix}-fill`, {
      ...base("f", { outTick: END, inTick: at < 0 ? 0 : t }),
      type: "path",
      path: constant({ contours }),
      style: { fill: fill(colour, opacity) },
    });
  }

  /** An outline that draws itself along `points` (first point repeated) from `at` over `dur`. */
  private outline(prefix: string, points: readonly Pt[], o: { at: number; dur: number; color?: string; width?: number }) {
    const t = tick(Math.max(0, o.at));
    return this.add(prefix, {
      ...base("o", { inTick: o.at < 0 ? 0 : t, outTick: END }),
      type: "path",
      path: constant({ contours: [{ closed: false, vertices: vertices(points) }] }),
      style: { stroke: stroke(this.paint(o.color), o.width ?? this.marker) },
      operators: o.at < 0 ? [] : [trim("t", { end: this.drawOn(o.at, o.at + o.dur) })],
    });
  }

  /**
   * A circle: an outline drawn on by hand, with its inside by theme when `filled`. A small
   * filled circle (r < 14) is a solid dot that pops in, so markers stay solid.
   */
  circle(cx: number, cy: number, r: number, o: { at: number; color?: string; filled?: boolean; width?: number; dur?: number }) {
    const filled = o.filled !== false;
    if (filled && r < 14) {
      const t = tick(o.at);
      return this.add("circle", {
        ...base("c", { inTick: t, outTick: END, x: cx, y: cy, ...(o.at < 0 ? {} : { scale: popScale(t) }) }),
        type: "ellipse",
        size: constant({ width: r * 2, height: r * 2 }),
        style: { fill: fill(this.paint(o.color)) },
      });
    }
    const pts = ellipsePoints(cx, cy, r, r);
    const dur = o.dur ?? Math.max(0.3, Math.min(1.2, (2 * Math.PI * r) / 900));
    if (filled) this.fillShape("circle", pts, [cx - r, cy - r, cx + r, cy + r], o.color, o.at, dur, this.count);
    return this.outline("circle", pts, { at: o.at, dur, color: o.color, width: o.width ?? this.marker * 1.2 });
  }

  /** A rounded box: an outline drawn on by hand, with its inside by theme when `filled`. */
  box(x: number, y: number, w: number, h: number, o: { at: number; color?: string; filled?: boolean; radius?: number; dur?: number; width?: number }) {
    const pts = rectPoints(x, y, w, h, o.radius ?? 14);
    const dur = o.dur ?? Math.max(0.3, Math.min(1.2, (2 * (w + h)) / 1100));
    if (o.filled !== false) this.fillShape("box", pts, [x, y, x + w, y + h], o.color, o.at, dur, this.count);
    return this.outline("box", pts, { at: o.at, dur, color: o.color, width: o.width ?? this.marker * 1.1 });
  }

  /** A bar that grows up from its baseline (bottom edge at `y`): outlined, its inside by theme. */
  bar(x: number, y: number, w: number, h: number, o: { at: number; dur: number; color?: string }) {
    const t0 = tick(o.at);
    const t1 = Math.max(t0 + FRAME, tick(o.at + o.dur));
    const grow = o.at < 0
      ? {}
      : {
          scale: keyed<{ x: number; y: number; z: number }>("bs", [
            [t0, { x: 1, y: 0.001, z: 1 }, OUT],
            [t1, { x: 1, y: 1, z: 1 }],
          ]),
        };
    const inside = this.theme.fill === "none" ? hex(this.theme.colors.board) : hex(tintHex(this.theme, o.color));
    return this.add("bar", {
      ...base("bar", { inTick: t0, outTick: END, x: x + w / 2, y, anchor: { x: 0, y: h / 2 }, ...grow }),
      type: "rect",
      size: constant({ width: w, height: h }),
      cornerRadius: constant(4),
      style: { fill: fill(inside), stroke: stroke(this.paint(o.color), this.marker * 1.1) },
    });
  }

  /** A shape that moves from one point to another (e.g. particles). */
  mover(from: Pt, to: Pt, r: number, o: { at: number; dur: number; color?: string }) {
    const t0 = tick(o.at);
    const t1 = Math.max(t0 + FRAME, tick(o.at + o.dur));
    return this.add("dot", {
      ...(o.at < 0
        ? base("d", { inTick: t0, outTick: END, x: to[0], y: to[1] })
        : base("d", {
            inTick: t0,
            outTick: END,
            position: keyed<{ x: number; y: number; z: number }>("p", [
              [t0, { x: from[0], y: from[1], z: 0 }, IN_OUT],
              [t1, { x: to[0], y: to[1], z: 0 }],
            ]),
          })),
      type: "ellipse",
      size: constant({ width: r * 2, height: r * 2 }),
      style: { fill: fill(this.paint(o.color)) },
    });
  }

  /** A text label centred on (x, y) that fades in at `at`. */
  text(str: string, x: number, y: number, o: { at: number; size?: number; color?: string; align?: "left" | "center" | "right"; width?: number }) {
    const size = o.size ?? 34;
    const line = Math.round(size * 1.2);
    const width = o.width ?? 520;
    const align = o.align ?? "center";
    const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    const t = tick(o.at);
    const ascii = str.replace(/[^\x20-\x7E]/g, "").slice(0, 60);
    return this.add("text", {
      ...base("tx", {
        inTick: t,
        outTick: END,
        x: left,
        y: y - line / 2 - size * 0.1,
        ...(o.at < 0 ? {} : { opacity: keyed("o", [[t, 0, OUT], [t + 4 * FRAME, 1]]) }),
      }),
      type: "text",
      runs: constant([
        { text: ascii, fontAssetId: FONT_ID, fontSize: size, fontWeight: 600, letterSpacing: 0, lineHeight: line, color: this.paint(o.color) },
      ]),
      box: { width, height: line },
      wrap: "none",
      align,
      verticalAlign: "top",
    });
  }

  /** A straight arrow that draws from `from` to `to`, then shows its head. */
  arrow(from: Pt, to: Pt, o: { at: number; dur: number; color?: string; width?: number }) {
    const width = o.width ?? this.marker * 1.2;
    this.stroke([from, to], { ...o, width });
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const s = 22;
    const left: Pt = [to[0] - s * Math.cos(ang - 0.5), to[1] - s * Math.sin(ang - 0.5)];
    const right: Pt = [to[0] - s * Math.cos(ang + 0.5), to[1] - s * Math.sin(ang + 0.5)];
    this.stroke([left, to, right], { at: o.at < 0 ? o.at : o.at + o.dur, dur: 0.1, color: o.color, width });
  }

  /**
   * Her chalk loop: one hand-drawn turn and a bit around a box, its radius drifting so the ends
   * don't meet, drawn on at `at` and fading out at `until`. Around a `word` it clears the corners
   * of the text box; around a drawing it hugs the box. `at < 0` draws it finished.
   */
  loop(box: Box, o: { at: number; dur?: number; color?: string; pad?: number; width?: number; until?: number; word?: boolean }): string {
    const pad = o.pad ?? 14;
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
    const rx = w / 2 + pad + (o.word ? h * 0.3 : 0), ry = (h / 2) * (o.word ? Math.SQRT2 : 1) + pad;
    const vs: PathVertex[] = [];
    for (let i = 0; i <= 56; i++) {
      const t = i / 56, a = (-110 + t * 385) * (Math.PI / 180), k = 1.04 - t * 0.1;
      vs.push(vtx(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
    }
    const start = Math.max(0, o.at), seconds = Math.max(0.2, o.dur ?? 0.6);
    const fadeAt = o.until !== undefined && o.at >= 0 ? tick(Math.max(start + seconds, o.until)) : null;
    const opacity = fadeAt === null ? 1 : keyed("o", [[fadeAt, 1, IN_OUT], [fadeAt + 18 * FRAME, 0]]);
    return this.add("loop", {
      ...base("l", { outTick: END, inTick: o.at < 0 ? 0 : tick(start) }),
      type: "path",
      path: constant({ contours: [{ closed: false, vertices: vs }] }),
      style: { stroke: stroke(this.paint(o.color, "red"), o.width ?? this.marker + 1, { opacity }) },
      ...(o.at < 0 ? {} : { operators: [trim("t", { end: this.drawOn(start, start + seconds) })] }),
    });
  }

  /**
   * Half-wipes a box: a few broad, slightly wavy strokes of the board colour dragged across it,
   * as if the side of an eraser had been passed over it once, leaving it faint but legible.
   */
  wipe(box: Box, o: { at: number; opacity?: number }): string {
    const w = box.x2 - box.x1, h = box.y2 - box.y1;
    const band = Math.max(22, Math.min(70, h / 2.6));
    const rows = Math.max(1, Math.ceil((h + band * 0.4) / (band * 0.8)));
    // Each pass is one slightly bowed drag across the box; passes alternate direction and
    // density, so some chalk shows through more than the rest.
    const seed = this.count;
    const ids: string[] = [];
    for (let r = 0; r < rows; r++) {
      const y = box.y1 + band * 0.35 + r * ((h - band * 0.7) / Math.max(1, rows - 1) || 0);
      const pts: Pt[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const u = i / n, t = r % 2 ? 1 - u : u;
        const bow = Math.sin(u * Math.PI) * band * 0.25 * (r % 2 ? -1 : 1);
        pts.push([box.x1 - band * 0.35 + t * (w + band * 0.7) + rand(seed + r, i) * band * 0.3, y + bow + rand(seed + r + 7, i) * band * 0.3]);
      }
      const t = tick(Math.max(0, o.at));
      const from = o.at + r * 0.12, to = from + 0.35;
      ids.push(this.add("wipe", {
        ...base("w", { outTick: END, inTick: o.at < 0 ? 0 : t }),
        type: "path",
        path: constant({ contours: [{ closed: false, vertices: vertices(pts, 16) }] }),
        style: { stroke: stroke(hex(this.theme.colors.board), band * (1 + rand(seed, r) * 0.3), { opacity: (o.opacity ?? 0.62) + rand(seed + 3, r) * 0.3 }) },
        ...(o.at < 0 ? {} : { operators: [trim("t", { end: this.drawOn(from, to) })] }),
      }));
    }
    return ids[0];
  }

  /**
   * The old soft marks, kept for the level-3 board (lib/lesson/board.ts): `behind` was a mark
   * under the shapes and is now the chalk loop around them; over them it is the half-wipe.
   */
  overlay(x: number, y: number, w: number, h: number, o: { at: number; color: string; opacity: number; behind: boolean; until?: number }) {
    const box = { x1: x, y1: y, x2: x + w, y2: y + h };
    if (o.behind) return this.loop(box, { at: o.at, color: o.color === "yellow" ? "red" : o.color, until: o.until });
    return this.wipe(box, { at: o.at });
  }

  build(id: string, name: string): AnimationDocument {
    const { theme } = this;
    const board = hex(theme.colors.board);
    const nodes: Record<string, SceneNode> = {
      paper: {
        ...base("paper", { outTick: END, x: W / 2, y: H / 2 }),
        type: "rect",
        size: constant({ width: W, height: H }),
        cornerRadius: constant(0),
        style: { fill: fill(board) },
      } as SceneNode,
      ...this.nodes,
    };
    const roots = ["paper"];
    if (theme.smudges) {
      Object.assign(nodes, smudges(this.paint("ink")));
      roots.push("smudge-blur");
    }
    if (theme.chalk) {
      // Everything drawn goes through the chalk shader as one layer.
      nodes.drawing = { ...base("drawing", { outTick: END }), type: "group", children: [...this.order] } as SceneNode;
      nodes.chalk = chalkEffect("chalk", "drawing", END, theme.chalk.grain);
      roots.push("chalk");
    } else roots.push(...this.order);
    return finishDocument(id, name, nodes, roots, theme.colors.board);
  }
}

/** A few broad, faint, blurred strokes: a board that has been wiped before (hers, on our stage). */
function smudges(ink: Color): Record<string, SceneNode> {
  const swipes = [
    [[0.08, 0.3], [0.3, 0.22], [0.52, 0.3]],
    [[0.55, 0.72], [0.75, 0.62], [0.95, 0.7]],
    [[0.2, 0.85], [0.4, 0.78], [0.6, 0.86]],
    [[0.62, 0.15], [0.8, 0.1], [0.92, 0.2]],
  ];
  const contours = swipes.map((pts) => ({ closed: false, vertices: pts.map(([x, y]) => vtx(x * W, y * H)) }));
  return {
    smudges: { ...base("smudges", { outTick: END }), type: "path", path: constant({ contours }), style: { stroke: stroke(ink, 94, { opacity: 0.045 }) } } as SceneNode,
    "smudge-blur": effectNode("smudge-blur", "smudges", "blur", END, [["radius", 38, 0, 200]]),
  };
}

function popScale(t: number) {
  return keyed<{ x: number; y: number; z: number }>("ps", [
    [t, { x: 0, y: 0, z: 1 }, OUT],
    [t + 6 * FRAME, { x: 1.08, y: 1.08, z: 1 }, OUT],
    [t + 10 * FRAME, { x: 1, y: 1, z: 1 }],
  ]);
}

/** Wraps nodes in a valid, stamped document with the shared font asset. */
export function finishDocument(id: string, name: string, nodes: Record<string, SceneNode>, rootNodeIds: string[], background = PAPER): AnimationDocument {
  const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: safeId(id),
    name,
    canvas: { width: W, height: H, pixelAspectRatio: 1, backgroundColor: hex(background) },
    timing: { ticksPerSecond: TPS, frameRate: { numerator: FPS, denominator: 1 }, durationTicks: END, displayStartTick: 0 },
    assets: { [FONT_ID]: { id: FONT_ID, type: "font", uri: FONT_URI, family: "Inter", style: "normal", weight: 600 } },
    rootCompositionId: "main",
    components: {},
    compositions: { main: { id: "main", name: "Main", width: W, height: H, durationTicks: END, nodes, rootNodeIds } },
    markers: [],
    design: { tokens: { looping: false } },
    capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
  });
  assertValidAnimationDocument(document);
  return document;
}
