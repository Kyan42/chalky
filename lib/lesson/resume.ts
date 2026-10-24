/**
 * What the learner says that needs no model at all. Client-safe (no
 * server-only import), so the lesson and /api/converse share one definition.
 */

/**
 * Replies that just mean "carry on": Janani's session-controller list, widened
 * so a string of acknowledgements ("yeah ok keep going") also counts.
 */
const ACK = "ok(ay)?|sure|yes|yeah|yep|yup|right|alright|got it|i see|makes sense|that makes sense|thanks?( you)?|cool|great|good|fine|uh huh|mhm";
const GO = "resume|continue|keep going|go on|carry on|next|never ?mind|move on|go ahead";
const GAP = "[^a-z0-9]*";
const RESUME = new RegExp(`^${GAP}((${ACK})${GAP})*((${GO})${GAP})?$`, "i");

export function isResume(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && RESUME.test(t);
}

/**
 * Just a greeting or Chalky's name, with nothing to learn in it ("Hey Chalky.",
 * which Ink-2 sometimes hears as "Hey Chucky."). Ink ends a turn at the pause
 * after it, so on its own it must not start a lesson.
 */
const GREETING = /^[^a-z0-9]*((hey|hi|hello|ok(ay)?|so|um+|uh+|yo)[^a-z0-9]*)*((chalky|chalkie|chucky|chuckie|charlie|chocky|jacky|chaki)[^a-z0-9]*)?$/i;

export function isGreetingOnly(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && GREETING.test(t);
}
