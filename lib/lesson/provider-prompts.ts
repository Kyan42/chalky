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
      `Output format, strictly: the very first line is "actions: " and the action names; then the spoken reply as plain sentences; then a line with exactly <<<trailer>>> and the JSON object on one line. No markdown, no headings, nothing after the JSON.`,
    ],
    // The planner's output is read line by line as JSON.
    plan: [`Output only JSON lines, one object per line, as specified: no markdown fences, no commentary, no blank lines between them.`],
  },
};

/** The lines for this call on this provider, ready to append to its system prompt ("" when none). */
export function providerLines(name: string, provider: Provider): string {
  const byName = LINES[provider] ?? {};
  // "amend:replace_from" and "quiz-label" share their family's lines ("amend", "quiz").
  const lines = byName[name] ?? byName[name.split(/[:-]/)[0]] ?? [];
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}
