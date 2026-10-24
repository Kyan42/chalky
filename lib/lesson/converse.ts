/**
 * The fast conversational layer: answers whatever the learner says mid-lesson
 * and decides how the plan goes on. Streams the spoken reply a sentence at a
 * time (so TTS can start on the first one) and ends with one structured
 * trailer: the escalation level reached, how the lesson resumes, where the
 * Chalky cursor points while the reply is spoken, the check question the
 * reply ends on, and a note for the planner.
 *
 * Haiku 5.5 with thinking off at low effort; Sonnet 5.5 if Haiku fails before
 * the first sentence. "ok / got it / keep going" never reaches a model.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import { isResume } from "./resume";
import { describeLearner, type BeatMode, type LearnerRecord } from "./types";

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

export interface ConverseTrailer {
  level: ConverseLevel;
  resume: ConverseResume;
  cursor: CursorCue[];
  /** The short check question the reply ends with, or null. */
  check: string | null;
  /** One or two sentences for the planner: what did not land and what angle to try. */
  planner_note: string;
}

export interface ConverseBeat {
  id: string;
  say: string;
  mode: BeatMode;
}

export interface BoardElementRef {
  id: string;
  kind: string;
  label: string;
}

export interface Exchange {
  who: "learner" | "chalky";
  text: string;
}

export interface ConverseInput {
  utterance: string;
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
}

/** NDJSON events from POST /api/converse. */
export type ConverseEvent =
  | { type: "start"; model: string; local: boolean; tMs: number }
  /** The level the model chose, sent before it speaks, so a detour can start planning at once. */
  | { type: "level"; level: ConverseLevel; tMs: number }
  | { type: "sentence"; text: string; tMs: number }
  | { type: "trailer"; trailer: ConverseTrailer; tMs: number; modelCues?: unknown[] }
  | { type: "done"; tMs: number; model: string; inputTokens: number; outputTokens: number; fellBack: boolean }
  | { type: "error"; message: string; tMs: number };

export { isResume };

const SENTINEL = "<<<trailer>>>";

const SYSTEM = `You are Chalky, a warm, clear teacher at a whiteboard, mid-lesson. The learner just said something. Reply out loud, briefly, then hand control back to the lesson. The board does the explaining: you point at it or draw on it, you don't lecture.

Choose the level first:
- "confirm": they summarised or restated the idea correctly (or nearly), or answered your check-in question correctly. Say one short sentence acknowledging it, plus at most one more correcting a small slip. No explanation and no question. The lesson goes straight on.
- "answer": a question you can answer by pointing at things ALREADY on the board (the element list below). At most two spoken sentences, and they must name at least one of those elements, with a cursor cue on each one you name. Allowed only on a first question in this spot (escalation 0).
- "detour": everything else that needs explaining: the answer needs something that is not on the board, they ask for a picture, they still don't get it, or they ask a follow-up in the same spot (escalation 1 or more). Don't talk around a missing picture: say one short sentence like "Let me draw that for you." and the lesson draws it next. Never more talk instead of a drawing.
- "replan": a detour was already given (escalation 2) and they are still lost. One or two sentences saying you'll take it from a different direction. Never before a detour.
- If they ask something off the lesson's path, use "answer" or "detour" by the same rules and steer back.
Plain spoken words only: no lists, no markdown, no symbols that read badly aloud; write numbers and units as words.

An "answer" may end with a short check question as its second sentence; set resume to "wait" then. Set resume to "replay_beat" if you were cut off mid-beat and the answer was a quick aside. "confirm" always has resume "continue".

While you speak, a cursor (a teacher's hand) moves over the board. Add a cue for each element you name, anchored to the exact word of your reply where you name it (as it appears; add #2 for its second occurrence, e.g. "orbit#2"), using only element ids from the board list. Gestures: "circle" to single out a shape (prefer it), "underline" for a label, a word or an equation, "tap" for a quick "this one", "point" to rest beside it, "sweep" to travel from it to another element ("to": that id).

Everything between the first line and the trailer line is spoken aloud to the learner, word for word. Speak to them directly: never describe what you are going to do, never talk about "the learner", levels, escalation, resume or cues there.

Output format, exactly: a first line "level: confirm" | "level: answer" | "level: detour" | "level: replan", then the spoken reply as plain text, then a line containing only ${SENTINEL}, then one JSON object on one line:
{"level": "confirm" | "answer" | "detour" | "replan", "resume": "replay_beat" | "continue" | "wait", "cursor": [{"at": "word" | "word#2", "target": "element-id", "gesture": "circle" | "underline" | "tap" | "point" | "sweep", "to": "element-id"}], "check": "the check question you ended with" | null, "planner_note": "one or two sentences: what the learner needs and which picture or angle would show it"}
Nothing else: no code fences, no commentary.`;

const LEVELS = new Set<ConverseLevel>(["confirm", "answer", "detour", "replan"]);
/** Spoken sentences allowed per level; the board does the rest. */
const MAX_SENTENCES: Record<ConverseLevel, number> = { confirm: 2, answer: 2, detour: 2, replan: 2 };
const RESUMES = new Set<ConverseResume>(["replay_beat", "continue", "wait"]);
const GESTURES = new Set<CursorGesture>(["point", "circle", "sweep", "underline", "tap"]);

function context(o: ConverseInput): string {
  const beats = o.beats.length
    ? o.beats.map((b, i) => `${i + 1}. [${b.mode}${i === o.beatIndex ? ", you were on this one" : i < o.beatIndex ? "" : ", not said yet"}] ${b.say}`).join("\n")
    : "(no beats yet)";
  const now = o.beats[o.beatIndex];
  let where = "The learner spoke at a check-in, after you finished a beat.";
  if (now && o.wordIndex >= 0) {
    const words = now.say.split(/\s+/);
    where = `You were cut off mid-beat after saying: "${words.slice(0, o.wordIndex + 1).join(" ")}" (the rest of the beat was not said).`;
  }
  const board = o.board.length ? o.board.map((e) => `- ${e.id}: ${e.kind}${e.label ? ` "${e.label}"` : ""}`).join("\n") : "(the board is empty)";
  const history = o.history.length ? o.history.map((h) => `${h.who === "learner" ? "Learner" : "You"}: ${h.text}`).join("\n") : "(none)";
  return [
    `The lesson answers: ${o.question}`,
    `The lesson's beats so far:\n${beats}`,
    where,
    `Elements on the board (ids you can point at):\n${board}`,
    `Earlier exchanges in this conversation:\n${history}`,
    describeLearner(o.learner),
    `Escalation already reached for this confusion: ${o.escalation} (0 none, 1 a brief answer was given, 2 a detour was given).`,
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
const WANTS_DRAWING = /\b(draw|drawing|sketch|diagram|picture|show me|on the board)\b/i;

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

/** Checks the model's trailer and fixes what it can; cursor targets must be on the board and anchored to a spoken word. */
export function cleanTrailer(raw: unknown, input: Pick<ConverseInput, "escalation" | "board" | "utterance">, spoken: string): ConverseTrailer {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = new Set(input.board.map((e) => e.id));
  const spokenWords = spoken.split(/\s+/).map(normWord);
  let level: ConverseLevel = LEVELS.has(t.level as ConverseLevel) ? (t.level as ConverseLevel) : input.escalation >= 1 ? "detour" : "answer";
  // Replanning only after a detour has been tried; a request for a drawing is at least a detour.
  if (level === "replan" && input.escalation < 2) level = "detour";
  if (level === "answer" && (input.escalation >= 1 || WANTS_DRAWING.test(input.utterance))) level = "detour";
  let check = typeof t.check === "string" && t.check.trim() ? t.check.trim() : null;
  let resume: ConverseResume = RESUMES.has(t.resume as ConverseResume) ? (t.resume as ConverseResume) : check ? "wait" : "replay_beat";
  if (check && resume !== "wait") resume = "wait";
  if (level === "confirm") {
    check = null;
    resume = "continue";
  }
  const cursor: CursorCue[] = [];
  if (Array.isArray(t.cursor)) {
    for (const c of t.cursor.slice(0, 8)) {
      const cue = (c ?? {}) as Record<string, unknown>;
      const at = parseAt(cue.at);
      const target = typeof cue.target === "string" ? cue.target.trim() : "";
      const gesture = GESTURES.has(cue.gesture as CursorGesture) ? (cue.gesture as CursorGesture) : "point";
      if (!at || !ids.has(target) || !spokenWords.includes(normWord(at.word))) continue;
      const to = typeof cue.to === "string" && ids.has(cue.to.trim()) && cue.to.trim() !== target ? cue.to.trim() : undefined;
      cursor.push({ ...at, target, gesture, ...(to ? { to } : {}) });
    }
  }
  const cues = groundCues(cursor, spoken, input.board);
  let note = typeof t.planner_note === "string" ? t.planner_note.trim() : "";
  // An answer has to be made on the board: one that points at nothing becomes a drawing detour.
  if (level === "answer" && !cues.length) {
    level = "detour";
    if (resume === "wait") resume = "wait";
    note = note || `The learner asked "${input.utterance}"; nothing on the board shows the answer, so draw it.`;
  }
  return { level, resume, cursor: cues, check, planner_note: note };
}

/** The trailer used when the model gave none (or unparsable JSON). */
function fallbackTrailer(input: ConverseInput, spoken: string): ConverseTrailer {
  const endsWithQuestion = /\?\s*$/.test(spoken);
  const last = spoken.split(/(?<=[.!?])\s+/).pop() ?? null;
  return cleanTrailer({ level: input.escalation >= 1 ? "detour" : "answer", resume: endsWithQuestion ? "wait" : "replay_beat", cursor: [], check: endsWithQuestion ? last : null, planner_note: "" }, input, spoken);
}

function params(model: string, input: ConverseInput): Anthropic.MessageStreamParams {
  const base: Anthropic.MessageStreamParams = {
    model,
    max_tokens: 700,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low" },
    messages: [{ role: "user", content: context(input) }],
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
    yield { type: "trailer", trailer: { level: "answer", resume: "continue", cursor: [], check: null, planner_note: "" }, tMs: ms() };
    yield { type: "done", tMs: ms(), model: "local", inputTokens: 0, outputTokens: 0, fellBack: false };
    return;
  }

  const client = anthropic();
  let model = CONVERSE_MODEL;
  let fellBack = false;
  for (let attempt = 0; ; attempt++) {
    yield { type: "start", model, local: false, tMs: ms() };
    let sentences = 0;
    let spoken = "";
    let pending = "";
    let trailerText = "";
    let inTrailer = false;
    /** The "level: ..." first line, until it has been read (or turned out to be missing). */
    let header: string | null = "";
    let early: ConverseLevel | null = null;
    let capped = false;
    const usage = { input: 0, output: 0 };
    const say = (text: string): ConverseEvent | null => {
      // Short by design: past the level's sentence budget, nothing more is spoken.
      if (capped || sentences >= MAX_SENTENCES[early ?? "answer"]) {
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
      const stream = client.messages.stream(params(model, input), { signal });
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
            const m = /^\s*level\s*:\s*(confirm|answer|detour|replan)\b/i.exec(header);
            if (m) {
              early = m[1].toLowerCase() as ConverseLevel;
              yield { type: "level", level: early, tMs: ms() };
            }
            pending += m ? header.slice(nl >= 0 ? nl + 1 : header.length) : header;
            header = null;
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
      yield { type: "done", tMs: ms(), model, inputTokens: usage.input, outputTokens: usage.output, fellBack };
      return;
    } catch (error) {
      if (signal.aborted) return;
      // Nothing has been spoken yet: try the fallback model once.
      if (attempt === 0 && sentences === 0 && model !== CONVERSE_FALLBACK_MODEL) {
        const why = error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : String((error as Error)?.message ?? error);
        console.warn(`[converse] ${model} failed before the first sentence (${why}); falling back to ${CONVERSE_FALLBACK_MODEL}`);
        model = CONVERSE_FALLBACK_MODEL;
        fellBack = true;
        continue;
      }
      throw error;
    }
  }
}
