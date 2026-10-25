/**
 * Grading a quiz. Two kinds:
 *   label  — the learner names numbered parts of what is on the board; graded as text by the fast model
 *            (Haiku, thinking off, JSON out), from their words and whatever their ink marked. Under a second.
 *   sketch — the learner draws something from the lesson; graded from the board picture with their ink by
 *            the slow model (Sonnet 5.5, vision, JSON out) against a rubric made of the lesson's own sentences.
 *   predict — before a section, the learner guesses what comes next; graded as text by the fast model against
 *            the next section's own sentences: right, partly or wrong, and one spoken sentence.
 * All answer with a score 0..1, what was right and what was missing, and two or three spoken sentences.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { trackCall } from "./calllog";
import { CONVERSE_MODEL } from "./converse";
import { DELEGATE_MODEL } from "./delegate";
import { withVoiceRules } from "./preference-prompt";
import type { CallLog } from "./types";

export interface LabelItem {
  n: number;
  /** The element id (for the cursor) and its hidden label (the right answer). */
  id: string;
  answer: string;
}

export interface QuizGrade {
  score: number;
  /** Label: per numbered item. */
  results?: { n: number; correct: boolean; heard: string }[];
  right: string[];
  missing: string[];
  /** Element ids the feedback talks about (sketch), for the cursor. */
  ids?: string[];
  feedback: string;
  ms: number;
  model: string;
  call?: CallLog;
}

async function json<T>(model: string, name: string, system: string, content: Anthropic.MessageParam["content"], schema: object, maxTokens: number, signal?: AbortSignal): Promise<{ out: T; call: CallLog }> {
  const tracked = trackCall(name, model);
  let message;
  let call: CallLog;
  try {
    message = await tracked.client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        // Haiku 5.5 turns thinking off with disabled; Sonnet 5.5 with between_tools.
        thinking: model.startsWith("claude-sonnet-5-5") ? { type: "between_tools" } : { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }],
      } as Anthropic.MessageCreateParamsNonStreaming,
      { signal },
    );
  } finally {
    call = tracked.finish();
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { out: JSON.parse(text) as T, call };
}

const LABEL_SCHEMA = {
  type: "object",
  properties: {
    results: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, correct: { type: "boolean" }, heard: { type: "string" } }, required: ["n", "correct", "heard"], additionalProperties: false } },
    feedback: { type: "string" },
  },
  required: ["results", "feedback"],
  additionalProperties: false,
};

/** The learner named the numbered parts: which they got, and two or three sentences back. */
export async function gradeLabel(o: { question: string; items: LabelItem[]; answer: string; inkMarks?: string[] }, signal?: AbortSignal): Promise<QuizGrade> {
  const t0 = performance.now();
  const system = await withVoiceRules(
    `You grade a quick spoken quiz in a lesson. The learner was shown numbered parts of a drawing and asked to name them. Decide for each number whether what they said names it: any name that means the same thing counts (synonyms, plain-language names, symbols said in words: "query matrix" or "the queries' weights" for Wq, "key matrix" for Wk, "value matrix" for Wv), and so do small slips and answers given out of order when it is clear which part they mean; a different part does not; a number they skipped is wrong, heard "". Then write the feedback Chalky, the teacher, says aloud: one or two short sentences (the lesson is waiting on it), first person, warm, no "good question": say which they got, and name the right answer for each one they missed. Return JSON only.`,
  );
  const user = [
    `The lesson: ${o.question}`,
    `The numbered parts and their names: ${o.items.map((it) => `${it.n} = ${it.answer}`).join("; ")}`,
    o.inkMarks?.length ? `They also marked on the board: ${o.inkMarks.join("; ")}` : "",
    `What the learner said: "${o.answer}"`,
  ]
    .filter(Boolean)
    .join("\n");
  const { out, call } = await json<{ results: { n: number; correct: boolean; heard: string }[]; feedback: string }>(CONVERSE_MODEL, "quiz-label", system, user, LABEL_SCHEMA, 500, signal);
  const results = o.items.map((it) => out.results.find((r) => r.n === it.n) ?? { n: it.n, correct: false, heard: "" });
  const right = results.filter((r) => r.correct).map((r) => o.items.find((it) => it.n === r.n)!.answer);
  const missing = results.filter((r) => !r.correct).map((r) => o.items.find((it) => it.n === r.n)!.answer);
  return { score: Math.round((right.length / Math.max(1, o.items.length)) * 100) / 100, results, right, missing, feedback: out.feedback.trim(), ms: Math.round(performance.now() - t0), model: CONVERSE_MODEL, call };
}

const SKETCH_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    right: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
    ids: { type: "array", items: { type: "string" } },
    feedback: { type: "string" },
  },
  required: ["score", "right", "missing", "ids", "feedback"],
  additionalProperties: false,
};

/** The learner drew something from the lesson: graded from the board picture against the lesson's own sentences. */
export async function gradeSketch(o: { question: string; ask: string; rubric: string[]; image?: string; inkMarks?: string[]; board?: string[]; answer?: string }, signal?: AbortSignal): Promise<QuizGrade> {
  const t0 = performance.now();
  const system = await withVoiceRules(
    `You grade a drawing quiz in a lesson. The learner was asked to draw something on the whiteboard with a pen (their strokes are blue, green, orange or dark; the teacher's own drawing is in chalk). Judge only their drawing, against the rubric: what the drawing must show, taken from what the lesson taught. Rough is fine; what matters is that the idea is there (the right parts, connected the right way, in the right order). Score 0 to 1 (the share of the rubric shown). List what they got right and what is missing, each in a few words. "ids": the ids of board elements your feedback refers to, if any. Then the feedback Chalky, the teacher, says aloud: two or three short sentences, first person, warm and specific: what they got, then what is missing. Return JSON only.`,
  );
  const text = [
    `The lesson: ${o.question}`,
    `The task: ${o.ask}`,
    `Rubric (what the lesson taught; the drawing should show this):\n${o.rubric.map((r) => `- ${r}`).join("\n")}`,
    o.board?.length ? `Elements on the board (ids): ${o.board.join(", ")}` : "",
    o.inkMarks?.length ? `Their strokes mark these board elements: ${o.inkMarks.join("; ")}` : "Their strokes mark no board element (judge them from the picture).",
    o.answer ? `They also said: "${o.answer}"` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const content: Anthropic.MessageParam["content"] = o.image
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: o.image } },
        { type: "text", text: `The board with the learner's drawing on it.\n\n${text}` },
      ]
    : text;
  const { out, call } = await json<{ score: number; right: string[]; missing: string[]; ids: string[]; feedback: string }>(DELEGATE_MODEL, "quiz-sketch", system, content, SKETCH_SCHEMA, 700, signal);
  return {
    score: Math.max(0, Math.min(1, Math.round(Number(out.score) * 100) / 100 || 0)),
    right: out.right.slice(0, 6),
    missing: out.missing.slice(0, 6),
    ids: out.ids.slice(0, 4),
    feedback: out.feedback.trim(),
    ms: Math.round(performance.now() - t0),
    model: DELEGATE_MODEL,
    call,
  };
}

/**
 * Predict: the rubric is what the lesson says next. From the beats after the quiz, the next section's own
 * sentences (its first beat up to the next section's start), at most six. The server cuts it, so the page
 * only sends the beats it has.
 */
export function predictRubric(after: { say: string; section?: string; quiz?: string }[]): string[] {
  const out: string[] = [];
  for (const [k, b] of after.entries()) {
    if (k > 0 && b.section) break;
    if (!b.quiz && b.say.trim()) out.push(b.say.trim());
  }
  return out.slice(0, 6);
}

const PREDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["right", "partly", "wrong"] },
    right: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
    covered: { type: "array", items: { type: "integer" } },
    feedback: { type: "string" },
  },
  required: ["verdict", "right", "missing", "covered", "feedback"],
  additionalProperties: false,
};

/** The learner guessed what comes next; graded against what the next section actually says. */
/**
 * `socratic`: the question that opens a section ("Ask me first"). The verdict is kept silent (the record and the
 * page's adjustment use it); the spoken line is a reaction to their idea with no right or wrong in it, and
 * `covered` lists the answer key's sentences (numbered from 1) their answer already says.
 */
export async function gradePredict(o: { question: string; ask: string; answer: string; rubric: string[]; socratic?: boolean }, signal?: AbortSignal): Promise<QuizGrade & { verdict: "right" | "partly" | "wrong"; covered: number[] }> {
  const t0 = performance.now();
  const speak = o.socratic
    ? `Then ONE short sentence Chalky, the teacher, says aloud to them ("you", never "their answer" or "the learner") before teaching this part: first person, warm, reacting to their idea itself (take it seriously, name what is interesting in it), leading into the explanation (for a guess about the sky: "Thinking of the air as a kind of filter is a good place to start, so let's see what it does to each color."; build yours from their own idea and this section). Never evaluate the answer ("your answer doesn't address…", "that's not quite it"), never say or imply right, wrong, correct, incorrect, close or exactly, and never give the answer away.`
    : `Then ONE short sentence Chalky, the teacher, says aloud: first person, warm, specific about their guess, and it must not give away the rest of the answer (the lesson is about to show it).`;
  const system = await withVoiceRules(
    `You grade a prediction in a lesson. Before the next part of the lesson, the learner was asked to predict what comes next. The answer key is what the next part actually says, sentence by sentence. Verdict: "right" when their prediction has the key idea (their own words, rough is fine), "partly" when it has part of it or the right direction without the reason, "wrong" when it misses it or says the opposite. "right" and "missing": the key ideas they got and missed, each in a few words. "covered": the numbers of the answer key's sentences whose point their answer already makes, so hearing them would only repeat it ([] if none). ${speak} Return JSON only.`,
  );
  const user = [
    `The lesson: ${o.question}`,
    `The prediction asked: ${o.ask}`,
    `What the next part of the lesson says (the answer key):\n${o.rubric.map((r, k) => `${k + 1}. ${r}`).join("\n")}`,
    `What the learner predicted: "${o.answer}"`,
  ].join("\n");
  const { out, call } = await json<{ verdict: "right" | "partly" | "wrong"; right: string[]; missing: string[]; covered: number[]; feedback: string }>(CONVERSE_MODEL, o.socratic ? "quiz-socratic" : "quiz-predict", system, user, PREDICT_SCHEMA, 400, signal);
  const verdict = out.verdict === "right" || out.verdict === "partly" ? out.verdict : "wrong";
  // One line: the next section is about to show the rest.
  const feedback = out.feedback.trim().split(/(?<=[.!?])\s+/)[0] ?? out.feedback.trim();
  return {
    verdict,
    score: verdict === "right" ? 1 : verdict === "partly" ? 0.5 : 0,
    right: out.right.slice(0, 4),
    missing: out.missing.slice(0, 4),
    covered: [...new Set(out.covered.filter((n) => Number.isInteger(n) && n >= 1 && n <= o.rubric.length))].sort((a, b) => a - b),
    feedback,
    ms: Math.round(performance.now() - t0),
    model: CONVERSE_MODEL,
    call,
  };
}

const LINE_SCHEMA = { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false };

/**
 * Socratic follow-ups, by the fast model. reframe: the learner's answer to a section's question missed; ask again
 * from another side, in their own words and framing, a concrete case or a smaller first step toward the same idea,
 * never stating or half-stating the answer (a different door, not a hint). gap: the third miss; one line that
 * names what their answers are missing, without explaining it (the section, played next, does that).
 */
export async function socraticLine(o: { mode: "reframe" | "gap"; question: string; ask: string; asked?: string[]; rubric: string[]; answers: string[]; missing: string[] }, signal?: AbortSignal): Promise<{ line: string; ms: number; model: string; call?: CallLog }> {
  const t0 = performance.now();
  const task =
    o.mode === "reframe"
      ? `The learner's answer to a question in a lesson missed the idea. Ask them again, reframed: open with a few words that take their idea seriously, in their own words (no verdict: never right, wrong, close or not quite), then ask from another side: a concrete case or a smaller first step toward the same idea, and not one already asked. Never state or half-state the answer, and never hint at it by naming it: a different door into the question, not a clue. ONE sentence, spoken to them ("you"), ending with a question mark.`
      : `The learner has tried three times to answer a question in a lesson and still missed the idea. Say ONE sentence, spoken to them, that names specifically the piece their answers have been missing as a place to look, never as the conclusion (e.g. "the part we haven't looked at is what happens when white light gets split apart", not "white light is a mix of colors"): the next part of the lesson explains it. No acknowledgement filler ("I hear you"), no score, no "wrong".`;
  const system = await withVoiceRules(`${task} Chalky, the teacher, says it aloud: first person, warm, plain words, under 30 words. Return JSON only: {"line": "..."}.`);
  const user = [
    `The lesson: ${o.question}`,
    `The question asked: ${o.ask}`,
    `What the lesson is about to explain (the answer, never to be given away):\n${o.rubric.map((r) => `- ${r}`).join("\n")}`,
    // React to what they just said, not to an earlier try.
    `Their latest answer (react to this one): "${o.answers[o.answers.length - 1] ?? ""}"`,
    o.answers.length > 1 ? `Their earlier answers: ${o.answers.slice(0, -1).map((a) => `"${a}"`).join("; ")}` : "",
    o.asked && o.asked.length > 1 ? `Already asked (don't repeat these or their examples): ${o.asked.slice(1).map((a) => `"${a}"`).join("; ")}` : "",
    o.missing.length ? `What their answers are missing: ${o.missing.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { out, call } = await json<{ line: string }>(CONVERSE_MODEL, `socratic-${o.mode}`, system, user, LINE_SCHEMA, 120, signal);
  // One sentence; a reframe ends with its question.
  let line = out.line.trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  if (o.mode === "reframe" && !line.endsWith("?")) line = `${line.replace(/[.!]$/, "")}?`;
  return { line, ms: Math.round(performance.now() - t0), model: CONVERSE_MODEL, call };
}
