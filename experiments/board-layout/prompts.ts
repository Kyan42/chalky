/**
 * Prompts and schemas for the board-layout experiment:
 *   presets, sequential: the v2 preset language, drawn beat after beat on the real board;
 *   layout + parallel:   one layout pass gives every beat a region and the element ids it
 *                        introduces, then all beats are drawn at once from that plan.
 */
import { PALETTE } from "@/experiments/visual-flex/doc";
import { PRESET_KINDS } from "@/lib/lesson/presets";
import type { PlannedBeat } from "@/lib/lesson/types";

const COLORS = Object.keys(PALETTE);

export const SYSTEM = `You draw on a teacher's whiteboard, one beat of a spoken lesson at a time. A teacher voice speaks the sentence; your drawing starts the moment the anchor word is spoken, builds while the rest of the sentence plays, then holds still. The board keeps everything from earlier beats, like a real whiteboard. Show the idea with shapes and arrows, not sentences: labels are 1 to 3 words. Answer with the requested output only.`;

export const PRESET_LANGUAGE = `Scene language. The board is a 100x100 grid: x right, y down, (0,0) top left; it is 3:2 on screen, so 1 unit of x is 1.5x as long as 1 unit of y. You choose WHAT to draw and roughly WHERE; the renderer places labels, snaps arrows to shapes and keeps text from overlapping, so prefer the kinds that do that for you.

Every element has: id (short unique name, e.g. "sun", "leaf", "co2-in"), kind, at (seconds after the anchor word, 0-4.5), dur (seconds to draw, 0.1-3), color, args (numbers in the order below), text ("" if unused), refs (comma-separated ids, "" if unused).

Shapes (give them a text label; the renderer puts it inside or on the free side):
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
- highlight: a soft yellow mark behind it for about 1.5 s, timed to the word that names it. Use it to point while you talk about something already there.
- dim: fades it back so new things stand out.

Rules: keep shapes inside 4..96 on both axes; leave room around shapes for their labels; draw few, large, clear shapes rather than many small ones (a beat usually adds 2 to 6 elements); never redraw what is already there, connect to it or highlight it instead. Colors: ${COLORS.join(", ")}.`;

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

function visualSeconds(beat: PlannedBeat): number {
  const words = beat.say.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "") === beat.at);
  return Math.max(1.5, +((words.length - Math.max(0, i)) / 2.6).toFixed(1));
}

function brief(question: string, beat: PlannedBeat) {
  return [
    `Question the learner asked: ${question}`,
    `What the teacher is saying now: "${beat.say}"`,
    `Anchor word: "${beat.at}". Time 0 is when this word is spoken; finish within about ${visualSeconds(beat)} seconds.`,
    beat.mode === "point"
      ? `This beat only points at what is already on the board: use highlight and dim (at least one), add nothing new. What to point at: ${beat.visual}`
      : `What the teacher planned to draw: ${beat.visual}`,
  ].join("\n");
}

/** Presets, drawn in order: the model sees the real board as placed so far. */
export function sequentialPrompt(question: string, beat: PlannedBeat, board: string) {
  return `${brief(question, beat)}\n\n${board}\n\n${PRESET_LANGUAGE}\n\nReturn JSON matching the schema.`;
}

export interface LayoutBeat {
  id: string;
  /** Scenes start on a fresh board; v1 layouts have none (one board for the lesson). */
  scene?: number;
  region: { x: number; y: number; w: number; h: number };
  introduces: { id: string; what: string }[];
  refs: string[];
}

/** Layout + parallel: the model sees only the plan (its region, what earlier beats declared), not the drawn board. */
export function parallelPrompt(question: string, beat: PlannedBeat, plan: LayoutBeat, earlier: LayoutBeat[]) {
  const r = plan.region;
  const before = earlier.flatMap((b) => b.introduces.map((e) => `- ${e.id}: ${e.what} (somewhere in x ${b.region.x}..${b.region.x + b.region.w}, y ${b.region.y}..${b.region.y + b.region.h})`));
  return `${brief(question, beat)}

Layout for this beat: draw your new shapes inside the region x ${r.x}..${r.x + r.w}, y ${r.y}..${r.y + r.h}. Other beats own the rest of the board.
${plan.introduces.length ? `Create these elements with exactly these ids: ${plan.introduces.map((e) => `${e.id} (${e.what})`).join("; ")}. You may add a couple more inside your region.` : "Add nothing new."}
${before.length ? `Already on the board from earlier beats (you can connect to, label, highlight or dim them by id; don't redraw them):\n${before.join("\n")}` : "The board is empty before this beat."}

${PRESET_LANGUAGE}

Return JSON matching the schema.`;
}

export const LAYOUT_SCHEMA: {
  type: "object";
  properties: { beats: { type: "array"; items: { type: "object"; properties: Record<string, object>; required: string[]; additionalProperties: false } } };
  required: string[];
  additionalProperties: false;
} = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          region: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
          introduces: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, what: { type: "string" } }, required: ["id", "what"], additionalProperties: false },
          },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["id", "region", "introduces", "refs"],
        additionalProperties: false,
      },
    },
  },
  required: ["beats"],
  additionalProperties: false,
};

/** v2 of the layout pass: the lesson is split into scenes, each a fresh board of at most four drawings. */
export const SCENE_LAYOUT_SCHEMA = {
  ...LAYOUT_SCHEMA,
  properties: {
    beats: {
      type: "array",
      items: {
        ...LAYOUT_SCHEMA.properties.beats.items,
        properties: { scene: { type: "number" }, ...LAYOUT_SCHEMA.properties.beats.items.properties },
        required: ["scene", ...LAYOUT_SCHEMA.properties.beats.items.required],
      },
    },
  },
};

export function sceneLayoutPrompt(question: string, beats: PlannedBeat[]) {
  const list = beats.filter((b) => b.mode !== "talk").map((b) => `${b.id} (${b.mode}): says "${b.say}"\n   planned visual: ${b.visual}`).join("\n");
  return `You lay out a teacher's whiteboard for a spoken lesson before anything is drawn, so every beat's drawing can be made at the same time. The board is a 100x100 grid (x right, y down; 3:2 on screen).

Lesson question: ${question}
Beats that draw or point:
${list}

First split the lesson into scenes. A scene is one picture the teacher builds up and then wipes, like moving to a clean part of the whiteboard. A scene holds at most 4 draw beats (point beats don't count) and should be one coherent picture: start a new scene when the lesson zooms in, moves to a new stage, or switches to an example. Number scenes 1, 2, 3 in order.

Then, within each scene (the board starts empty for each scene):
- region: where that beat's new drawing goes. Draw beats in the same scene get regions that don't overlap, sized to what they draw (the scene's main picture can take 50x55; additions 25x25 to 35x35). Place related parts next to each other so arrows between them are short. Keep 5 units clear at every edge. For a point beat, give the region of what it points at, in its scene.
- introduces: the elements this beat creates, each with a short unique id (like "sun", "leaf", "co2-arrow") and a few words on what it is. Point beats introduce nothing.
- refs: ids from earlier beats IN THE SAME SCENE that this beat connects to, highlights or dims (earlier scenes have been wiped).

Return JSON matching the schema.`;
}

export function layoutPrompt(question: string, beats: PlannedBeat[]) {
  const list = beats.filter((b) => b.mode !== "talk").map((b) => `${b.id} (${b.mode}): says "${b.say}"\n   planned visual: ${b.visual}`).join("\n");
  return `You lay out a whiteboard for a spoken lesson before anything is drawn, so every beat's drawing can be made at the same time. The board is a 100x100 grid (x right, y down; 3:2 on screen) and keeps everything drawn.

Lesson question: ${question}
Beats that draw or point:
${list}

For each beat give:
- region: the part of the board its new drawing goes in. Draw beats should get regions that don't overlap each other, sized to what they draw (a main diagram can take 40x45; a small addition 25x20). Put the main picture first and add related parts next to what they relate to, so arrows between them are short. Leave a 4-unit margin at the edges. If the board would run out of room, make later regions smaller rather than overlapping. For a point beat, give the region of the things it points at.
- introduces: the elements this beat creates, each with a short unique id (like "sun", "leaf", "co2-arrow") and a few words on what it is. Point beats introduce nothing.
- refs: ids from earlier beats this beat connects to, highlights or dims.

Return JSON matching the schema.`;
}
