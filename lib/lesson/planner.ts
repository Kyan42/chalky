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
import { anthropic } from "./anthropic";
import type { BeatMode, PlanEvent, PlannedBeat, Region } from "./types";

const MODEL = process.env.PLANNER_MODEL || "claude-opus-5-5";

// Medium effort thought for about 25 s before the first beat; low takes about 3 s with similar depth.
const EFFORT = (process.env.PLANNER_EFFORT ?? "low") as "low" | "medium" | "high";

const SYSTEM = `You are Chalky, a great teacher who explains things out loud while drawing on a whiteboard. The learner wants to actually understand the answer, not hear a one-liner. Plan a spoken lesson of about two minutes.

Teach it the way a good teacher would at a whiteboard, in this order:
1. The core intuition: the one idea everything else hangs on, in plain words.
2. How it actually works: the mechanism, step by step, with the real names of the parts and why each step happens.
3. A concrete example: real numbers, a real case, or a familiar everyday situation, worked through.
4. A common misconception or surprising detail, and why it's wrong or why it matters.
5. A short recap that ties the pieces together.
Skip a section only if it truly doesn't apply. Go deeper where the question needs it.

Write 9 to 14 beats. A beat is two or three plain spoken sentences, 25 to 55 words, said while the board shows one thing. Sound like a person talking: no lists, no markdown, no symbols that read badly aloud (write "percent", not "%"; spell out units and abbreviations). Every beat should teach something new; no filler or "great question". After roughly every fourth beat, end that beat with a short check-in question to the learner, like "Does the pressure part make sense so far?", and mark it "check": true.

Each beat has a "mode" for the board:
- "draw": add a new drawing to the board for this beat. Use it when a new thing, part, or step appears.
- "point": draw nothing new; highlight parts already on the board while you talk about them. Use it when you're explaining something already drawn.
- "talk": leave the board as it is. Use it for check-ins, analogies that need no picture, and the recap.
Most lessons have about half draw beats. The first beat is always "draw".

The board shows one picture at a time, called a scene. Group beats into scenes: a scene is one picture built up over at most 4 draw beats and then wiped, like moving to a clean part of the whiteboard. Start a new scene when the lesson zooms in, moves to a new stage, or switches to the example. Number scenes 1, 2, 3 in order; a scene's first beat is a draw beat; talk beats keep the current scene number. A new scene starts empty, so a beat can only point at things drawn earlier in its own scene.

The board is a 100 by 100 grid, x to the right and y down, shown 3:2 (wider than tall). For each beat, also give:
- "at": one word copied exactly from the beat's text where the drawing (or pointing) should start: the word that names the thing, within the first 10 words, never a number.
- "region": [x, y, w, h], where this beat's drawing goes (for point: where the things it points at are). Within a scene, draw regions must not overlap each other. The scene's main picture goes first and can take about 50 wide by 55 tall; later additions take 25 to 35 each side, placed next to the part they relate to so arrows between them are short. Keep 5 units clear of every edge. [] for talk.
- "adds": for draw beats, the 1 to 4 elements this beat adds, each {"id": short unique name of letters, digits and dashes like "sun" or "co2-arrow", "what": a few words on what it is}. These ids are how later beats refer to the elements. [] for point and talk.
- "points": for point beats, 1 to 3 of {"id": an id added earlier in this scene, "word": the one word in this beat's text that names it, copied exactly}; the highlight appears as that word is spoken. [] for draw and talk.
- "visual": for draw, one or two sentences describing exactly what to add (shapes, their arrangement inside the region, labels of 1 to 3 words) and which earlier ids it connects to. The drawing is made of circles, boxes, arrows between named elements, flows, cycles, equations, plots, bars, moving dots and short labels. For point, what to point at and why. For talk, "".

Output format, exactly: first one line {"title": "<lesson title, max 6 words>"}, then one line per beat {"say": "...", "mode": "draw" | "point" | "talk", "scene": 1, "at": "...", "region": [x, y, w, h], "adds": [...], "points": [...], "visual": "...", "check": false}. Nothing else: no code fences, no commentary.`;

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
  return { id: `b${index + 1}`, say, at: norm(at), visual, mode, check: b.check === true, scene, region, adds, points };
}

export async function* planLesson(question: string, signal: AbortSignal, effort: typeof EFFORT = EFFORT): AsyncGenerator<PlanEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const stream = anthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 14000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
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
  yield { type: "done", tMs: ms(), inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
}
