/**
 * The intake: before teaching, Chalky asks the learner one short question
 * (what they already know, or which part they care about), then decides from
 * the answer whether the plan, already being written from the raw question,
 * should change after its first beat. Haiku with thinking off: both calls sit
 * on the path to first sound.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import { CONVERSE_MODEL } from "./converse";
import type { LearnerRecord } from "./types";

export type IntakeKind = "prior" | "focus";

export interface IntakeQuestion {
  kind: IntakeKind;
  say: string;
  ms: number;
  model: string;
}

export interface IntakeDecision {
  /** Replace the plan from beat 2 with one tailored to the answer. */
  amend: boolean;
  /** For the planner: what the answer tells us and how to change the lesson. */
  note: string;
  learner: Pick<LearnerRecord, "level" | "prior" | "focus">;
  ms: number;
  model: string;
}

/** Shape-based fallback when the model is slow or fails, so the intake never blocks first sound. */
export function fallbackIntake(question: string): { kind: IntakeKind; say: string } {
  const q = question.trim().replace(/[?.!]+$/, "");
  const topic = /^(what|how|why)\s+(is|are|does|do)\s+(an?\s+|the\s+)?(.+)$/i.exec(q)?.[4];
  if (/^(how|why)\b/i.test(q)) return { kind: "focus", say: "Is there a specific part of that you find confusing?" };
  return { kind: "prior", say: topic && topic.split(/\s+/).length <= 4 ? `What do you already know about ${topic}?` : "What do you already know about this?" };
}

const ASK_SYSTEM = `You are Chalky, a warm teacher about to explain something out loud. Before you start, you ask the learner exactly ONE short spoken question, at most 14 words, that will help you pitch the lesson. Choose its kind from the shape of their question:
- "prior": ask what they already know, when the topic has a name or vocabulary they may or may not have met ("What do you already know about photosynthesis?").
- "focus": ask which part they want, when the question is broad or has several parts ("Is there a specific part that's confusing you?").
Plain spoken words, one question, no greeting, no preamble. Answer on one line, exactly: prior: <question>  or  focus: <question>`;

const DECIDE_SYSTEM = `You are Chalky, a teacher. You asked the learner one question before teaching; a lesson plan was already written from their original question alone. From their answer, decide:
- "amend": true when the answer changes what the lesson should be: it narrows the focus to one part, shows they already know the basics (skip ahead, go deeper), or shows they are new to it (slower, more basic). false when the answer adds nothing the plan doesn't already cover (vague, "not much", "I don't know", or it simply restates the question).
- "note": one or two sentences for the planner on how to change the lesson, or "" when amend is false.
- "level": "new" (has not met it), "some" (knows the basics) or "strong" (knows it well and wants depth); "unknown" if the answer doesn't say.
- "prior": what they already know, in a few words, or "".
- "focus": the part they care about, in a few words, or "".
Answer with the JSON only.`;

const DECIDE_SCHEMA = {
  type: "object",
  properties: {
    amend: { type: "boolean" },
    note: { type: "string" },
    level: { type: "string", enum: ["new", "some", "strong", "unknown"] },
    prior: { type: "string" },
    focus: { type: "string" },
  },
  required: ["amend", "note", "level", "prior", "focus"],
  additionalProperties: false,
};

async function json<T>(system: string, user: string, schema: object, maxTokens: number, signal?: AbortSignal): Promise<T> {
  const message = await anthropic().messages.create(
    {
      model: CONVERSE_MODEL,
      max_tokens: maxTokens,
      system,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    } as Anthropic.MessageCreateParamsNonStreaming,
    { signal },
  );
  if (message.stop_reason === "refusal") throw new Error("refused");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

/**
 * One intake question, from the model within `budgetMs`, else from the question's
 * shape. It is the lesson's first sound, so the budget is tight; plain text (no
 * JSON schema) is the fastest way to get one line back.
 */
export async function intakeQuestion(question: string, signal?: AbortSignal, budgetMs = Number(process.env.INTAKE_BUDGET_MS) || 1000): Promise<IntakeQuestion> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const deadline = AbortSignal.timeout(budgetMs);
  try {
    const message = await anthropic().messages.create(
      {
        model: CONVERSE_MODEL,
        max_tokens: 60,
        system: ASK_SYSTEM,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `The learner asked: "${question}"` }],
      } as Anthropic.MessageCreateParamsNonStreaming,
      { signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
    );
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    const m = /^(prior|focus)\s*:\s*(.+)$/im.exec(text);
    if (!m) throw new Error(`unexpected: ${text.slice(0, 80)}`);
    const r = { kind: m[1].toLowerCase() as IntakeKind, say: m[2] };
    const say = r.say.trim();
    if (!say.endsWith("?") || say.split(/\s+/).length > 20) throw new Error(`not one short question: ${say}`);
    return { kind: r.kind === "focus" ? "focus" : "prior", say, ms: ms(), model: CONVERSE_MODEL };
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn(`[intake] fell back to a template (${deadline.aborted ? `over ${budgetMs} ms` : String((e as Error)?.message ?? e).slice(0, 120)})`);
    return { ...fallbackIntake(question), ms: ms(), model: "template" };
  }
}

export async function decideIntake(o: { question: string; asked: string; answer: string; beats: string[] }, signal?: AbortSignal): Promise<IntakeDecision> {
  const t0 = performance.now();
  const user = [
    `The learner asked: "${o.question}"`,
    o.beats.length ? `The plan so far starts:\n${o.beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}` : "",
    `You asked: "${o.asked}"`,
    `They answered: "${o.answer}"`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await json<{ amend: boolean; note: string; level: LearnerRecord["level"]; prior: string; focus: string }>(DECIDE_SYSTEM, user, DECIDE_SCHEMA, 300, signal);
  return {
    amend: r.amend === true && r.note.trim().length > 0,
    note: r.note.trim(),
    learner: { level: r.level, prior: r.prior.trim(), focus: r.focus.trim() },
    ms: Math.round(performance.now() - t0),
    model: CONVERSE_MODEL,
  };
}
