/**
 * Answers the learner when they talk back: at a check-in ("does that make
 * sense?") or after interrupting a beat. Returns a short spoken reply and what
 * the lesson should do next.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import { withVoiceRules } from "./preference-prompt";

const MODEL = "claude-opus-5-5";

export type ReplyIntent = "continue" | "stop";

export interface ReplyResult {
  say: string;
  intent: ReplyIntent;
  ms: number;
}

const SYSTEM = `You are Chalky, a warm, clear teacher giving a spoken lesson at a whiteboard. The learner just said something to you mid-lesson. Reply out loud as a teacher would: if they asked a question or are confused, answer it directly and concretely in two to four spoken sentences, at most 70 words, building on what the lesson has covered. If they just said yes, got it, or keep going, reply with a very short acknowledgement of a few words. Plain spoken words only: no lists, no markdown, no symbols that read badly aloud.

Set intent to "stop" only if they clearly want to end the lesson; otherwise "continue" (the lesson carries on right after your reply).`;

const SCHEMA = {
  type: "object",
  properties: { say: { type: "string" }, intent: { type: "string", enum: ["continue", "stop"] } },
  required: ["say", "intent"],
  additionalProperties: false,
};

export async function reply(o: { question: string; said: string[]; now?: string; heard: string; kind: "check-in" | "interrupt" }): Promise<ReplyResult> {
  const t0 = performance.now();
  const context = [
    `The lesson answers: ${o.question}`,
    `What you've said so far:\n${o.said.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(nothing yet)"}`,
    o.kind === "interrupt"
      ? `The learner interrupted you while you were saying: "${o.now ?? ""}"`
      : "You had just asked the learner a check-in question.",
    `The learner said: "${o.heard}"`,
  ].join("\n\n");
  const message = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: await withVoiceRules(SYSTEM),
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: context }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  if (message.stop_reason === "refusal") throw new Error("Chalky couldn't answer that");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { say: string; intent: ReplyIntent };
  return { say: parsed.say.trim(), intent: parsed.intent, ms: Math.round(performance.now() - t0) };
}
