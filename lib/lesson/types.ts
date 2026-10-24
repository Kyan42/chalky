/**
 * What a beat does to the board: add a drawing, point at (highlight or dim)
 * what is already there, or leave it alone while the teacher talks.
 */
export type BeatMode = "draw" | "point" | "talk";

/** A planned lesson beat: two or three spoken sentences, the word its visual starts on, and what to draw. */
export interface PlannedBeat {
  id: string;
  say: string;
  /** A word from `say`; the visual's time 0 is when Sonic speaks it. */
  at: string;
  /** What to add (draw) or which parts to point at (point); "" for talk. */
  visual: string;
  mode: BeatMode;
  /** The beat ends with a check-in question; the lesson waits for the learner before going on. */
  check: boolean;
}

/** NDJSON events from POST /api/plan. */
export type PlanEvent =
  | { type: "title"; title: string; tMs: number }
  | { type: "beat"; beat: PlannedBeat; tMs: number }
  | { type: "done"; tMs: number; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string; tMs: number };
