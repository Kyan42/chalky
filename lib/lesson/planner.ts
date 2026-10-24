/**
 * The lesson planner: a question in, a structured two-minute lesson out
 * (intuition, mechanism, example, misconception, recap), streamed one beat at
 * a time as JSON lines so the first beat can play while later ones are written.
 * PLANNER_EFFORT overrides the effort level (default low).
 */
import "server-only";
import { anthropic } from "./anthropic";
import type { BeatMode, PlanEvent, PlannedBeat } from "./types";

const MODEL = "claude-opus-5-5";

// Medium effort thought for about 25 s before the first beat; low takes about 3 s with similar depth.
const EFFORT = (process.env.PLANNER_EFFORT ?? "low") as "low" | "medium" | "high";

const SYSTEM = `You are Chalky, a great teacher who explains things out loud while drawing on one shared whiteboard. The learner wants to actually understand the answer, not hear a one-liner. Plan a spoken lesson of about two minutes.

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
- "point": draw nothing new; highlight or fade parts already on the board while you talk about them. Use it when you're explaining something already drawn.
- "talk": leave the board as it is. Use it for check-ins, analogies that need no picture, and the recap.
Most lessons have about half draw beats. The first beat is always "draw".

For each beat, also give:
- "at": one word copied exactly from the beat's text where the drawing (or pointing) should start: the word that names the thing, within the first 10 words, never a number.
- "visual": for draw, one or two sentences describing exactly what to add (shapes, where on the board relative to what's there, labels of 1 to 3 words). The drawing is made of lines, curves, circles, boxes, arrows, bars, moving dots and short labels. For point, which existing parts to highlight or fade. For talk, "".

Output format, exactly: first one line {"title": "<lesson title, max 6 words>"}, then one line per beat {"say": "...", "mode": "draw" | "point" | "talk", "at": "...", "visual": "...", "check": false}. Nothing else: no code fences, no commentary.`;

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

const MODES = new Set<BeatMode>(["draw", "point", "talk"]);

function checkBeat(raw: unknown, index: number): PlannedBeat {
  const b = raw as Partial<PlannedBeat>;
  if (typeof b.say !== "string") throw new Error(`beat ${index + 1} is missing say`);
  const words = b.say.split(/\s+/).map(norm);
  // Fall back to the first content word if the anchor isn't in the sentence.
  const at = typeof b.at === "string" && words.includes(norm(b.at)) ? b.at : (b.say.split(/\s+/).find((w) => norm(w).length > 3) ?? b.say.split(/\s+/)[0]);
  const visual = typeof b.visual === "string" ? b.visual.trim() : "";
  // The board can't point at anything before something is drawn, or without a brief.
  let mode: BeatMode = b.mode && MODES.has(b.mode) ? b.mode : "draw";
  if (index === 0 || (mode !== "talk" && !visual)) mode = index === 0 ? "draw" : "talk";
  return { id: `b${index + 1}`, say: b.say.trim(), at: norm(at), visual, mode, check: b.check === true };
}

export async function* planLesson(question: string, signal: AbortSignal, effort: typeof EFFORT = EFFORT): AsyncGenerator<PlanEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const stream = anthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 12000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort },
      messages: [{ role: "user", content: question }],
    },
    { signal },
  );

  let pending = "";
  let beats = 0;
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
    const obj = JSON.parse(trimmed);
    if (typeof obj.title === "string") yield { type: "title", title: obj.title, tMs: ms() };
    else yield { type: "beat", beat: checkBeat(obj, beats++), tMs: ms() };
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
