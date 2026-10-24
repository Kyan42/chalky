"use client";

/**
 * The basic lesson loop: type a question, the planner streams beats, each
 * beat's scene-language visual is generated as soon as the beat arrives, and
 * beats play in order with Sonic voice. Audio is the clock: each frame the
 * board's Clayzo player is seeked to (speech time − anchor word start).
 *
 * The board grows: each beat's document holds everything drawn so far (earlier
 * beats already finished, this beat animating in), and the player swaps to it
 * at the beat boundary.
 */
import { createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { useCallback, useEffect, useRef, useState } from "react";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { mergeTimestamps, resolveAt, wordAt, type WordTimestamps } from "@/lib/beat";
import type { BoardElement } from "@/lib/lesson/board";
import type { PlanEvent, PlannedBeat } from "@/lib/lesson/types";
import type { BeatAudioEvent } from "@/lib/sonic";

const TPS = 240;
const FRAME_TICKS = 4;
const DOC_END = 6 * TPS;
const GAP_SECONDS = 0.45;

type Status = "idle" | "planning" | "drawing" | "speaking" | "waiting" | "done" | "stopped" | "error";

interface BeatState {
  beat: PlannedBeat;
  plannedAtMs: number;
  visual: "drawing" | "ready" | "failed" | "none";
  visualMs?: number;
  doc?: AnimationDocument;
  cleared?: boolean;
  boardSize?: number;
  edits?: { added: number; highlights: number; dims: number };
  /** Resolves when the visual request settles, with or without a document. */
  ready: Promise<void>;
}

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

export default function Lesson() {
  const [question, setQuestion] = useState("Why is the sky blue?");
  const [title, setTitle] = useState("Ask Chalky anything");
  const [status, setStatus] = useState<Status>("idle");
  const [beats, setBeats] = useState<BeatState[]>([]);
  const [current, setCurrent] = useState(-1);
  const [words, setWords] = useState<string[]>([]);
  const [wordIndex, setWordIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [firstSoundMs, setFirstSoundMs] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<StreamPlayer | null>(null);
  const continueRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    audioRef.current?.stop();
    playerRef.current?.pause();
  }, []);

  useEffect(() => () => {
    stop();
    playerRef.current?.dispose();
  }, [stop]);

  /** Replaces the board's player with one for `doc` (or clears it). */
  const showDocument = useCallback(async (doc: AnimationDocument | undefined) => {
    playerRef.current?.dispose();
    playerRef.current = null;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    const player = await createPlayer({
      canvas, document: doc as never, loaders: fontLoader,
      pauseWhenOffscreen: false, stateMachine: false,
      onError: (e) => console.warn("[clayzo]", e.message),
    });
    player.pause();
    await player.seek(0);
    playerRef.current = player;
  }, []);

  /** Speaks one beat and drives its visual from the audio clock. Resolves when the speech has played. */
  const playBeat = useCallback(async (state: BeatState, signal: AbortSignal, onFirstSound: () => void) => {
    const ctx = ctxRef.current!;
    setWords(state.beat.say.split(/\s+/));
    setWordIndex(-1);
    // A talk beat (or a failed visual) has no document of its own: the board stays as it is.
    const follow = !!state.doc;
    const [response] = await Promise.all([
      fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: state.beat.say }), signal }),
      follow ? showDocument(state.doc) : Promise.resolve(),
    ]);
    if (!response.ok || !response.body) throw new Error(`speech failed (${response.status})`);

    let audio: StreamPlayer | null = null;
    let timestamps: WordTimestamps = { words: [], start: [], end: [] };
    let anchorStart: number | null = null;
    let streamDone = false;
    let seeking = false;
    let lastTick = -1;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!audio) return;
      const t = audio.position();
      if (t < 0) return;
      setWordIndex(wordAt(t, timestamps));
      const player = playerRef.current;
      if (follow && player && anchorStart !== null && !seeking) {
        const tick = Math.max(0, Math.min(DOC_END - FRAME_TICKS, Math.round(((t - anchorStart) * TPS) / FRAME_TICKS) * FRAME_TICKS));
        if (tick !== lastTick) {
          seeking = true;
          lastTick = tick;
          player.seek(tick).finally(() => (seeking = false));
        }
      }
    };
    raf = requestAnimationFrame(frame);

    try {
      for await (const event of ndjson<BeatAudioEvent>(response)) {
        if (signal.aborted) break;
        if (event.type === "start") {
          audio = new StreamPlayer(ctx, event.sampleRate);
          audioRef.current = audio;
        } else if (event.type === "audio" && audio) {
          audio.append(event.data);
          onFirstSound();
        } else if (event.type === "timestamps") {
          timestamps = mergeTimestamps(timestamps, event);
          setWords(timestamps.words);
          if (anchorStart === null) {
            const i = resolveAt(state.beat.at, timestamps);
            if (i >= 0) anchorStart = timestamps.start[i];
          }
        } else if (event.type === "done") streamDone = true;
        else if (event.type === "error") throw new Error(`Sonic: ${event.message}`);
      }
      // If the anchor word never showed up, start the visual with the speech.
      if (anchorStart === null) anchorStart = 0;
      while (!signal.aborted && streamDone && audio && !audio.drained) await new Promise((r) => setTimeout(r, 30));
      await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
    } finally {
      cancelAnimationFrame(raf);
      setWordIndex(timestamps.words.length);
    }
  }, [showDocument]);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    stop();
    const abort = new AbortController();
    abortRef.current = abort;
    const ctx = (ctxRef.current ??= new AudioContext());
    await ctx.resume(); // inside the click, so autoplay allows it
    const t0 = performance.now();
    let heard = false;
    const onFirstSound = () => {
      if (heard) return;
      heard = true;
      setFirstSoundMs(Math.round(performance.now() - t0));
    };

    setError(null);
    setBeats([]);
    setCurrent(-1);
    setWords([]);
    setFirstSoundMs(null);
    setTitle("Planning…");
    setStatus("planning");
    await showDocument(undefined);

    const list: BeatState[] = [];
    let planDone = false;
    let notify: () => void = () => {};
    const changed = () => new Promise<void>((r) => (notify = r));

    // Planner: each beat's visual is drawn onto the board left by the beat before it,
    // so visuals are generated in order, each as soon as its beat and the previous board exist.
    let board: Promise<BoardElement[]> = Promise.resolve([]);
    const planning = (async () => {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }), signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(`planning failed (${res.status})`);
      for await (const event of ndjson<PlanEvent>(res)) {
        if (event.type === "title") setTitle(event.title);
        else if (event.type === "error") throw new Error(`planner: ${event.message}`);
        else if (event.type === "beat") {
          const state: BeatState = { beat: event.beat, plannedAtMs: Math.round(performance.now() - t0), visual: "drawing", ready: Promise.resolve() };
          const before = board;
          const drawn = before.then(async (prev) => {
            if (event.beat.mode === "talk") {
              state.visual = "none";
              return prev;
            }
            const r: { doc?: AnimationDocument; board?: BoardElement[]; cleared?: boolean; ms?: number; edits?: BeatState["edits"] } = await fetch("/api/visual", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: q, beat: event.beat, board: prev }),
              signal: abort.signal,
            }).then((x) => x.json());
            state.doc = r.doc ?? undefined;
            state.visual = r.doc ? "ready" : "failed";
            state.visualMs = r.ms;
            state.cleared = r.cleared;
            state.boardSize = r.board?.length;
            state.edits = r.edits;
            // A failed beat leaves the board as it was.
            return r.doc && r.board ? r.board : prev;
          });
          board = drawn.catch(() => before);
          state.ready = drawn
            .then(() => {})
            .catch(() => {
              state.visual = "failed";
            })
            .finally(() => setBeats([...list]));
          list.push(state);
          setBeats([...list]);
          notify();
        }
      }
    })().finally(() => {
      planDone = true;
      notify();
    });
    planning.catch((e) => {
      if (!abort.signal.aborted) {
        setError(String(e.message ?? e));
        setStatus("error");
      }
    });

    try {
      for (let i = 0; ; i++) {
        while (i >= list.length && !planDone) await changed();
        if (i >= list.length || abort.signal.aborted) break;
        setCurrent(i);
        setStatus("drawing");
        await list[i].ready;
        if (abort.signal.aborted) break;
        setStatus("speaking");
        await playBeat(list[i], abort.signal, onFirstSound);
        // A check-in question waits for the learner before the lesson goes on.
        const more = i + 1 < list.length || !planDone;
        if (list[i].beat.check && more && !abort.signal.aborted) {
          setStatus("waiting");
          await new Promise<void>((resolve) => {
            continueRef.current = resolve;
            abort.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          continueRef.current = null;
        }
      }
      if (!abort.signal.aborted) setStatus((s) => (s === "error" ? s : "done"));
      else setStatus("stopped");
    } catch (e) {
      if (abort.signal.aborted) setStatus("stopped");
      else {
        setError(String((e as Error).message ?? e));
        setStatus("error");
      }
    }
  }, [question, stop, showDocument, playBeat]);

  const busy = status === "planning" || status === "drawing" || status === "speaking" || status === "waiting";
  const micLabel: Record<Status, string> = {
    idle: "Ready", planning: "Planning…", drawing: "Drawing…", speaking: "Speaking", waiting: "Waiting for you", done: "Done", stopped: "Stopped", error: "Error",
  };

  return (
    <div className="board-wrap">
      <div className="board" data-status={status}>
        <header className="topic">
          <h1 data-testid="title">{title}</h1>
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" aria-label="Question" data-testid="question" />
            <button type="submit" disabled={!question.trim()} data-testid="ask">{busy ? "Ask again" : "Ask"}</button>
            {status === "waiting" && (
              <button type="button" className="continue" onClick={() => continueRef.current?.()} data-testid="continue">
                Continue
              </button>
            )}
            {busy && <button type="button" onClick={stop} data-testid="stop">Stop</button>}
          </form>
          <div className="mic" data-state={status === "speaking" || status === "waiting" ? status : "idle"} data-testid="status">
            <span className="dot" />
            {micLabel[status]}
          </div>
        </header>
        <section className="stage" data-testid="stage">
          <div className="visual">
            <canvas ref={canvasRef} aria-label="The current beat's drawing" />
          </div>
        </section>
        <aside className="evidence lesson-beats">
          <div className="empty">Sources will appear here (not wired up yet).</div>
          {beats.length > 0 && (
            <ol data-testid="beats">
              {beats.map((b, i) => (
                <li key={b.beat.id} data-state={i === current ? "now" : i < current ? "done" : "next"}>
                  <span className="beat-say">{b.beat.say}</span>
                  <span className="beat-meta">
                    {b.beat.mode}{b.beat.check ? " · check-in" : ""} · planned at {(b.plannedAtMs / 1000).toFixed(1)} s · {b.visual === "none" ? "no drawing" : `visual ${b.visual === "drawing" ? "drawing…" : b.visual === "failed" ? "failed" : `${((b.visualMs ?? 0) / 1000).toFixed(1)} s`}`}
                    {b.boardSize !== undefined && ` · ${b.cleared ? "new board, " : ""}+${b.edits?.added ?? 0} (${b.boardSize} on board)`}
                    {!!b.edits?.highlights && ` · ${b.edits.highlights} highlight${b.edits.highlights > 1 ? "s" : ""}`}
                    {!!b.edits?.dims && ` · ${b.edits.dims} dim${b.edits.dims > 1 ? "s" : ""}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {firstSoundMs !== null && <p className="beat-meta" data-testid="first-sound">First sound {(firstSoundMs / 1000).toFixed(1)} s after asking.</p>}
        </aside>
        <footer className="caption" data-testid="caption">
          <p>
            {words.map((w, i) => (
              <span key={i} className="word" data-state={i < wordIndex ? "spoken" : i === wordIndex ? "now" : "pending"}>
                {w}{" "}
              </span>
            ))}
          </p>
        </footer>
      </div>
      {error && <div className="lesson-error" data-testid="error">{error}</div>}
    </div>
  );
}
