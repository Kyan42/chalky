/**
 * Chalky's fixed lines: said word for word, often at a moment where any wait shows (Start talking, right after
 * the learner answers). The server keeps their speech cached per voice, speed and language (lib/tts-cache.ts),
 * so they start at once; the page says them through /api/tts like any line.
 */
export const GREETING = "Hey, I'm Chalky! What do you want to learn today?";
/** Said the moment the intake answer lands, while the fast model decides (no silence while it thinks). */
export const INTAKE_ACKS = ["Got it, give me a second.", "Okay, let me set that up.", "Great, one moment while I sketch this out."];
export const RESEARCH_EMPTY_START = "I couldn't find anything recent on that, so here's what I know.";
export const RESEARCH_EMPTY_MID = "I couldn't find anything recent on that, so I'll stick with what I know.";
/** A section's question with nothing heard for a while. */
export const QUIET_SHOW = "No worries, let me just show you.";

/** Every fixed line, plus the ones the conversation model is asked to say as written. */
export const STOCK_LINES = [GREETING, ...INTAKE_ACKS, RESEARCH_EMPTY_START, RESEARCH_EMPTY_MID, QUIET_SHOW, "Let me check the latest on that.", "Sure, let's stop here."];
