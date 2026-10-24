/**
 * Live visual generation for one beat: the level 3 scene language from the
 * flexibility experiment (Claude Haiku 5.5, effort low, structured outputs),
 * compiled to a Clayzo document, with one repair turn on failure.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { anthropic } from "./anthropic";
import { L3_SCHEMA, SCENE_LANGUAGE } from "@/experiments/visual-flex/prompts";
import { compileLevel3, fromFlatElements, type FlatElement } from "@/experiments/visual-flex/scene";
import type { PlannedBeat } from "./types";

const MODEL = "claude-haiku-5-5";

const SYSTEM = `You design the animated visual for one beat of a spoken lesson. A teacher voice speaks the sentence; your visual starts the moment the anchor word is spoken, builds while the rest of the sentence plays, then holds still. It sits on a whiteboard beside the speech, so it should show the idea, not repeat the sentence as text. Keep labels short. Answer with the requested output only.`;

/** Seconds of speech left after the anchor word, at about 2.6 words per second. */
function visualSeconds(beat: PlannedBeat): number {
  const words = beat.say.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "") === beat.at);
  return Math.max(1.5, +((words.length - Math.max(0, i)) / 2.6).toFixed(1));
}

export interface VisualResult {
  doc: AnimationDocument | null;
  ms: number;
  attempts: { ms: number; outputTokens: number; stopReason: string | null; error: string | null }[];
}

export async function generateVisual(question: string, beat: PlannedBeat, signal?: AbortSignal): Promise<VisualResult> {
  const client = anthropic();
  const t0 = performance.now();
  const brief = [
    `Question the learner asked: ${question}`,
    `Sentence being spoken: "${beat.say}"`,
    `Anchor word: "${beat.at}". The visual's time 0 is when this word is spoken.`,
    `Timing: the visual must finish building within about ${visualSeconds(beat)} seconds, then hold.`,
    `What the teacher planned to draw: ${beat.visual}`,
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${brief}\n\n${SCENE_LANGUAGE}\n\nReturn JSON matching the schema.` }];
  const attempts: VisualResult["attempts"] = [];

  for (let turn = 0; turn < 2; turn++) {
    const ta = performance.now();
    const message = await client.messages
      .stream(
        {
          model: MODEL,
          max_tokens: 6000,
          system: SYSTEM,
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: { type: "json_schema", schema: L3_SCHEMA } },
        } as Anthropic.MessageStreamParams,
        { signal },
      )
      .finalMessage();
    const attempt = { ms: Math.round(performance.now() - ta), outputTokens: message.usage.output_tokens, stopReason: message.stop_reason, error: null as string | null };
    attempts.push(attempt);
    if (message.stop_reason === "refusal") {
      attempt.error = "refusal";
      break;
    }
    try {
      if (message.stop_reason === "max_tokens") throw new Error("output was cut off at max_tokens");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const doc = compileLevel3(fromFlatElements(JSON.parse(text) as { elements: FlatElement[] }), `${beat.id}-${Date.now()}`);
      return { doc, ms: Math.round(performance.now() - t0), attempts };
    } catch (e) {
      attempt.error = String((e as Error).message ?? e).slice(0, 800);
      messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: "user", content: `That failed with this error:\n${attempt.error}\n\nFix it and answer again in the same format.` });
    }
  }
  return { doc: null, ms: Math.round(performance.now() - t0), attempts };
}
