// Chalky's animation kit. Every chapter, detour and feedback animation is authored with it, so
// they share one look, one timing model and one manifest format.
//
//   import { createScene } from "../../kit/kit";
//   const scene = createScene({ timingPath: "timing.json" });
//   scene.title("t", { text: "Ohm's law", at: scene.beatStart(0) });
//   ...
//   scene.write("chapter.json");
//
// Coordinates are pixels on a 1920x1080 canvas, origin top-left. Times are ticks (240 per second);
// use scene.sec(), scene.beatStart(i) and scene.wordTick(i, "word") instead of raw numbers.
import { readFileSync, writeFileSync } from "node:fs";
import {
  ANIMATION_DOCUMENT_VERSION,
  arcVertices,
  assertValidAnimationDocument,
  base,
  constant,
  fill,
  hex,
  keyed as rawKeyed,
  pen,
  stroke,
  transform,
  trim,
  withComputedRevision,
  type AnimationDocument,
  type Animatable,
  type Color,
  type CubicBezier,
  type Ease,
  type GroupNode,
  type Key,
  type PathContour,
  type PathNode,
  type SceneNode,
  type Spring,
  type TextNode,
  type Vec3,
} from "@clayzo/animation/authoring";
import { CANVAS, type Bounds, type Manifest, type VoicedBeat } from "../../lib/types";

// ---- Look ---------------------------------------------------------------------------------------

export const COLORS = {
  background: "#0E1020",
  panel: "#181B33",
  grid: "#1C2040",
  ink: "#F4F1EA", // primary text
  muted: "#9AA0C3",
  blue: "#4DA3FF",
  teal: "#2ED3B7",
  green: "#7BE07F",
  yellow: "#FFD84D",
  orange: "#FF9F43",
  pink: "#FF5C8A",
  purple: "#A78BFA",
  red: "#FF5A5A",
} as const;
export type ColorName = keyof typeof COLORS;
export const color = (name: ColorName | string): Color => hex(name in COLORS ? COLORS[name as ColorName] : name);

export const FONT_ID = "manrope";
export const FONT_URI = "fonts/Manrope.ttf";

/** Motion vocabulary. Prefer these over ad-hoc curves. */
export const EASE = {
  out: { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 } as CubicBezier,
  inOut: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } as CubicBezier,
  in: { x1: 0.5, y1: 0, x2: 0.9, y2: 0.4 } as CubicBezier,
  pop: { mass: 1, stiffness: 260, damping: 18 } as Spring,
  soft: { mass: 1, stiffness: 140, damping: 20 } as Spring,
};

const FRAME = CANVAS.ticksPerSecond / CANVAS.fps; // 8 ticks
export const snap = (tick: number) => Math.max(0, Math.round(tick / FRAME) * FRAME);

// ---- Timing -------------------------------------------------------------------------------------

export type Timing = {
  beats: VoicedBeat[];
  /** Seconds of narration, including gaps between beats. */
  totalSeconds: number;
  /** Seconds the animation keeps going after the last word (question card, outro). */
  tailSeconds: number;
};

// ---- Scene --------------------------------------------------------------------------------------

type Track = Manifest["elements"][number];

export type Scene = ReturnType<typeof createScene>;

export function createScene(options: {
  timingPath?: string;
  timing?: Timing;
  /** A frozen frame (frozen.json) to start from: its nodes are on screen at tick 0. */
  startFromPath?: string;
  /** Draw the background rect and subtle grid. Default true (false when starting from a frozen frame). */
  background?: boolean;
}) {
  const timing: Timing = options.timing ?? JSON.parse(readFileSync(options.timingPath ?? "timing.json", "utf8"));
  const sec = (seconds: number) => snap(seconds * CANVAS.ticksPerSecond);
  const end = sec(timing.totalSeconds + timing.tailSeconds);

  const nodes: Record<string, SceneNode> = {};
  const roots: string[] = [];
  const tracks: Track[] = [];
  let questionTick: number | undefined;

  function add<T extends SceneNode>(node: T, opts: { root?: boolean } = {}): T {
    if (nodes[node.id]) throw new Error(`Duplicate node id "${node.id}"`);
    nodes[node.id] = node;
    if (opts.root !== false) roots.push(node.id);
    return node;
  }

  /** Records what an element is, so the tutor can tell what the student circled. */
  function track(nodeId: string, label: string, concept: string, bounds: Bounds, firstTick: number, lastTick = end) {
    tracks.push({ nodeId, label, concept, bounds, firstTick, lastTick });
  }

  // Frozen starting frame: its nodes go first, inside one group the scene can zoom and dim.
  let frozenGroupId: string | null = null;
  const frozenMoves: { tick: number; x: number; y: number; scale: number; opacity: number; ease: Ease }[] = [];
  if (options.startFromPath) {
    const frozen = JSON.parse(readFileSync(options.startFromPath, "utf8")) as AnimationDocument;
    const composition = frozen.compositions[frozen.rootCompositionId];
    for (const [id, node] of Object.entries(composition.nodes)) {
      nodes[id] = { ...node, outTick: end };
    }
    frozenGroupId = "frozen-frame";
    nodes["frozen-bg"] = {
      ...base("frozen-bg", { outTick: end, x: CANVAS.width / 2, y: CANVAS.height / 2 }),
      type: "rect",
      size: constant({ width: CANVAS.width, height: CANVAS.height }),
      cornerRadius: constant(0),
      style: { fill: fill(color("background")) },
    };
    roots.push("frozen-bg", frozenGroupId);
    nodes[frozenGroupId] = {
      ...base(frozenGroupId, { outTick: end }),
      type: "group",
      children: composition.rootNodeIds,
    } satisfies GroupNode;
  } else if (options.background !== false) {
    add({
      ...base("bg", { outTick: end, x: CANVAS.width / 2, y: CANVAS.height / 2 }),
      type: "rect",
      size: constant({ width: CANVAS.width, height: CANVAS.height }),
      cornerRadius: constant(0),
      style: { fill: fill(color("background")) },
    });
    const grid: PathContour[] = [];
    for (let x = 120; x < CANVAS.width; x += 120) grid.push(pen(x, 0).lineTo(x, CANVAS.height).open());
    for (let y = 120; y < CANVAS.height; y += 120) grid.push(pen(0, y).lineTo(CANVAS.width, y).open());
    add({
      ...base("bg-grid", { outTick: end }),
      type: "path",
      path: constant({ contours: grid }),
      style: { stroke: stroke(color("grid"), 1.5) },
    });
  }

  // Narration: one audio node per voiced beat.
  const assets: AnimationDocument["assets"] = {
    [FONT_ID]: { id: FONT_ID, type: "font", uri: FONT_URI, family: "Manrope", style: "normal", weight: 400 },
  };
  for (const beat of timing.beats) {
    const id = `narration-${beat.index}`;
    assets[id] = { id, type: "audio", uri: beat.audioUri, mimeType: "audio/wav" };
    add({
      ...base(id, { outTick: Math.min(end, sec(beat.start + beat.duration) + FRAME), inTick: sec(beat.start) }),
      type: "audio",
      assetId: id,
      volume: constant(1),
      playbackRate: constant(1),
      startOffsetTick: sec(beat.start),
      loop: false,
    });
  }

  // ---- Time helpers ----

  const beat = (index: number) => {
    const b = timing.beats[index];
    if (!b) throw new Error(`No beat ${index}; there are ${timing.beats.length}`);
    return b;
  };
  const beatStart = (index: number) => sec(beat(index).start);
  const beatEnd = (index: number) => sec(beat(index).start + beat(index).duration);
  /** The tick a word of a beat's narration starts. Matches loosely (case, punctuation). Falls back to the beat start. */
  function wordTick(index: number, word: string, occurrence = 0) {
    const want = word.toLowerCase().replace(/[^a-z0-9']/g, "");
    const matches = beat(index).words.filter((w) => {
      const got = w.word.toLowerCase().replace(/[^a-z0-9']/g, "");
      return got === want || (want.length > 3 && got.startsWith(want));
    });
    const hit = matches[occurrence] ?? matches[0];
    return hit ? sec(hit.start) : beatStart(index);
  }

  // ---- Motion helpers ----

  /** Scale track that pops from `from` to 1 at `tick` with a spring. */
  const popScale = (id: string, tick: number, from = 0.6): Animatable<Vec3> =>
    keyed(`${id}.scale`, [
      [0, { x: from, y: from, z: 1 }, "hold"],
      [snap(tick), { x: from, y: from, z: 1 }, EASE.pop],
      [snap(tick) + sec(0.6), { x: 1, y: 1, z: 1 }],
    ]);

  /** 0 → 1 → 0 opacity envelope: fades in at `inAt`, optionally out at `outAt`. */
  function fade(id: string, inAt: number, outAt?: number, duration = sec(0.35)): Animatable<number> {
    const keys: Key<number>[] = [
      [0, 0, "hold"],
      [snap(inAt), 0, EASE.out],
      [snap(inAt) + duration, 1, "hold"],
    ];
    if (outAt !== undefined && outAt > inAt + duration) {
      keys.push([snap(outAt), 1, EASE.in], [snap(outAt) + duration, 0]);
    }
    return keyed(`${id}.fade`, keys);
  }

  /** Position track: holds `from`, then glides to each later point. */
  function path(id: string, from: { x: number; y: number }, moves: { at: number; x: number; y: number; ease?: Ease }[]) {
    const keys: Key<Vec3>[] = [[0, { ...from, z: 0 }, "hold"]];
    let last = from;
    for (const move of moves) {
      keys.push([snap(move.at), { ...last, z: 0 }, move.ease ?? EASE.inOut]);
      keys.push([snap(move.at) + sec(0.7), { x: move.x, y: move.y, z: 0 }, "hold"]);
      last = move;
    }
    return keyed(`${id}.pos`, keys);
  }

  // ---- Element helpers. Each adds the node(s), tracks them in the manifest and returns the id. ----

  type Appear = { at: number; until?: number };
  type Tracked = { label?: string; concept?: string };

  function textNode(
    id: string,
    o: Appear &
      Tracked & {
        text: string;
        x: number;
        y: number;
        size?: number;
        weight?: number;
        color?: ColorName | string;
        width?: number;
        align?: "left" | "center" | "right";
      },
  ) {
    const size = o.size ?? 44;
    const width = o.width ?? 1200;
    const align = o.align ?? "center";
    const left = align === "center" ? o.x - width / 2 : align === "right" ? o.x - width : o.x;
    const lines = Math.max(1, Math.ceil((o.text.length * size * 0.52) / width));
    const height = lines * size * 1.25;
    add({
      ...base(id, { outTick: end, x: left, y: o.y - height / 2 }),
      opacity: fade(id, o.at, o.until),
      type: "text",
      runs: constant([
        {
          text: o.text,
          fontAssetId: FONT_ID,
          fontSize: size,
          fontWeight: o.weight ?? 600,
          letterSpacing: 0,
          lineHeight: size * 1.25,
          color: color(o.color ?? "ink"),
        },
      ]),
      box: { width, height },
      wrap: "word",
      align,
      verticalAlign: "top",
    } satisfies TextNode);
    const textWidth = Math.min(width, o.text.length * size * 0.52);
    const bx = align === "center" ? o.x - textWidth / 2 : align === "right" ? o.x - textWidth : o.x;
    track(id, o.label ?? o.text, o.concept ?? o.text, { x: bx, y: o.y - height / 2, width: textWidth, height }, snap(o.at), o.until ?? end);
    return id;
  }

  const api = {
    timing,
    end,
    sec,
    snap,
    beat,
    beatStart,
    beatEnd,
    wordTick,
    frozenGroupId,

    /** Low-level: add any Clayzo node. Remember to call `track` for anything a student might point at. */
    add,
    track,
    popScale,
    fade,
    path,

    text: textNode,

    /** A big headline, top-centre by default. */
    title(id: string, o: Appear & Tracked & { text: string; x?: number; y?: number; color?: ColorName | string }) {
      return textNode(id, { size: 76, weight: 800, x: CANVAS.width / 2, y: 140, width: 1600, ...o });
    },

    /** A small caption-style label. */
    label(id: string, o: Appear & Tracked & { text: string; x: number; y: number; color?: ColorName | string; size?: number }) {
      return textNode(id, { size: 34, weight: 600, width: 520, ...o });
    },

    /** A rounded card with an optional label inside. Pops in. */
    box(
      id: string,
      o: Appear &
        Tracked & {
          x: number;
          y: number;
          width: number;
          height: number;
          color?: ColorName | string;
          outline?: boolean;
          text?: string;
          textSize?: number;
          moves?: { at: number; x: number; y: number }[];
        },
    ) {
      const c = color(o.color ?? "blue");
      add({
        ...base(id, {
          outTick: end,
          position: o.moves ? path(id, o, o.moves) : constant({ x: o.x, y: o.y, z: 0 }),
          scale: popScale(id, o.at),
        }),
        opacity: o.until !== undefined ? fade(id, o.at, o.until) : constant(1),
        type: "rect",
        size: constant({ width: o.width, height: o.height }),
        cornerRadius: constant(Math.min(28, o.height / 3)),
        style: o.outline
          ? { stroke: stroke(c, 6, { opacity: fade(`${id}.stroke`, o.at) }) }
          : { fill: fill(c, fade(`${id}.fill`, o.at)) },
      });
      if (o.text) {
        textNode(`${id}-text`, {
          text: o.text,
          x: o.x,
          y: o.y,
          width: o.width - 32,
          size: o.textSize ?? 40,
          color: o.outline ? o.color ?? "ink" : "background",
          at: o.at + sec(0.15),
          until: o.until,
          label: o.label ?? o.text,
          concept: o.concept,
        });
      }
      track(id, o.label ?? o.text ?? id, o.concept ?? o.label ?? o.text ?? id, {
        x: o.x - o.width / 2,
        y: o.y - o.height / 2,
        width: o.width,
        height: o.height,
      }, snap(o.at), o.until ?? end);
      return id;
    },

    /** A filled circle (or ring with `outline`). Pops in. */
    circle(
      id: string,
      o: Appear &
        Tracked & {
          x: number;
          y: number;
          radius: number;
          color?: ColorName | string;
          outline?: boolean;
          text?: string;
          moves?: { at: number; x: number; y: number }[];
        },
    ) {
      const c = color(o.color ?? "teal");
      add({
        ...base(id, {
          outTick: end,
          position: o.moves ? path(id, o, o.moves) : constant({ x: o.x, y: o.y, z: 0 }),
          scale: popScale(id, o.at, 0.3),
        }),
        opacity: o.until !== undefined ? fade(id, o.at, o.until) : constant(1),
        type: "ellipse",
        size: constant({ width: o.radius * 2, height: o.radius * 2 }),
        style: o.outline ? { stroke: stroke(c, 6, { opacity: fade(`${id}.stroke`, o.at) }) } : { fill: fill(c, fade(`${id}.fill`, o.at)) },
      });
      if (o.text) {
        textNode(`${id}-text`, {
          text: o.text,
          x: o.x,
          y: o.y,
          width: o.radius * 2,
          size: Math.min(40, o.radius * 0.6),
          color: o.outline ? o.color ?? "ink" : "background",
          at: o.at + sec(0.15),
          until: o.until,
        });
      }
      track(id, o.label ?? o.text ?? id, o.concept ?? o.label ?? id, {
        x: o.x - o.radius,
        y: o.y - o.radius,
        width: o.radius * 2,
        height: o.radius * 2,
      }, snap(o.at), o.until ?? end);
      return id;
    },

    /**
     * A line or arrow that draws itself on. `points` is a polyline; pass `curve` for a gentle arc
     * between the first and last points instead.
     */
    arrow(
      id: string,
      o: Appear &
        Tracked & {
          points: { x: number; y: number }[];
          color?: ColorName | string;
          width?: number;
          head?: boolean;
          duration?: number;
          dashed?: boolean;
        },
    ) {
      const c = color(o.color ?? "yellow");
      const w = o.width ?? 8;
      const draw = o.duration ?? sec(0.6);
      const at = snap(o.at);
      const p = pen(o.points[0].x, o.points[0].y, { polyline: true });
      for (const point of o.points.slice(1)) p.lineTo(point.x, point.y);
      const contours: PathContour[] = [p.open()];
      add({
        ...base(id, { outTick: o.until ?? end }),
        type: "path",
        path: constant({ contours }),
        style: { stroke: stroke(c, w, o.dashed ? { dash: [w * 2.5, w * 2] } : {}) },
        operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0, "hold"], [at, 0, EASE.inOut], [at + draw, 1]]) })],
      } satisfies PathNode);
      if (o.head !== false && o.points.length >= 2) {
        const a = o.points[o.points.length - 2];
        const b = o.points[o.points.length - 1];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const size = w * 3.2;
        const left = { x: b.x - size * Math.cos(angle - 0.5), y: b.y - size * Math.sin(angle - 0.5) };
        const right = { x: b.x - size * Math.cos(angle + 0.5), y: b.y - size * Math.sin(angle + 0.5) };
        add({
          ...base(`${id}-head`, { outTick: o.until ?? end }),
          type: "path",
          path: constant({ contours: [pen(left.x, left.y).lineTo(b.x, b.y).lineTo(right.x, right.y).open()] }),
          style: { stroke: stroke(c, w, { opacity: fade(`${id}-head.op`, at + draw - sec(0.1), undefined, sec(0.1)) }) },
        } satisfies PathNode);
      }
      const xs = o.points.map((pt) => pt.x);
      const ys = o.points.map((pt) => pt.y);
      track(id, o.label ?? "arrow", o.concept ?? o.label ?? "arrow", {
        x: Math.min(...xs) - w,
        y: Math.min(...ys) - w,
        width: Math.max(...xs) - Math.min(...xs) + 2 * w,
        height: Math.max(...ys) - Math.min(...ys) + 2 * w,
      }, at, o.until ?? end);
      return id;
    },

    /** A ring that draws around a point to call attention to it, then optionally fades. */
    highlight(id: string, o: Appear & { x: number; y: number; radius: number; color?: ColorName | string }) {
      const at = snap(o.at);
      add({
        ...base(id, { outTick: o.until ?? end }),
        type: "path",
        path: constant({ contours: [{ closed: false, vertices: arcVertices({ x: o.x, y: o.y }, o.radius, -100, 275, { polyline: true }) }] }),
        style: { stroke: stroke(color(o.color ?? "yellow"), 7, { opacity: o.until ? fade(`${id}.op`, at, o.until - sec(0.35)) : constant(1) }) },
        operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0, "hold"], [at, 0, EASE.out], [at + sec(0.5), 1]]) })],
      } satisfies PathNode);
      return id;
    },

    /** Any SVG-ish line art as a stroked or filled path that draws on. */
    drawPath(
      id: string,
      o: Appear &
        Tracked & {
          contours: PathContour[];
          color?: ColorName | string;
          width?: number;
          filled?: boolean;
          duration?: number;
          bounds: Bounds;
        },
    ) {
      const at = snap(o.at);
      const c = color(o.color ?? "ink");
      add({
        ...base(id, { outTick: o.until ?? end }),
        type: "path",
        path: constant({ contours: o.contours }),
        style: o.filled ? { fill: fill(c, fade(`${id}.fill`, at)) } : { stroke: stroke(c, o.width ?? 6) },
        operators: o.filled
          ? []
          : [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0, "hold"], [at, 0, EASE.inOut], [at + (o.duration ?? sec(0.8)), 1]]) })],
      } satisfies PathNode);
      track(id, o.label ?? id, o.concept ?? o.label ?? id, o.bounds, at, o.until ?? end);
      return id;
    },

    /**
     * The end-of-chapter question card. Slides up at `at`, stays to the end, and leaves the
     * upper area of the screen clear for the student to draw on. Sets the manifest's questionTick.
     */
    questionCard(o: { prompt: string; at: number }) {
      const at = snap(o.at);
      const y = CANVAS.height - 150;
      add({
        ...base("question-card", {
          outTick: end,
          position: keyed("question-card.pos", [
            [0, { x: CANVAS.width / 2, y: y + 260, z: 0 }, "hold"],
            [at, { x: CANVAS.width / 2, y: y + 260, z: 0 }, EASE.soft],
            [at + sec(0.8), { x: CANVAS.width / 2, y, z: 0 }],
          ]),
        }),
        type: "rect",
        size: constant({ width: 1680, height: 200 }),
        cornerRadius: constant(32),
        style: { fill: fill(color("panel")), stroke: stroke(color("yellow"), 4) },
      });
      textNode("question-kicker", { text: "YOUR TURN · draw and talk", x: CANVAS.width / 2, y: y - 60, size: 28, weight: 800, color: "yellow", at: at + sec(0.5), width: 1500 });
      textNode("question-text", { text: o.prompt, x: CANVAS.width / 2, y: y + 12, size: 44, weight: 700, width: 1560, at: at + sec(0.6), label: "question", concept: "the question" });
      questionTick = at + sec(1.2);
      return "question-card";
    },

    /**
     * For animations that start from a frozen frame: move/zoom/dim the whole frozen scene.
     * `x`,`y` is the frozen-scene point that should end up at screen centre; scale 1 at x=960,y=540 is untouched.
     */
    frozenCamera(o: { at: number; x: number; y: number; scale: number; opacity?: number; ease?: Ease }) {
      if (!frozenGroupId) throw new Error("frozenCamera needs createScene({ startFromPath })");
      frozenMoves.push({ tick: snap(o.at), x: o.x, y: o.y, scale: o.scale, opacity: o.opacity ?? 1, ease: o.ease ?? EASE.inOut });
    },

    /** Builds, validates and stamps the document. */
    build(id: string, name: string): { document: AnimationDocument; manifest: Manifest } {
      if (frozenGroupId && frozenMoves.length) {
        const sorted = [...frozenMoves].sort((a, b) => a.tick - b.tick);
        const anchor: Key<Vec3>[] = [[0, { x: CANVAS.width / 2, y: CANVAS.height / 2, z: 0 }, "hold"]];
        const scale: Key<Vec3>[] = [[0, { x: 1, y: 1, z: 1 }, "hold"]];
        const opacity: Key<number>[] = [[0, 1, "hold"]];
        let prev = { x: CANVAS.width / 2, y: CANVAS.height / 2, scale: 1, opacity: 1 };
        for (const move of sorted) {
          const t1 = move.tick + sec(0.9);
          anchor.push([move.tick, { x: prev.x, y: prev.y, z: 0 }, move.ease], [t1, { x: move.x, y: move.y, z: 0 }, "hold"]);
          scale.push([move.tick, { x: prev.scale, y: prev.scale, z: 1 }, move.ease], [t1, { x: move.scale, y: move.scale, z: 1 }, "hold"]);
          opacity.push([move.tick, prev.opacity, move.ease], [t1, move.opacity, "hold"]);
          prev = move;
        }
        const group = nodes[frozenGroupId] as GroupNode;
        group.transform = transform(CANVAS.width / 2, CANVAS.height / 2, {
          anchor: keyed("frozen.anchor", anchor),
          scale: keyed("frozen.scale", scale),
        });
        group.opacity = keyed("frozen.opacity", opacity);
      }

      const document = withComputedRevision({
        version: ANIMATION_DOCUMENT_VERSION,
        id,
        revision: "",
        name,
        canvas: { width: CANVAS.width, height: CANVAS.height, pixelAspectRatio: 1, backgroundColor: color("background") },
        timing: {
          ticksPerSecond: CANVAS.ticksPerSecond,
          frameRate: { numerator: CANVAS.fps, denominator: 1 },
          durationTicks: end,
          displayStartTick: 0,
        },
        assets,
        compositions: {
          main: { id: "main", name: "Main", width: CANVAS.width, height: CANVAS.height, durationTicks: end, nodes, rootNodeIds: roots },
        },
        rootCompositionId: "main",
        components: {},
        markers: [],
        capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
      } satisfies AnimationDocument);
      assertValidAnimationDocument(document);

      const manifest: Manifest = {
        beats: timing.beats.map((b) => ({ index: b.index, startTick: sec(b.start), endTick: sec(b.start + b.duration), narration: b.narration })),
        elements: tracks,
        questionTick,
      };
      return { document, manifest };
    },

    /** Builds and writes `<file>` plus `<file minus .json>.manifest.json`. */
    write(file: string, name?: string) {
      const id = file.replace(/\.json$/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const { document, manifest } = api.build(id, name ?? id);
      writeFileSync(file, JSON.stringify(document));
      writeFileSync(file.replace(/\.json$/, ".manifest.json"), JSON.stringify(manifest, null, 2));
      console.log(`wrote ${file} (${(end / CANVAS.ticksPerSecond).toFixed(1)}s, revision ${document.revision}, ${Object.keys(nodes).length} nodes)`);
      return { document, manifest };
    },
  };
  return api;
}

/** `keyed`, but keys at the same tick collapse (the later one wins) instead of throwing. */
function keyed<T>(id: string, keys: Key<T>[]) {
  return rawKeyed(id, dedupe(keys));
}

/** Keys must have strictly increasing ticks; later keys at the same tick win. */
function dedupe<T>(keys: Key<T>[]): Key<T>[] {
  const out: Key<T>[] = [];
  for (const key of keys) {
    if (out.length && out[out.length - 1][0] >= key[0]) out[out.length - 1] = key;
    else out.push(key);
  }
  return out;
}
