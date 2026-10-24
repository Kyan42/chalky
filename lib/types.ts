// Shared shapes used by the web app, Convex functions and the builder worker.

/** Every chapter, detour and feedback animation is authored on this canvas. */
export const CANVAS = { width: 1920, height: 1080, fps: 30, ticksPerSecond: 240 } as const;

export type Beat = {
  /** What the tutor says, 1–3 sentences. */
  narration: string;
  /** What should be on screen while it is said. Free text for the animation builder. */
  visual: string;
};

export type QuestionSpec = {
  prompt: string;
  kind: "draw" | "explain" | "draw+explain";
  rubric: string;
  correctAnswer: string;
  commonMistake: string;
};

export type ChapterPlan = {
  title: string;
  objective: string;
  beats: Beat[];
  question: QuestionSpec;
};

export type ChapterStatus = "planned" | "queued" | "voicing" | "animating" | "ready" | "failed";

/** Word timings for one voiced beat, in seconds from the start of the animation. */
export type VoicedBeat = {
  index: number;
  narration: string;
  visual: string;
  audioUri: string;
  start: number;
  duration: number;
  words: { word: string; start: number; end: number }[];
};

export type Bounds = { x: number; y: number; width: number; height: number };

/** Written next to every animation document so the tutor knows what is on screen. */
export type Manifest = {
  beats: { index: number; startTick: number; endTick: number; narration: string }[];
  elements: {
    nodeId: string;
    label: string;
    concept: string;
    bounds: Bounds;
    firstTick: number;
    lastTick: number;
  }[];
  /** Where the end-of-chapter question card is fully on screen; the app pauses here. */
  questionTick?: number;
};

/** One ink stroke, in document coordinates (CANVAS space). Points are [x, y, pressure, msSinceStrokeStart]. */
export type StrokePoint = [number, number, number, number];

export type StrokeData = {
  points: StrokePoint[];
  color: string;
  size: number;
  /** Tick of the segment the stroke was drawn over. */
  tick: number;
  /** ms since the ink period started, for replay. */
  offsetMs: number;
};

export type SegmentKind = "chapter" | "feedback_correct" | "feedback_mistake" | "feedback_custom" | "detour";

export type JobKind = "chapter" | "chapter_feedback" | "feedback" | "detour" | "export";
