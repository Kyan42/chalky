/**
 * What a beat does to the board: add a drawing, point at (highlight) what is
 * already there, or leave it alone while the teacher talks.
 */
export type BeatMode = "draw" | "point" | "talk";

/** A region of the board on a 100x100 grid (x right, y down). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A planned lesson beat. The planner also lays the board out as it goes, so
 * every beat's drawing can be generated at once, without seeing the others:
 * which scene (picture) it belongs to, where on the board it goes, which
 * elements it introduces (by id) and which earlier ones it points at.
 */
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
  /** 1-based. A new scene starts on a wiped board. Talk beats inherit the scene before them. */
  scene: number;
  /** Where this beat's drawing goes (draw), or where the things it points at are (point). */
  region: Region;
  /** Elements a draw beat introduces; later beats refer to them by id. */
  adds: { id: string; what: string }[];
  /** Elements from earlier beats in the same scene to highlight, each when `word` from `say` is spoken. */
  points: { id: string; word: string }[];
}

/** NDJSON events from POST /api/plan. */
export type PlanEvent =
  | { type: "title"; title: string; tMs: number }
  | { type: "beat"; beat: PlannedBeat; tMs: number }
  | { type: "done"; tMs: number; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string; tMs: number };
