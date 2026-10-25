"use client";

/**
 * The lesson loop, voice first, and speech never waits for the board.
 *
 * Ask out loud (or type). Three things start at once: a one-line opener
 * (Haiku, spoken within a second or two), the planner (Opus, streaming beats),
 * and, as each beat lands, its drawing (Haiku, from the planner's layout alone,
 * so all beats draw in parallel). Beats are spoken as soon as their text
 * exists. The board is compiled here in the browser from each beat's
 * scene-language elements: a scene's earlier beats drawn still, the current
 * beat animating from its anchor word. A drawing that lands after its anchor
 * word starts the moment it arrives. Point beats need no model call: the
 * planner named the ids and the spoken words, and Sonic's word timestamps
 * place the highlights.
 *
 * Audio is the clock: each frame the board's Clayzo player is seeked to
 * (speech time − anchor word start).
 *
 * Talking back, using the listening half of Janani's voice loop (PR #2):
 * - at a check-in, answer out loud; "yes / keep going" carries on, anything
 *   else gets a spoken reply first;
 * - press Space (or "Ask") mid-beat to cut in: Chalky stops, listens, answers,
 *   then replays the beat it was on.
 * The mic is half-duplex: it isn't sent while Chalky is speaking.
 */
import { createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import { base, constant, easeAt, keyed, type AnimationDocument, type CubicBezier, type SceneNode } from "@clayzo/animation/authoring";
import { INK_COLORS, InkLayer, NO_ZOOM, snapshotBoard, type InkCamera } from "@/components/InkLayer";
import { readInk, type InkStroke } from "@/lib/lesson/ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChalkyCursor, { type CursorStep, type GridBox } from "@/components/ChalkyCursor";
import { Orb, type OrbState } from "@/components/Orb";
import { END, finishDocument, H, W } from "@/experiments/visual-flex/doc";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { mergeTimestamps, normalizeWord, resolveAt, wordAt, type WordTimestamps } from "@/lib/beat";
import type { ConverseEvent, ConverseTrailer, Exchange, SketchSide } from "@/lib/lesson/converse";
import { compilePresetBoard, type LayoutReport, type PresetElement } from "@/lib/lesson/presets";
import { NEW_LEARNER, type CallLog, type LearnerRecord, type PlanEvent, type PlannedBeat, type Region } from "@/lib/lesson/types";
import type { BeatAudioEvent } from "@/lib/sonic";
import { isGreetingOnly, isResume, isStillLost } from "@/lib/lesson/resume";
import { firstPerson } from "@/lib/lesson/voice";
import { holdAudio, unlockAudio } from "@/lib/voice/audio";
import { buildKeyterms, topicWords } from "@/lib/voice/keyterms";
import { useHybridMic } from "@/lib/voice/useHybridMic";

const TPS = 240;
const FRAME_TICKS = 4;
/** Documents are 20 s long (experiments/visual-flex/doc.ts), enough for any highlight in a beat. */
const DOC_END = 20 * TPS;
/** A breath between beats: the judges asked for a slower lesson. */
const GAP_SECONDS = 0.65;
/** Speakers ring on for a moment after the audio ends; keep the mic closed a little longer. */
const ECHO_TAIL_MS = 300;
const WORDS_PER_SECOND = 2.6;
const HIGHLIGHT_SECONDS = 1.8;
const GREETING = "Hey, I'm Chalky! What do you want to learn today?";
/** Statuses in which Chalky is busy talking or about to: the open mic is muted (hold Space to barge in). */
const MUTED: ReadonlySet<string> = new Set(["planning", "speaking", "replying"]);
/** Seconds of silence after the intake question before the lesson just goes on. */
const INTAKE_SILENCE_MS = 4000;
/** The hand arrives on an element this long before Chalky names it, as a teacher's hand leads the voice. */
const CURSOR_LEAD_S = 0.5;
const SEED_TERMS = buildKeyterms();
/**
 * Voice barge-in (experimental): talk over Chalky to interrupt. Off unless
 * NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN=1; in development, ?voice=1 or ?voice=0 overrides.
 * Without headphones the speakers can leak into the mic; Space always works.
 */
function voiceBargeInEnabled(): boolean {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    const v = new URLSearchParams(window.location.search).get("voice");
    if (v === "1") return true;
    if (v === "0") return false;
  }
  return process.env.NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN === "1";
}
/** Said the moment the intake answer lands, while the fast model decides (no silence while it thinks). */
const INTAKE_ACKS = ["Got it, give me a second.", "Okay, let me set that up.", "Great, one moment while I sketch this out."];
/** If nothing has been heard for this long while a beat is still being planned, say a short line. */
const FILLER_AFTER_MS = 8000;
const FILLERS = ["Almost there, I'm laying out the board.", "Still sketching this out, just a moment."];
/** A confirm that already looks ahead makes the bridge redundant. */
const LOOKS_AHEAD = /\b(now|next|let'?s|move on|moving on|back to|on to|onto|coming up)\b/i;
/** Answers to the intake question that mean "just start". */
const SKIP_INTAKE = /^[^a-z0-9]*(just (explain|teach|tell|show)( me)?( it| this)?|nothing( really)?|no|nope|not (much|really)|none|go ahead|skip( it)?|start|let'?s go|whatever|no idea)[^a-z0-9]*$/i;

type Status = "idle" | "planning" | "speaking" | "paused" | "waiting" | "listening" | "replying" | "done" | "stopped" | "error";

/** none: talk beat. local: a point beat built here from the planner's ids. pending/ready/failed: the drawer. */
type DrawState = "none" | "pending" | "ready" | "failed" | "local";

interface BeatState {
  beat: PlannedBeat;
  plannedAtMs: number;
  draw: DrawState;
  elements: PresetElement[] | null;
  drawMs?: number;
  model?: string;
  dropped?: number;
  /** The drawing's model calls, measured. */
  drawCalls?: CallLog[];
  error?: string | null;
  /** Seconds after its anchor word the drawing arrived; unset when it was in time. */
  lateSec?: number;
  /** Resolves when the drawing settles, with its elements or null. */
  ready: Promise<PresetElement[] | null>;
  /** Added while teaching (a detour or a new ending): the layout pass leaves it alone. */
  extra?: boolean;
  /** Sketches Chalky drew while answering a question at this beat; they stay on the board for the rest of the scene. */
  sketches?: PresetElement[];
  /** The elements those sketches introduced, for the board's names. */
  sketchAdds?: { id: string; what: string }[];
}

type Compile = (current: PresetElement[]) => AnimationDocument | null;

const fontLoader = (() => {
  let bytes: Promise<Uint8Array> | null = null;
  return { fontAssetLoader: () => (bytes ??= fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))) };
})();

async function* ndjson<T>(response: Response): AsyncGenerator<T> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  if (pending.trim()) yield JSON.parse(pending) as T;
}

/** A spoken line that isn't a lesson beat (the opener, a reply): it leaves the board alone. */
function line(say: string): BeatState {
  return {
    beat: { id: "line", say, at: "", visual: "", mode: "talk", check: false, scene: 0, region: { x: 0, y: 0, w: 100, h: 100 }, adds: [], points: [] },
    plannedAtMs: 0,
    draw: "none",
    elements: [],
    ready: Promise.resolve(null),
  };
}

const normWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of `word` in `say`, or -1. */
function wordIndex(say: string, word: string): number {
  return say.split(/\s+/).map(normWord).indexOf(normWord(word));
}

/**
 * The highlights of a point beat, each timed to its spoken word. `timing` gives
 * the seconds after the anchor word a word is spoken, or null to estimate it
 * from word positions (before Sonic's timestamps have arrived).
 */
function pointElements(beat: PlannedBeat, timing: (word: string) => number | null): PresetElement[] {
  const anchorIndex = Math.max(0, wordIndex(beat.say, beat.at));
  return beat.points.map((p) => {
    const exact = timing(p.word);
    const at = exact ?? (Math.max(0, wordIndex(beat.say, p.word)) - anchorIndex) / WORDS_PER_SECOND;
    return { id: `pt-${p.id}`, kind: "highlight", at: Math.max(0, at), dur: HIGHLIGHT_SECONDS, color: "yellow", args: [], text: "", refs: p.id };
  });
}

/**
 * The element groups of beat `i`'s scene: earlier beats as drawn, the sketches
 * answers added along the way (beat `i`'s own too, already drawn), then
 * `current` for beat `i` itself, which is the group that animates.
 */
function sceneGroups(list: BeatState[], i: number, current: PresetElement[]): PresetElement[][] {
  const scene = list[i].beat.scene;
  const groups: PresetElement[][] = [];
  for (let j = 0; j < i; j++) {
    const b = list[j];
    if (b.beat.scene !== scene) continue;
    if (b.beat.mode !== "talk") groups.push(b.elements ?? []);
    if (b.sketches?.length) groups.push(b.sketches);
  }
  if (list[i].sketches?.length) groups.push(list[i].sketches!);
  groups.push(current);
  return groups;
}

/** The names of everything a scene's beats and sketches introduced. */
const sceneAdds = (list: BeatState[], scene: number) =>
  list.filter((b) => b.beat.scene === scene).flatMap((b) => [...b.beat.adds, ...(b.sketchAdds ?? [])]);

/**
 * A free area of the board (100x100 grid) for an answer's sketch: the biggest
 * of a few sizes that touches nothing drawn, nearest to what is there so it
 * reads as part of the same picture. Null when nothing fits.
 */
function freeRegion(boxes: Record<string, GridBox>, view: Region = FULL_VIEW): Region | null {
  const taken = Object.values(boxes).filter((b) => b.w * b.h >= 0.3);
  const cx = taken.length ? taken.reduce((a, b) => a + b.x + b.w / 2, 0) / taken.length : 50;
  const cy = taken.length ? taken.reduce((a, b) => a + b.y + b.h / 2, 0) / taken.length : 50;
  const clear = (x: number, y: number, w: number, h: number) =>
    taken.every((b) => x + w + 3 <= b.x || b.x + b.w + 3 <= x || y + h + 3 <= b.y || b.y + b.h + 3 <= y);
  const k = view.w / 100;
  const step = 4 * k;
  for (const [sw, sh] of [[42, 42], [36, 40], [40, 32], [32, 32], [28, 30], [24, 24]]) {
    const w = sw * k, h = sh * k;
    let best: { r: Region; d: number } | null = null;
    for (let x = view.x + step; x + w <= view.x + view.w - step; x += step) {
      for (let y = view.y + 2 * step; y + h <= view.y + view.h - step; y += step) {
        if (!clear(x, y, w, h)) continue;
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        if (!best || d < best.d) best = { r: { x, y, w, h }, d };
      }
    }
    if (best) return best.r;
  }
  return null;
}

/** The whole board, on the 100x100 grid: a scene's view before any zooming out. */
const FULL_VIEW: Region = { x: 0, y: 0, w: 100, h: 100 };
/** How far one zoom-out grows the view, and the most it ever shows (2.4x the board). */
const ZOOM_STEP = 1.4;
const MAX_VIEW = 240;
const ZOOM_SECONDS = 0.9;
/** The zoom's easing: the board's camera and the learner's ink both follow it. */
const GLIDE: CubicBezier = { x1: 0.65, y1: 0, x2: 0.35, y2: 1 };

/** A view as the camera that shows it. */
const cameraFor = (v: Region): InkCamera => ({ cx: v.x + v.w / 2, cy: v.y + v.h / 2, s: 100 / v.w });
/** The camera `u` (0..1) of the way through a zoom from `a` to `b`, on the board's own curve. */
function cameraBetween(a: Region, b: Region, u: number): InkCamera {
  const e = easeAt(GLIDE, Math.max(0, Math.min(1, u)));
  const p = cameraFor(a), q = cameraFor(b);
  return { cx: p.cx + (q.cx - p.cx) * e, cy: p.cy + (q.cy - p.cy) * e, s: p.s + (q.s - p.s) * e };
}

/**
 * Compiles a scene. Its drawing lives in world space (the 100x100 grid, and
 * beyond it once the lesson has zoomed out); `camera.view` is the part of the
 * world the board shows. Zooming out from `camera.from` animates over the
 * document's first second, like an infinite canvas making room.
 */
function compileScene(groups: PresetElement[][], camera: { view: Region; from?: Region } = { view: FULL_VIEW }): { doc: AnimationDocument; report: LayoutReport } | null {
  if (!groups.some((g) => g.length)) return null;
  const { view, from } = camera;
  const stage = { x1: (view.x / 100) * W + 14, y1: (view.y / 100) * H + 14, x2: ((view.x + view.w) / 100) * W - 14, y2: ((view.y + view.h) / 100) * H - 14 };
  const { doc, report } = compilePresetBoard(groups, groups.length - 1, `board-${Date.now()}`, undefined, stage);
  if (report.dangling.length) console.info(`[board] dangling refs: ${report.dangling.join("; ")}`);
  const zoomed = view.w !== 100 || view.x !== 0 || view.y !== 0 || (from && (from.w !== view.w || from.x !== view.x || from.y !== view.y));
  return { doc: zoomed ? withCamera(doc, view, from) : doc, report };
}

/** Wraps a board's drawing (not its paper) in a camera group that shows `view`, gliding there from `from`. */
function withCamera(doc: AnimationDocument, view: Region, from?: Region): AnimationDocument {
  const comp = doc.compositions[doc.rootCompositionId];
  const content = comp.rootNodeIds.filter((id) => id !== "paper");
  // The view's centre goes to the board's centre, scaled so the view fills the board.
  const pose = (v: Region) => ({ anchor: { x: ((v.x + v.w / 2) / 100) * W, y: ((v.y + v.h / 2) / 100) * H, z: 0 }, scale: { x: 100 / v.w, y: 100 / v.h, z: 1 } });
  const to = pose(view);
  const start = from ? pose(from) : to;
  const glide = GLIDE;
  const t1 = Math.round(ZOOM_SECONDS * TPS / FRAME_TICKS) * FRAME_TICKS;
  const camera: SceneNode = {
    ...base("camera", {
      outTick: END,
      x: W / 2,
      y: H / 2,
      anchor: from ? keyed("camera.anchor", [[0, start.anchor, glide], [t1, to.anchor]]) : constant(to.anchor),
      scale: from ? keyed("camera.scale", [[0, start.scale, glide], [t1, to.scale]]) : constant(to.scale),
    }),
    type: "group",
    children: content,
  };
  return finishDocument(`${doc.id}-cam`, doc.name, { ...comp.nodes, camera }, ["paper", "camera"]);
}

/** A board box (world grid) as it appears on screen through `view`. */
function onScreen(b: GridBox, view: Region): GridBox {
  return { x: ((b.x - view.x) / view.w) * 100, y: ((b.y - view.y) / view.h) * 100, w: (b.w / view.w) * 100, h: (b.h / view.h) * 100 };
}
const screenBoxes = (boxes: Record<string, GridBox>, view: Region) =>
  view === FULL_VIEW ? boxes : Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, onScreen(b, view)]));

/**
 * The view zoomed out one step, growing to the right and down from where the
 * drawing is, like adding canvas beside your work: the drawing keeps its place
 * and one strip of free space opens wide enough for a sketch. Stays square on
 * the grid so nothing stretches. Null at the most it zooms out.
 */
function zoomOut(view: Region, boxes: Record<string, GridBox>): Region | null {
  const size = Math.min(MAX_VIEW, view.w * ZOOM_STEP);
  if (size <= view.w + 1) return null;
  const all = Object.values(boxes);
  const left = all.length ? Math.min(view.x, ...all.map((b) => b.x - 4)) : view.x;
  const top = all.length ? Math.min(view.y, ...all.map((b) => b.y - 4)) : view.y;
  return { x: left, y: top, w: size, h: size };
}

/** The smallest square view that still shows all of `view` and `region` (plus a margin), or null past MAX_VIEW. */
function viewFor(view: Region, region: Region): Region | null {
  const m = 4;
  const x0 = Math.min(view.x, region.x - m), y0 = Math.min(view.y, region.y - m);
  const x1 = Math.max(view.x + view.w, region.x + region.w + m), y1 = Math.max(view.y + view.h, region.y + region.h + m);
  const size = Math.max(x1 - x0, y1 - y0);
  if (size > MAX_VIEW) return null;
  if (size <= view.w && x0 >= view.x && y0 >= view.y) return view;
  return { x: x0 - (size - (x1 - x0)) / 2, y: y0 - (size - (y1 - y0)) / 2, w: size, h: size };
}

/**
 * Where an answer's sketch goes: on the side of `near` the reply asked for,
 * slid along that side (and then further out) until it touches nothing drawn,
 * zooming the view out to include it when it falls off the board. "on" marks
 * the element itself. Null when no such spot fits; the caller then takes any
 * free space.
 */
function placeSketch(boxes: Record<string, GridBox>, view: Region, near: string | null, side: SketchSide): { region: Region; view: Region } | null {
  const ref = near ? boxes[near] : undefined;
  if (!ref) return null;
  if (side === "on") {
    const region = { x: ref.x - 2, y: ref.y - 2, w: ref.w + 4, h: ref.h + 4 };
    const v = viewFor(view, region);
    return v ? { region, view: v } : null;
  }
  // About the size of what it sits next to, within limits, so it reads at the same scale.
  const w = Math.max(24, Math.min(40, ref.w * 0.9)), h = Math.max(22, Math.min(36, ref.h * 0.9));
  const gap = 4;
  const taken = Object.values(boxes).filter((b) => b.w * b.h >= 0.3);
  const clear = (r: Region) => taken.every((b) => r.x + r.w + 2 <= b.x || b.x + b.w + 2 <= r.x || r.y + r.h + 2 <= b.y || b.y + b.h + 2 <= r.y);
  const vertical = side === "above" || side === "below";
  for (let out = 0; out <= 3; out++) {
    for (const slide of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
      const push = out * (vertical ? h * 0.6 : w * 0.6);
      const r: Region =
        side === "above" ? { x: ref.x + ref.w / 2 - w / 2 + slide * w, y: ref.y - gap - h - push, w, h }
        : side === "below" ? { x: ref.x + ref.w / 2 - w / 2 + slide * w, y: ref.y + ref.h + gap + push, w, h }
        : side === "left" ? { x: ref.x - gap - w - push, y: ref.y + ref.h / 2 - h / 2 + slide * h, w, h }
        : { x: ref.x + ref.w + gap + push, y: ref.y + ref.h / 2 - h / 2 + slide * h, w, h };
      if (!clear(r)) continue;
      const v = viewFor(view, r);
      if (v) return { region: r, view: v };
    }
  }
  return null;
}

/** The board as the cursor and the conversation layer see it: element boxes on the 100x100 grid, and a named list. */
interface BoardView {
  /** Element boxes in world space (the grid the drawing is laid out on). */
  boxes: Record<string, GridBox>;
  list: { id: string; kind: string; label: string }[];
  /** The part of the world the board shows; FULL_VIEW until the scene zooms out. */
  view: Region;
}
const EMPTY_BOARD: BoardView = { boxes: {}, list: [], view: FULL_VIEW };

/** Turns the compiler's report (stage pixels) into grid boxes, and names every element once for /api/converse. */
function boardView(report: LayoutReport, elements: PresetElement[], adds: { id: string; what: string }[], view: Region = FULL_VIEW): BoardView {
  const boxes: Record<string, GridBox> = {};
  const list: BoardView["list"] = [];
  const grid = (b: { x1: number; y1: number; x2: number; y2: number }): GridBox => ({ x: (b.x1 / W) * 100, y: (b.y1 / H) * 100, w: ((b.x2 - b.x1) / W) * 100, h: ((b.y2 - b.y1) / H) * 100 });
  const byId = new Map(elements.map((e) => [e.id, e]));
  const what = new Map(adds.map((a) => [a.id, a.what]));
  // Block parts are registered twice ("cell.nucleus" and "cell-nucleus"); list the dotted one.
  const dashed = new Set(report.shapes.filter((x) => x.id.includes(".")).map((x) => x.id.replace(".", "-")));
  const labelOf = (id: string): string => {
    const e = byId.get(id);
    return (e?.text && e.kind !== "plot" ? e.text : "") || what.get(id) || e?.kind || id;
  };
  for (const shape of report.shapes) {
    const b = grid(shape.box);
    boxes[shape.id] = b;
    if (dashed.has(shape.id) || b.w * b.h < 0.3) continue; // anchors are points, not things to talk about
    const dot = shape.id.indexOf(".");
    if (dot > 0) list.push({ id: shape.id, kind: "part", label: `${shape.id.slice(dot + 1).replace(/[-_]/g, " ")} of ${labelOf(shape.id.slice(0, dot))}` });
    else list.push({ id: shape.id, kind: byId.get(shape.id)?.kind ?? "shape", label: labelOf(shape.id) });
  }
  for (const t of report.texts) {
    if (t.owner || boxes[t.id]) continue;
    boxes[t.id] = grid(t.box);
    list.push({ id: t.id, kind: "text", label: byId.get(t.id)?.text || t.id });
  }
  return { boxes, list, view };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a beat waits for its prefetched speech to finish downloading before it just streams. */
const HOLD_MAX_MS = 8000;

/**
 * A beat's speech fetched while the beat before it plays: every event is kept,
 * so the beat plays from memory and never streams while it plays. Tied to one
 * BeatState object, so a beat removed by a plan change can't be played from it.
 */
interface Prefetch {
  state: BeatState;
  events: BeatAudioEvent[];
  bytes: number;
  done: boolean;
  failed: boolean;
  abort: AbortController;
  settled: Promise<void>;
  wake: () => void;
}

function prefetchSpeech(state: BeatState, parent: AbortSignal): Prefetch {
  const abort = new AbortController();
  parent.addEventListener("abort", () => abort.abort(), { once: true });
  const p: Prefetch = { state, events: [], bytes: 0, done: false, failed: false, abort, settled: Promise.resolve(), wake: () => {} };
  p.settled = (async () => {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: firstPerson(state.beat.say).text }), signal: abort.signal });
    if (!r.ok || !r.body) throw new Error(`speech failed (${r.status})`);
    for await (const ev of ndjson<BeatAudioEvent>(r)) {
      p.events.push(ev);
      if (ev.type === "audio") p.bytes += ev.bytes;
      if (ev.type === "error") throw new Error(ev.message);
      p.wake();
    }
  })()
    .catch(() => {
      p.failed = true;
    })
    .finally(() => {
      p.done = true;
      p.wake();
    });
  return p;
}

/** Plays a prefetch's events back in order, waiting for any still arriving. */
async function* replayPrefetch(p: Prefetch): AsyncGenerator<BeatAudioEvent> {
  for (let k = 0; ; ) {
    while (k >= p.events.length && !p.done) await new Promise<void>((r) => (p.wake = r));
    if (k >= p.events.length) return;
    yield p.events[k++];
  }
}

/** Speech prefetch bookkeeping for the stats line. */
interface PrefetchStats {
  fetched: number;
  fetchedKB: number;
  fromMemory: number;
  dropped: number;
  wastedKB: number;
  heldMs: number;
}
const NO_PREFETCH: PrefetchStats = { fetched: 0, fetchedKB: 0, fromMemory: 0, dropped: 0, wastedKB: 0, heldMs: 0 };

export default function Lesson() {
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("Ask Chalky anything");
  const [status, setStatusRaw] = useState<Status>("idle");
  /**
   * Paused by the learner (a Space tap, or Pause): audio, board and cursor frozen at a point, mic open.
   * `prev` is the status to go back to; lesson loops wait on `waiters` before starting anything new.
   */
  const pausedRef = useRef<{ prev: Status; at: number; beatId: string; wordIndex: number } | null>(null);
  const unpauseWaiters = useRef<(() => void)[]>([]);
  /** While paused, talking statuses are remembered for the resume instead of shown. */
  const setStatus = useCallback((next: Status | ((s: Status) => Status)) => {
    const p = pausedRef.current;
    if (p && typeof next === "string" && (next === "speaking" || next === "replying" || next === "planning")) {
      p.prev = next;
      return;
    }
    setStatusRaw(next);
  }, []);
  const [beats, setBeats] = useState<BeatState[]>([]);
  const [current, setCurrent] = useState(-1);
  const [words, setWords] = useState<string[]>([]);
  const [wordIndexNow, setWordIndexNow] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [firstSoundMs, setFirstSoundMs] = useState<number | null>(null);
  const [lessonSoundMs, setLessonSoundMs] = useState<number | null>(null);
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const [lastReplyMs, setLastReplyMs] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardView>(EMPTY_BOARD);
  const boardRef = useRef<BoardView>(EMPTY_BOARD);
  /** The board's camera as the ink reads it; follows the view, and animates with it during a zoom. */
  const cameraRef = useRef<InkCamera>(NO_ZOOM);
  const zoomingRef = useRef(false);
  const readCamera = useCallback(() => cameraRef.current, []);
  const showBoard = useCallback((view: BoardView) => {
    boardRef.current = view;
    setBoard(view);
    if (!zoomingRef.current) cameraRef.current = cameraFor(view.view);
  }, []);
  /** The learner's pen strokes on the board; cleared when the lesson moves on from their turn. */
  const [ink, setInk] = useState<InkStroke[]>([]);
  const inkRef = useRef<InkStroke[]>([]);
  const showInk = useCallback((strokes: InkStroke[]) => {
    inkRef.current = strokes;
    setInk(strokes);
  }, []);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [cursorScript, setCursorScript] = useState<CursorStep[]>([]);
  /** The cursor's clock: whatever audio is playing now; frozen when the learner pauses Chalky. */
  const cursorClockRef = useRef<() => number>(() => 0);
  const cursorClock = useCallback(() => cursorClockRef.current(), []);
  const [pausedAt, setPausedAt] = useState<{ beatId: string; wordIndex: number } | null>(null);
  const [lastLevel, setLastLevel] = useState<string | null>(null);
  const [learnerView, setLearnerView] = useState<LearnerRecord | null>(null);
  const [intakeView, setIntakeView] = useState<string | null>(null);
  const [prefetchStats, setPrefetchStats] = useState<PrefetchStats>(NO_PREFETCH);
  /** Drops every prefetched beat's speech (an interrupt or a plan change); set by the running lesson. */
  const dropPrefetchRef = useRef<(why: string) => void>(() => {});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const playerGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const beatAbortRef = useRef<AbortController | null>(null);
  /** The reply being spoken (or fetched); a barge-in or a new utterance cancels it. */
  const replyAbortRef = useRef<AbortController | null>(null);
  /** What the learner said while Chalky was busy; the lesson takes it at its next turn. */
  const queueRef = useRef<string[]>([]);
  const interruptedRef = useRef(false);
  const audioRef = useRef<StreamPlayer | null>(null);
  const speakingRef = useRef(false);
  /** Chalky's voice is playing (or just stopped: the echo tail). Mirrors speakingRef for the mic. */
  const [speakingAudio, setSpeakingAudio] = useState(false);
  const setSpeaking = useCallback((on: boolean) => {
    // Paused: the mic stays open; resume() turns speaking back on.
    if (on && pausedRef.current) return;
    speakingRef.current = on;
    setSpeakingAudio(on);
  }, []);
  /** The word of the current beat being spoken; read when the learner pauses Chalky. */
  const wordIndexRef = useRef(-1);
  /** When Chalky last finished saying something (for the planning filler). */
  const lastSpokeRef = useRef(0);
  /** Where Chalky stopped when the learner cut in: the beat to replay and the word reached. */
  const resumeRef = useRef<{ beatId: string; wordIndex: number } | null>(null);
  /** Set while the lesson waits for the learner; resolves with what they said (null = just carry on). */
  const turnRef = useRef<((text: string | null) => void) | null>(null);
  const statusRef = useRef<Status>("idle");
  const currentBeatIdRef = useRef("");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const askRef = useRef<(q: string) => void>(() => {});
  /** Words Ink is hearing right now, and text being typed: the intake's silence timer waits while either is there. */
  const partialRef = useRef("");
  const draftRef = useRef("");
  const pauseRef = useRef<() => void>(() => {});
  const cutInRef = useRef<() => void>(() => {});
  /** The learner's latest words to the conversation layer, and when (for merging a quick second utterance). */
  const lastLearnerRef = useRef<{ text: string; at: number } | null>(null);
  /** Applies the merge rule; returns true when it handled the utterance. */
  const mergeRef = useRef<(said: string) => boolean>(() => false);
  /** How the learner's latest words arrived, for the transcript. */
  const inputViaRef = useRef<"voice" | "typed" | "button">("typed");
  /** Adds an event to the running lesson's transcript; set by the running lesson. */
  const logRef = useRef<(e: Record<string, unknown>) => void>(() => {});
  /** Sends the running lesson's transcript now; set by the running lesson. */
  const flushLogRef = useRef<() => void>(() => {});
  // Closing or hiding the tab still saves the transcript (keepalive outlives the page).
  useEffect(() => {
    const save = () => flushLogRef.current();
    window.addEventListener("pagehide", save);
    const onHidden = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
  /** A lesson is running and Chalky has the floor (planning, speaking or replying). */
  const lessonBusyRef = useRef<() => boolean>(() => false);
  const [heardNote, setHeardNote] = useState<string | null>(null);
  // Read after mount so the server render and the first client render agree.
  const [voiceBargeIn, setVoiceBargeIn] = useState(false);
  useEffect(() => setVoiceBargeIn(voiceBargeInEnabled()), []);
  /**
   * The learner pressed Stop: Chalky freezes mid-word (voice, board and cursor
   * all run on the audio clock, which is suspended), the mic is off, and
   * nothing they say, type or draw is taken until they press Start, which
   * carries on from that exact word.
   */
  const [halted, setHalted] = useState(false);
  const haltedRef = useRef(false);
  const haltWaitersRef = useRef<(() => void)[]>([]);
  /** Resolves at once, or when Start is pressed (or the lesson ends) if Chalky is stopped. */
  const haltGate = useCallback(
    (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (!haltedRef.current || signal.aborted) return resolve();
        haltWaitersRef.current.push(resolve);
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    [],
  );
  const setHaltedNow = useCallback((on: boolean) => {
    haltedRef.current = on;
    setHalted(on);
    if (!on) {
      const waiters = haltWaitersRef.current;
      haltWaitersRef.current = [];
      for (const wake of waiters) wake();
    }
  }, []);
  const voice = useHybridMic({
    voiceBargeIn,
    onVoiceBargeIn: (partial) => logRef.current({ kind: "voice-barge", partial, status: statusRef.current }),
    onVoiceIgnored: (text) => logRef.current({ kind: "voice-ignored", text }),
    // Before any topic is known: Chalky's name and common science and learning words (Ink takes at most 100).
    keyterms: SEED_TERMS,
    speaking: MUTED.has(status) || speakingAudio,
    // Chalky asked something (intake, check-in, a reply's check): a pause mid-answer must not end the turn.
    patient: status === "waiting",
    paused: halted,
    // Space down while Chalky talks: stop now, keep the resume point, then listen.
    onBargeIn: () => pauseRef.current(),
    onUtterance: (text) => {
      const said = text.trim();
      if (!said || haltedRef.current) return;
      inputViaRef.current = "voice";
      if (mergeRef.current(said)) return;
      if (turnRef.current) turnRef.current(said);
      else if (pausedRef.current) {
        // Talking while paused: that's a cut-in, about this spot.
        queueRef.current.push(said);
        cutInRef.current();
      } else if (lessonBusyRef.current()) {
        queueRef.current.push(said);
        pauseRef.current();
      } else if (["idle", "done", "stopped", "error"].includes(statusRef.current)) {
        // "Hey Chalky." on its own is not a question; wait for the rest.
        if (isGreetingOnly(said)) {
          setHeardNote(`Heard “${said}”. Go ahead, what do you want to learn?`);
          return;
        }
        setHeardNote(null);
        askRef.current(said);
      }
    },
    // A press with no words leaves Chalky paused in "Your turn": say or type something, or Continue.
    onBargeInCancelled: () => {},
  });

  partialRef.current = voice.partial;
  draftRef.current = draft;

  const stop = useCallback(() => {
    pausedRef.current = null;
    unpauseWaiters.current.splice(0).forEach((r) => r());
    setHaltedNow(false);
    void holdAudio(false);
    queueRef.current = [];
    replyAbortRef.current?.abort();
    abortRef.current?.abort();
    beatAbortRef.current?.abort();
    audioRef.current?.stop();
    playerRef.current?.pause();
    turnRef.current?.(null);
  }, [setHaltedNow]);

  useEffect(() => () => {
    stop();
    playerRef.current?.dispose();
  }, [stop]);

  /** Resolves once the learner resumes (or the lesson is stopped). */
  const waitWhilePaused = useCallback(async (signal?: AbortSignal) => {
    while (pausedRef.current && !signal?.aborted) {
      await new Promise<void>((r) => {
        unpauseWaiters.current.push(r);
        signal?.addEventListener("abort", () => r(), { once: true });
      });
    }
  }, []);

  /** Replaces the board's player with one for `doc` (or clears it). A newer call wins over an older one still creating. */
  const showDocument = useCallback(async (doc: AnimationDocument | null | undefined) => {
    const gen = ++playerGen.current;
    playerRef.current?.dispose();
    playerRef.current = null;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    const player = await createPlayer({
      canvas, document: doc as never, loaders: fontLoader,
      pauseWhenOffscreen: false, stateMachine: false,
      onError: (e) => console.warn("[clayzo]", e.message),
    });
    if (gen !== playerGen.current) {
      player.dispose();
      return;
    }
    player.pause();
    await player.seek(0);
    playerRef.current = player;
  }, []);

  /**
   * Speaks one beat and drives its board from the audio clock. `compile` builds
   * the scene's document around this beat's elements (null: leave the board).
   * Resolves when the speech has played.
   */
  const playBeat = useCallback(async (state: BeatState, signal: AbortSignal, compile: Compile | null, onFirstSound?: () => void, speech?: { prefetch?: Prefetch | null; onStreamed?: () => void; onHeld?: (ms: number, fromMemory: boolean) => void; onSpeechDone?: (sonic: { firstAudioMs: number | null; totalMs: number; kb: number; audioSeconds: number }) => void }) => {
    const ctx = await unlockAudio();
    // The safety net: Chalky never speaks of itself in the third person ("Chalky's board" -> "my board").
    const voiced = firstPerson(state.beat.say);
    if (voiced.rewrites.length) logRef.current({ kind: "self-name-rewrite", role: state.beat.id === "line" ? "line" : "beat", beatId: state.beat.id, from: state.beat.say, to: voiced.text, rewrites: voiced.rewrites });
    const spokenText = voiced.text;
    setWords(spokenText.split(/\s+/));
    setWordIndexNow(-1);
    wordIndexRef.current = -1;
    setSpeaking(true);
    setCursorScript([]);
    let audio: StreamPlayer | null = null;
    let timestamps: WordTimestamps = { words: [], start: [], end: [] };
    let anchorStart: number | null = null;
    let streamDone = false;
    let playing = true;
    let seeking = false;
    let lastTick = -1;
    let raf = 0;

    const show = async (currentElements: PresetElement[]) => {
      if (!compile) return;
      lastTick = -1;
      try {
        await showDocument(compile(currentElements));
      } catch (e) {
        // The player refused the document: keep speaking with the board as it was.
        console.warn("[board] player", e);
        logRef.current({ kind: "board-error", beatId: state.beat.id, error: String((e as Error).message ?? e).slice(0, 200), stage: "player" });
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!audio) return;
      const t = audio.position();
      if (t < 0) return;
      const w = wordAt(t, timestamps);
      wordIndexRef.current = w;
      setWordIndexNow(w);
      const player = playerRef.current;
      if (compile && player && anchorStart !== null && !seeking) {
        const tick = Math.max(0, Math.min(DOC_END - FRAME_TICKS, Math.round(((t - anchorStart) * TPS) / FRAME_TICKS) * FRAME_TICKS));
        if (tick !== lastTick) {
          seeking = true;
          lastTick = tick;
          player.seek(tick).finally(() => (seeking = false));
        }
      }
    };

    cursorClockRef.current = () => Math.max(0, audio?.position() ?? 0);
    // A point beat points with the cursor at what is on the board; a target the board lacks keeps the yellow highlight.
    let cursorPoints: PlannedBeat["points"] = [];
    let highlightBeat = state.beat;
    try {
      // The board as it can be shown right now; a drawing still in flight binds when it lands.
      let initial: PresetElement[] = [];
      if (compile && state.draw === "local") {
        compile([]); // learns this scene's element boxes
        const boxes = boardRef.current.boxes;
        cursorPoints = state.beat.points.filter((p) => boxes[p.id]);
        highlightBeat = { ...state.beat, points: state.beat.points.filter((p) => !boxes[p.id]) };
        initial = pointElements(highlightBeat, () => null);
      } else if (compile && state.elements) initial = state.elements;
      // Speech: from memory when the beat before fetched it (waiting for the download to finish, so it
      // never streams while it plays), else streamed as it arrives (the first beat, replies, a miss).
      const pre = speech?.prefetch && speech.prefetch.state === state && !speech.prefetch.failed ? speech.prefetch : null;
      const openStream = async (): Promise<AsyncGenerator<BeatAudioEvent>> => {
        if (pre) {
          const t = performance.now();
          if (!pre.done) await Promise.race([pre.settled, sleep(HOLD_MAX_MS), new Promise((r) => signal.addEventListener("abort", r, { once: true }))]);
          speech?.onHeld?.(Math.round(performance.now() - t), pre.done && !pre.failed);
          if (!pre.failed) return replayPrefetch(pre);
        }
        const response = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spokenText }), signal });
        if (!response.ok || !response.body) throw new Error(`speech failed (${response.status})`);
        return ndjson<BeatAudioEvent>(response);
      };
      const [events] = await Promise.all([openStream(), compile ? show(initial) : Promise.resolve()]);
      if (compile && state.draw === "pending") {
        void state.ready.then((elements) => {
          if (!playing || signal.aborted || !elements?.length) return;
          // The drawing landed after its anchor word: start it now instead.
          const now = audio?.position() ?? -1;
          if (anchorStart !== null && now > anchorStart) {
            state.lateSec = +(now - anchorStart).toFixed(1);
            anchorStart = now;
          }
          void show(elements);
        });
      }
      raf = requestAnimationFrame(frame);
      for await (const event of events) {
        if (signal.aborted) break;
        if (event.type === "start") {
          audio = new StreamPlayer(ctx, event.sampleRate, event.encoding);
          if (pausedRef.current) audio.pause();
          audioRef.current = audio;
        } else if (event.type === "audio" && audio) {
          audio.append(event.data);
          onFirstSound?.();
        } else if (event.type === "timestamps") {
          timestamps = mergeTimestamps(timestamps, event);
          setWords(timestamps.words);
          if (anchorStart === null && state.beat.at) {
            const i = resolveAt(state.beat.at, timestamps);
            if (i >= 0) anchorStart = timestamps.start[i];
          }
          if (cursorPoints.length) {
            const ts = timestamps;
            setCursorScript(cursorPoints.flatMap((p) => {
              const k = resolveAt(p.word, ts);
              return k >= 0 ? [{ t: Math.max(0, ts.start[k] - CURSOR_LEAD_S), target: p.id, gesture: "circle" as const }] : [];
            }));
          }
        } else if (event.type === "done") {
          streamDone = true;
          speech?.onSpeechDone?.({ firstAudioMs: event.stats.firstAudioMs, totalMs: event.tMs, kb: Math.round(event.stats.bytes / 1024), audioSeconds: +event.stats.audioSeconds.toFixed(2) });
          // This beat's speech is all here: the next beat's can download now without competing with it.
          speech?.onStreamed?.();
          // Every word is timed now: place a point beat's highlights exactly.
          if (compile && state.draw === "local" && anchorStart !== null && highlightBeat.points.length) {
            const base = anchorStart;
            const exact = pointElements(highlightBeat, (word) => {
              const i = resolveAt(word, timestamps);
              return i >= 0 ? timestamps.start[i] - base : null;
            });
            const initialAts = pointElements(highlightBeat, () => null).map((e) => e.at);
            if (exact.some((e, k) => Math.abs(e.at - initialAts[k]) > 0.25)) void show(exact);
          }
        } else if (event.type === "error") throw new Error(`Sonic: ${event.message}`);
      }
      // If the anchor word never showed up, the visual's clock starts with the speech.
      if (anchorStart === null) anchorStart = 0;
      while (!signal.aborted && streamDone && audio && !audio.drained) await new Promise((r) => setTimeout(r, 30));
      if (!signal.aborted) {
        setWordIndexNow(timestamps.words.length);
        await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
        await waitWhilePaused(signal);
      }
    } finally {
      lastSpokeRef.current = performance.now();
      playing = false;
      cancelAnimationFrame(raf);
      if (signal.aborted) audio?.stop();
      setTimeout(() => {
        // Another line may have started meanwhile; only the last one to finish clears the flag.
        if (audioRef.current === audio || audio === null) setSpeaking(false);
      }, ECHO_TAIL_MS);
    }
  }, [showDocument, setSpeaking, waitWhilePaused]);

  /** Waits for the learner: a spoken turn, a typed reply, or Continue (null). */
  const awaitTurn = useCallback((signal: AbortSignal) => {
    const queued = queueRef.current.shift();
    if (queued !== undefined) return Promise.resolve<string | null>(queued);
    return new Promise<string | null>((resolve) => {
      const done = (text: string | null) => {
        turnRef.current = null;
        resolve(text);
      };
      turnRef.current = done;
      signal.addEventListener("abort", () => done(null), { once: true });
    });
  }, []);

  const ask = useCallback(async (q: string) => {
    q = q.trim();
    if (!q) return;
    stop();
    const abort = new AbortController();
    abortRef.current = abort;
    await unlockAudio(); // inside the click or right after a spoken turn, so autoplay allows it
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    setHeardNote(null);
    // The question's own words help Ink hear the intake answer (applied between turns, never mid-speech).
    voice.setKeyterms(buildKeyterms(topicWords(q)));
    // The planning filler counts silence from the question, not from page load.
    lastSpokeRef.current = performance.now();
    let heard = false;
    const onFirstSound = () => {
      if (heard) return;
      heard = true;
      setFirstSoundMs(since());
    };
    let lessonHeard = false;
    const onLessonSound = () => {
      onFirstSound();
      if (lessonHeard) return;
      lessonHeard = true;
      setLessonSoundMs(since());
    };
    const said: string[] = [];

    setQuestion(q);
    setDraft("");
    setError(null);
    setBeats([]);
    setCurrent(-1);
    setWords([]);
    setFirstSoundMs(null);
    setLessonSoundMs(null);
    setLayoutMs(null);
    setLastReplyMs(null);
    setLastLevel(null);
    setPausedAt(null);
    showBoard(EMPTY_BOARD);
    setCursorScript([]);
    queueRef.current = [];
    setTitle("Planning…");
    setStatus("planning");
    await showDocument(undefined);

    const post = (path: string, body: unknown, signal: AbortSignal = abort.signal) =>
      fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    // Development: /lesson?fixture=<slug>&beats=<n> plays a saved plan instead of calling the planner.
    const params = new URLSearchParams(window.location.search);
    const fixture = process.env.NODE_ENV !== "production" ? params.get("fixture") : null;

    // The intake: one short question to the learner, asked while the planner writes the speculative plan.
    // ?intake=0 turns it off (development).
    const intakeAsk =
      params.get("intake") === "0"
        ? Promise.resolve(null)
        : post("/api/converse", { intent: "intake_ask", question: q })
            .then((r) => r.json())
            .then((r: { say?: string; kind?: string; ms?: number; model?: string; call?: CallLog }) => (typeof r.say === "string" && r.say ? r : null))
            .catch(() => null);
    /** What the lesson knows about the learner; goes to every reply and plan change. */
    const learner: LearnerRecord = { ...NEW_LEARNER, confusions: [], replies: [] };
    const noteLearner = () => setLearnerView({ ...learner, confusions: [...learner.confusions], replies: [...learner.replies] });
    noteLearner();
    setIntakeView(null);
    // ---------- The lesson's transcript, for reviewing live runs: experiments/live-runs/<id>.json ----------
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lesson";
    const transcript = {
      id: `${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}-${slug}`,
      question: q,
      askedVia: inputViaRef.current,
      startedAt: new Date().toISOString(),
      fixture,
      title: "",
      /** Everything said, typed and decided, in order; t is ms since the question. */
      events: [] as Record<string, unknown>[],
      /** One entry per beat played (a replay is a second entry). */
      beats: [] as Record<string, unknown>[],
      learner: null as LearnerRecord | null,
      prefetch: null as PrefetchStats | null,
      endedAt: null as string | null,
      end: null as string | null,
    };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushLog = (closing = false) => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      const body = JSON.stringify(transcript);
      // The tab is going away: a beacon outlives the page (browsers cap it at about 64 KB; a longer
      // transcript keeps what the last regular save sent, at most 2 s old).
      if (closing && body.length < 60_000 && navigator.sendBeacon?.("/api/live-log", new Blob([body], { type: "application/json" }))) return;
      // Not the lesson's abort signal, so the final save survives Stop.
      void fetch("/api/live-log", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    };
    const logEv = (e: Record<string, unknown>) => {
      transcript.events.push({ t: since(), ...e });
      flushTimer ??= setTimeout(flushLog, 2000);
    };
    logRef.current = logEv;
    flushLogRef.current = () => {
      transcript.learner = learner;
      transcript.prefetch = { ...stats };
      flushLog(true);
    };
    logEv({ kind: "learner", via: transcript.askedVia, role: "question", text: q });

    // One beat of speech ahead: fetched while the beat before plays, dropped on any change of course.
    const prefetches = new Map<BeatState, Prefetch>();
    const stats: PrefetchStats = { ...NO_PREFETCH };
    setPrefetchStats({ ...stats });
    const kb = (bytes: number) => Math.round(bytes / 1024);
    const dropPrefetches = (why: string) => {
      for (const p of prefetches.values()) {
        p.abort.abort();
        stats.dropped++;
        stats.wastedKB += kb(p.bytes);
        console.info(`[prefetch] dropped ${p.state.beat.id} (${kb(p.bytes)} KB): ${why}`);
        logEv({ kind: "prefetch-dropped", beatId: p.state.beat.id, kb: kb(p.bytes), why });
      }
      prefetches.clear();
      setPrefetchStats({ ...stats });
    };
    dropPrefetchRef.current = dropPrefetches;
    const prefetchNext = (i: number) => {
      const next = list[i + 1];
      if (!next || prefetches.has(next) || abort.signal.aborted) return;
      const p = prefetchSpeech(next, abort.signal);
      prefetches.set(next, p);
      stats.fetched++;
      void p.settled.then(() => {
        stats.fetchedKB += kb(p.bytes);
        setPrefetchStats({ ...stats });
      });
    };

    /** Beats after the first wait for the intake's decision, so a speculative beat 2 never plays before an amended one. */
    let intakeGate: Promise<void> = Promise.resolve();

    const list: BeatState[] = [];
    let planDone = false;
    /** Plan operations still streaming beats in (a new ending). */
    let amending = 0;
    /** The rest of the lesson was replaced: beats the first plan still sends are dropped. */
    let planReplaced = false;
    const planOpen = () => !planDone || amending > 0;
    let notify: () => void = () => {};
    const changed = () => new Promise<void>((r) => (notify = r));
    let firstBeat: () => void = () => {};
    const firstBeatPlanned = new Promise<void>((r) => (firstBeat = r));

    // Visual beats (draw or point) in order. The first two draw straight away from the
    // planner's own layout; the rest wait for the layout pass, which re-places them once
    // the whole plan is in, hidden behind the first beats' speech.
    const visualBeats: BeatState[] = [];
    let resolveLayout: () => void = () => {};
    const layout = new Promise<void>((r) => (resolveLayout = r));
    const SHAPES = new Set(["circle", "box", "flow", "cycle", "plot", "bar", "equation", "text", "move", "line", "arrow"]);
    /** The ids a drawn beat actually put on the board (what later beats can refer to). */
    const drawnIds = (s: BeatState) => (s.elements ?? []).filter((e) => SHAPES.has(e.kind)).map((e) => e.id);

    /** Draws a beat from its (current) layout, or marks it local when the planner's points suffice. */
    const startDraw = (state: BeatState, earlierOverride?: PlannedBeat[], signal: AbortSignal = abort.signal): Promise<PresetElement[] | null> => {
      const beat = state.beat;
      if (beat.mode === "point" && beat.points.length) {
        state.draw = "local";
        state.elements = [];
        setBeats([...list]);
        return Promise.resolve(null);
      }
      state.draw = "pending";
      state.elements = null;
      const index = list.indexOf(state);
      const earlier = earlierOverride ?? list.filter((b, i) => i < index && b.beat.scene === beat.scene && b.beat.mode === "draw").map((b) => b.beat);
      return post("/api/draw", { question: q, beat, earlier }, signal)
        .then((r) => r.json())
        .then((r: { elements?: PresetElement[]; ms?: number; model?: string; dropped?: number; error?: string | null; calls?: CallLog[] }) => {
          state.drawCalls = r.calls;
          state.elements = r.elements ?? [];
          state.draw = state.elements.length ? "ready" : "failed";
          state.drawMs = r.ms;
          state.model = r.model;
          state.dropped = r.dropped;
          state.error = r.error ?? null;
          return state.elements.length ? state.elements : null;
        })
        .catch((e: Error) => {
          state.elements = [];
          state.draw = "failed";
          state.error = signal.aborted ? "stopped" : String(e.message ?? e);
          return null;
        })
        .finally(() => setBeats([...list]));
    };

    /** Applies the layout pass to the beats not drawn yet; talk beats follow the scene before them. */
    const applyLayout = (laid: { id: string; scene: number; region: PlannedBeat["region"]; adds: PlannedBeat["adds"]; points: PlannedBeat["points"] }[]) => {
      let scene = 1;
      for (const s of list) {
        if (s.extra) continue;
        const l = laid.find((x) => x.id === s.beat.id);
        if (s.beat.mode === "talk" || !l) {
          s.beat.scene = scene;
          continue;
        }
        if (visualBeats.indexOf(s) >= 2) {
          s.beat.scene = l.scene;
          s.beat.region = l.region;
          s.beat.adds = l.adds;
          s.beat.points = l.points;
        } else {
          // Drawn already: later beats refer to what is really on the board.
          const ids = drawnIds(s);
          if (ids.length) s.beat.adds = ids.map((id) => ({ id, what: s.beat.adds.find((a) => a.id === id)?.what ?? "" }));
        }
        scene = s.beat.scene;
      }
      setBeats([...list]);
    };

    const planning = (async () => {
      const res = fixture ? await fetch(`/api/fixture?name=${encodeURIComponent(fixture)}&beats=${params.get("beats") ?? ""}&delay=${params.get("delay") ?? ""}`, { signal: abort.signal }) : await post("/api/plan", { question: q });
      if (!res.ok || !res.body) throw new Error(`planning failed (${res.status})`);
      for await (const event of ndjson<PlanEvent>(res)) {
        if (event.type === "title") {
          setTitle(event.title);
          transcript.title = event.title;
          logEv({ kind: "plan-title", title: event.title });
          voice.setKeyterms(buildKeyterms(topicWords(q, event.title)));
        } else if (event.type === "error") throw new Error(`planner: ${event.message}`);
        else if (event.type === "done") logEv({ kind: "plan-done", inputTokens: event.inputTokens, outputTokens: event.outputTokens, call: event.call ?? null });
        else if (event.type === "beat") {
          if (planReplaced) continue;
          const beat = event.beat;
          const state: BeatState = { beat, plannedAtMs: since(), draw: "none", elements: [], ready: Promise.resolve(null) };
          logEv({ kind: "planned", beatId: beat.id, mode: beat.mode, scene: beat.scene, check: beat.check, section: beat.section, bridge: beat.bridge, say: beat.say });
          list.push(state);
          if (beat.mode !== "talk") {
            visualBeats.push(state);
            if (visualBeats.length <= 2) state.ready = startDraw(state);
            else {
              state.draw = "pending";
              state.elements = null;
              state.ready = layout.then(() => startDraw(state));
            }
          }
          setBeats([...list]);
          if (list.length === 1) firstBeat();
          notify();
        }
      }
      // The whole plan is in: lay the rest of the board out around the first drawings.
      if (visualBeats.length > 2 && !fixture && !planReplaced) {
        await Promise.all(visualBeats.slice(0, 2).map((s) => s.ready));
        const fixed = visualBeats.slice(0, 2).map((s) => ({ id: s.beat.id, region: s.beat.region, ids: drawnIds(s).length ? drawnIds(s) : s.beat.adds.map((a) => a.id) }));
        const t1 = performance.now();
        const r = await post("/api/layout", { question: q, beats: list.map((s) => s.beat), fixed })
          .then((x) => x.json())
          .catch(() => null);
        logEv({ kind: "layout", ms: Math.round(performance.now() - t1), ok: !!r?.beats, error: r?.error ?? null, call: r?.call ?? null });
        if (r?.beats) applyLayout(r.beats);
        setLayoutMs(r?.beats ? Math.round(performance.now() - t1) : null);
      }
    })().finally(() => {
      planDone = true;
      resolveLayout();
      firstBeat();
      notify();
    });
    planning.catch((e) => {
      if (!abort.signal.aborted) {
        setError(String(e.message ?? e));
        setStatus("error");
      }
    });

    // ---------- The conversation layer ----------
    /** Escalation reached for the current confusion: 0 none, 1 a brief answer, 2 a detour. Kept across the detour's beats. */
    let escalation: 0 | 1 | 2 = 0;
    /** Answers that drew a sketch so far, for unique beat ids. */
    let sketchCount = 0;
    /** Each scene's view of the board: the whole board, until answers needed room and it zoomed out. */
    const views = new Map<number, Region>();
    const viewOf = (scene: number) => views.get(scene) ?? FULL_VIEW;
    const history: Exchange[] = [];
    let amendCount = 0;
    /** A detour planned (and drawn) in the background after a brief answer, in case the learner is still lost. */
    let draft: { at: number; abort: AbortController; beats: Promise<BeatState[]> } | null = null;
    const dropDraft = () => {
      draft?.abort.abort();
      draft = null;
    };

    /** Plans a 2-4 beat detour to play at list position `at`, and starts drawing it; nothing is inserted yet. */
    const planDetour = (at: number, note: string, heardText: string, said?: string) => {
      const ctl = new AbortController();
      abort.signal.addEventListener("abort", () => ctl.abort(), { once: true });
      const prefix = `d${++amendCount}`;
      const beats = (async () => {
        const res = await post("/api/amend", { question: q, beats: list.map((s) => s.beat), op: "insert_after", index: at - 1, note, heard: heardText, said, prefix, learner }, ctl.signal);
        if (!res.ok || !res.body) throw new Error(`detour failed (${res.status})`);
        const out: BeatState[] = [];
        for await (const ev of ndjson<PlanEvent>(res)) {
          if (ev.type === "error") throw new Error(ev.message);
          if (ev.type === "done") logEv({ kind: "amend-done", prefix, call: ev.call ?? null });
          if (ev.type !== "beat") continue;
          const state: BeatState = { beat: ev.beat, plannedAtMs: since(), draw: "none", elements: [], ready: Promise.resolve(null), extra: true };
          const earlier = out.filter((b) => b.beat.scene === ev.beat.scene && b.beat.mode === "draw").map((b) => b.beat);
          out.push(state);
          if (ev.beat.mode !== "talk") state.ready = startDraw(state, earlier, ctl.signal);
        }
        return out;
      })();
      beats.catch((e) => console.warn("[detour]", e));
      return { at, abort: ctl, beats };
    };

    /** Replaces the lesson from list position `from` with a new ending, streamed in as it is planned. */
    const replan = (from: number, note: string, heardText: string, intake = false, said?: string) => {
      dropDraft();
      dropPrefetches(intake ? "the intake rewrote the plan" : "replan");
      logEv({ kind: "replan", from, fromBeat: list[from]?.beat.id ?? null, intake, note });
      const before = list.map((s) => s.beat);
      planReplaced = true;
      list.splice(from);
      setBeats([...list]);
      amending++;
      const prefix = `r${++amendCount}`;
      void (async () => {
        const res = await post("/api/amend", { question: q, beats: before, op: "replace_from", index: from, note, heard: heardText, said, prefix, intake, learner });
        if (!res.ok || !res.body) throw new Error(`replan failed (${res.status})`);
        for await (const ev of ndjson<PlanEvent>(res)) {
          if (ev.type === "error") throw new Error(ev.message);
          if (ev.type === "done") logEv({ kind: "amend-done", prefix, call: ev.call ?? null });
          if (ev.type !== "beat") continue;
          const state: BeatState = { beat: ev.beat, plannedAtMs: since(), draw: "none", elements: [], ready: Promise.resolve(null), extra: true };
          logEv({ kind: "planned", by: intake ? "intake" : "replan", beatId: ev.beat.id, mode: ev.beat.mode, scene: ev.beat.scene, check: ev.beat.check, section: ev.beat.section, bridge: ev.beat.bridge, say: ev.beat.say });
          list.push(state);
          if (ev.beat.mode !== "talk") state.ready = startDraw(state);
          setBeats([...list]);
          notify();
        }
      })()
        .catch((e) => console.warn("[replan]", e))
        .finally(() => {
          amending--;
          notify();
        });
    };

    /**
     * Asks /api/converse and speaks the reply as it streams: each sentence goes
     * to Sonic the moment it arrives, and all of them play through one player,
     * so word timestamps (and the cursor's cues) share one clock. Returns the
     * trailer and what was said, or null if the learner cut in or it failed.
     */
    const speakReply = async (utterance: string, i: number, wordIndex: number, onLevel?: (level: ConverseTrailer["level"]) => void): Promise<{ trailer: ConverseTrailer; said: string } | null> => {
      const replyAbort = new AbortController();
      replyAbortRef.current = replyAbort;
      const onStop = () => replyAbort.abort();
      abort.signal.addEventListener("abort", onStop, { once: true });
      const signal = replyAbort.signal;
      setStatus("replying");
      // A beat cut off mid-drawing froze half drawn; show its drawing finished so the reply can point at it.
      const finished = playerRef.current?.seek(DOC_END - FRAME_TICKS);
      // What the learner drew: the elements it marks, and a picture of the board with it on top.
      let inkPayload: { marks: ReturnType<typeof readInk>["marks"]; loose: number; image?: string } | undefined;
      const strokes = inkRef.current;
      if (strokes.length) {
        const view = boardRef.current;
        const labels = Object.fromEntries(view.list.map((e) => [e.id, e.label]));
        const read = readInk(strokes, view.boxes, labels, { w: W, h: H });
        await finished?.catch(() => {});
        const image = snapshotBoard(canvasRef.current, strokes, W, H, cameraRef.current);
        inkPayload = { ...read, ...(image ? { image } : {}) };
        console.info(`[ink] ${strokes.length} stroke(s): ${read.marks.map((m) => `${m.how} ${m.id}`).join(", ") || "nothing marked"}${read.loose ? `, ${read.loose} loose` : ""}`);
      }
      const t1 = performance.now();
      const ctx = await unlockAudio();
      let audio: StreamPlayer | null = null;
      let all: WordTimestamps = { words: [], start: [], end: [] };
      let trailer: ConverseTrailer | null = null;
      let modelCues: unknown[] = [];
      let firstSoundMs: number | null = null;
      let replyCalls: CallLog[] = [];
      const sonicPerSentence: { sentence: number; firstAudioMs: number | null; totalMs: number; kb: number }[] = [];
      /**
       * The answer's sketch: drawn into a free area of the board while the
       * answer plays, on the reply's own clock, and kept with beat i's scene so
       * it stays for the beats after. `sketchStart` is the reply audio time its
       * drawing began (-1 until it is on the board).
       */
      let sketchStart = -1;
      let sketchSeeking = false;
      let zoomFrom: Region = FULL_VIEW, zoomTo: Region = FULL_VIEW;
      let sketchShown: Promise<void> = Promise.resolve();
      let replyLive = true;
      const startSketch = (t: ConverseTrailer) => {
        const owner = list[i];
        const ask = t.sketch;
        if (!ask || !owner) return;
        const scene = owner.beat.scene;
        const before = viewOf(scene);
        // Where the reply says it belongs (zooming out toward it if that is off the board); else any free space.
        const placed = placeSketch(boardRef.current.boxes, before, ask.near, ask.side);
        let view = placed?.view ?? before;
        let region = placed?.region ?? freeRegion(boardRef.current.boxes, view);
        if (placed) console.info(`[sketch] ${ask.side} ${ask.near}`);
        else if (ask.near) console.info(`[sketch] no room ${ask.side} ${ask.near}; using free space`);
        while (!region) {
          const wider = zoomOut(view, boardRef.current.boxes);
          if (!wider) break;
          view = wider;
          region = freeRegion(boardRef.current.boxes, view);
        }
        if (!region) {
          console.info("[sketch] no free space even zoomed out; skipped");
          return;
        }
        if (view !== before) console.info(`[sketch] zoomed out to ${Math.round(view.w)}% of the board to make room`);
        const say = sentences.map((x) => x.text).join(" ");
        // Everything stays inside the region: a line out to the rest of the board would cut across what is drawn there.
        const visual = `${ask.visual} Keep every shape, label and arrow inside your region; no arrows or connectors out to the rest of the board.`;
        const beat: PlannedBeat = { id: `answer-${++sketchCount}`, say, at: say.split(/\s+/)[0] ?? "", visual, mode: "draw", check: false, scene, region, adds: ask.adds, points: [] };
        const earlier = list.slice(0, i + 1).filter((b) => b.beat.scene === scene && b.beat.mode === "draw").map((b) => b.beat);
        const t0 = performance.now();
        sketchShown = post("/api/draw", { question: q, beat, earlier }, abort.signal)
          .then((r) => r.json())
          .then(async (res: { elements?: PresetElement[]; error?: string | null }) => {
            const els = res.elements ?? [];
            console.info(`[sketch] ${els.length} element(s) in ${Math.round(performance.now() - t0)} ms${res.error ? ` (${res.error})` : ""}: ${ask.visual}`);
            if (!els.length) return;
            // What the board shows now (the scene so far, this beat finished), with the sketch drawing on top.
            const base = sceneGroups(list, i, owner.beat.mode === "draw" ? (owner.elements ?? []) : []);
            owner.sketches = [...(owner.sketches ?? []), ...els];
            owner.sketchAdds = [...(owner.sketchAdds ?? []), ...ask.adds];
            views.set(scene, view);
            if (!replyLive || signal.aborted) return; // cut off: it shows with the scene's next drawing
            const compiled = compileScene([...base, els], { view, from: before });
            if (!compiled) return;
            // The ink stays where it was until the zoom starts, then moves with the board.
            zoomFrom = before;
            zoomTo = view;
            zoomingRef.current = view !== before;
            cameraRef.current = cameraFor(before);
            showBoard(boardView(compiled.report, [...base, els].flat(), sceneAdds(list, scene), view));
            await showDocument(compiled.doc);
            const a = audio as StreamPlayer | null;
            if (a && !a.drained) sketchStart = a.position();
            else {
              await playerRef.current?.seek(DOC_END - FRAME_TICKS);
              zoomingRef.current = false;
              cameraRef.current = cameraFor(view);
            }
          })
          .catch((e) => console.warn("[sketch]", e));
      };
      const sentences: { text: string; tts?: Promise<Response> }[] = [];
      // Speech for the sentence playing and one ahead only: Sonic slows down when many streams run at once.
      let playingIndex = 0;
      const ensure = (k: number) => {
        const x = sentences[k];
        if (x && !x.tts) x.tts = post("/api/tts", { text: x.text }, signal);
      };
      let wake: () => void = () => {};
      let ended = false;
      let raf = 0;
      const cue = () => {
        if (!trailer) return;
        const norm = all.words.map(normalizeWord);
        const steps: CursorStep[] = [];
        for (const c of trailer.cursor) {
          const want = normalizeWord(c.word);
          let seen = 0;
          const k = norm.findIndex((w) => w === want && ++seen === c.occurrence);
          if (k >= 0) steps.push({ t: Math.max(0, all.start[k] - CURSOR_LEAD_S), target: c.target, gesture: c.gesture, ...(c.to ? { to: c.to } : {}) });
        }
        setCursorScript(steps);
      };
      try {
        const res = await post(
          "/api/converse",
          {
            utterance,
            question: q,
            beats: list.map((s) => ({ id: s.beat.id, say: s.beat.say, mode: s.beat.mode, section: s.beat.section, check: s.beat.check })),
            beatIndex: i,
            wordIndex,
            board: boardRef.current.list.map((e) => ({ ...e, ...(boardRef.current.boxes[e.id] ? { box: boardRef.current.boxes[e.id] } : {}) })),
            history: history.slice(-6),
            escalation,
            learner,
            ...(inkPayload ? { ink: inkPayload } : {}),
          },
          signal,
        );
        if (!res.ok || !res.body) throw new Error(`reply failed (${res.status})`);
        const reading = (async () => {
          for await (const ev of ndjson<ConverseEvent>(res)) {
            if (ev.type === "sentence") {
              const voicedSentence = firstPerson(ev.text);
              if (voicedSentence.rewrites.length) logEv({ kind: "self-name-rewrite", role: "reply", from: ev.text, to: voicedSentence.text, rewrites: voicedSentence.rewrites });
              sentences.push({ text: voicedSentence.text });
              if (sentences.length - 1 <= playingIndex + 1) ensure(sentences.length - 1);
              wake();
            } else if (ev.type === "done") {
              replyCalls = ev.calls ?? [];
            } else if (ev.type === "level") {
              onLevel?.(ev.level);
            } else if (ev.type === "trailer") {
              modelCues = ev.modelCues ?? [];
              trailer = ev.trailer;
              startSketch(ev.trailer);
              cue();
            } else if (ev.type === "error") throw new Error(ev.message);
          }
        })().finally(() => {
          ended = true;
          wake();
        });
        reading.catch(() => {});
        setWords([]);
        setWordIndexNow(-1);
        setCursorScript([]);
        cursorClockRef.current = () => Math.max(0, audio?.position() ?? 0);
        const frame = () => {
          raf = requestAnimationFrame(frame);
          const t = audio?.position() ?? -1;
          if (t >= 0) setWordIndexNow(wordAt(t, all));
          // The sketch (and any zoom) draws on the reply's clock, so Stop freezes it too.
          if (sketchStart >= 0 && t >= 0 && zoomingRef.current) {
            const u = (t - sketchStart) / ZOOM_SECONDS;
            cameraRef.current = cameraBetween(zoomFrom, zoomTo, u);
            if (u >= 1) zoomingRef.current = false;
          }
          const player = playerRef.current;
          if (sketchStart >= 0 && t >= 0 && player && !sketchSeeking) {
            sketchSeeking = true;
            const tick = Math.max(0, Math.min(DOC_END - FRAME_TICKS, Math.round(((t - sketchStart) * TPS) / FRAME_TICKS) * FRAME_TICKS));
            player.seek(tick).finally(() => (sketchSeeking = false));
          }
        };
        raf = requestAnimationFrame(frame);
        let heard = false;
        for (let k = 0; ; k++) {
          while (k >= sentences.length && !ended && !signal.aborted) await new Promise<void>((r) => (wake = r));
          if (k >= sentences.length || signal.aborted) break;
          playingIndex = k;
          ensure(k);
          ensure(k + 1);
          const r = await sentences[k].tts!;
          if (!r.ok || !r.body) throw new Error(`speech failed (${r.status})`);
          // Everything before this sentence is in the player: its words start where that audio ends.
          let offset = audio ? audio.receivedSeconds : 0;
          for await (const ev of ndjson<BeatAudioEvent>(r)) {
            if (signal.aborted) break;
            if (ev.type === "start" && !audio) {
              audio = new StreamPlayer(ctx, ev.sampleRate, ev.encoding);
              if (pausedRef.current) audio.pause();
              audioRef.current = audio;
              offset = 0;
            } else if (ev.type === "audio" && audio) {
              audio.append(ev.data);
              if (!heard) {
                heard = true;
                firstSoundMs = Math.round(performance.now() - t1);
                setLastReplyMs(firstSoundMs);
                setSpeaking(true);
                setStatus("speaking");
              }
            } else if (ev.type === "timestamps") {
              all = mergeTimestamps(all, { words: ev.words, start: ev.start.map((x) => x + offset), end: ev.end.map((x) => x + offset) });
              setWords(all.words);
              cue();
            } else if (ev.type === "done") {
              sonicPerSentence.push({ sentence: k + 1, firstAudioMs: ev.stats.firstAudioMs, totalMs: ev.tMs, kb: Math.round(ev.stats.bytes / 1024) });
            } else if (ev.type === "error") throw new Error(`Sonic: ${ev.message}`);
          }
        }
        await reading;
        while (!signal.aborted && audio && !(audio as StreamPlayer).drained) await sleep(30);
        // A sketch still being drawn gets a few more seconds to land before the lesson moves on.
        await Promise.race([sketchShown, sleep(5000)]);
        if (sketchStart >= 0) {
          sketchStart = -1;
          await playerRef.current?.seek(DOC_END - FRAME_TICKS);
        }
        if (zoomingRef.current) {
          zoomingRef.current = false;
          cameraRef.current = cameraFor(zoomTo);
        }
        if (signal.aborted || !trailer) return null;
        setWordIndexNow(all.words.length);
        const saidText = sentences.map((x) => x.text).join(" ");
        const t = trailer as ConverseTrailer;
        logEv({
          kind: "reply",
          who: "chalky",
          text: saidText,
          level: t.level,
          resume: t.resume,
          check: t.check,
          plannerNote: t.planner_note,
          escalationBefore: escalation,
          cuesKept: t.cursor,
          cuesFromModel: modelCues,
          calls: replyCalls,
          sonic: sonicPerSentence,
          firstSoundMs,
          totalMs: Math.round(performance.now() - t1),
        });
        return { trailer: t, said: saidText };
      } catch (e) {
        logEv({ kind: "reply-failed", aborted: signal.aborted, error: signal.aborted ? null : String((e as Error).message ?? e), firstSoundMs });
        if (!signal.aborted) {
          console.warn("[converse]", e);
          setError(`Chalky couldn't answer: ${String((e as Error).message ?? e)}`);
        }
        return null;
      } finally {
        cancelAnimationFrame(raf);
        replyLive = false;
        // Cut off mid-zoom: land where the board is going.
        if (zoomingRef.current) {
          zoomingRef.current = false;
          cameraRef.current = cameraFor(zoomTo);
        }
        abort.signal.removeEventListener("abort", onStop);
        if (replyAbortRef.current === replyAbort) replyAbortRef.current = null;
        lastSpokeRef.current = performance.now();
        if (signal.aborted) audio?.stop();
        const mine = audio;
        setTimeout(() => {
          if (audioRef.current === mine || mine === null) setSpeaking(false);
        }, ECHO_TAIL_MS);
      }
    };

    /**
     * The one Waiting state: after a check-in, after the learner cut in, or when
     * they spoke between beats. Nothing resumes on silence. "got it / keep going"
     * (or Continue) resumes with no model call; anything else gets a spoken
     * reply and, by its level, a brief answer (then wait), a detour (inserted
     * here, then wait at its check-in) or a new ending (then go on).
     * Returns the list position to play next (`resumeAt` replays the beat cut
     * off), or -1 when the lesson was stopped.
     */
    const converseAt = (i: number, wordIndex: number, resumeAt: number, bridge?: string): Promise<number> =>
      converseTurns(i, wordIndex, resumeAt, bridge).finally(() => showInk([]));
    const converseTurns = async (i: number, wordIndex: number, resumeAt: number, bridge?: string): Promise<number> => {
      setStatus("waiting");
      // Cut off during a check-in beat: whatever the learner says next settles that check, so going on
      // continues after it instead of replaying it and asking the same question again.
      if (wordIndex >= 0 && list[i]?.beat.check && resumeAt === i) {
        resumeAt = i + 1;
        logEv({ kind: "check-in-settled", beatId: list[i].beat.id, why: "cut off during its check-in; not replayed" });
      }
      for (;;) {
        const heardText = await awaitTurn(abort.signal);
        if (abort.signal.aborted) return -1;
        logEv({
          kind: "learner",
          via: heardText === null ? "button" : inputViaRef.current,
          role: wordIndex >= 0 ? "cut-in" : bridge ? "check-in" : "between beats",
          beatId: list[i]?.beat.id ?? null,
          wordIndex,
          text: heardText ?? "(Continue)",
          local: heardText === null || isResume(heardText),
          escalation,
        });
        if (heardText !== null) {
          learner.replies = [...learner.replies, heardText].slice(-5);
          noteLearner();
        }
        if (heardText === null || isResume(heardText)) {
          escalation = 0;
          dropDraft();
          setPausedAt(null);
          setLastLevel(heardText === null ? "continue (button)" : `continue (local, no model call${bridge ? ", bridge" : ""})`);
          // At a check-in, take a breath and say what comes next: written by the planner, no model call.
          if (bridge && !abort.signal.aborted) {
            logEv({ kind: "say", who: "chalky", role: "bridge", text: bridge });
            setStatus("speaking");
            await playBeat(line(bridge), abort.signal, null).catch(() => {});
          }
          return resumeAt;
        }
        history.push({ who: "learner", text: heardText });
        // A quick second utterance may be merged into this while the reply runs (see mergeRef).
        lastLearnerRef.current = { text: heardText, at: performance.now() };
        // A new question starts fresh: only "still lost" builds on the last answer (and its drafted detour).
        if (!isStillLost(heardText)) {
          escalation = 0;
          dropDraft();
        }
        // A detour is decided before the lead-in is spoken: start planning (and drawing) it right away.
        const reply = await speakReply(heardText, i, wordIndex, (level) => {
          if (level === "detour" && !(draft && draft.at === resumeAt)) {
            dropDraft();
            draft = planDetour(resumeAt, `The learner said: "${heardText}". Show it with a drawing of what is missing from the board.`, heardText, "a one-sentence hand-off, like \"Let me draw that for you.\"");
          }
        });
        if (abort.signal.aborted) return -1;
        if (!reply) {
          setStatus("waiting");
          continue;
        }
        history.push({ who: "chalky", text: reply.said });
        const { trailer } = reply;
        if (trailer.planner_note) {
          learner.confusions = [...learner.confusions, trailer.planner_note].slice(-5);
          noteLearner();
        }
        setLastLevel(`${trailer.level} / ${trailer.resume}${trailer.cursor.length ? ` · cursor ${trailer.cursor.map((c) => `${c.gesture} ${c.target}`).join(", ")}` : ""}`);
        /** Going on from a check-in: say its bridge first (written by the planner, no model call). */
        const goOn = async (spoken?: string) => {
          escalation = 0;
          dropDraft();
          setPausedAt(null);
          // Either the reply or the bridge carries the lesson forward, not both.
          if (bridge && spoken && LOOKS_AHEAD.test(spoken)) logEv({ kind: "bridge-skipped", reason: "the reply already looked ahead", bridge });
          else if (bridge && !abort.signal.aborted) {
            logEv({ kind: "say", who: "chalky", role: "bridge", text: bridge });
            setStatus("speaking");
            await playBeat(line(bridge), abort.signal, null).catch(() => {});
          }
          return resumeAt;
        };
        if (trailer.level === "confirm") return await goOn(reply.said);
        if (trailer.level === "replan") {
          escalation = 0;
          setPausedAt(null);
          replan(resumeAt, trailer.planner_note, heardText, false, reply.said);
          return resumeAt;
        }
        if (trailer.level === "detour") {
          escalation = 2;
          const d = draft && draft.at === resumeAt ? draft : (dropDraft(), planDetour(resumeAt, trailer.planner_note, heardText, reply.said));
          draft = null;
          setStatus("planning");
          const detour = await d.beats.catch(() => [] as BeatState[]);
          if (abort.signal.aborted) return -1;
          if (detour.length) {
            logEv({ kind: "detour", at: resumeAt, beats: detour.map((d) => ({ beatId: d.beat.id, mode: d.beat.mode, say: d.beat.say })) });
            dropPrefetches("detour inserted");
            // A talk or check-in beat cut off for this detour is not replayed: the detour's own closing check replaces it.
            const cut = wordIndex >= 0 ? list[i] : undefined;
            if (cut && (cut.beat.mode === "talk" || cut.beat.check)) {
              list.splice(i, 1, ...detour);
              logEv({ kind: "replaced-by-detour", beatId: cut.beat.id, why: cut.beat.check ? "check-in" : "talk" });
              setBeats([...list]);
              return i;
            }
            list.splice(resumeAt, 0, ...detour);
            setBeats([...list]);
            return resumeAt;
          }
          setError("Couldn't plan a detour; try asking another way.");
          setStatus("waiting");
          continue;
        }
        // A brief answer: draft the detour now, in case they are still lost.
        escalation = Math.max(escalation, 1) as 1 | 2;
        if (!draft) draft = planDetour(resumeAt, trailer.planner_note, heardText);
        if (trailer.resume === "continue" || trailer.resume === "replay_beat") return await goOn(reply.said);
        setStatus("waiting");
      }
    };

    try {
      // The intake: ask one question, wait for an answer (or ~4 s of silence), and let the fast model
      // decide whether the plan should change after beat 1. The plan has been streaming meanwhile.
      const iq = await intakeAsk;
      if (iq?.say && !abort.signal.aborted) {
        const tAsk = performance.now();
        logEv({ kind: "say", who: "chalky", role: "intake", text: iq.say, intakeKind: iq.kind, model: iq.model, ms: iq.ms, call: iq.call ?? null });
        setStatus("speaking");
        await playBeat(line(iq.say), abort.signal, null, onFirstSound);
        setStatus("waiting");
        const answer = await (async () => {
          const waiting = awaitTurn(abort.signal);
          let deadline = performance.now() + INTAKE_SILENCE_MS;
          let started = false;
          const timer = setInterval(() => {
            // Silence lets the lesson go on, but only if the learner hasn't started answering at all:
            // once they speak or type, the patient turn end decides when they're done. Stopped holds it open.
            if (haltedRef.current) deadline = performance.now() + INTAKE_SILENCE_MS;
            else if (partialRef.current.trim() || draftRef.current.trim()) started = true;
            if (!started && performance.now() > deadline) turnRef.current?.(null);
          }, 200);
          try {
            return await waiting;
          } finally {
            clearInterval(timer);
          }
        })();
        if (abort.signal.aborted) throw new DOMException("stopped", "AbortError");
        const waitedMs = Math.round(performance.now() - tAsk);
        logEv({ kind: "learner", role: "intake answer", via: answer === null ? "silence" : inputViaRef.current, text: answer ?? "(silence)" });
        if (!answer || SKIP_INTAKE.test(answer) || isResume(answer)) {
          setIntakeView(`Asked “${iq.say}” (${iq.kind}, ${iq.model}); ${answer ? `“${answer}”: skipped` : "no answer: went on"}; the intake took ${(waitedMs / 1000).toFixed(1)} s.`);
          if (answer) {
            learner.replies = [answer];
            noteLearner();
          }
          logEv({ kind: "intake-decision", skipped: true, reason: answer ? "skip phrase" : "silence", intakeMs: waitedMs });
        } else {
          learner.replies = [answer];
          const tDecide = performance.now();
          const deciding: Promise<{ amend?: boolean; note?: string; learner?: Partial<LearnerRecord>; error?: string; call?: unknown }> = post("/api/converse", {
            intent: "intake_answer",
            question: q,
            asked: iq.say,
            answer,
            beats: list.slice(0, 3).map((s) => s.beat.say),
          })
            .then((r) => r.json())
            .catch((e) => ({ error: String(e) }));
          // Answer the learner at once, while the fast model decides: never silence after they speak.
          const ack = INTAKE_ACKS[Math.floor(Math.random() * INTAKE_ACKS.length)];
          logEv({ kind: "say", who: "chalky", role: "intake-ack", text: ack });
          setStatus("speaking");
          await playBeat(line(ack), abort.signal, null).catch(() => {});
          setStatus("replying");
          const decision = await deciding;
          Object.assign(learner, { level: decision.learner?.level ?? "unknown", prior: decision.learner?.prior ?? "", focus: decision.learner?.focus ?? "" });
          noteLearner();
          const decideMs = Math.round(performance.now() - tDecide);
          logEv({ kind: "intake-decision", skipped: false, amend: !!decision.amend, note: decision.note ?? "", learner: decision.learner ?? null, call: decision.call ?? null, error: decision.error ?? null, decideMs, intakeMs: Math.round(performance.now() - tAsk) });
          if (decision.amend && decision.note && !abort.signal.aborted) {
            // Beat 1 plays as planned; everything after it is rewritten for this learner.
            let release: () => void = () => {};
            intakeGate = new Promise<void>((r) => (release = r));
            void firstBeatPlanned.then(() => {
              if (list.length >= 1 && !abort.signal.aborted) replan(1, decision.note!, answer, true);
              release();
            });
          }
          setIntakeView(
            `Asked “${iq.say}” (${iq.kind}, ${iq.model}); answer “${answer}”; ${decision.error ? `decision failed: ${decision.error}` : decision.amend ? `the plan is rewritten from beat 2: ${decision.note}` : "the plan stays as it is"} (decided in ${(decideMs / 1000).toFixed(1)} s); the intake took ${((performance.now() - tAsk) / 1000).toFixed(1)} s.`,
          );
        }
      }

      let i = 0;
      for (;;) {
        if (i >= list.length && planOpen()) setStatus("planning");
        let fillers = 0;
        while (i >= list.length && planOpen() && !abort.signal.aborted) {
          const timedOut = await Promise.race([changed().then(() => false), sleep(500).then(() => true)]);
          // Nothing heard for a while and the next beat is still being planned: say so, briefly, at most twice.
          if (timedOut && fillers < FILLERS.length && performance.now() - lastSpokeRef.current > FILLER_AFTER_MS && !abort.signal.aborted) {
            const filler = FILLERS[fillers++];
            logEv({ kind: "say", who: "chalky", role: "filler", text: filler, waitingForBeat: i });
            await playBeat(line(filler), abort.signal, null).catch(() => {});
            setStatus("planning");
          }
        }
        if (abort.signal.aborted) break;
        // The learner spoke between beats (or while Chalky was planning): answer before going on.
        if (queueRef.current.length) {
          const next = await converseAt(Math.max(0, Math.min(i, list.length) - 1), -1, i);
          if (next < 0) break;
          i = next;
          continue;
        }
        if (i >= 1) await intakeGate;
        await waitWhilePaused(abort.signal);
        await haltGate(abort.signal);
        if (abort.signal.aborted) break;
        if (i >= list.length) {
          if (planOpen()) continue;
          break;
        }
        setCurrent(i);
        currentBeatIdRef.current = list[i].beat.id;
        setStatus("speaking");
        const bi = i;
        const compile: Compile | null =
          list[bi].beat.mode === "talk"
            ? null
            : (currentElements) => {
                let groups = sceneGroups(list, bi, currentElements);
                const scene = list[bi].beat.scene;
                const view = viewOf(scene);
                let compiled: ReturnType<typeof compileScene> = null;
                try {
                  compiled = compileScene(groups, { view });
                } catch (e) {
                  // One bad drawing (a NaN size, say) must not end the lesson: keep the board without it.
                  logEv({ kind: "board-error", beatId: list[bi].beat.id, error: String((e as Error).message ?? e).slice(0, 200) });
                  console.warn("[board]", e);
                  // Find the drawing(s) that break it by compiling each on its own, and leave only those out.
                  groups = groups.map((g) => {
                    try {
                      compileScene([g], { view });
                      return g;
                    } catch {
                      return [];
                    }
                  });
                  try {
                    compiled = compileScene(groups, { view });
                  } catch {
                    compiled = null;
                  }
                }
                if (!compiled) return null;
                showBoard(boardView(compiled.report, groups.flat(), sceneAdds(list, scene), view));
                return compiled.doc;
              };
        const beatAbort = new AbortController();
        beatAbortRef.current = beatAbort;
        abort.signal.addEventListener("abort", () => beatAbort.abort(), { once: true });
        // Only the prefetch made for exactly this beat object can play it; anything else left over is stale.
        const pre = prefetches.get(list[i]) ?? null;
        prefetches.delete(list[i]);
        if (prefetches.size) dropPrefetches("out of order");
        const bi2 = i;
        const timing: Record<string, unknown> = { beatId: list[i].beat.id, mode: list[i].beat.mode, scene: list[i].beat.scene, say: list[i].beat.say, startMs: since(), prefetched: !!pre };
        const tBeat = performance.now();
        try {
          await playBeat(
            list[i],
            beatAbort.signal,
            compile,
            () => {
              timing.firstSoundMs ??= Math.round(performance.now() - tBeat);
              onLessonSound();
            },
            {
              prefetch: pre,
              onSpeechDone: (sonic) => {
                timing.sonic = sonic;
              },
              onStreamed: () => {
                timing.streamedMs = Math.round(performance.now() - tBeat);
                prefetchNext(bi2);
              },
              onHeld: (ms, fromMemory) => {
                timing.heldMs = ms;
                timing.fromMemory = fromMemory;
                stats.heldMs += ms;
                if (fromMemory) stats.fromMemory++;
                setPrefetchStats({ ...stats });
              },
            },
          );
        } catch (e) {
          if (!interruptedRef.current) throw e;
        }
        Object.assign(timing, {
          endMs: since(),
          playedMs: Math.round(performance.now() - tBeat),
          interrupted: interruptedRef.current,
          ...(interruptedRef.current ? { atWord: (resumeRef.current?.wordIndex ?? -1) + 1 } : {}),
          draw: list[i].draw,
          drawMs: list[i].drawMs ?? null,
          drawModel: list[i].model ?? null,
          drawLateSec: list[i].lateSec ?? null,
          drawError: list[i].error ?? null,
          drawCalls: list[i].drawCalls ?? null,
        });
        transcript.beats.push(timing);
        logEv({ kind: "beat", ...timing });
        if (beatAbortRef.current === beatAbort) beatAbortRef.current = null;
        setBeats([...list]);
        if (abort.signal.aborted) break;

        // Cut in mid-beat: wait for the learner, then (by default) replay this beat from its start.
        if (interruptedRef.current) {
          interruptedRef.current = false;
          const next = await converseAt(i, resumeRef.current?.wordIndex ?? -1, i);
          if (next < 0) break;
          i = next;
          continue;
        }
        said.push(list[i].beat.say);

        // A check-in question waits for the learner before the lesson goes on.
        const more = i + 1 < list.length || planOpen();
        if (list[i].beat.check && more) {
          const next = await converseAt(i, -1, i + 1, list[i].beat.bridge);
          if (next < 0) break;
          i = next;
          continue;
        }
        i++;
      }
      if (!abort.signal.aborted) setStatus((s) => (s === "error" ? s : "done"));
      else setStatus("stopped");
      transcript.end = abort.signal.aborted ? "stopped" : "done";
    } catch (e) {
      if (abort.signal.aborted) setStatus("stopped");
      else {
        setError(String((e as Error).message ?? e));
        setStatus("error");
      }
      transcript.end = abort.signal.aborted ? "stopped" : `error: ${String((e as Error).message ?? e)}`;
    } finally {
      transcript.endedAt = new Date().toISOString();
      transcript.learner = learner;
      transcript.prefetch = { ...stats };
      logEv({ kind: "end", end: transcript.end });
      flushLog();
    }
  }, [stop, showDocument, showBoard, playBeat, awaitTurn, voice, setSpeaking, setStatus, waitWhilePaused, haltGate]);

  useEffect(() => {
    askRef.current = (q) => void ask(q);
  }, [ask]);

  /** Pauses right where Chalky is: sound, board and cursor freeze (they follow the audio clock); the mic opens. */
  const pausePlayback = useCallback(() => {
    const st = statusRef.current;
    if (pausedRef.current || (st !== "speaking" && st !== "replying")) return;
    pausedRef.current = { prev: st, at: performance.now(), beatId: currentBeatIdRef.current, wordIndex: wordIndexRef.current };
    audioRef.current?.pause();
    speakingRef.current = false;
    setSpeakingAudio(false);
    setPausedAt({ beatId: currentBeatIdRef.current, wordIndex: wordIndexRef.current });
    setStatusRaw("paused");
    logRef.current({ kind: "pause", beatId: currentBeatIdRef.current, wordIndex: wordIndexRef.current, during: st });
  }, []);

  /** Goes on from exactly where the pause was (a second Space tap, or Continue). */
  const resumePlayback = useCallback(() => {
    const p = pausedRef.current;
    if (!p) return;
    pausedRef.current = null;
    audioRef.current?.resume();
    if (audioRef.current && !audioRef.current.drained) {
      speakingRef.current = true;
      setSpeakingAudio(true);
    }
    setPausedAt(null);
    setStatusRaw(p.prev);
    logRef.current({ kind: "resume", beatId: p.beatId, wordIndex: p.wordIndex, pausedMs: Math.round(performance.now() - p.at) });
    unpauseWaiters.current.splice(0).forEach((r) => r());
  }, []);

  /** Stops Chalky to listen: the beat (replayed or settled later) or the reply in flight is cut. */
  const interrupt = useCallback(() => {
    // A cut-in from a pause ends the pause: what is cut is what was paused.
    const p = pausedRef.current;
    if (p) {
      pausedRef.current = null;
      setStatusRaw(p.prev);
      statusRef.current = p.prev;
      unpauseWaiters.current.splice(0).forEach((r) => r());
    }
    const st = statusRef.current;
    if (st !== "speaking" && st !== "replying") return;
    const reply = replyAbortRef.current;
    const beat = beatAbortRef.current;
    if (!reply && !beat) return;
    // Freeze the cursor where it is.
    const frozen = cursorClockRef.current();
    cursorClockRef.current = () => frozen;
    if (reply) {
      // Cut off a reply: cancel it (model, speech and audio); the lesson listens again.
      reply.abort();
      replyAbortRef.current = null;
    } else if (beat) {
      dropPrefetchRef.current("interrupted");
      interruptedRef.current = true;
      resumeRef.current = { beatId: currentBeatIdRef.current, wordIndex: wordIndexRef.current };
      setPausedAt(resumeRef.current);
      beat.abort();
    }
    audioRef.current?.stop();
    playerRef.current?.pause();
    // The audio is cut: open the mic now rather than after the echo tail.
    setSpeaking(false);
    setStatus("waiting");
  }, [setSpeaking]);
  /** Stop: Chalky freezes where it is and takes no input until Start. */
  const halt = useCallback(() => {
    if (!abortRef.current || abortRef.current.signal.aborted || haltedRef.current) return;
    setHaltedNow(true);
    queueRef.current = [];
    setDraft("");
    void holdAudio(true);
  }, [setHaltedNow]);
  /** Start: carry on from the word where Stop froze it (a turn that was waiting goes on waiting). */
  const resume = useCallback(() => {
    if (!haltedRef.current) return;
    setHaltedNow(false);
    void holdAudio(false);
  }, [setHaltedNow]);

  useEffect(() => {
    // Space down (the hybrid mic's barge-in) pauses at once; holding and talking then cuts in.
    pauseRef.current = pausePlayback;
    cutInRef.current = interrupt;
    lessonBusyRef.current = () => !!abortRef.current && !abortRef.current.signal.aborted && (MUTED.has(statusRef.current) || !!pausedRef.current) && !turnRef.current;
    mergeRef.current = (said) => {
      // A reply is in flight for the learner's last words: a quick "oh" or "wait" joins that question instead
      // of replacing it; a longer second utterance re-asks with both, in order.
      const last = lastLearnerRef.current;
      if (!replyAbortRef.current || !last) return false;
      if (said.split(/\s+/).length <= 2 && !isResume(said)) {
        last.text = `${last.text} ${said}`;
        logRef.current({ kind: "utterance-merged", text: said, into: last.text, action: "kept the reply" });
        if (pausedRef.current) resumePlayback();
        return true;
      }
      const both = `${last.text} ${said}`;
      logRef.current({ kind: "utterance-merged", text: said, into: both, action: "re-asked with both" });
      queueRef.current.push(both);
      interrupt();
      return true;
    };
  }, [interrupt, pausePlayback, resumePlayback]);

  // Space is a toggle: a tap while Chalky talks pauses, a tap while paused resumes. With the mic on, the
  // hybrid mic sees Space first (it pauses on key down, and holding it talks); without it, this does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.isContentEditable || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox"))) return;
      if (pausedRef.current) {
        e.preventDefault();
        resumePlayback();
      } else if (statusRef.current === "speaking" || statusRef.current === "replying") {
        e.preventDefault();
        pausePlayback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resumePlayback, pausePlayback]);

  const startTalking = useCallback(async () => {
    try {
      await voice.start();
      // The first connection already carries Chalky's name and the seed science vocabulary.
      const abort = new AbortController();
      abortRef.current = abort;
      setStatus("speaking");
      await playBeat(line(GREETING), abort.signal, null);
      setStatus("idle");
    } catch (e) {
      setError(`Voice couldn't start: ${String((e as Error).message ?? e)}. You can still type.`);
      setStatus("idle");
    }
  }, [voice, playBeat]);

  const submit = () => {
    const text = draft.trim();
    if (!text || haltedRef.current) return;
    inputViaRef.current = "typed";
    if (mergeRef.current(text)) {
      setDraft("");
      return;
    }
    if (turnRef.current) {
      setDraft("");
      turnRef.current(text);
    } else if (lessonBusyRef.current()) {
      // Typed while Chalky talks: same as cutting in and saying it.
      setDraft("");
      queueRef.current.push(text);
      interrupt();
    } else void ask(text);
  };

  const waitingForLearner = status === "waiting" || status === "listening" || status === "paused";
  const onScreenBoxes = useMemo(() => screenBoxes(board.boxes, board.view), [board]);
  /** The pen works once something is on the board and a lesson is running; drawing while Chalky talks pauses it. */
  const penReady = !halted && board.list.length > 0 && ["speaking", "paused", "waiting", "listening", "replying"].includes(status);
  const busy = ["planning", "speaking", "paused", "waiting", "listening", "replying"].includes(status) && !!question;
  const orbState: OrbState =
    halted ? "idle"
    : status === "speaking" ? "speaking"
    : status === "planning" || status === "replying" ? "thinking"
    : voice.started ? "listening"
    : "idle";
  const orbLevel = useCallback(() => (speakingRef.current ? (audioRef.current?.level() ?? 0) : voice.level()), [voice]);
  const statusLabel: Record<Status, string> = {
    idle: voice.started ? "Listening" : "Ready", planning: "Planning…", speaking: voice.mode === "held" ? "Listening" : "Speaking", paused: "Paused · Space to go on", waiting: "Your turn",
    listening: "Listening", replying: "Thinking…", done: voice.started ? "Done · ask another" : "Done", stopped: "Stopped", error: "Error",
  };
  const showWelcome = !question && status !== "speaking";

  const drawLabel = (b: BeatState) => {
    switch (b.draw) {
      case "none": return "no drawing";
      case "local": return `points at ${b.beat.points.map((p) => p.id).join(", ")} · no model call`;
      case "pending": return "drawing…";
      case "failed": return `drawing failed: ${b.error ?? "unknown"}`;
      case "ready": return `drawn in ${((b.drawMs ?? 0) / 1000).toFixed(1)} s (${(b.model ?? "").replace("claude-", "")}) · ${b.elements?.length ?? 0} elements${b.dropped ? ` · ${b.dropped} dropped` : ""}${b.lateSec ? ` · landed ${b.lateSec} s after its word` : ""}`;
    }
  };

  return (
    <div className="board-wrap">
      <div className="board" data-status={status} data-mic={voice.mode}>
        <header className="topic">
          <h1 data-testid="title">{title}</h1>
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={halted ? "Chalky is stopped. Press Start to carry on." : waitingForLearner ? "Answer or ask Chalky…" : "Type a question, or just say it"}
              disabled={halted}
              aria-label="Question"
              data-testid="question"
            />
            <button type="submit" disabled={halted || !draft.trim()} data-testid="ask">{waitingForLearner || busy ? "Send" : "Ask"}</button>
            {status === "speaking" && busy && !halted && (
              <button type="button" onClick={pausePlayback} data-testid="interrupt" title="Space">Pause</button>
            )}
            {waitingForLearner && !halted && (
              <button type="button" className="continue" onClick={() => (pausedRef.current ? resumePlayback() : turnRef.current?.(null))} data-testid="continue">Continue</button>
            )}
            {busy &&
              (halted ? (
                <button type="button" className="start" onClick={resume} data-testid="start">Start</button>
              ) : (
                <button type="button" onClick={halt} data-testid="stop">Stop</button>
              ))}
          </form>
          {voiceBargeIn && (
            <span className="voice-badge" data-testid="voice-barge-badge" title="Talk over Chalky to interrupt. Use headphones: speakers can leak into the mic. Space still pauses.">
              Voice interrupt on · headphones
            </span>
          )}
          <div className="mic" data-testid="status">
            {halted ? "Stopped" : statusLabel[status]}
            <Orb state={orbState} level={orbLevel} size={34} />
          </div>
        </header>
        <section className="stage" data-testid="stage">
          <div className="visual" style={{ position: "relative" }}>
            <canvas ref={canvasRef} aria-label="The whiteboard" />
            {question && current < 0 && (
              // Before the first beat draws: the topic in chalk, so the board is never blank while Chalky plans.
              <div className="chalk-title" data-testid="chalk-title">
                {title && title !== "Planning…" ? title : question}
              </div>
            )}
            <InkLayer
              width={W}
              height={H}
              enabled={penReady}
              strokes={ink}
              color={inkColor}
              camera={readCamera}
              onPenDown={() => {
                // Drawing while Chalky talks is cutting in, like Space.
                if (lessonBusyRef.current()) pauseRef.current();
              }}
              onStroke={(stroke) => showInk([...inkRef.current, stroke])}
            />
            <ChalkyCursor boxes={onScreenBoxes} script={cursorScript} clock={cursorClock} />
            {penReady && (
              <div className="pen" data-testid="pen">
                {INK_COLORS.map((c) => (
                  <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Pen colour ${c}`} aria-pressed={c === inkColor} onClick={() => setInkColor(c)} />
                ))}
                <button type="button" onClick={() => showInk(inkRef.current.slice(0, -1))} disabled={!ink.length} data-testid="ink-undo">Undo</button>
                <button type="button" onClick={() => showInk([])} disabled={!ink.length} data-testid="ink-clear">Clear</button>
              </div>
            )}
          </div>
          {showWelcome && (
            <div className="welcome" data-testid="welcome">
              <Orb state={orbState} level={orbLevel} size={150} />
              <h2>What do you want to learn?</h2>
              {voice.started ? <p>I&apos;m listening. Just say it, or type it at the top.</p> : <p>Talk to Chalky, or type a question at the top.</p>}
              {!voice.started && <button type="button" onClick={startTalking} data-testid="start-talking">Start talking</button>}
            </div>
          )}
        </section>
        <aside className="evidence lesson-beats">
          <div className="empty">Sources will appear here (not wired up yet).</div>
          {beats.length > 0 && (
            <ol data-testid="beats">
              {beats.map((b, i) => (
                <li key={b.beat.id} data-beat-id={b.beat.id} data-state={i === current ? "now" : i < current ? "done" : "next"} data-scene={b.beat.scene}>
                  <span className="beat-say">{b.beat.say}</span>
                  <span className="beat-meta">
                    {b.beat.section ? `§ ${b.beat.section} · ` : ""}scene {b.beat.scene} · {b.beat.mode}{b.beat.check ? ` · check-in${b.beat.bridge ? ` → “${b.beat.bridge}”` : ""}` : ""} · planned at {(b.plannedAtMs / 1000).toFixed(1)} s · {drawLabel(b)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {firstSoundMs !== null && (
            <p className="beat-meta" data-testid="first-sound">
              First sound {(firstSoundMs / 1000).toFixed(1)} s after asking{lessonSoundMs !== null ? `; the lesson itself at ${(lessonSoundMs / 1000).toFixed(1)} s` : ""}.
            </p>
          )}
          {layoutMs !== null && <p className="beat-meta" data-testid="layout-ms">Layout pass took {(layoutMs / 1000).toFixed(1)} s.</p>}
          {lastReplyMs !== null && <p className="beat-meta" data-testid="reply-ms">Last answer: first sound {(lastReplyMs / 1000).toFixed(1)} s after the learner finished.</p>}
          {lastLevel && <p className="beat-meta" data-testid="last-level">Last turn: {lastLevel}</p>}
          {intakeView && <p className="beat-meta" data-testid="intake">Intake: {intakeView}</p>}
          {prefetchStats.fetched > 0 && (
            <p className="beat-meta" data-testid="prefetch">
              Speech one beat ahead: {prefetchStats.fetched} fetched ({prefetchStats.fetchedKB} KB), {prefetchStats.fromMemory} played from memory, held {(prefetchStats.heldMs / 1000).toFixed(1)} s in all; {prefetchStats.dropped} dropped ({prefetchStats.wastedKB} KB wasted).
            </p>
          )}
          {learnerView && (learnerView.level !== "unknown" || learnerView.prior || learnerView.focus || learnerView.confusions.length > 0) && (
            <p className="beat-meta" data-testid="learner">
              Learner: {[learnerView.level !== "unknown" && `level ${learnerView.level}`, learnerView.prior && `prior: ${learnerView.prior}`, learnerView.focus && `focus: ${learnerView.focus}`, learnerView.confusions.length > 0 && `${learnerView.confusions.length} confusion(s)`].filter(Boolean).join(" · ")}
            </p>
          )}
          {pausedAt && <p className="beat-meta" data-testid="paused-at">Paused at {pausedAt.beatId}, word {pausedAt.wordIndex + 1}.</p>}
        </aside>
        <footer className="caption" data-testid="caption">
          {voice.partial ? (
            <p className="heard" data-testid="heard">“{voice.partial}”</p>
          ) : heardNote && !question ? (
            <p className="heard" data-testid="heard-note">{heardNote}</p>
          ) : (
            <p>
              {words.map((w, i) => (
                <span key={i} className="word" data-state={i < wordIndexNow ? "spoken" : i === wordIndexNow ? "now" : "pending"}>
                  {w}{" "}
                </span>
              ))}
            </p>
          )}
        </footer>
      </div>
      {(error || voice.error) && <div className="lesson-error" data-testid="error">{error ?? voice.error}</div>}
    </div>
  );
}
