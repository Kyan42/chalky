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

/** A yes that isn't sure ("yeah, I think so", "kind of"): one line back, the lesson goes on, the record notes it. */
const HESITANT = /^\W*((yeah|yes|yep|sure|ok(ay)?|um+|uh+)\W+)*(i think so|i guess( so)?|kind of|sort of|maybe|probably|not sure|i'?m not sure|more or less|somewhat|a little)\b/i;

export function isHesitant(text: string): boolean {
  return HESITANT.test(text.trim()) && text.trim().split(/\s+/).length <= 8;
}

/** The learner asked something: a question gets an answer, never a confirm that moves on. */
const QUESTION = /\?\s*$|^\W*(why|what|how|when|where|who|which|whose|is|are|was|were|do|does|did|can|could|would|should|will|isn'?t|aren'?t|doesn'?t|don'?t)\b/i;

export function isQuestion(text: string): boolean {
  return QUESTION.test(text.trim());
}

export function isStillLost(text: string): boolean {
  return STILL_LOST.test(text.trim());
}

/**
 * The learner wants to stop the whole lesson ("I'm done", "let's end the lesson", "that's enough for
 * today"), as opposed to finishing a drawing or one part ("I'm done drawing", "done with this bit").
 */
const END_LESSON = /\b(end|stop|finish|quit|exit|close|wrap up)\b(\s+\w+){0,2}\s+(lesson|class|session)\b|\b(done|finished|through) with (the|this|my|today'?s) (lesson|class|session)\b|\b(that'?s|that is) (all|enough) for (now|today)\b|\b(i'?m|i am|we'?re|we are) (all )?(done|finished) for (now|today)\b|\bi (have|need|gotta|got) to go\b|^\W*((ok(ay)?|yeah|so|um+|alright)\W+)*(i'?m|i am|we'?re|we are) (all )?(done|finished)\W*$/i;

export function wantsToEnd(text: string): boolean {
  return END_LESSON.test(text.trim());
}
