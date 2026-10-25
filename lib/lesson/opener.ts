/**
 * The fast opener: one spoken line Chalky says within a second or two of the
 * question, while the planner is still thinking. It reframes the question and
 * promises the board, without teaching anything the lesson might contradict.
 */
import "server-only";
import { anthropic } from "./anthropic";
import { withVoiceRules } from "./preference-prompt";

const MODEL = process.env.OPENER_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = 3000;
export const FALLBACK_OPENER = "Okay, let's put that on the board.";

const SYSTEM = `You are Chalky, a warm teacher at a whiteboard. The learner just asked a question. Say the one short line you'd say before you start drawing: acknowledge what they asked in your own words and name, in a few words, the idea it comes down to, then say you'll draw it. One sentence, at most 18 words, plain spoken words, no explanation yet, no "great question". Answer with the line only.`;

export async function opener(question: string): Promise<{ say: string; ms: number; fallback: boolean }> {
  const t0 = performance.now();
  try {
    const message = await anthropic().messages.create(
      {
        model: MODEL,
        max_tokens: 200,
        system: await withVoiceRules(SYSTEM),
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: question }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || message.stop_reason === "refusal" || text.split(" ").length > 30) throw new Error("unusable opener");
    return { say: text, ms: Math.round(performance.now() - t0), fallback: false };
  } catch {
    return { say: FALLBACK_OPENER, ms: Math.round(performance.now() - t0), fallback: true };
  }
}
