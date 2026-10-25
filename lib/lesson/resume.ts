/**
 * What the learner says that needs no model at all. Client-safe (no
 * server-only import), so the lesson and /api/converse share one definition.
 */

/**
 * Replies that just mean "carry on": Janani's session-controller list, widened
 * so a string of acknowledgements ("yeah ok keep going") also counts.
 */
const ACK = "u+h+|u+m+|hmm+|mm+|oh|ah|ok(ay)?|sure|yes|yeah|yep|yup|right|alright|got it|i see|makes sense|that makes sense|thanks?( you)?|cool|great|good|fine|uh huh|mhm";
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

/**
 * The learner is still lost on what was just explained ("I still don't get
 * it", "huh?", "what do you mean"), as opposed to asking something new. Only
 * this escalates an answer to a detour; a new question starts fresh.
 */
const STILL_LOST = /\b(still|again|don'?t (get|understand|follow)|do not (get|understand|follow)|not (getting|following|sure)|confus|lost me|i'?m lost|what do you mean|makes? no sense|doesn'?t make sense|huh|wait what|say that again)\b|^\W*(what|huh|sorry)\W*$/i;

export function isStillLost(text: string): boolean {
  return STILL_LOST.test(text.trim());
}
