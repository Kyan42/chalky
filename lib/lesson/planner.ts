/**
 * The lesson planner: a question in, a structured two-minute lesson out
 * (intuition, mechanism, example, misconception, recap), streamed one beat at
 * a time as JSON lines so the first beat can play while later ones are written.
 *
 * The planner also lays the whiteboard out as it goes: beats are grouped into
 * scenes (one picture each, wiped between them), every draw beat gets a region
 * and the ids of the elements it introduces, and point beats name the ids they
 * highlight and the spoken word each highlight lands on. That is what lets
 * every beat's drawing be generated at the same time, and point beats need no
 * model call at all.
 *
 * PLANNER_EFFORT overrides the effort level (default low).
 */
import "server-only";
import { BLOCKS } from "@/lib/blocks";
import { trackCall } from "./calllog";
import { withVoiceRules } from "./voice";
import { describeLearner, type BeatMode, type LearnerRecord, type PlanEvent, type PlannedBeat, type Region } from "./types";

const MODEL = process.env.PLANNER_MODEL || "claude-opus-5-5";

// Medium effort thought for about 25 s before the first beat; low takes about 3 s with similar depth.
const EFFORT = (process.env.PLANNER_EFFORT ?? "low") as "low" | "medium" | "high";

/**
 * Experiment switches for time to first beat (scripts/planner-bench.ts):
 * PLANNER_THINKING=off turns thinking off (Sonnet 5.5: between_tools; others: disabled),
 * PLANNER_TITLE_FIRST=1 tells the model to write the title line at once.
 */
function plannerThinking(model: string) {
  if (process.env.PLANNER_THINKING !== "off") return { type: "adaptive" as const };
  return model.startsWith("claude-sonnet-5-5") ? ({ type: "between_tools" } as const) : ({ type: "disabled" } as const);
}
const TITLE_FIRST = "Start writing at once with the title line, then the first beat; do not plan the whole lesson in your head first.";
const plannerSystem = () => withVoiceRules(process.env.PLANNER_TITLE_FIRST === "1" ? `${SYSTEM}

${TITLE_FIRST}` : SYSTEM);

const SYSTEM = `You are Chalky, a great teacher who explains things out loud while drawing on a whiteboard. The learner wants to actually understand the answer, not hear a one-liner. Plan a spoken lesson of about three minutes that goes slowly and keeps the learner involved.

Teach it the way a good teacher would at a whiteboard, in this order:
1. The core intuition: the one idea everything else hangs on, in plain words.
2. How it actually works: the mechanism, step by step, with the real names of the parts and why each step happens.
3. A concrete example: real numbers, a real case, or a familiar everyday situation, worked through.
4. A common misconception or surprising detail, and why it's wrong or why it matters.
5. A short recap that ties the pieces together.
Skip a section only if it truly doesn't apply. Go deeper where the question needs it.

Write 12 to 18 beats. A beat is ONE idea in one to three short plain spoken sentences, 25 to 35 words, said while the board shows one thing. Sound like a person talking: no lists, no markdown, no symbols that read badly aloud (write "percent", not "%"; spell out units and abbreviations). No filler or "great question". Give the learner time: after a beat that draws something new, follow it with a point or talk beat that dwells on it before drawing the next thing; at most about half the beats draw.

Split the lesson into sections of 2 or 3 beats, each with a one-line goal (what the learner should get from it). The first beat of a section carries "section": "<the goal, at most 12 words>". The last beat of every section except the recap ends with a short check-in question to the learner, like "Does the pressure part make sense so far?", and is marked "check": true. A check-in beat also carries "bridge": a short line, at most 12 words, that you say when the learner answers "yes" or "got it", like a teacher taking a breath and naming what comes next ("Okay, next is how the water gets in.").

Each beat has a "mode" for the board:
- "draw": add a new drawing to the board for this beat. Use it when a new thing, part, or step appears.
- "point": draw nothing new; highlight parts already on the board while you talk about them. Use it when you're explaining something already drawn.
- "talk": leave the board as it is. Use it for check-ins, analogies that need no picture, and the recap.
Most lessons have about half draw beats. The first beat is always "draw".

The board shows one picture at a time, called a scene. Group beats into scenes: a scene is one picture built up over at most 4 draw beats and then wiped, like moving to a clean part of the whiteboard. Start a new scene when the lesson zooms in, moves to a new stage, or switches to the example. Number scenes 1, 2, 3 in order; a scene's first beat is a draw beat; talk beats keep the current scene number. A new scene starts empty, so a beat can only point at things drawn earlier in its own scene.

The board is a 100 by 100 grid, x to the right and y down, shown 3:2 (wider than tall). For each beat, also give:
- "at": one word copied exactly from the beat's text where the drawing (or pointing) should start: the word that names the thing, within the first 10 words, never a number.
- "region": [x, y, w, h], where this beat's drawing goes (for point: where the things it points at are). Within a scene, draw regions must not overlap each other. The scene's first draw beat is its main picture: give it a big region, about 55 to 65 wide and 60 to 75 tall, usually on the left or in the middle. Later additions take 25 to 40 each side, placed next to the part they relate to so arrows between them are short. Use the whole board over a scene; keep 5 units clear of every edge. [] for talk.
- "adds": for draw beats, the 1 to 4 things this beat draws, each {"id": short unique name of letters, digits and dashes like "sun" or "leaf", "what": a few words on what it is}. Name the shapes (a box, a circle, a curve, a row of steps), not arrows or labels between them. These ids are how later beats refer to the shapes. When the board has a ready-made drawing for the thing (${BLOCKS.map((b) => b.id).join(", ")}), use that word as the id or say it in "what", so the drawer uses it. Never add something an earlier beat of the scene already drew (a part of its cycle or flow, for instance): point at it or connect to it instead. [] for point and talk.
- "points": for point beats, 1 to 3 of {"id": a shape id added earlier in this scene, "word": the one word in this beat's text that names it, copied exactly}; the highlight appears as that word is spoken. [] for draw and talk.
- "visual": for draw, one or two sentences describing exactly what to add (shapes, their arrangement inside the region, labels of 1 to 3 words) and which earlier ids it connects to. The drawing is made of circles, boxes, arrows between named elements, flows, cycles, equations, plots, bars, moving dots and short labels. For point, what to point at and why. For talk, "".

Output format, exactly: first one line {"title": "<lesson title, max 6 words>"}, then one line per beat {"say": "...", "mode": "draw" | "point" | "talk", "scene": 1, "at": "...", "region": [x, y, w, h], "adds": [...], "points": [...], "visual": "...", "check": false}, adding "section": "..." on a section's first beat and "bridge": "..." on a check-in beat. Nothing else: no code fences, no commentary.`;

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
const MODES = new Set<BeatMode>(["draw", "point", "talk"]);
const FULL_BOARD: Region = { x: 5, y: 5, w: 90, h: 90 };

export const cleanId = (raw: unknown) =>
  String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function cleanRegion(raw: unknown): Region | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const [x, y, w, h] = raw.map((v) => num(v, NaN));
  if ([x, y, w, h].some((v) => Number.isNaN(v)) || w <= 0 || h <= 0) return null;
  const cx = Math.max(0, Math.min(95, x)), cy = Math.max(0, Math.min(95, y));
  return { x: cx, y: cy, w: Math.max(5, Math.min(100 - cx, w)), h: Math.max(5, Math.min(100 - cy, h)) };
}

interface PlanState {
  scene: number;
  /** Ids added so far, per scene. */
  known: Map<number, Set<string>>;
}

/** Checks one raw beat line and fixes what it can; keeps the scene bookkeeping in `st`. */
function checkBeat(raw: unknown, index: number, st: PlanState): PlannedBeat {
  const b = raw as Record<string, unknown>;
  if (typeof b.say !== "string") throw new Error(`beat ${index + 1} is missing say`);
  const say = b.say.trim();
  const tokens = say.split(/\s+/);
  const words = tokens.map(norm);
  // Fall back to the first content word if the anchor isn't in the sentence.
  const at = typeof b.at === "string" && words.includes(norm(b.at)) ? b.at : (tokens.find((w) => norm(w).length > 3) ?? tokens[0]);
  const visual = typeof b.visual === "string" ? b.visual.trim() : "";
  let mode: BeatMode = typeof b.mode === "string" && MODES.has(b.mode as BeatMode) ? (b.mode as BeatMode) : "draw";
  if (mode !== "talk" && !visual) mode = "talk";

  // Scenes only move forward, and only on a beat that draws.
  let scene = Math.max(1, Math.round(num(b.scene, st.scene)));
  if (scene < st.scene) scene = st.scene;
  if (mode === "talk") scene = st.scene || 1;
  if (index === 0) {
    scene = 1;
    mode = "draw";
  }
  const newScene = scene > st.scene;
  if (newScene && mode === "point") mode = "draw";
  if (!st.known.has(scene)) st.known.set(scene, new Set());
  const known = st.known.get(scene)!;

  const adds =
    mode === "draw" && Array.isArray(b.adds)
      ? b.adds
          .map((a) => ({ id: cleanId((a as Record<string, unknown>)?.id), what: String((a as Record<string, unknown>)?.what ?? "").trim() }))
          .filter((a) => a.id && !known.has(a.id))
          .slice(0, 6)
      : [];
  for (const a of adds) known.add(a.id);

  // A point beat can only point at what this scene already holds, and the word must be in the sentence.
  const points =
    mode === "point" && Array.isArray(b.points)
      ? b.points
          .map((p) => ({ id: cleanId((p as Record<string, unknown>)?.id), word: String((p as Record<string, unknown>)?.word ?? "").trim() }))
          .filter((p) => p.id && known.has(p.id) && p.word && words.includes(norm(p.word)))
          .slice(0, 4)
      : [];

  const region = mode === "talk" ? FULL_BOARD : (cleanRegion(b.region) ?? FULL_BOARD);
  st.scene = scene;
  const check = b.check === true;
  const line = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const section = line(b.section, 120);
  const bridge = check ? line(b.bridge, 120) : undefined;
  return { id: `b${index + 1}`, say, at: norm(at), visual, mode, check, scene, region, adds, points, ...(section ? { section } : {}), ...(bridge ? { bridge } : {}) };
}

export async function* planLesson(question: string, signal: AbortSignal, effort: typeof EFFORT = EFFORT): AsyncGenerator<PlanEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const tracked = trackCall("plan", MODEL);
  const stream = tracked.client.messages.stream(
    {
      model: MODEL,
      max_tokens: 14000,
      system: plannerSystem(),
      thinking: plannerThinking(MODEL),
      output_config: { effort },
      messages: [{ role: "user", content: question }],
    },
    { signal },
  );

  let pending = "";
  let beats = 0;
  const st: PlanState = { scene: 0, known: new Map() };
  const lines: string[] = [];
  stream.on("text", (delta) => {
    tracked.firstToken();
    pending += delta;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      lines.push(pending.slice(0, nl));
      pending = pending.slice(nl + 1);
    }
  });

  const parse = function* (line: string): Generator<PlanEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      console.warn(`[plan] skipped a line that isn't JSON: ${trimmed.slice(0, 120)}`);
      return;
    }
    if (typeof obj.title === "string") yield { type: "title", title: obj.title, tMs: ms() };
    else yield { type: "beat", beat: checkBeat(obj, beats++, st), tMs: ms() };
  };

  // Drain whole lines as they arrive, then whatever is left once the stream ends.
  const done = stream.finalMessage();
  let finished = false;
  done.finally(() => (finished = true)).catch(() => {});
  while (!finished || lines.length) {
    const line = lines.shift();
    if (line !== undefined) {
      yield* parse(line);
      continue;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  const message = await done;
  if (pending.trim()) yield* parse(pending);
  if (message.stop_reason === "refusal") throw new Error("the planner declined this question");
  if (!beats) throw new Error("the planner returned no beats");
  yield { type: "done", tMs: ms(), inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, call: tracked.finish() };
}

/**
 * Plan operations for the conversation layer: change the lesson while it is
 * being taught.
 *
 * - insert_after k: a short detour (2 to 4 beats, ending in a check-in) spoken
 *   right after beat k, on a clean part of the board (a new scene).
 * - replace_from k: beats k onward are dropped and replaced by a new ending
 *   that takes a different angle, starting in a new scene.
 *
 * Both are guided by the conversation layer's planner_note (what didn't land,
 * what to try) and stream beats in the main plan's shape, validated the same
 * way. Ids get `prefix` so they never collide with the plan's own b1, b2…
 */
export type AmendOp = "insert_after" | "replace_from";

/** Sonnet by default: a detour or a new ending is a few beats, and the learner is waiting (Opus took about 30 s for four beats). */
const AMEND_MODEL = process.env.AMEND_MODEL || "claude-sonnet-5-5";

export interface AmendRequest {
  question: string;
  /** The whole plan so far, in lesson order. */
  beats: PlannedBeat[];
  op: AmendOp;
  /** For insert_after: the beat the detour follows (-1: before the first). For replace_from: the first beat replaced. */
  index: number;
  note: string;
  /** What the learner said that led here. */
  heard?: string;
  /** What Chalky has just said aloud before these beats (the hand-off or answer); they continue from it. */
  said?: string;
  /** Unique id prefix for the new beats, e.g. "d1" → d1-1, d1-2… */
  prefix: string;
  /** The intake changed the lesson: rewrite the rest of a whole lesson, continuing on the current board. */
  intake?: boolean;
  learner?: LearnerRecord;
}

/**
 * Where a detour goes: on the board it interrupts when that scene is the plan's latest and nothing later
 * draws there (it continues the picture, drawing around what is there), else on a clean board.
 */
function detourScene(r: AmendRequest, maxScene: number): { scene: number; drawn: PlannedBeat[]; stay: boolean } {
  const scene = r.beats[r.index]?.scene ?? 0;
  const drawn = r.beats.slice(0, r.index + 1).filter((b) => b.scene === scene && b.mode === "draw");
  const stay = r.op === "insert_after" && !r.intake && scene > 0 && scene === maxScene && !r.beats.slice(r.index + 1).some((b) => b.scene === scene);
  return { scene, drawn, stay };
}

function amendPrompt(r: AmendRequest, newScene: number): string {
  const lines = r.beats.map((b, i) => {
    const visual = b.mode === "draw" ? ` adds ${b.adds.map((a) => a.id).join(", ") || "-"} in region [${[b.region.x, b.region.y, b.region.w, b.region.h].map(Math.round).join(", ")}]` : b.mode === "point" ? ` points at ${b.points.map((p) => p.id).join(", ") || "-"}` : "";
    return `${i + 1}. [${b.id}, scene ${b.scene}, ${b.mode}${visual}] ${b.say}`;
  });
  const here = detourScene(r, newScene - 1);
  const board = r.op === "insert_after" && here.drawn.length
    ? `Already drawn on the board the learner is looking at (scene ${here.scene}): ${here.drawn.map((b) => `${b.adds.map((a) => `${a.id} (${a.what})`).join(", ") || "-"} in region [${[b.region.x, b.region.y, b.region.w, b.region.h].map(Math.round).join(", ")}]`).join("; ")}. Never draw any of these again: point at them by id instead.${here.drawn.some((b) => /^d\d+-/.test(b.id)) ? " Beats with ids starting with d are a detour you already gave on this board; continue from it, do not repeat what it drew or said." : ""}`
    : "";
  const where = here.stay
    ? `If there is free space on that board for the one or two new things you need (the 100x100 board, outside the regions above), stay in scene ${here.scene}: draw only in free space and point at what is there. Otherwise start a clean board: scene ${newScene}. Either way all of the detour's beats stay in the scene you pick, and its first beat draws something.`
    : `It goes on a clean part of the board: its first beat is a draw beat in scene ${newScene}, and all of its beats stay in scene ${newScene}.`;
  const task = r.intake
    ? `REWRITE THE LESSON from beat ${r.index + 1} on, tailored to what the learner just told you (above): beats ${r.index + 1} onward are dropped, and the beats before stay as they are (beat 1 is already being spoken). Write the rest of a whole lesson, 10 to 16 beats, by the same rules as a full lesson (sections with goals, check-ins with bridges, a recap at the end). It continues on the same board: stay in scene ${newScene} for a while, drawing in free space beside what is already there (you may point at those ids), and start new scenes after it as the lesson moves on.`
    : r.op === "insert_after"
      ? `Write a short DETOUR of 2 to 4 beats that will be spoken right after beat ${r.index + 1}, before the lesson goes on. It explains the same idea from a fresh angle (a concrete case, an analogy, real numbers), following the note above, and does not move the lesson forward. ${where} Its last beat ends with a short check-in question and has "check": true.`
      : `REPLACE the rest of the lesson: beats ${r.index + 1} onward are dropped. Write 4 to 8 beats that take the learner from where they are to the end of the lesson by a different route, following the note above, including a short recap at the end. Start on a clean board: the first beat is a draw beat in scene ${newScene}; later scenes count up from there. Add a check-in after roughly every fourth beat.`;
  return [
    `The lesson answers: ${r.question}`,
    `The lesson planned so far:\n${lines.join("\n")}`,
    r.heard ? `The learner just said: "${r.heard}"` : "",
    board,
    r.said ? `You have just said aloud, right before these beats: "${r.said}". Continue from it: do not restate it or the learner's question, do not greet or acknowledge again.` : "",
    `Never open a beat with "good question", "great question" or similar, and never repeat the learner's question back to them.`,
    describeLearner(r.learner),
    `What didn't land and what to try next: ${r.note || "(no note)"}`,
    task,
    `Same beat format and rules as a full lesson, except: ignore the beat count and do not write a title line. Output only the beat lines.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function* amendLesson(r: AmendRequest, signal: AbortSignal): AsyncGenerator<PlanEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const maxScene = r.beats.reduce((m, b) => Math.max(m, b.scene || 0), 0);
  // The intake rewrite continues on beat 1's board; every other change starts on a clean one.
  const newScene = r.intake ? Math.max(1, maxScene) : maxScene + 1;
  const tracked = trackCall(`amend:${r.op}`, AMEND_MODEL);
  const stream = tracked.client.messages.stream(
    {
      model: AMEND_MODEL,
      max_tokens: 8000,
      system: withVoiceRules(SYSTEM),
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      messages: [{ role: "user", content: amendPrompt(r, newScene) }],
    },
    { signal },
  );
  let pending = "";
  const lines: string[] = [];
  stream.on("text", (delta) => {
    tracked.firstToken();
    pending += delta;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      lines.push(pending.slice(0, nl));
      pending = pending.slice(nl + 1);
    }
  });
  // Scenes only move forward from the plan's last one; the new part starts in a fresh scene.
  const st: PlanState = { scene: maxScene, known: new Map() };
  if (r.intake) st.known.set(newScene, new Set(r.beats.filter((b) => b.scene === newScene).flatMap((b) => b.adds.map((a) => a.id))));
  const here = detourScene(r, maxScene);
  if (here.stay) st.known.set(here.scene, new Set(here.drawn.flatMap((b) => b.adds.map((a) => a.id))));
  /** The scene the detour's drawing beats use: decided by its first one (the same board, if allowed, or a clean one). */
  let detourAt: number | null = null;
  const notes: string[] = [];
  let n = 0;
  const parse = function* (line: string): Generator<PlanEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      console.warn(`[amend] skipped a line that isn't JSON: ${trimmed.slice(0, 120)}`);
      return;
    }
    if (typeof obj.title === "string" || typeof obj.say !== "string") return;
    if (r.op === "insert_after" && obj.mode !== "talk") {
      detourAt ??= here.stay && Number(obj.scene) === here.scene ? here.scene : newScene;
      obj.scene = detourAt;
    } else if (n === 0 && obj.mode !== "talk" && !r.intake) obj.scene = Math.max(newScene, Number(obj.scene) || 0);
    // The first beat of a change must not point: on a new board there is nothing to point at yet.
    if (n === 0 && obj.mode === "point" && !(r.op === "insert_after" && obj.scene === here.scene && here.stay)) {
      const note = `${r.prefix}-1 was a point beat with nothing on its board; spoken as talk`;
      console.info(`[amend] ${note}`);
      notes.push(note);
      obj.mode = "talk";
    }
    // index n + 1 (never 0): checkBeat treats beat 0 as the lesson's very first beat.
    // The first beat goes straight in: no "good question", no restating the learner's question (they just heard a hand-off).
    if (n === 0 && typeof obj.say === "string") {
      let say = obj.say.trim().replace(/^(good|great|nice|excellent|fair|interesting|fun)\s+(question|one)\s*[-:,.!—]\s*/i, "");
      const sentences = say.split(/(?<=[.!?])\s+/);
      if (sentences.length > 1 && sentences[0].trim().endsWith("?")) say = sentences.slice(1).join(" ");
      if (say !== obj.say) console.info(`[amend] trimmed the opener of ${r.prefix}-1: "${String(obj.say).slice(0, 80)}" -> "${say.slice(0, 80)}"`);
      obj.say = say.charAt(0).toUpperCase() + say.slice(1);
    }
    const beat = checkBeat(obj, n + 1, st);
    n++;
    yield { type: "beat", beat: { ...beat, id: `${r.prefix}-${n}` }, tMs: ms() };
  };
  const done = stream.finalMessage();
  let finished = false;
  done.finally(() => (finished = true)).catch(() => {});
  while (!finished || lines.length) {
    const line = lines.shift();
    if (line !== undefined) {
      yield* parse(line);
      continue;
    }
    await new Promise((res) => setTimeout(res, 15));
  }
  const message = await done;
  if (pending.trim()) yield* parse(pending);
  if (message.stop_reason === "refusal") throw new Error("the planner declined this change");
  if (!n) throw new Error("the planner returned no beats");
  yield { type: "done", tMs: ms(), inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, call: tracked.finish(), ...(notes.length ? { notes } : {}) };
}
