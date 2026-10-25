/**
 * The fast conversational layer: answers whatever the learner says, before a
 * lesson or during one, and decides what happens next. Streams the spoken
 * reply a sentence at a time (so TTS can start on the first one) and ends with
 * one trailer: a list of actions the reply takes, in order (say, start_lesson,
 * ask, point, sketch, amend, resume). The lesson executes them; pausing and
 * when playback starts stay with the lesson, never the model.
 *
 * Haiku 5.5 with thinking off at low effort; Sonnet 5.5 if Haiku fails before
 * the first sentence. "ok / got it / keep going" never reaches a model.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { trackCall } from "./calllog";
import { cleanId } from "./planner";
import { isResume, isStillLost } from "./resume";
import { NOTE_RULES, withVoiceRules } from "./voice";
import { describeLearner, type BeatMode, type CallLog, type LearnerRecord } from "./types";

export const CONVERSE_MODEL = process.env.CONVERSE_MODEL || "claude-haiku-5-5";
export const CONVERSE_FALLBACK_MODEL = process.env.CONVERSE_FALLBACK_MODEL || "claude-sonnet-5-5";

/** 1 answer: a brief grounded answer. 2 detour: a short side explanation with a drawing. 3 replan: change the lesson. */
/** confirm: they got it, acknowledge and go on. answer: point at what's on the board. detour: draw what's missing. replan: change the lesson. */
export type ConverseLevel = "confirm" | "answer" | "detour" | "replan";
export type ConverseResume = "replay_beat" | "continue" | "wait";
export type CursorGesture = "point" | "circle" | "sweep" | "underline" | "tap";

/** One cursor move while the reply is spoken, anchored to a word of the reply. */
export interface CursorCue {
  /** The spoken word the gesture starts on, as written in the reply. */
  word: string;
  /** Which occurrence of that word in the reply, 1-based. */
  occurrence: number;
  /** An element id on the board. */
  target: string;
  gesture: CursorGesture;
  /** For sweep: the element it travels to (omitted: along `target`'s extent). */
  to?: string;
}

/** What a reply does, in order. The spoken text is the reply's words; these are its deeds. */
export type ConverseAction =
  /** Nothing beyond the words: a remark, a joke, a quick answer that needs no board. */
  | { type: "say" }
  /** Start a lesson (the planner starts from this). */
  | { type: "start_lesson"; question: string; focus: string; level: string }
  /** One spoken question back, then wait (the intake; a check). */
  | { type: "ask"; question: string }
  | { type: "point"; cues: CursorCue[] }
  | { type: "sketch"; sketch: NonNullable<ConverseTrailer["sketch"]> }
  /** Edit the lesson's beat timeline (1-based beat numbers): a detour, a new ending, or dropping beats. */
  | { type: "amend"; op: AmendAction; index: number; note: string; count?: number }
  | { type: "resume"; how: ConverseResume }
  /** Move the board's camera to a scene's place, or to frame one element (in any scene). */
  | { type: "go_to"; scene?: number; element?: string }
  /** The cursor circles an element of the scene in view, or a spot (a rectangle on that scene's grid). */
  | { type: "highlight"; element?: string; region?: { x: number; y: number; w: number; h: number } }
  /** Hand a request the fast model cannot settle from its context to the slow executor. */
  | { type: "delegate"; request: string };
export type AmendAction = "insert_after" | "replace_from" | "delete";

export interface ConverseTrailer {
  /** The actions as the model chose them (cleaned), for the transcript and the executor. */
  actions: ConverseAction[];
  /** start_lesson's arguments, if the reply starts a lesson. */
  lesson: { question: string; focus: string; level: string } | null;
  /** The amend action, if any (its note is also planner_note). */
  amend: { op: AmendAction; index: number; note: string; count?: number } | null;
  /** Derived from the actions: say alone is "confirm", point/sketch/ask "answer", insert_after "detour", replace_from "replan". */
  level: ConverseLevel;
  resume: ConverseResume;
  cursor: CursorCue[];
  /** The short check question the reply ends with, or null. */
  check: string | null;
  /** One or two sentences for the planner: what did not land and what angle to try. */
  planner_note: string;
  /**
   * For an answer: a small drawing added to the board while it is spoken, so
   * the picture follows the question. What to draw, and the new elements it
   * introduces (ids later turns can point at). Null: the board stays as it is.
   */
  sketch: { visual: string; adds: { id: string; what: string }[]; near: string | null; side: SketchSide } | null;
  /** go_to's target, if any. */
  goTo?: { scene?: number; element?: string } | null;
  /** highlight targets, in order. */
  highlights?: { element?: string; region?: { x: number; y: number; w: number; h: number } }[];
  /** delegate's request, if any. */
  delegate?: string | null;
}

/** A scene of the one board, as the fast model sees it: its number, a title, and the ids drawn there. */
export interface SceneRef {
  scene: number;
  title: string;
  ids: string[];
}

/** A board element the retrieval index found for the utterance (any scene). */
export interface BoardHit {
  id: string;
  label: string;
  scene: number;
  /** The beat sentence that introduced it. */
  said: string;
}

export interface ConverseBeat {
  id: string;
  say: string;
  mode: BeatMode;
  /** The section goal, on a section's first beat. */
  section?: string;
  /** The beat ends with a check-in question. */
  check?: boolean;
}

export interface BoardElementRef {
  id: string;
  kind: string;
  label: string;
  /** Where it is, on the board's grid (0..100 is the visible board before any zooming out; y down). */
  box?: { x: number; y: number; w: number; h: number };
}

/** Where an answer's sketch goes: on one side of an element already drawn, or on it (to mark the thing itself). */
export type SketchSide = "above" | "below" | "left" | "right" | "on";

export interface Exchange {
  who: "learner" | "chalky";
  text: string;
}

export interface ConverseInput {
  utterance: string;
  /** The scene in view (the board list is its elements, on its own grid), and every scene drawn so far. */
  scene?: number;
  scenes?: SceneRef[];
  /** Retrieval: the board elements (any scene) that best match the utterance. */
  candidates?: BoardHit[];
  /** Retrieval: what this learner said in earlier lessons that best matches the utterance. */
  memory?: string[];
  question: string;
  beats: ConverseBeat[];
  /** Index of the beat Chalky was on (or just finished); -1 before the lesson. */
  beatIndex: number;
  /** Word of that beat where Chalky stopped; -1 if the beat had finished. */
  wordIndex: number;
  board: BoardElementRef[];
  history: Exchange[];
  /** Escalation already reached for this confusion: 0 none, 1 answer given, 2 detour given. */
  escalation: 0 | 1 | 2;
  learner?: LearnerRecord;
  /** What the learner drew on the board before speaking, if anything. */
  ink?: ConverseInk;
}

/** The learner's ink: the board elements it marks, strokes that mark nothing, and a picture of the board with it. */
export interface ConverseInk {
  marks: { id: string; label: string; how: "circled" | "pointed at" | "drew over"; latest?: boolean }[];
  loose: number;
  /** JPEG, base64, of the board with the learner's ink on top. */
  image?: string;
}

/** NDJSON events from POST /api/converse. */
export type ConverseEvent =
  | { type: "start"; model: string; local: boolean; tMs: number }
  /** The level the actions line implies, sent before it speaks, so a detour can start planning at once. */
  | { type: "level"; level: ConverseLevel; tMs: number }
  /** The action names from the reply's first line, before it speaks. */
  | { type: "actions"; names: string[]; tMs: number }
  | { type: "sentence"; text: string; tMs: number }
  | { type: "trailer"; trailer: ConverseTrailer; tMs: number; modelCues?: unknown[] }
  | { type: "done"; tMs: number; model: string; inputTokens: number; outputTokens: number; fellBack: boolean; calls?: CallLog[] }
  | { type: "error"; message: string; tMs: number };

export { isResume };

const SENTINEL = "<<<trailer>>>";

const SYSTEM = `You are Chalky, a warm, clear teacher at a whiteboard. The learner just said something, before a lesson or during one. Reply out loud, briefly, and choose what happens next as a list of actions. The board does the explaining: you point at it or draw on it, you don't lecture.

The actions (several per turn, applied in order):
- "say": nothing beyond your words; the lesson goes on unchanged. For a remark ("huh, that's cool"), a joke, thanks, a greeting, or a quick factual question that needs no board. To a remark, a reaction or thanks: exactly ONE short sentence, then the lesson goes on by itself (do not announce it). To a quick question: up to three sentences.
- "start_lesson" {"question", "focus", "level"}: start teaching a lesson. Use it when they want to learn something properly ("I want to learn photosynthesis", "teach me how vaccines work", "ok, teach me properly", "tell me more"). Not for a quick question: answer that with "say" and let them ask for more. "question" is the lesson's question in their words or close to it; "focus" what they seem to want from it; "level" beginner, some, or advanced if you can tell, else "unknown".
- "ask" {"question"}: one short question back to them, spoken as the last sentence of your reply; then you wait for the answer. Before a lesson starts, ask one question that would change how you teach it (what they already know, or what they need it for), together with "start_lesson": the lesson is planned while they answer. Not for a greeting or a quick question.
- "point" [{"at", "target", "gesture", "to"}]: a cursor (a teacher's hand) moves over the board while you speak. One cue for each element you name, anchored to the exact word of your reply where you name it (as it appears; add #2 for its second occurrence, e.g. "orbit#2"), using only element ids from the board list. Gestures: "circle" to single out a shape (prefer it), "underline" for a label, a word or an equation, "tap" for a quick "this one", "point" to rest beside it, "sweep" to travel from it to another element ("to": that id).
- "sketch" {"visual", "adds", "near", "side"}: one small drawing added while you speak, when the answer needs one small thing that is not on the board (they name something new: a cloud, the ocean, a person, violet light). One sentence saying what to draw, the new elements it introduces with short ids (one to three simple things), and where: "near" an element on the board and "side" (above, below, left, right, or on). Put it where it would really be, read from the positions: the sun, clouds and rain above the ground and the plants, roots and soil below the ground line, a part inside or on the thing it belongs to; use "on" only to mark the element itself. The board zooms out if there is no room, so never put a thing somewhere wrong to make it fit. Talk about it as it appears ("here's the prism..."). Never point at some other element instead of drawing the missing one.
- "amend" {"op", "index", "note", "count"}: change the lesson's plan (beats are numbered as listed below). "insert_after" puts a short detour (a drawing from a fresh angle) after beat "index": use it only when they are still lost on what you just explained ("I still don't get it", "huh?") or ask you to draw something. "replace_from" rewrites the lesson from beat "index" on: when a detour was already given and they are still lost, or the lesson should go another way (they know this part, they want something else). "delete" drops "count" beats from beat "index" (they no longer apply, e.g. a sketch already covered them). The "note" tells the planner, as instructions, what the learner needs and which picture or angle would show it. With "insert_after" or "replace_from", say EXACTLY ONE short hand-off sentence ("Let me draw that for you.", "Let me come at this from a different direction.") and do not start explaining: the drawing does that.
- "go_to" {"scene"} or {"element"}: the board is one long board with every scene the lesson drew on it, side by side; this moves the camera back to an earlier scene's place, or frames one element in any scene. For "show me where the diagram for X was": go_to that element or scene, then "highlight" it. The board stays there until the lesson's next beat brings the camera back.
- "highlight" {"element"} or {"region": {"x", "y", "w", "h"}}: the cursor circles an element of the scene in view, or a spot on that scene's grid (the same coordinates as the element positions) when what they ask about is a place, not an element.
- "delegate" {"request"}: when you cannot settle the request from what you are given here (they ask about something from another scene and neither the scene list nor the candidates name it, or it needs the whole lesson at once), say ONE short line that covers the wait ("Let me find that.") and hand over the request, in one sentence, to a slower helper who sees the whole board and lesson; its actions arrive a moment later. Never delegate pointing at something in the scene in view, or anything the candidates name.
- "resume" {"how"}: how the lesson goes on after your reply: "continue" (go on from where it was), "replay_beat" (say the beat you were cut off in again), or "wait" (wait for them). If you leave it out: "wait" after an "ask", else "continue".

Choosing:
- A simple check or question about what is already on the board: "point" at it (name it and circle it). That is all.
- The answer needs one small thing that is not on the board: "sketch" it (with "point" for what is there).
- At a check-in, they restate their understanding and it is right or close enough: "say" one short line ("Right, that's it.") and the lesson goes on.
- Still lost on what you just explained: "amend" insert_after; still lost after a detour: "amend" replace_from.
- A remark or a reaction mid-lesson: "say" one short sentence, and the lesson goes on.
- Off the lesson's path: answer briefly by the same rules and steer back.
At most two spoken sentences, except a quick "say" answer may use three. Plain spoken words only: no lists, no markdown, no symbols that read badly aloud; write numbers and units as words.

The learner can draw on the board with a pen (blue, green, orange or dark strokes; your own marks are red). When they did, you are told what their ink marks and may see a picture of the board with their ink. Their "this", "that" or "here" means their newest mark, even when older ink is still on the board: answer about it by name, and point at it or circle it.

Everything between the first line and the trailer line is spoken aloud to the learner, word for word. Speak to them directly: never describe what you are going to do, never talk about "the learner", actions, levels, resume or cues there.

Output format, exactly: a first line "actions: " with the action names in order (write amend with its op, e.g. "actions: say" or "actions: point, sketch" or "actions: amend:insert_after" or "actions: ask, start_lesson"), then the spoken reply as plain text, then a line containing only ${SENTINEL}, then one JSON object on one line:
{"actions": [{"type": "say"} | {"type": "start_lesson", "question": "...", "focus": "...", "level": "..."} | {"type": "ask", "question": "the question you ended with"} | {"type": "point", "cues": [{"at": "word" | "word#2", "target": "element-id", "gesture": "circle" | "underline" | "tap" | "point" | "sweep", "to": "element-id"}]} | {"type": "sketch", "visual": "what to draw", "adds": [{"id": "short-id", "what": "what it is"}], "near": "element-id", "side": "above" | "below" | "left" | "right" | "on"} | {"type": "amend", "op": "insert_after" | "replace_from" | "delete", "index": 3, "note": "...", "count": 2} | {"type": "resume", "how": "continue" | "replay_beat" | "wait"} | {"type": "go_to", "scene": 2} | {"type": "go_to", "element": "element-id"} | {"type": "highlight", "element": "element-id"} | {"type": "highlight", "region": {"x": 10, "y": 20, "w": 30, "h": 20}} | {"type": "delegate", "request": "..."}]}
Nothing else: no code fences, no commentary.`;

/** Spoken sentences allowed, by the actions named on the first line; the board does the rest. */
function sentenceBudget(names: string[]): number {
  if (names.some((n) => n === "amend:insert_after" || n === "amend:replace_from" || n === "delegate")) return 1;
  if (names.length && names.every((n) => n === "say" || n === "resume")) return 3;
  return 2;
}
/** The level an actions line implies, for the early "level" event. */
function levelOf(names: string[]): ConverseLevel {
  if (names.includes("amend:replace_from")) return "replan";
  if (names.includes("amend:insert_after")) return "detour";
  if (names.some((n) => n === "point" || n === "sketch" || n === "ask" || n === "start_lesson" || n === "go_to" || n === "highlight" || n === "delegate")) return "answer";
  return "confirm";
}
const ACTION_NAMES = /\b(say|start_lesson|ask|point|sketch|resume|go_to|highlight|delegate|amend(?::\s*(?:insert_after|replace_from|delete))?)\b/g;
const RESUMES = new Set<ConverseResume>(["replay_beat", "continue", "wait"]);
const GESTURES = new Set<CursorGesture>(["point", "circle", "sweep", "underline", "tap"]);
const SIDES = new Set<SketchSide>(["above", "below", "left", "right", "on"]);

function context(o: ConverseInput): string {
  const beats = o.beats.length
    ? o.beats.map((b, i) => `${i + 1}. [${b.mode}${i === o.beatIndex ? ", you were on this one" : i < o.beatIndex ? "" : ", not said yet"}] ${b.say}`).join("\n")
    : "(no beats yet)";
  const now = o.beats[o.beatIndex];
  let where = "The learner spoke between beats, after you finished one.";
  if (now?.check && o.wordIndex < 0) {
    // At a check-in: what was asked, what this section is for, and what is coming, so "we'll get to that" is a real answer.
    const asked = now.say.split(/(?<=[.!?])\s+/).filter((x) => x.trim().endsWith("?")).pop() ?? now.say;
    let goal = "";
    for (let k = o.beatIndex; k >= 0 && !goal; k--) goal = o.beats[k]?.section ?? "";
    const next = o.beats.slice(o.beatIndex + 1, o.beatIndex + 3).map((b, k) => `${k + 1}. ${b.say}`);
    where = [
      `You had just asked a check-in question: "${asked}"`,
      goal ? `This section's goal: ${goal}` : "",
      next.length ? `What you will say next:\n${next.join("\n")}` : "Nothing more is planned after this.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (now && o.wordIndex >= 0) {
    const words = now.say.split(/\s+/);
    where = `You were cut off mid-beat after saying: "${words.slice(0, o.wordIndex + 1).join(" ")}" (the rest of the beat was not said).`;
  }
  const at = (b: BoardElementRef["box"]) => (b ? `, at x ${Math.round(b.x)}..${Math.round(b.x + b.w)}, y ${Math.round(b.y)}..${Math.round(b.y + b.h)}` : "");
  const board = o.board.length ? o.board.map((e) => `- ${e.id}: ${e.kind}${e.label ? ` "${e.label}"` : ""}${at(e.box)}`).join("\n") : "(the board is empty)";
  const history = o.history.length ? o.history.map((h) => `${h.who === "learner" ? "Learner" : "You"}: ${h.text}`).join("\n") : "(none)";
  if (!o.beats.length && !o.question)
    return [
      "No lesson is running yet: the board is empty. This may be the learner's first words to you.",
      `Earlier exchanges in this conversation:\n${history}`,
      describeLearner(o.learner),
      o.memory?.length ? `What this learner has said in earlier lessons (most relevant first; if it bears on this, say so in your reply or your intake question):\n${o.memory.map((m) => `- ${m}`).join("\n")}` : "",
      `The learner just said: "${o.utterance}"`,
    ]
      .filter(Boolean)
      .join("\n\n");
  return [
    `The lesson answers: ${o.question}`,
    `The lesson's beats so far:\n${beats}`,
    where,
    `Elements in the scene in view${o.scene ? ` (scene ${o.scene})` : ""} (ids you can point at), with where they are on its grid (x right, y down; small y is the top):\n${board}`,
    o.scenes && o.scenes.length > 1 ? `Every scene on the board, in order (go_to can take you to any of them):\n${o.scenes.map((s) => `- scene ${s.scene}${s.scene === o.scene ? " (in view)" : ""}: ${s.title} — ${s.ids.slice(0, 14).join(", ") || "(nothing drawn)"}`).join("\n")}` : "",
    o.candidates?.length ? `Board elements that best match what they just said (from any scene; go_to and highlight can use them):\n${o.candidates.map((c) => `- ${c.id} in scene ${c.scene}: "${c.label}"${c.said ? `, from "${c.said.slice(0, 120)}"` : ""}`).join("\n")}` : "",
    `Earlier exchanges in this conversation:\n${history}`,
    describeLearner(o.learner),
    o.memory?.length ? `What this learner has said in earlier lessons (most relevant first):\n${o.memory.map((m) => `- ${m}`).join("\n")}` : "",
    `Escalation already reached for this confusion: ${o.escalation} (0 none, 1 a brief answer was given, 2 a detour was given).`,
    describeInk(o.ink),
    `The learner just said: "${o.utterance}"`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Where the first complete sentence of `text` ends (just before the whitespace that follows it); -1 if none yet. */
function sentenceEnd(text: string): number {
  const m = /[.!?]+["')\]]*(\s+)/.exec(text);
  return m ? m.index + m[0].length - m[1].length : -1;
}

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function parseAt(at: unknown): { word: string; occurrence: number } | null {
  if (typeof at !== "string") return null;
  const m = /^(.*?)(?:#(\d+))?$/.exec(at.trim());
  const word = (m?.[1] ?? "").replace(/^\W+|\W+$/g, "");
  if (!word) return null;
  return { word, occurrence: Math.max(1, Number(m?.[2] ?? 1) || 1) };
}

/** The learner asked for a picture: that needs a detour, whatever the model said. */
const WANTS_DRAWING = /\b(draw|drawing|sketch|diagram|picture)\b/i;

const RANK: Record<ConverseLevel, number> = { confirm: 0, answer: 1, detour: 2, replan: 3 };
/** Hand-off lines for a reply the server escalated: the drawing that follows does the explaining. */
const HANDOFF: Partial<Record<ConverseLevel, string>> = { detour: "Let me draw that for you.", replan: "Let me come at this from a different direction." };

/**
 * The level the learner's words call for, whatever the model chose: still lost after an answer (a detour)
 * or after a detour (a new plan), or asking for a drawing. A new question is never escalated, even inside
 * a detour: only "still lost" builds on what came before (isStillLost).
 */
export function forcedLevel(input: Pick<ConverseInput, "escalation" | "utterance">): ConverseLevel | null {
  const lost = isStillLost(input.utterance);
  if (lost && input.escalation >= 2) return "replan";
  if ((lost && input.escalation >= 1) || WANTS_DRAWING.test(input.utterance)) return "detour";
  return null;
}

const MAX_CUES = 4;

/**
 * With thinking off, the model sometimes says its plan out loud ("The learner
 * is confused, give an answer rather than a detour..."). Such a sentence is
 * never spoken.
 */
const META = /\b(the learner|learner('s)? (is|said|asked|wants)|escalation|level ("|')?(answer|detour|replan)|resume (should|is|to)|replay_beat|cursor cue|planner_note|the trailer|i should (point|answer|give)|i'll (set|give an answer))\b/i;

export function isMetaTalk(sentence: string): boolean {
  return META.test(sentence);
}
const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "at", "it", "its", "is", "arrow", "label", "box", "circle", "line", "shape", "part"]);

/**
 * Ties cursor cues to the moment the reply names the element. The model often
 * anchors on a word that occurs several times ("wave" in "each color is a
 * wave ... the long red wave"), so a cue moves to the occurrence next to the
 * element's distinctive name ("red" for red-wave). Elements the reply names
 * that got no cue get one, so the hand follows the talk even when the model
 * left the list empty.
 */
export function groundCues(cues: CursorCue[], spoken: string, board: BoardElementRef[]): CursorCue[] {
  const tokens = spoken.split(/\s+/).map(normWord);
  // Distinctive words per element: the parts of its id that no other element's id shares.
  const parts = new Map(board.map((e) => [e.id, e.id.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))]));
  const count = new Map<string, number>();
  for (const ws of parts.values()) for (const w of new Set(ws)) count.set(w, (count.get(w) ?? 0) + 1);
  const names = (id: string) => (parts.get(id) ?? []).filter((w) => count.get(w) === 1);
  const said = (token: string, ns: string[]) => ns.some((n) => token === n || token === `${n}s`);
  /** Where the reply names an element: a word only its id has ("sun"), or its id's words in a row ("red wave" when "red" also names red-band). */
  const namedAt = (pos: number, id: string) => {
    const ns = names(id);
    if (ns.length) return said(tokens[pos], ns);
    const ps = parts.get(id) ?? [];
    return ps.length > 1 && ps.every((w, j) => tokens[pos + j] === w || tokens[pos + j] === `${w}s`);
  };
  const near = (pos: number, id: string) => {
    for (let k = Math.max(0, pos - 3); k <= Math.min(tokens.length - 1, pos + 3); k++) if (namedAt(k, id)) return true;
    return false;
  };
  const occurrenceAt = (pos: number) => tokens.slice(0, pos + 1).filter((w) => w === tokens[pos]).length;
  const out: { cue: CursorCue; pos: number }[] = [];
  for (const c of cues) {
    const w = normWord(c.word);
    const positions = tokens.flatMap((t, k) => (t === w ? [k] : []));
    if (!positions.length) continue;
    const pos = positions.find((k) => near(k, c.target)) ?? positions[Math.min(c.occurrence, positions.length) - 1];
    out.push({ cue: { ...c, word: tokens[pos], occurrence: occurrenceAt(pos) }, pos });
  }
  // Elements named in the reply without a cue: point at them when their name is said.
  const cued = new Set(out.map((x) => x.cue.target));
  for (const e of board) {
    if (out.length >= MAX_CUES) break;
    if (cued.has(e.id) || e.id.includes(".")) continue;
    const pos = tokens.findIndex((_, k) => namedAt(k, e.id));
    if (pos < 0) continue;
    // A label or text is underlined; a shape is circled.
    const gesture: CursorGesture = /text|label|equation/.test(e.kind) ? "underline" : "circle";
    out.push({ cue: { word: tokens[pos], occurrence: occurrenceAt(pos), target: e.id, gesture }, pos });
    cued.add(e.id);
  }
  // In spoken order; two cues on the same word would fight, so keep the first.
  out.sort((a, b) => a.pos - b.pos);
  return out.filter((x, k) => k === 0 || x.pos !== out[k - 1].pos).slice(0, MAX_CUES).map((x) => x.cue);
}

/** Checks the model's actions and fixes what it can; cursor targets must be on the board and anchored to a spoken word. */
export function cleanTrailer(raw: unknown, input: Pick<ConverseInput, "escalation" | "board" | "utterance" | "beatIndex" | "beats" | "scenes" | "candidates">, spoken: string): ConverseTrailer {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = new Set(input.board.map((e) => e.id));
  const spokenWords = spoken.split(/\s+/).map(normWord);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const list = (Array.isArray(t.actions) ? t.actions : []).slice(0, 8).map((a) => (a && typeof a === "object" ? a : {}) as Record<string, unknown>);
  const cursor: CursorCue[] = [];
  let sketch: ConverseTrailer["sketch"] = null;
  let check: string | null = null;
  let lesson: ConverseTrailer["lesson"] = null;
  let amend: ConverseTrailer["amend"] = null;
  let how: ConverseResume | null = null;
  let goTo: ConverseTrailer["goTo"] = null;
  const highlights: NonNullable<ConverseTrailer["highlights"]> = [];
  let delegate: string | null = null;
  const sceneNums = new Set((input.scenes ?? []).map((s) => s.scene));
  const anyIds = new Set([...ids, ...(input.scenes ?? []).flatMap((s) => s.ids), ...(input.candidates ?? []).map((c) => c.id)]);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const a of list) {
    if (a.type === "go_to") {
      const scene = num(a.scene);
      const element = typeof a.element === "string" ? a.element.trim() : "";
      if (element && anyIds.has(element)) goTo = { element };
      else if (scene !== null && sceneNums.has(scene)) goTo = { scene };
    } else if (a.type === "highlight") {
      const element = typeof a.element === "string" ? a.element.trim() : "";
      const r = (a.region && typeof a.region === "object" ? a.region : null) as Record<string, unknown> | null;
      const box = r && [r.x, r.y, r.w, r.h].every((v) => num(v) !== null) ? { x: num(r.x)!, y: num(r.y)!, w: Math.max(2, num(r.w)!), h: Math.max(2, num(r.h)!) } : null;
      if (element && anyIds.has(element)) highlights.push({ element });
      else if (box && box.x > -60 && box.x < 260 && box.y > -60 && box.y < 260) highlights.push({ region: box });
    } else if (a.type === "delegate" && typeof a.request === "string" && a.request.trim()) delegate = a.request.trim().slice(0, 400);
    else if (a.type === "start_lesson") {
      const question = str(a.question, 300) || input.utterance;
      lesson = { question, focus: str(a.focus, 200), level: str(a.level, 30) || "unknown" };
    } else if (a.type === "ask") check = str(a.question, 300) || check;
    else if (a.type === "point") {
      const cues = Array.isArray(a.cues) ? a.cues : Array.isArray(a.cursor) ? a.cursor : [];
      for (const c of (cues as unknown[]).slice(0, 8)) {
        const cue = (c ?? {}) as Record<string, unknown>;
        const at = parseAt(cue.at);
        const target = typeof cue.target === "string" ? cue.target.trim() : "";
        const gesture = GESTURES.has(cue.gesture as CursorGesture) ? (cue.gesture as CursorGesture) : "point";
        if (!at || !ids.has(target) || !spokenWords.includes(normWord(at.word))) continue;
        const to = typeof cue.to === "string" && ids.has(cue.to.trim()) && cue.to.trim() !== target ? cue.to.trim() : undefined;
        cursor.push({ ...at, target, gesture, ...(to ? { to } : {}) });
      }
    } else if (a.type === "sketch") {
      const visual = str(a.visual, 300);
      if (!visual) continue;
      const adds = (Array.isArray(a.adds) ? (a.adds as unknown[]) : [])
        .slice(0, 4)
        .map((x) => ({ id: cleanId((x as Record<string, unknown>)?.id), what: String((x as Record<string, unknown>)?.what ?? "").trim().slice(0, 80) }))
        .filter((x) => x.id && !ids.has(x.id));
      const near = typeof a.near === "string" && ids.has(a.near.trim()) ? a.near.trim() : null;
      const side = SIDES.has(a.side as SketchSide) ? (a.side as SketchSide) : "right";
      sketch = { visual, adds, near, side };
    } else if (a.type === "amend") {
      const op = a.op === "insert_after" || a.op === "replace_from" || a.op === "delete" ? (a.op as AmendAction) : null;
      if (!op) continue;
      const index = Math.round(Number(a.index));
      const count = Math.max(1, Math.round(Number(a.count) || 1));
      amend = { op, index: Number.isFinite(index) ? index : input.beatIndex + 1, note: str(a.note, 600), ...(op === "delete" ? { count } : {}) };
    } else if (a.type === "resume" && RESUMES.has(a.how as ConverseResume)) how = a.how as ConverseResume;
  }
  // No lesson to amend yet: a request to change it starts one instead.
  if (amend && !input.beats.length && amend.op !== "delete") {
    lesson ??= { question: input.utterance, focus: amend.note, level: "unknown" };
    amend = null;
  }
  if (amend?.op === "delete") amend = input.beats.length ? amend : null;
  let level: ConverseLevel = amend?.op === "replace_from" ? "replan" : amend?.op === "insert_after" ? "detour" : cursor.length || sketch || check || lesson || goTo || highlights.length || delegate ? "answer" : "confirm";
  // Still lost, or asking for a drawing: the lesson changes whatever the model chose (forcedLevel).
  const forced = input.beats.length ? forcedLevel(input) : null;
  const escalated = !!forced && RANK[level] < RANK[forced];
  if (escalated) {
    level = forced;
    amend = { op: forced === "replan" ? "replace_from" : "insert_after", index: input.beatIndex + 1, note: amend?.note || `The learner said "${input.utterance}" and is still lost; show it a different way.` };
    // Cut to the hand-off: a check it asked is not what Chalky does next.
    check = null;
    sketch = null;
  }
  // A drawing comes with an answer only; a detour or a new plan draws its own beats.
  if (level === "detour" || level === "replan") sketch = null;
  const cues = groundCues(cursor, spoken, input.board);
  // Shown something elsewhere on the board: they get to look before the lesson moves the camera back.
  let resume: ConverseResume = how ?? (check || goTo ? "wait" : "continue");
  if (check && resume !== "wait") resume = "wait";
  if (escalated && resume === "wait") resume = "replay_beat";
  // The cleaned list, in the model's order, with what the executor will really do.
  const actions: ConverseAction[] = [];
  for (const a of list) {
    if (a.type === "say") actions.push({ type: "say" });
    else if (a.type === "start_lesson" && lesson && !actions.some((x) => x.type === "start_lesson")) actions.push({ type: "start_lesson", ...lesson });
    else if (a.type === "ask" && check && !actions.some((x) => x.type === "ask")) actions.push({ type: "ask", question: check });
    else if (a.type === "point" && cues.length && !actions.some((x) => x.type === "point")) actions.push({ type: "point", cues });
    else if (a.type === "sketch" && sketch && !actions.some((x) => x.type === "sketch")) actions.push({ type: "sketch", sketch });
    else if (a.type === "amend" && amend && !escalated && !actions.some((x) => x.type === "amend")) actions.push({ type: "amend", ...amend });
    else if (a.type === "go_to" && goTo && !escalated && !actions.some((x) => x.type === "go_to")) actions.push({ type: "go_to", ...goTo });
    else if (a.type === "highlight" && !escalated && actions.filter((x) => x.type === "highlight").length < highlights.length) actions.push({ type: "highlight", ...highlights[actions.filter((x) => x.type === "highlight").length] });
    else if (a.type === "delegate" && delegate && !escalated && !actions.some((x) => x.type === "delegate")) actions.push({ type: "delegate", request: delegate });
  }
  if (cues.length && !actions.some((x) => x.type === "point")) actions.push({ type: "point", cues });
  if (lesson && !actions.some((x) => x.type === "start_lesson")) actions.push({ type: "start_lesson", ...lesson });
  if (amend && !actions.some((x) => x.type === "amend")) actions.push({ type: "amend", ...amend });
  actions.push({ type: "resume", how: resume });
  return { actions, lesson, amend, level, resume, cursor: cues, check, planner_note: amend?.note ?? "", sketch, goTo: escalated ? null : goTo, highlights: escalated ? [] : highlights, delegate: escalated ? null : delegate };
}

/** The trailer used when the model gave none (or unparsable JSON). */
function fallbackTrailer(input: ConverseInput, spoken: string): ConverseTrailer {
  const endsWithQuestion = /\?\s*$/.test(spoken);
  const last = spoken.split(/(?<=[.!?])\s+/).pop() ?? null;
  return cleanTrailer({ actions: endsWithQuestion ? [{ type: "ask", question: last }] : [{ type: "say" }] }, input, spoken);
}

function describeInk(ink: ConverseInk | undefined): string {
  if (!ink || (!ink.marks.length && !ink.loose)) return "The learner has not drawn on the board.";
  const say = (m: ConverseInk["marks"][number]) => `${m.how} ${m.id} ("${m.label}")`;
  const latest = ink.marks.filter((m) => m.latest);
  const earlier = ink.marks.filter((m) => !m.latest);
  const lines = ["The learner drew on the board before speaking."];
  // Their newest mark is what "this" points at; older ink is still on the board but is not the question.
  if (latest.length) lines.push(`Their newest mark, the one "this" or "that" means: ${latest.map(say).join("; ")}.`);
  if (earlier.length) lines.push(`Earlier ink still on the board: ${earlier.map(say).join("; ")}.`);
  if (ink.loose) lines.push(`${ink.loose} stroke${ink.loose === 1 ? "" : "s"} mark nothing on the board${ink.image ? " (see the picture)" : ""}.`);
  return lines.join(" ");
}

function params(model: string, input: ConverseInput): Anthropic.MessageStreamParams {
  const base: Anthropic.MessageStreamParams = {
    model,
    max_tokens: 700,
    system: [{ type: "text", text: `${withVoiceRules(SYSTEM)}\n\n${NOTE_RULES}`, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: input.ink?.image
          ? [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.ink.image } },
              { type: "text", text: `The board as the learner sees it, with their ink on top.\n\n${context(input)}` },
            ]
          : context(input),
      },
    ],
  };
  // Haiku 5.5 accepts thinking off at low effort; Sonnet 5.5 turns it off with between_tools.
  if (model.startsWith("claude-haiku")) base.thinking = { type: "disabled" };
  else if (model.startsWith("claude-sonnet-5-5")) base.thinking = { type: "between_tools" };
  return base;
}

export async function* converse(input: ConverseInput, signal: AbortSignal): AsyncGenerator<ConverseEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const utterance = input.utterance.trim();

  if (isResume(utterance)) {
    yield { type: "start", model: "local", local: true, tMs: ms() };
    yield { type: "trailer", trailer: { actions: [{ type: "resume", how: "continue" }], lesson: null, amend: null, level: "confirm", resume: "continue", cursor: [], check: null, planner_note: "", sketch: null }, tMs: ms() };
    yield { type: "done", tMs: ms(), model: "local", inputTokens: 0, outputTokens: 0, fellBack: false };
    return;
  }

  const calls: CallLog[] = [];
  let model = CONVERSE_MODEL;
  let fellBack = false;
  let callsInFlight: ReturnType<typeof trackCall> | null = null;
  for (let attempt = 0; ; attempt++) {
    yield { type: "start", model, local: false, tMs: ms() };
    let sentences = 0;
    let spoken = "";
    let pending = "";
    let trailerText = "";
    let inTrailer = false;
    /** The "actions: ..." first line, until it has been read (or turned out to be missing). */
    let header: string | null = "";
    let names: string[] = [];
    let budget = 2;
    let capped = false;
    const usage = { input: 0, output: 0 };
    const say = (text: string): ConverseEvent | null => {
      // Short by design: past the level's sentence budget, nothing more is spoken.
      if (capped || sentences >= budget) {
        capped = true;
        return null;
      }
      if (isMetaTalk(text)) {
        console.warn(`[converse] dropped a sentence that narrates the plan: "${text.slice(0, 160)}"`);
        return null;
      }
      spoken += (spoken ? " " : "") + text;
      sentences++;
      return { type: "sentence", text, tMs: ms() };
    };
    try {
      const tracked = trackCall("converse", model);
      callsInFlight = tracked;
      const stream = tracked.watch(tracked.client.messages.stream(params(model, input), { signal }));
      for await (const event of stream) {
        if (signal.aborted) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          if (inTrailer) {
            trailerText += event.delta.text;
            continue;
          }
          if (header !== null) {
            header += event.delta.text;
            const nl = header.indexOf("\n");
            if (nl < 0 && header.length < 40) continue;
            const m = /^\s*actions?\s*:\s*([^\n]*)/i.exec(header);
            if (m) names = [...m[1].toLowerCase().matchAll(ACTION_NAMES)].map((x) => x[1].replace(/\s+/g, ""));
            pending += m ? header.slice(nl >= 0 ? nl + 1 : header.length) : header;
            header = null;
            // Still lost, or asking for a drawing: escalate now, and say only the hand-off, not the model's answer.
            const forced = input.beats.length ? forcedLevel(input) : null;
            if (forced && RANK[levelOf(names)] < RANK[forced]) {
              console.info(`[converse] escalated ${names.join(", ") || "?"} -> ${forced} ("${input.utterance.slice(0, 80)}")`);
              names = [forced === "replan" ? "amend:replace_from" : "amend:insert_after"];
              budget = 1;
              yield { type: "actions", names, tMs: ms() };
              yield { type: "level", level: forced, tMs: ms() };
              const ev = say(HANDOFF[forced]!);
              if (ev) yield ev;
              capped = true;
            } else if (m) {
              budget = sentenceBudget(names);
              yield { type: "actions", names, tMs: ms() };
              yield { type: "level", level: levelOf(names), tMs: ms() };
            }
          } else pending += event.delta.text;
          if (capped && !pending.includes(SENTINEL)) continue;
          const cut = pending.indexOf(SENTINEL);
          if (cut >= 0) {
            // Everything before the sentinel is speech; after it, the trailer.
            const speech = pending.slice(0, cut).trim();
            trailerText = pending.slice(cut + SENTINEL.length);
            pending = "";
            inTrailer = true;
            const ev = speech ? say(speech) : null;
            if (ev) yield ev;
            continue;
          }
          // Emit whole sentences as they complete; a sentinel in progress ("<<<tra") is never a sentence.
          for (;;) {
            const end = sentenceEnd(pending);
            if (end < 0) break;
            const sentence = pending.slice(0, end).trim();
            if (sentence.includes("<<")) break;
            pending = pending.slice(end);
            const ev = sentence ? say(sentence) : null;
            if (ev) yield ev;
          }
        } else if (event.type === "message_delta") {
          usage.output = event.usage.output_tokens;
        } else if (event.type === "message_start") {
          const u = event.message.usage;
          usage.input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        }
      }
      if (signal.aborted) return;
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") throw new Error("Chalky couldn't answer that");
      // Flush what is left. If the sentinel never came, a trailing JSON object is still the trailer.
      const rest = pending.trim();
      if (rest) {
        const brace = inTrailer ? -1 : rest.indexOf("{");
        const speech = (brace >= 0 ? rest.slice(0, brace) : rest).trim();
        if (brace >= 0) trailerText = rest.slice(brace);
        const ev = speech ? say(speech) : null;
        if (ev) yield ev;
      }
      let trailer: ConverseTrailer;
      let modelCues: unknown[] = [];
      try {
        const json = trailerText.slice(trailerText.indexOf("{"), trailerText.lastIndexOf("}") + 1);
        const raw = JSON.parse(json);
        if (Array.isArray(raw?.cursor)) modelCues = raw.cursor;
        trailer = cleanTrailer(raw, input, spoken);
        const asked = Array.isArray(raw?.cursor) ? raw.cursor.length : 0;
        if (asked !== trailer.cursor.length) console.info(`[converse] kept ${trailer.cursor.length} of ${asked} cursor cues: ${JSON.stringify(raw.cursor)}`);
        else if (!asked) console.info(`[converse] no cursor cues (board: ${input.board.map((e) => e.id).join(", ") || "empty"})`);
      } catch {
        trailer = fallbackTrailer(input, spoken);
      }
      yield { type: "trailer", trailer, tMs: ms(), modelCues };
      calls.push(tracked.finish());
      yield { type: "done", tMs: ms(), model, inputTokens: usage.input, outputTokens: usage.output, fellBack, calls };
      return;
    } catch (error) {
      if (signal.aborted) return;
      // Nothing has been spoken yet: try the fallback model once.
      if (attempt === 0 && sentences === 0 && model !== CONVERSE_FALLBACK_MODEL) {
        const why = error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : String((error as Error)?.message ?? error);
        console.warn(`[converse] ${model} failed before the first sentence (${why}); falling back to ${CONVERSE_FALLBACK_MODEL}`);
        if (callsInFlight) calls.push(callsInFlight.finish(error));
        model = CONVERSE_FALLBACK_MODEL;
        fellBack = true;
        continue;
      }
      throw error;
    }
  }
}
