/**
 * Provider-specific prompt lines, in one place: the formats Claude follows from our prompts as written may
 * need a different nudge on another provider. Appended to a call's system prompt by lib/lesson/provider.ts,
 * keyed by the call's name. Every line here is noted in docs/openai.md with the reason it was added.
 */
import type { Provider } from "./provider";

const LINES: Partial<Record<Provider, Record<string, string[]>>> = {
  openai: {
    // The conversation reply is read as it streams: the actions line first, speech, then the sentinel and
    // one JSON line. Nothing else may come before the actions line or after the trailer.
    converse: [
      `Output format, strictly: the very first line is "actions: " and the action names; then the spoken reply as plain sentences; then a line with exactly <<<trailer>>> and the JSON object on one line. No markdown, no headings. Stop writing right after the JSON object: no tool calls, no further text.`,
      // gpt-6-luna once skipped the actions line and spoke its own plan ("This is time-sensitive, so start a lesson…").
      `Every sentence after the actions line is spoken aloud to the learner, as Chalky. Never write notes, reasoning or instructions to yourself there.`,
      // gpt-6-luna answered "Why is the sky blue?" in two sentences and offered more, where Claude starts the lesson.
      `Before a lesson, a "why" or "how" question about a topic ("Why is the sky blue?", "How does photosynthesis work?") is a request to learn it: use start_lesson with the intake ask, not a short answer, even when you could answer it in one sentence (Chalky teaches it at the board). A quick question is a single fact ("What's the capital of Peru?").`,
    ],
    // The planner's output is read line by line as JSON.
    plan: [
      `Output only JSON lines, one object per line, as specified: no markdown fences, no commentary, no blank lines between them.`,
      // gpt-6.1-sol left "section" off the lesson's first beat, so the first section had no title.
      `The lesson's first beat opens the first section: the first beat line after the title line always has a "section" field.`,
      // gpt-6.1-sol read "speak in the first person" as narrating its actions: "I point to the air here", "I draw…", "I call that…".
      `"First person" only means you never call yourself Chalky. Don't narrate what you do at the board ("I draw…", "I point to…", "I call this…"): talk about the thing itself ("Here's the air…", "This is called scattering…"), as the drawing appears.`,
    ],
  },
};

/** The lines for this call on this provider, ready to append to its system prompt ("" when none). */
export function providerLines(name: string, provider: Provider): string {
  const byName = LINES[provider] ?? {};
  // "amend:replace_from" and "quiz-label" share their family's lines ("amend", "quiz").
  const lines = byName[name] ?? byName[name.split(/[:-]/)[0]] ?? [];
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}
