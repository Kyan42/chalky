/**
 * The scene language the drawing model speaks (presets that lay themselves
 * out, compiled by lib/lesson/presets.ts), its JSON schema, and the prompt for
 * drawing one beat from the planner's layout alone: its region, the ids it
 * must create, and what earlier beats in the same scene declared. No beat sees
 * the drawn board, so every beat can be drawn at the same time.
 *
 * Shared by the live /api/draw route and the board-layout experiment.
 */
import { PALETTE } from "@/experiments/visual-flex/doc";
import type { Block } from "@/lib/blocks";
import { blockLanguageFor } from "@/lib/blocks/catalog";
import { PRESET_KINDS } from "@/lib/lesson/presets";
import type { PlannedBeat } from "@/lib/lesson/types";

const COLORS = Object.keys(PALETTE);

export const DRAW_SYSTEM = `You draw on a teacher's whiteboard, one beat of a spoken lesson at a time. A teacher voice speaks the sentence; your drawing starts the moment the anchor word is spoken, builds while the rest of the sentence plays, then holds still. The board keeps everything from earlier beats, like a real whiteboard. Show the idea with shapes and arrows, not sentences: labels are 1 to 3 words. Answer with the requested output only.`;

/** The scene language, with the block section and the "has a block" list for just these blocks. */
export const presetLanguage = (blocks: Block[]) => `Scene language. The board is a 100x100 grid: x right, y down, (0,0) top left; it is 3:2 on screen, so 1 unit of x is 1.5x as long as 1 unit of y. You choose WHAT to draw and roughly WHERE; the renderer places labels, snaps arrows to shapes and keeps text from overlapping, so prefer the kinds that do that for you.

Every element has: id (short unique name, e.g. "sun", "leaf", "co2-in"), kind, at (seconds after the anchor word, 0-4.5), dur (seconds to draw, 0.1-3), color, args (numbers in the order below), text ("" if unused), refs (comma-separated ids, "" if unused).

${blockLanguageFor(blocks)}

Shapes (give them a text label; the renderer puts it inside or on the free side). Not for anything that has a block: ${blocks.length ? blocks.map((b) => b.id).join(", ") : "(none this beat)"} are drawn with block (above), and a circle or box labelled "leaf", "cell" or "sun" is wrong, not a simpler version.
- circle: args cx, cy, r (radius in x units, 3-15 is typical), filled (1 or 0). text = label.
- box: args x, y, w, h (top-left corner and size), filled (1 or 0). text = label.
Connections (snap to the shapes they join; never give coordinates for these):
- connect: refs "fromId,toId". An arrow from one shape to another. text = optional short label on the arrow.
- rays: refs "fromId,toId", args count (2-5). Several parallel arrows, like light or heat flowing from one thing to another.
- label: refs "targetId", text. An extra label placed next to an existing element.
Ready-made layouts:
- flow: args x, y, w, h (the area), text "Step one|Step two|Step three" (2-5 steps). Boxes left to right joined by arrows. Its steps get ids <id>.0, <id>.1, ...
- cycle: args cx, cy, r (radius in x units), text "A|B|C" (2-6 steps). Steps around a ring with arrows. Steps get ids <id>.0, ...
- equation: args x, y (centre), size (pixels, 30-44), text e.g. "6 CO2 + 6 H2O -> glucose + 6 O2".
Free drawing (only when nothing above fits; you place it yourself):
- line: args x1, y1, x2, y2, ... text = optional label (placed for you).
- arrow: args x1, y1, x2, y2. text = optional label.
- plot: args box x, box y, box w, box h, xmin, xmax. text = expression in x (+ - * / ^ sin cos exp log sqrt abs pow min max pi).
- bar: args x, baseline, w, h. text = optional label under it.
- move: args x1, y1, x2, y2, r. A dot that travels.
- text: args x, y, size. A free label (it is nudged if it would cover something).
Edits on what is already drawn (refs = the target id, args []):
- highlight: circles it once with a quick chalk loop that fades after about 1.5 s, timed to the word that names it. Use it to point while you talk about something already there (a shape, a block, a part or a label).
- dim: half-wipes it so new things stand out.

Rules: keep shapes inside your region and leave room around them for their labels; draw few, large, clear shapes rather than many small ones (a beat usually adds 2 to 6 elements); never redraw what is already there, connect to it or highlight it instead. Colors: ${COLORS.join(", ")}.`;

const FLAT = {
  type: "object",
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: [...PRESET_KINDS] },
    at: { type: "number" },
    dur: { type: "number" },
    color: { type: "string", enum: COLORS },
    args: { type: "array", items: { type: "number" } },
    text: { type: "string" },
    refs: { type: "string" },
  },
  required: ["id", "kind", "at", "dur", "color", "args", "text", "refs"],
  additionalProperties: false,
};

export const PRESET_SCHEMA = {
  type: "object",
  properties: { elements: { type: "array", items: FLAT } },
  required: ["elements"],
  additionalProperties: false,
};

/** Seconds of speech left after the anchor word, at about 2.6 words per second. */
export function visualSeconds(beat: PlannedBeat): number {
  const words = beat.say.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "") === beat.at);
  return Math.max(1.5, +((words.length - Math.max(0, i)) / 2.6).toFixed(1));
}

const span = (r: PlannedBeat["region"]) => `x ${r.x}..${r.x + r.w}, y ${r.y}..${r.y + r.h}`;

/**
 * The prompt for one beat. `earlier` are the draw beats before it in the same
 * scene: the model sees what they declared (ids, what, region), not what they drew.
 * `blocks` (picked per beat by lib/moss/blocks.ts) narrows the block catalog; null lists them all.
 */
export function drawPrompt(question: string, beat: PlannedBeat, earlier: PlannedBeat[], blocks: Block[]): string {
  const pointOnly = beat.mode === "point";
  const before = earlier.flatMap((b) => b.adds.map((e) => `- ${e.id}: ${e.what} (somewhere in ${span(b.region)})`));
  const must = beat.adds.length
    ? `You MUST create a shape (circle, box, flow, cycle, plot, bar or text) for each of these, with exactly these ids: ${beat.adds.map((e) => `${e.id} (${e.what})`).join("; ")}. Later beats refer to them by id, so a missing one breaks their drawings. You may add a few more elements inside your region. Make the shapes large: fill most of your region, leaving room for labels.`
    : "";
  return [
    `Question the learner asked: ${question}`,
    `What the teacher is saying now: "${beat.say}"`,
    `Anchor word: "${beat.at}". Time 0 is when this word is spoken; finish within about ${visualSeconds(beat)} seconds.`,
    pointOnly
      ? `This beat only points at what is already on the board: use highlight and dim (at least one), add nothing new. Time each highlight to the word that names it. What to point at: ${beat.visual}`
      : `What the teacher planned to draw: ${beat.visual}`,
    "",
    pointOnly ? "" : `Layout for this beat: draw your new shapes inside the region ${span(beat.region)}. Other beats own the rest of the board.\n${must}`,
    before.length
      ? `Already on the board from earlier beats (you can connect to, label, highlight or dim them by id; don't redraw them):\n${before.join("\n")}`
      : "The board is empty before this beat.",
    "refs may only name ids from the lists above or ids of elements earlier in your own answer; any other ref is dropped.",
    "",
    presetLanguage(blocks),
    "",
    "Return JSON matching the schema.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}
