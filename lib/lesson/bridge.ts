/** Words that open a confirmation of the learner's answer; the first group does so even as the whole line. */
const AGREES = "yes|yep|yeah|right|exactly|correct|that'?s right|that'?s it|spot on";
const CONFIRMS = new RegExp(`^(${AGREES}|good|great|nice|perfect)\\b[^.!?]*[.!?]\\s+`, "i");
const ONLY_CONFIRMS = new RegExp(`^(${AGREES})\\b[^.!?]*[.!?]?$`, "i");
/**
 * A check-in's bridge is written before the learner answers, so it must not confirm one. Takes a confirming
 * opening sentence off it ("Yes, cat. Now, how it decides." -> "Now, how it decides.") and hands that
 * sentence back: it holds the answer the planner had in mind. A bridge that is only a confirmation is
 * dropped. "Good, let's put real numbers on it." is one sentence that names the next step, and stays.
 */
export function splitBridge(bridge: string | undefined): { bridge?: string; confirms?: string } {
  if (!bridge) return {};
  if (ONLY_CONFIRMS.test(bridge)) return { confirms: bridge };
  const m = bridge.match(CONFIRMS);
  if (!m) return { bridge };
  const rest = bridge.slice(m[0].length).trim();
  return { ...(rest ? { bridge: rest[0].toUpperCase() + rest.slice(1) } : {}), confirms: m[0].trim() };
}
