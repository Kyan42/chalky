/**
 * The slow executor: a request the fast conversational model could not settle
 * from its small context ("delegate"), decided with the whole lesson in view:
 * every scene's elements with positions, every beat, the conversation, the
 * learner record, and the board picture when the learner drew on it. It
 * answers with actions from the same vocabulary (go_to, highlight, amend,
 * resume) and no words: the fast model already said a line to cover the wait.
 *
 * Sonnet 5.5 by default (DELEGATE_MODEL overrides), thinking off, JSON out.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { trackCall } from "./calllog";
import type { AmendAction, ConverseAction, ConverseResume, Exchange } from "./converse";
import { describeLearner, type CallLog, type LearnerRecord } from "./types";

export const DELEGATE_MODEL = process.env.DELEGATE_MODEL || "claude-sonnet-5-5";

export interface DelegateScene {
  scene: number;
  title: string;
  /** Elements drawn in this scene, with boxes on the scene's own 100x100 grid. */
  elements: { id: string; kind: string; label: string; box?: { x: number; y: number; w: number; h: number } }[];
}

export interface DelegateInput {
  request: string;
  utterance: string;
  question: string;
  beats: { id: string; say: string; mode: string; scene: number }[];
  /** The beat Chalky was on, and the scene in view. */
  beatIndex: number;
  scene: number;
  scenes: DelegateScene[];
  history: Exchange[];
  learner?: LearnerRecord;
  /** JPEG, base64, of the board with the learner's ink, when they drew. */
  image?: string;
}

export interface DelegateResult {
  actions: ConverseAction[];
  ms: number;
  model: string;
  call?: CallLog;
}

const SYSTEM = `You help Chalky, a teacher at a whiteboard, mid-lesson. The board is one long board: every scene the lesson drew sits on it side by side, and a camera shows one place at a time. A faster assistant who only sees the scene in view heard the learner, said a short line to cover the wait, and handed you a request it could not settle. You see everything. Decide what happens on the board now.

Answer with actions only (no words; Chalky has already spoken):
- {"type": "go_to", "scene": n} moves the camera to scene n's place; {"type": "go_to", "element": "id"} frames that element, in whatever scene it is.
- {"type": "highlight", "element": "id"} circles that element (go_to its scene first if it is not in view); {"type": "highlight", "region": {"x", "y", "w", "h"}} circles a spot on the grid of the scene the camera ends on, when the answer is a place, not an element.
- {"type": "amend", "op": "insert_after" | "replace_from" | "delete", "index": beat number, "note": "what the planner should do", "count": n}: change the lesson plan, only when the request asks for it.
- {"type": "resume", "how": "continue" | "replay_beat" | "wait"}: how the lesson goes on after; usually "wait" after showing them something, so they can look.
Use element ids exactly as listed. If nothing on the board answers it, return just a resume.`;

const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["go_to", "highlight", "amend", "resume"] },
          scene: { type: "integer" },
          element: { type: "string" },
          region: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"], additionalProperties: false },
          op: { type: "string", enum: ["insert_after", "replace_from", "delete"] },
          index: { type: "integer" },
          note: { type: "string" },
          count: { type: "integer" },
          how: { type: "string", enum: ["continue", "replay_beat", "wait"] },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
};

function context(o: DelegateInput): string {
  const at = (b?: { x: number; y: number; w: number; h: number }) => (b ? ` at x ${Math.round(b.x)}..${Math.round(b.x + b.w)}, y ${Math.round(b.y)}..${Math.round(b.y + b.h)}` : "");
  const scenes = o.scenes.map((s) => `Scene ${s.scene}${s.scene === o.scene ? " (in view)" : ""}: ${s.title}\n${s.elements.map((e) => `  - ${e.id}: ${e.kind} "${e.label}"${at(e.box)}`).join("\n") || "  (nothing drawn)"}`).join("\n");
  const beats = o.beats.map((b, i) => `${i + 1}. [${b.id}, scene ${b.scene}, ${b.mode}${i === o.beatIndex ? ", Chalky was here" : ""}] ${b.say}`).join("\n");
  const history = o.history.map((h) => `${h.who === "learner" ? "Learner" : "Chalky"}: ${h.text}`).join("\n") || "(none)";
  return [
    `The lesson answers: ${o.question}`,
    `The beats:\n${beats}`,
    `The board, scene by scene (boxes on each scene's own grid; x right, y down):\n${scenes}`,
    `The conversation so far:\n${history}`,
    describeLearner(o.learner),
    `The learner just said: "${o.utterance}"`,
    `The request handed to you: ${o.request}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Keeps only actions that name real scenes, elements and beats. */
export function cleanDelegated(raw: unknown, o: Pick<DelegateInput, "scenes" | "beats">): ConverseAction[] {
  const list = (raw && typeof raw === "object" && Array.isArray((raw as { actions?: unknown }).actions) ? (raw as { actions: unknown[] }).actions : []).slice(0, 6);
  const ids = new Set(o.scenes.flatMap((s) => s.elements.map((e) => e.id)));
  const scenes = new Set(o.scenes.map((s) => s.scene));
  const out: ConverseAction[] = [];
  for (const x of list) {
    const a = (x ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (a.type === "go_to") {
      if (typeof a.element === "string" && ids.has(a.element)) out.push({ type: "go_to", element: a.element });
      else if (n(a.scene) !== null && scenes.has(n(a.scene)!)) out.push({ type: "go_to", scene: n(a.scene)! });
    } else if (a.type === "highlight") {
      const r = (a.region ?? null) as Record<string, unknown> | null;
      if (typeof a.element === "string" && ids.has(a.element)) out.push({ type: "highlight", element: a.element });
      else if (r && [r.x, r.y, r.w, r.h].every((v) => n(v) !== null)) out.push({ type: "highlight", region: { x: n(r.x)!, y: n(r.y)!, w: Math.max(2, n(r.w)!), h: Math.max(2, n(r.h)!) } });
    } else if (a.type === "amend" && (a.op === "insert_after" || a.op === "replace_from" || a.op === "delete")) {
      const index = Math.round(n(a.index) ?? 0);
      if (index >= 1 && index <= o.beats.length + 1) out.push({ type: "amend", op: a.op as AmendAction, index, note: typeof a.note === "string" ? a.note.slice(0, 600) : "", ...(a.op === "delete" ? { count: Math.max(1, Math.round(n(a.count) ?? 1)) } : {}) });
    } else if (a.type === "resume" && (a.how === "continue" || a.how === "replay_beat" || a.how === "wait")) out.push({ type: "resume", how: a.how as ConverseResume });
  }
  return out;
}

export async function delegate(input: DelegateInput, signal?: AbortSignal): Promise<DelegateResult> {
  const t0 = performance.now();
  const tracked = trackCall("delegate", DELEGATE_MODEL);
  let message;
  let call: CallLog | undefined;
  try {
    message = await tracked.client.messages.create(
      {
        model: DELEGATE_MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        // Sonnet 5.5 turns thinking off with between_tools.
        thinking: DELEGATE_MODEL.startsWith("claude-sonnet-5-5") ? { type: "between_tools" } : { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [
          {
            role: "user",
            content: input.image
              ? [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.image } },
                  { type: "text", text: `The board as the learner sees it, with their ink on top.\n\n${context(input)}` },
                ]
              : context(input),
          },
        ],
      } as Anthropic.MessageCreateParamsNonStreaming,
      { signal },
    );
  } finally {
    call = tracked.finish();
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    console.warn(`[delegate] not JSON: ${text.slice(0, 200)}`);
  }
  const actions = cleanDelegated(raw, input);
  const ms = Math.round(performance.now() - t0);
  console.info(`[delegate] "${input.request.slice(0, 100)}" -> ${JSON.stringify(actions)} in ${ms} ms`);
  return { actions, ms, model: DELEGATE_MODEL, call };
}
