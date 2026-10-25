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
  /** On a section's first beat: the section's one-line goal. */
  section?: string;
  /** On a check-in beat: what Chalky says when the learner answers "got it" (no model call), naming what comes next. */
  bridge?: string;
}

/**
 * What the lesson has learned about the learner so far, kept in the browser
 * (no persistence yet) and passed to the planner and the reply route: the
 * intake answer, their check-in replies and what they got stuck on.
 */
export interface LearnerRecord {
  level: "new" | "some" | "strong" | "unknown";
  /** What they already know, in a few words. */
  prior: string;
  /** The part they care about, in a few words. */
  focus: string;
  /** What didn't land (the reply layer's planner notes), newest last. */
  confusions: string[];
  /** Their answers at check-ins, newest last. */
  replies: string[];
}

export const NEW_LEARNER: LearnerRecord = { level: "unknown", prior: "", focus: "", confusions: [], replies: [] };

/** The record as a few lines for a prompt; "" when nothing is known yet. */
export function describeLearner(l: LearnerRecord | undefined): string {
  if (!l) return "";
  const lines = [
    l.level !== "unknown" ? `level: ${l.level === "new" ? "new to this" : l.level === "some" ? "knows the basics" : "knows it well, wants depth"}` : "",
    l.prior ? `already knows: ${l.prior}` : "",
    l.focus ? `wants to focus on: ${l.focus}` : "",
    l.confusions.length ? `got stuck on: ${l.confusions.slice(-3).join(" | ")}` : "",
    l.replies.length ? `recent check-in answers: ${l.replies.slice(-3).map((r) => `"${r}"`).join(", ")}` : "",
  ].filter(Boolean);
  return lines.length ? `What we know about the learner:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
}

/** Checks a learner record sent by the browser. */
export function cleanLearner(raw: unknown): LearnerRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(-5) : []);
  const level = ["new", "some", "strong"].includes(o.level as string) ? (o.level as LearnerRecord["level"]) : "unknown";
  return { level, prior: str(o.prior), focus: str(o.focus), confusions: list(o.confusions), replies: list(o.replies) };
}

/** One HTTP attempt of a model call (the SDK retries 408/409/429/5xx on its own). */
export interface CallAttempt {
  n: number;
  /** HTTP status, or null when the request failed before a response (network, abort, timeout). */
  status: number | null;
  /** Time from this attempt's start to its response headers. */
  headersMs: number;
  /** When this attempt started, after the call began (shows retry backoff). */
  atMs: number;
  requestId: string | null;
  retryAfter?: string;
  /** anthropic-ratelimit-* headers, kept on non-200 responses. */
  rateLimit?: Record<string, string>;
  error?: string;
}

/** One model call, measured (lib/lesson/calllog.ts). */
export interface CallLog {
  name: string;
  model: string;
  maxRetries: number;
  /** Time to the first content token (streams only). */
  ttftMs: number | null;
  totalMs: number | null;
  retries: number;
  attempts: CallAttempt[];
  error: string | null;
}

/** NDJSON events from POST /api/plan. */
export type PlanEvent =
  | { type: "title"; title: string; tMs: number }
  | { type: "beat"; beat: PlannedBeat; tMs: number }
  | { type: "done"; tMs: number; inputTokens: number; outputTokens: number; call?: CallLog; notes?: string[] }
  | { type: "error"; message: string; tMs: number };
