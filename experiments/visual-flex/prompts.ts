/**
 * Prompts and output schemas for the four levels of visual generation.
 * Levels 1–3 use structured outputs (JSON schema); level 4 returns one ```ts block.
 */
import { estimateVisualSeconds, type ExperimentBeat } from "./beats";
import { END, FONT_ID, FONT_URI, H, PALETTE, PAPER, TPS, W } from "./doc";
import { PRIMITIVE_NAMES, PRIMITIVES } from "./primitives";

export type Level = 1 | 2 | 3 | 4;

const COLORS = Object.keys(PALETTE);

const SYSTEM = `You design the animated visual for one beat of a spoken lesson. A teacher voice speaks the sentence; your visual starts the moment the anchor word is spoken, builds while the rest of the sentence plays, then holds still. It sits on a whiteboard beside the speech, so it should show the idea, not repeat the sentence as text. Keep labels short. Answer with the requested output only.`;

function beatBrief(beat: ExperimentBeat): string {
  const seconds = estimateVisualSeconds(beat);
  return [
    `Question the learner asked: ${beat.question}`,
    `Sentence being spoken: "${beat.say}"`,
    `Anchor word: "${beat.at}". The visual's time 0 is when this word is spoken.`,
    `Timing: the visual must finish building within about ${seconds} seconds, then hold.`,
  ].join("\n");
}

// ---------- Level 1: one primitive by name ----------

const L1_SCHEMA = {
  type: "object",
  properties: { primitive: { type: "string", enum: PRIMITIVE_NAMES } },
  required: ["primitive"],
  additionalProperties: false,
};

function level1(beat: ExperimentBeat): string {
  const list = PRIMITIVE_NAMES.map((n) => `- ${n}: ${PRIMITIVES[n].describe}`).join("\n");
  return `${beatBrief(beat)}

Pick the ONE animation from this fixed library that best fits the sentence. It plays with default settings and no labels.
${list}

Return JSON: {"primitive": "<name>"}.`;
}

// ---------- Level 2: up to three parameterized primitives ----------

// Optional properties make the structured-output grammar explode ("Schema is too
// complex"), so every field is required and params are name/value pairs.
export const PARAM_NAMES = ["cycles", "amplitude", "phase", "color", "label", "labels", "steps", "values", "shape", "xLabel", "yLabel", "root", "children", "mode", "count", "layers", "text"];

const L2_SCHEMA = {
  type: "object",
  properties: {
    layout: { type: "string", enum: ["single", "row", "column"] },
    caption: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          primitive: { type: "string", enum: PRIMITIVE_NAMES },
          startsAt: { type: "number" },
          params: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string", enum: PARAM_NAMES }, value: { type: "string" } },
              required: ["name", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["primitive", "startsAt", "params"],
        additionalProperties: false,
      },
    },
  },
  required: ["layout", "caption", "items"],
  additionalProperties: false,
};

function level2(beat: ExperimentBeat): string {
  const list = PRIMITIVE_NAMES.map((n) => `- ${n}: ${PRIMITIVES[n].describe}. Params: ${PRIMITIVES[n].params}`).join("\n");
  return `${beatBrief(beat)}

Compose the visual from 1 to 3 animations from this library. Set each one's params (only the ones listed for it) as name/value pairs, when it starts (startsAt, seconds after the anchor word, 0–3.5), and a layout: "single" (all in one area), "row" (side by side) or "column" (stacked). The caption (max 6 words, or "" for none) sits on top.
${list}
Param values are strings: a number as "3", a list as items joined by "|" (e.g. steps "Sun|Leaf|Sugar", values "1|2|4"). Colors: ${COLORS.join(", ")}. Labels: max 3 words each.

Return JSON matching the schema.`;
}

// ---------- Level 3: a scene language on a 100x100 grid ----------

// Same reason as level 2: one flat element shape with every field required.
// `args` holds the kind's numbers in a fixed order; `text` holds a label or a plot's fn.
const L3_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["line", "plot", "circle", "rect", "arrow", "bar", "move", "text"] },
          at: { type: "number" },
          dur: { type: "number" },
          color: { type: "string", enum: COLORS },
          args: { type: "array", items: { type: "number" } },
          text: { type: "string" },
        },
        required: ["kind", "at", "dur", "color", "args", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["elements"],
  additionalProperties: false,
};

function level3(beat: ExperimentBeat): string {
  return `${beatBrief(beat)}

Draw the visual yourself with a small scene language. The canvas is a 100x100 grid: x goes right, y goes down, (0,0) is top left. The canvas is 3:2 (wider than tall), so 1 unit of x is 1.5x as long on screen as 1 unit of y. Use at most 30 elements. Every element has kind, at (seconds after the anchor word when it appears, 0–4.5), dur (seconds it takes to draw, 0.1–3), color, args (numbers, in the order below) and text ("" when unused).

Kinds and their args:
- line: x1, y1, x2, y2, x3, y3, ... (2+ points). Draws itself along the points.
- plot: box x, box y, box w, box h, xmin, xmax. text = a math expression in x using + - * / ^ ( ) and sin cos tan exp log sqrt abs pow min max floor pi. Draws the curve in the box, fitted vertically, left to right.
- circle: cx, cy, r (radius in x units), filled (1 or 0). Pops in.
- rect: x, y (top left), w, h, filled (1 or 0). Rounded box that pops in.
- arrow: x1, y1, x2, y2. Draws, then shows its head.
- bar: x (left), baseline (bottom y), w, h. Grows up from the baseline.
- move: x1, y1, x2, y2, r (dot radius, e.g. 1.2). A dot that travels.
- text: x, y (centre), size (pixels on a ${W}x${H} stage, e.g. 34). text = the label (max 4 words).
Colors: ${COLORS.join(", ")}. Keep everything inside 3..97 on both axes and leave space between labels.

Return JSON matching the schema.`;
}

// ---------- Level 4: raw Clayzo authoring code ----------

const CLAYZO_REFERENCE = `Clayzo authoring reference (condensed, for this task only)

Import ONLY from "@clayzo/animation/authoring":
  ANIMATION_DOCUMENT_VERSION, assertValidAnimationDocument, withComputedRevision,
  base, constant, keyed, fill, stroke, trim, hex, and the types AnimationDocument, SceneNode, PathVertex.

Time: ${TPS} ticks per second, 60 fps, so ticks must be multiples of 4. The document is ${END} ticks long (6 s). Tick 0 = the anchor word.
Stage: ${W} x ${H} units, x right, y down. Background ${PAPER}.

Helpers:
- hex("#RRGGBB") -> Color.
- constant(value) -> a non-animated property.
- keyed(id, [[tick, value, ease?], ...]) -> an animated property. Ticks increase; the last key holds. ease is "linear", "hold", or a cubic bezier {x1,y1,x2,y2} with x in 0..1, e.g. OUT = {x1:0.2,y1:0.6,x2:0.35,y2:1}.
- base(id, { outTick, inTick?, x?, y?, position?, anchor?, scale?, rotation?, opacity? }) -> the fields every node needs. Spread it into the node. x/y is the node's centre for rect/ellipse, the origin for paths and text. Use x/y OR position: keyed(id, [[t, {x,y,z:0}], ...]), never both. scale can be a number or keyed(id, [[t,{x,y,z:1}], ...]). Every node needs outTick: ${END}.
- fill(color, opacity?) and stroke(color, width) -> styles.
- trim(id, { end: keyed(id, [[t0, 0, OUT], [t1, 1]]) }) -> an operator that makes a path draw itself on.
Ids (node ids, keyed ids, trim ids) must be unique, letters/digits/._:- only, starting with a letter or digit.

Node shapes (all also spread ...base(...)):
- rect:    { type: "rect", size: constant({ width, height }), cornerRadius: constant(16), style: { fill: fill(c) } }
- ellipse: { type: "ellipse", size: constant({ width, height }), style: { fill: fill(c) } or { stroke: stroke(c, 6) } }
- path:    { type: "path", path: constant({ contours: [{ closed: false, vertices }] }), style: { stroke: stroke(c, 8) }, operators: [trim(...)] }
           vertices: PathVertex[] = [{ point: {x,y}, inTangent: {x:0,y:0}, outTangent: {x:0,y:0} }, ...] in stage units (straight segments; add many points for curves).
- text:    { type: "text", runs: constant([{ text, fontAssetId: "${FONT_ID}", fontSize: 34, fontWeight: 600, letterSpacing: 0, lineHeight: 41, color: c }]),
             box: { width, height: lineHeight }, wrap: "none", align: "center", verticalAlign: "top" } with base x/y at the box's TOP LEFT. ASCII text only.

Document shell (copy exactly, fill in nodes and rootNodeIds; rootNodeIds lists every node in draw order, "paper" first):
const paper: SceneNode = { ...base("paper", { outTick: ${END}, x: ${W / 2}, y: ${H / 2} }), type: "rect", size: constant({ width: ${W}, height: ${H} }), cornerRadius: constant(0), style: { fill: fill(hex("${PAPER}")) } };
const doc = withComputedRevision({
  version: ANIMATION_DOCUMENT_VERSION, id: "visual", name: "visual",
  canvas: { width: ${W}, height: ${H}, pixelAspectRatio: 1, backgroundColor: hex("${PAPER}") },
  timing: { ticksPerSecond: ${TPS}, frameRate: { numerator: 60, denominator: 1 }, durationTicks: ${END}, displayStartTick: 0 },
  assets: { ${FONT_ID}: { id: "${FONT_ID}", type: "font", uri: "${FONT_URI}", family: "Inter", style: "normal", weight: 600 } },
  rootCompositionId: "main", components: {},
  compositions: { main: { id: "main", name: "Main", width: ${W}, height: ${H}, durationTicks: ${END}, nodes: { paper, ...others }, rootNodeIds: ["paper", ...] } },
  markers: [], design: { tokens: { looping: false } }, capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
});
assertValidAnimationDocument(doc);
export default doc;

Palette: ${Object.entries(PALETTE).map(([k, v]) => `${k} ${v}`).join(", ")}.`;

function level4(beat: ExperimentBeat): string {
  return `${beatBrief(beat)}

Write a TypeScript module that builds the visual as a Clayzo animation document and default-exports it. You may compute geometry with plain code (loops, Math). No other imports, no I/O, no network, no randomness without a fixed seed.

${CLAYZO_REFERENCE}

Answer with exactly one \`\`\`ts code block and nothing else.`;
}

export interface LevelPrompt {
  system: string;
  user: string;
  schema?: object;
}

export function promptFor(level: Level, beat: ExperimentBeat): LevelPrompt {
  switch (level) {
    case 1:
      return { system: SYSTEM, user: level1(beat), schema: L1_SCHEMA };
    case 2:
      return { system: SYSTEM, user: level2(beat), schema: L2_SCHEMA };
    case 3:
      return { system: SYSTEM, user: level3(beat), schema: L3_SCHEMA };
    case 4:
      return { system: SYSTEM, user: level4(beat) };
  }
}
