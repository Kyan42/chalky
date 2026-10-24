/**
 * `wave.draw`: a sine "noise wave" that draws itself left to right.
 *
 * Art direction (per the Clayzo authoring skill): verb "draw", geometry a
 * single sine stroke over a pressure baseline, palette chalk-ink on paper,
 * full-stage scale, no words. One object, drawn in one continuous gesture.
 *
 * The document is authored against @clayzo/animation's types and never
 * written by hand. The planner will only ever name `wave.draw`; this module
 * owns every pixel decision.
 */
import {
  ANIMATION_DOCUMENT_VERSION,
  assertValidAnimationDocument,
  base,
  constant,
  fill,
  hex,
  keyed,
  marker,
  stroke,
  trim,
  withComputedRevision,
  type AnimationDocument,
  type PathVertex,
  type SceneNode,
} from "@clayzo/animation/authoring";

export const TICKS_PER_SECOND = 240;
export const FPS = 60; // 4 ticks per frame
const TICKS_PER_FRAME = TICKS_PER_SECOND / FPS;

export const WAVE_WIDTH = 1200;
export const WAVE_HEIGHT = 800;

/** Ticks the stroke takes to draw from left to right. */
export const DRAW_TICKS = 384; // 1.6 s, on the 60 fps grid
/** Total length; the finished wave holds after the draw. */
export const WAVE_DURATION_TICKS = 480; // 2.0 s

const PAPER = hex("#F7F5EF");
const RULE = hex("#C9C4B6");
const INK = hex("#E4572E");

const IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

export interface WaveOptions {
  /** Number of full sine cycles across the stage. */
  readonly cycles?: number;
  /** Peak height in document pixels. */
  readonly amplitude?: number;
  /** Document id; must differ between variants so revisions differ. */
  readonly id?: string;
  readonly color?: string;
}

/** The sine as a polyline. `trim` draws chords between vertices, so subdivide finely. */
function sineVertices(x0: number, x1: number, cy: number, amplitude: number, cycles: number): PathVertex[] {
  const steps = Math.max(48, Math.round(cycles * 64));
  const zero = { x: 0, y: 0 };
  const vertices: PathVertex[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    vertices.push({
      point: { x: x0 + (x1 - x0) * t, y: cy - amplitude * Math.sin(t * cycles * Math.PI * 2) },
      inTangent: zero,
      outTangent: zero,
    });
  }
  return vertices;
}

export function buildWaveDocument(options: WaveOptions = {}): AnimationDocument {
  const cycles = options.cycles ?? 3;
  const amplitude = options.amplitude ?? 210;
  const id = options.id ?? "wave-draw";
  const ink = options.color ? hex(options.color) : INK;
  const margin = 110;
  const cy = WAVE_HEIGHT / 2;
  const END = WAVE_DURATION_TICKS;
  const zero = { x: 0, y: 0 };

  const nodes: Record<string, SceneNode> = {
    paper: {
      ...base("paper", { outTick: END, x: WAVE_WIDTH / 2, y: WAVE_HEIGHT / 2 }),
      type: "rect",
      size: constant({ width: WAVE_WIDTH, height: WAVE_HEIGHT }),
      cornerRadius: constant(0),
      style: { fill: fill(PAPER) },
    },
    // Static, so the engine caches it as a picture.
    baseline: {
      ...base("baseline", { outTick: END }),
      type: "path",
      path: constant({
        contours: [
          {
            closed: false,
            vertices: [
              { point: { x: margin - 30, y: cy }, inTangent: zero, outTangent: zero },
              { point: { x: WAVE_WIDTH - margin + 30, y: cy }, inTangent: zero, outTangent: zero },
            ],
          },
        ],
      }),
      style: { stroke: stroke(RULE, 4, { dash: [18, 14] }) },
    },
    wave: {
      ...base("wave", { outTick: END }),
      type: "path",
      path: constant({
        contours: [{ closed: false, vertices: sineVertices(margin, WAVE_WIDTH - margin, cy, amplitude, cycles) }],
      }),
      style: { stroke: stroke(ink, 14) },
      operators: [
        trim("wave.trim", {
          end: keyed("wave.end", [
            [0, 0, IN_OUT],
            [DRAW_TICKS, 1],
          ]),
        }),
      ],
    },
  };

  const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id,
    name: "Noise wave",
    canvas: { width: WAVE_WIDTH, height: WAVE_HEIGHT, pixelAspectRatio: 1, backgroundColor: PAPER },
    timing: {
      ticksPerSecond: TICKS_PER_SECOND,
      frameRate: { numerator: FPS, denominator: 1 },
      durationTicks: END,
      displayStartTick: 0,
    },
    assets: {},
    rootCompositionId: "main",
    components: {},
    compositions: {
      main: {
        id: "main",
        name: "Main",
        width: WAVE_WIDTH,
        height: WAVE_HEIGHT,
        durationTicks: END,
        nodes,
        rootNodeIds: ["paper", "baseline", "wave"],
      },
    },
    markers: [marker("drawn", DRAW_TICKS)],
    design: { tokens: { looping: false } },
    capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
  });
  assertValidAnimationDocument(document);
  return document;
}

/** Seconds of audio clock → the document tick to show, clamped to the document. */
export function secondsToTick(seconds: number): number {
  const tick = Math.round(seconds * TICKS_PER_SECOND);
  return Math.min(Math.max(tick, 0), WAVE_DURATION_TICKS - 1);
}

export { TICKS_PER_FRAME };
