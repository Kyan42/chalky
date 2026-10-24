/**
 * Live visual generation for one beat on the growing board: the level 3 scene
 * language from the flexibility experiment (Claude Haiku 5.5, effort low,
 * structured outputs), plus element ids, `highlight` / `dim` edits on what is
 * already drawn, and `clear`. Compiled to one Clayzo document for the whole
 * board, with one repair turn on failure.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { L3_SCHEMA, SCENE_LANGUAGE } from "@/experiments/visual-flex/prompts";
import { anthropic } from "./anthropic";
import { compileBoard, describeBoard, MAX_ELEMENTS, type BoardElement, type BoardSpec } from "./board";
import type { PlannedBeat } from "./types";

const MODEL = "claude-haiku-5-5";

const SYSTEM = `You draw on a teacher's whiteboard, one beat of a spoken lesson at a time. A teacher voice speaks the sentence; your drawing starts the moment the anchor word is spoken, builds while the rest of the sentence plays, then holds still. The board keeps everything from earlier beats, like a real whiteboard, so build on it: add only what this beat needs, point at what is already there, and keep the board readable. Show the idea, don't repeat the sentence as text. Keep labels short. Answer with the requested output only.`;

const BOARD_RULES = `Board rules:
- Every element has an id: a short unique name like "sun" or "blue-wave". Ids from earlier beats stay valid.
- Two more kinds edit elements that are already on the board. They take no args (use []), and text is the id of the element to edit:
  - highlight: a soft yellow mark behind that element for about 1.5 seconds, to point at it while you talk about it. Highlight the main shape or label the sentence is about (a box, a circle, a curve, a label), not a single small dot. Time it to the word that names it. Also brings back a dimmed element.
  - dim: fades that element back so new things stand out. It stays dimmed in later beats until highlighted.
- Don't redraw something that is already on the board; highlight it instead. Most beats after the first should highlight at least one existing element, the one the sentence talks about.
- Put new elements only in free cells of the occupancy map. Never place a label on top of another label or shape. If there isn't room for this beat, dim older elements that no longer matter, or set clear.
- Keep clear false almost always: the point of the board is that it builds up. Set it true only when the occupancy map has no free room left for this beat, or the lesson switches to a completely different picture; then draw everything this beat needs from scratch. The board holds at most ${MAX_ELEMENTS} elements.`;

// The experiment's level 3 schema, plus `id` on each element, the two edit kinds and `clear`.
const item = L3_SCHEMA.properties.elements.items;
const BOARD_SCHEMA = {
  type: "object",
  properties: {
    clear: { type: "boolean" },
    elements: {
      type: "array",
      items: {
        ...item,
        properties: {
          id: { type: "string" },
          ...item.properties,
          kind: { type: "string", enum: [...item.properties.kind.enum, "highlight", "dim"] },
        },
        required: ["id", ...item.required],
      },
    },
  },
  required: ["clear", "elements"],
  additionalProperties: false,
};

/** Seconds of speech left after the anchor word, at about 2.6 words per second. */
function visualSeconds(beat: PlannedBeat): number {
  const words = beat.say.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "") === beat.at);
  return Math.max(1.5, +((words.length - Math.max(0, i)) / 2.6).toFixed(1));
}

export interface VisualResult {
  doc: AnimationDocument | null;
  /** The board after this beat; send it back with the next beat. */
  board: BoardElement[];
  cleared: boolean;
  edits?: { added: number; highlights: number; dims: number };
  ms: number;
  attempts: { ms: number; outputTokens: number; stopReason: string | null; error: string | null }[];
}

export async function generateVisual(question: string, beat: PlannedBeat, board: BoardElement[], signal?: AbortSignal, model = MODEL): Promise<VisualResult> {
  const client = anthropic();
  const t0 = performance.now();
  const pointOnly = beat.mode === "point";
  const brief = [
    `Question the learner asked: ${question}`,
    `What the teacher is saying now: "${beat.say}"`,
    `Anchor word: "${beat.at}". Time 0 is when this word is spoken.`,
    `Timing: this beat's drawing must finish within about ${visualSeconds(beat)} seconds, then hold.`,
    pointOnly
      ? `This beat only points at what is already on the board: use highlight and dim edits (at least one), and add no new elements. Time each highlight to the word that names it. What to point at: ${beat.visual}`
      : `What the teacher planned to draw: ${beat.visual}`,
    "",
    describeBoard(board),
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${brief}\n\n${SCENE_LANGUAGE}\n\n${BOARD_RULES}\n\nReturn JSON matching the schema.` },
  ];
  const attempts: VisualResult["attempts"] = [];

  for (let turn = 0; turn < 2; turn++) {
    const ta = performance.now();
    const message = await client.messages
      .stream(
        {
          model,
          max_tokens: 6000,
          system: SYSTEM,
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: { type: "json_schema", schema: BOARD_SCHEMA } },
        } as Anthropic.MessageStreamParams,
        { signal },
      )
      .finalMessage();
    const attempt = { ms: Math.round(performance.now() - ta), outputTokens: message.usage.output_tokens, stopReason: message.stop_reason, error: null as string | null };
    attempts.push(attempt);
    if (message.stop_reason === "refusal") {
      attempt.error = "refusal";
      break;
    }
    try {
      if (message.stop_reason === "max_tokens") throw new Error("output was cut off at max_tokens");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const spec = JSON.parse(text) as BoardSpec;
      if (pointOnly) {
        // A pointing beat never adds or wipes anything, whatever the model sent.
        spec.clear = false;
        spec.elements = spec.elements.filter((e) => e.kind === "highlight" || e.kind === "dim");
        if (!spec.elements.length) throw new Error("this beat must highlight or dim at least one element that is already on the board");
      }
      const result = compileBoard(board, spec, beat.id, `${beat.id}-${Date.now()}`);
      const edits = spec.elements.filter((e) => e.kind === "highlight" || e.kind === "dim");
      if (edits.length) console.info(`[visual] ${beat.id} edits: ${edits.map((e) => `${e.kind} ${e.text} at ${e.at}s for ${e.dur}s`).join("; ")}`);
      return {
        doc: result.doc, board: result.board, cleared: spec.clear,
        edits: { added: result.added, highlights: result.highlights, dims: result.dims },
        ms: Math.round(performance.now() - t0), attempts,
      };
    } catch (e) {
      attempt.error = String((e as Error).message ?? e).slice(0, 800);
      messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: "user", content: `That failed with this error:\n${attempt.error}\n\nFix it and answer again in the same format.` });
    }
  }
  return { doc: null, board, cleared: false, ms: Math.round(performance.now() - t0), attempts };
}
