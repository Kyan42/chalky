/**
 * The lesson planner: a question in, a short lesson out, streamed one beat at a
 * time as JSON lines so the first beat can play while later ones are written.
 */
import "server-only";
import { anthropic } from "./anthropic";
import type { PlanEvent, PlannedBeat } from "./types";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are Chalky, a teacher who explains things out loud while drawing on a whiteboard. You plan a short spoken lesson that answers the learner's question.

Write 4 to 6 beats. A beat is what you say in one breath while drawing one thing: one or two plain spoken sentences, at most 28 words, no lists, no markdown, no symbols that read badly aloud (write "percent", not "%"; spell out units). Build the idea up beat by beat: start with the core intuition, then add one new piece per beat. The last beat ties it together.

For each beat, also give:
- "at": one word copied exactly from that beat's sentence, where the drawing should start. Pick the word that names the thing being drawn, early in the sentence (within its first 8 words), never a number.
- "visual": one sentence describing what to draw for this beat on its own canvas, concretely (shapes, positions, labels of 1 to 3 words). The drawing is made of lines, curves, circles, boxes, arrows, bars, moving dots and short labels.

Output format, exactly: first one line {"title": "<lesson title, max 6 words>"}, then one line per beat {"say": "...", "at": "...", "visual": "..."}. Nothing else: no code fences, no commentary.`;

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

function checkBeat(raw: unknown, index: number): PlannedBeat {
  const b = raw as Partial<PlannedBeat>;
  if (typeof b.say !== "string" || typeof b.at !== "string" || typeof b.visual !== "string") throw new Error(`beat ${index + 1} is missing say/at/visual`);
  const words = b.say.split(/\s+/).map(norm);
  // Fall back to the first content word if the anchor isn't in the sentence.
  const at = words.includes(norm(b.at)) ? b.at : (b.say.split(/\s+/).find((w) => norm(w).length > 3) ?? b.say.split(/\s+/)[0]);
  return { id: `b${index + 1}`, say: b.say.trim(), at: norm(at), visual: b.visual.trim() };
}

export async function* planLesson(question: string, signal: AbortSignal): AsyncGenerator<PlanEvent> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const stream = anthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
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
