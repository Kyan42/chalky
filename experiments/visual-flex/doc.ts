/**
 * Shared Clayzo building blocks for the flexibility experiment. Levels 1–3
 * compile into these; level 4 writes Clayzo code directly.
 *
 * Stage: 1200×800 document units, 240 ticks/s, 60 fps (4 ticks per frame).
 * Visual time 0 is the moment the beat's anchor word is spoken.
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
  type PathVertex,
  type SceneNode,
} from "@clayzo/animation/authoring";

export const W = 1200;
export const H = 800;
export const TPS = 240;
export const FPS = 60;
const FRAME = TPS / FPS;
/** Every visual is this long; the beat's speech is shorter, so it holds at the end. */
export const MAX_SECONDS = 6;
export const END = MAX_SECONDS * TPS;

export const FONT_ID = "inter";
export const FONT_URI = "/fonts/Inter-SemiBold.otf";

export const PAPER = "#F7F5EF";
export const PALETTE: Record<string, string> = {
  ink: "#1F2A44",
  red: "#E4572E",
  blue: "#2E86E4",
  green: "#2E9E5B",
  yellow: "#E0A100",
  purple: "#7A4FD6",
  grey: "#9A958A",
};
export type PaletteName = keyof typeof PALETTE;

export function color(name: string | undefined, fallback: PaletteName = "ink"): Color {
  const value = name && (PALETTE[name] ?? (/^#[0-9a-f]{6}$/i.test(name) ? name : undefined));
  return hex(value ?? PALETTE[fallback]);
}

/** Seconds → tick on the 60 fps grid, clamped into the visual. */
export function tick(seconds: number): number {
  const t = Math.round((Math.max(0, seconds) * TPS) / FRAME) * FRAME;
  return Math.min(t, END - FRAME);
}

const OUT = { x1: 0.2, y1: 0.6, x2: 0.35, y2: 1 };
const IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
const zero = { x: 0, y: 0 };

export type Pt = readonly [number, number];

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

/** Ids must be stable-id safe. */
export function safeId(raw: string): string {
  const id = raw.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return (id || "n").slice(0, 100);
}

export class Scene {
  readonly nodes: Record<string, SceneNode> = {};
  readonly order: string[] = [];
  private count = 0;

  private add(prefix: string, node: Record<string, unknown>): string {
    const id = safeId(`${prefix}-${this.count++}`);
    this.nodes[id] = { ...node, id, name: id } as SceneNode;
    this.order.push(id);
    return id;
  }

  /** A stroke that draws itself along `points` from `at` over `dur` seconds. */
  stroke(points: readonly Pt[], o: { at: number; dur: number; color?: string; width?: number; closed?: boolean; fillColor?: string }) {
    const start = tick(o.at);
    const end = Math.max(start + FRAME, tick(o.at + o.dur));
    const pts = o.closed ? [...points, points[0]] : points;
    return this.add("stroke", {
      ...base("s", { inTick: start, outTick: END }),
      type: "path",
      path: constant({ contours: [{ closed: false, vertices: vertices(pts) }] }),
      style: {
        stroke: stroke(color(o.color), o.width ?? 8),
        ...(o.fillColor ? { fill: fill(color(o.fillColor), 0.18) } : {}),
      },
      operators: [trim("t", { end: keyed("e", [[start, 0, IN_OUT], [end, 1]]) })],
    });
  }

  /** A filled circle or ring that pops in at `at`. */
  circle(cx: number, cy: number, r: number, o: { at: number; color?: string; filled?: boolean; width?: number }) {
    const t = tick(o.at);
    return this.add("circle", {
      ...base("c", { inTick: t, outTick: END, x: cx, y: cy, scale: popScale(t) }),
      type: "ellipse",
      size: constant({ width: r * 2, height: r * 2 }),
      style: o.filled === false ? { stroke: stroke(color(o.color), o.width ?? 6) } : { fill: fill(color(o.color)) },
    });
  }

  /** A rounded box that pops in at `at`. */
  box(x: number, y: number, w: number, h: number, o: { at: number; color?: string; filled?: boolean; radius?: number }) {
    const t = tick(o.at);
    return this.add("box", {
      ...base("b", { inTick: t, outTick: END, x: x + w / 2, y: y + h / 2, scale: popScale(t) }),
      type: "rect",
      size: constant({ width: w, height: h }),
      cornerRadius: constant(o.radius ?? 16),
      style: o.filled === false ? { stroke: stroke(color(o.color), 5) } : { fill: fill(color(o.color), 0.9) },
    });
  }

  /** A bar that grows up from its baseline (bottom edge at `y`). */
  bar(x: number, y: number, w: number, h: number, o: { at: number; dur: number; color?: string }) {
    const t0 = tick(o.at);
    const t1 = Math.max(t0 + FRAME, tick(o.at + o.dur));
    return this.add("bar", {
      ...base("bar", {
        inTick: t0,
        outTick: END,
        x: x + w / 2,
        y,
        anchor: { x: 0, y: h / 2 },
        scale: keyed<{ x: number; y: number; z: number }>("bs", [
          [t0, { x: 1, y: 0.001, z: 1 }, OUT],
          [t1, { x: 1, y: 1, z: 1 }],
        ]),
      }),
      type: "rect",
      size: constant({ width: w, height: h }),
      cornerRadius: constant(6),
      style: { fill: fill(color(o.color)) },
    });
  }

  /** A shape that moves from one point to another (e.g. particles). */
  mover(from: Pt, to: Pt, r: number, o: { at: number; dur: number; color?: string }) {
    const t0 = tick(o.at);
    const t1 = Math.max(t0 + FRAME, tick(o.at + o.dur));
    return this.add("dot", {
      ...base("d", {
        inTick: t0,
        outTick: END,
        position: keyed<{ x: number; y: number; z: number }>("p", [
          [t0, { x: from[0], y: from[1], z: 0 }, IN_OUT],
          [t1, { x: to[0], y: to[1], z: 0 }],
        ]),
      }),
      type: "ellipse",
      size: constant({ width: r * 2, height: r * 2 }),
      style: { fill: fill(color(o.color)) },
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
        opacity: keyed("o", [[t, 0, OUT], [t + 4 * FRAME, 1]]),
      }),
      type: "text",
      runs: constant([
        { text: ascii, fontAssetId: FONT_ID, fontSize: size, fontWeight: 600, letterSpacing: 0, lineHeight: line, color: color(o.color) },
      ]),
      box: { width, height: line },
      wrap: "none",
      align,
      verticalAlign: "top",
    });
  }

  /** A straight arrow that draws from `from` to `to`, then shows its head. */
  arrow(from: Pt, to: Pt, o: { at: number; dur: number; color?: string; width?: number }) {
    this.stroke([from, to], o);
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const s = 22;
    const left: Pt = [to[0] - s * Math.cos(ang - 0.5), to[1] - s * Math.sin(ang - 0.5)];
    const right: Pt = [to[0] - s * Math.cos(ang + 0.5), to[1] - s * Math.sin(ang + 0.5)];
    this.stroke([left, to, right], { at: o.at + o.dur, dur: 0.1, color: o.color, width: o.width });
  }

  build(id: string, name: string): AnimationDocument {
    const paper: SceneNode = {
      ...base("paper", { outTick: END, x: W / 2, y: H / 2 }),
      type: "rect",
      size: constant({ width: W, height: H }),
      cornerRadius: constant(0),
      style: { fill: fill(hex(PAPER)) },
    };
    return finishDocument(id, name, { paper, ...this.nodes }, ["paper", ...this.order]);
  }
}

function popScale(t: number) {
  return keyed<{ x: number; y: number; z: number }>("ps", [
    [t, { x: 0, y: 0, z: 1 }, OUT],
    [t + 6 * FRAME, { x: 1.08, y: 1.08, z: 1 }, OUT],
    [t + 10 * FRAME, { x: 1, y: 1, z: 1 }],
  ]);
}

/** Wraps nodes in a valid, stamped document with the shared font asset. */
export function finishDocument(id: string, name: string, nodes: Record<string, SceneNode>, rootNodeIds: string[]): AnimationDocument {
  const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: safeId(id),
    name,
    canvas: { width: W, height: H, pixelAspectRatio: 1, backgroundColor: hex(PAPER) },
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
