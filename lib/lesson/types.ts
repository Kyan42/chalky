/** A planned lesson beat: one or two spoken sentences, the word its visual starts on, and what to draw. */
export interface PlannedBeat {
  id: string;
  say: string;
  /** A word from `say`; the visual's time 0 is when Sonic speaks it. */
  at: string;
  /** A short description of the visual for the scene-language generator. */
  visual: string;
}

/** NDJSON events from POST /api/plan. */
export type PlanEvent =
  | { type: "title"; title: string; tMs: number }
  | { type: "beat"; beat: PlannedBeat; tMs: number }
  | { type: "done"; tMs: number; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string; tMs: number };
