"use client";

/**
 * The lesson loop, voice first. Ask out loud (or type): the planner streams
 * beats, each beat's scene-language visual is generated in order onto the
 * growing board, and beats play with Sonic voice. Audio is the clock: each
 * frame the board's Clayzo player is seeked to (speech time − anchor word start).
 *
 * Talking back, using the listening half of Janani's voice loop (PR #2):
 * - at a check-in, answer out loud; "yes / keep going" carries on, anything
 *   else gets a spoken reply first;
 * - press Space (or "Ask") mid-beat to cut in: Chalky stops, listens, answers,
 *   then replays the beat it was on.
 * The mic is half-duplex: it isn't sent while Chalky is speaking.
 *
 * The board grows: each beat's document holds everything drawn so far (earlier
 * beats already finished, this beat animating in), and the player swaps to it
 * at the beat boundary.
 */
import { createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbState } from "@/components/Orb";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { mergeTimestamps, resolveAt, wordAt, type WordTimestamps } from "@/lib/beat";
import type { BoardElement } from "@/lib/lesson/board";
import type { PlanEvent, PlannedBeat } from "@/lib/lesson/types";
import type { BeatAudioEvent } from "@/lib/sonic";
import { unlockAudio } from "@/lib/voice/audio";
import { useListening } from "@/lib/voice/useListening";

const TPS = 240;
const FRAME_TICKS = 4;
const DOC_END = 6 * TPS;
const GAP_SECONDS = 0.45;
/** Speakers ring on for a moment after the audio ends; keep the mic closed a little longer. */
const ECHO_TAIL_MS = 300;
const GREETING = "Hey, I'm Chalky! What do you want to learn today?";
/** Replies that just mean "carry on" (from Janani's session controller), answered without a model call. */
const RESUME = /^\W*(ok(ay)?|sure|yes|yeah|yep|got it|makes sense|that makes sense|thanks?( you)?|cool|great)?\W*(resume|continue|keep going|go on|carry on|next|never ?mind|move on)?\W*$/i;

type Status = "idle" | "planning" | "drawing" | "speaking" | "waiting" | "listening" | "replying" | "done" | "stopped" | "error";

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

/** A spoken line that isn't a lesson beat (the greeting, a reply): it leaves the board alone. */
function line(say: string): BeatState {
  return { beat: { id: "line", say, at: "", visual: "", mode: "talk", check: false }, plannedAtMs: 0, visual: "none", ready: Promise.resolve() };
}

export default function Lesson() {
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("Ask Chalky anything");
  const [status, setStatus] = useState<Status>("idle");
  const [beats, setBeats] = useState<BeatState[]>([]);
  const [current, setCurrent] = useState(-1);
  const [words, setWords] = useState<string[]>([]);
  const [wordIndex, setWordIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [firstSoundMs, setFirstSoundMs] = useState<number | null>(null);
  const [lastReplyMs, setLastReplyMs] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const beatAbortRef = useRef<AbortController | null>(null);
  const interruptedRef = useRef(false);
  const audioRef = useRef<StreamPlayer | null>(null);
  const speakingRef = useRef(false);
  /** Set while the lesson waits for the learner; resolves with what they said (null = just carry on). */
  const turnRef = useRef<((text: string | null) => void) | null>(null);
  const statusRef = useRef<Status>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const askRef = useRef<(q: string) => void>(() => {});
  const voice = useListening(
    {
      onEnd: (text) => {
        const said = text.trim();
        if (!said) return;
        if (turnRef.current) turnRef.current(said);
        else if (["idle", "done", "stopped", "error"].includes(statusRef.current)) askRef.current(said);
      },
    },
    () => speakingRef.current,
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    beatAbortRef.current?.abort();
    audioRef.current?.stop();
    playerRef.current?.pause();
    turnRef.current?.(null);
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
  const playBeat = useCallback(async (state: BeatState, signal: AbortSignal, onFirstSound?: () => void) => {
    const ctx = await unlockAudio();
    setWords(state.beat.say.split(/\s+/));
    setWordIndex(-1);
    speakingRef.current = true;
    // A talk beat (or a failed visual) has no document of its own: the board stays as it is.
    const follow = !!state.doc;
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

    try {
      const [response] = await Promise.all([
        fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: state.beat.say }), signal }),
        follow ? showDocument(state.doc) : Promise.resolve(),
      ]);
      if (!response.ok || !response.body) throw new Error(`speech failed (${response.status})`);
      raf = requestAnimationFrame(frame);
      for await (const event of ndjson<BeatAudioEvent>(response)) {
        if (signal.aborted) break;
        if (event.type === "start") {
          audio = new StreamPlayer(ctx, event.sampleRate);
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
        } else if (event.type === "done") streamDone = true;
        else if (event.type === "error") throw new Error(`Sonic: ${event.message}`);
      }
      // If the anchor word never showed up, start the visual with the speech.
      if (anchorStart === null) anchorStart = 0;
      while (!signal.aborted && streamDone && audio && !audio.drained) await new Promise((r) => setTimeout(r, 30));
      if (!signal.aborted) {
        setWordIndex(timestamps.words.length);
        await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
      }
    } finally {
      cancelAnimationFrame(raf);
      if (signal.aborted) audio?.stop();
      setTimeout(() => (speakingRef.current = false), ECHO_TAIL_MS);
    }
  }, [showDocument]);

  /** Waits for the learner: a spoken turn, a typed reply, or Continue (null). */
  const awaitTurn = useCallback((signal: AbortSignal) => {
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
    let heard = false;
    const onFirstSound = () => {
      if (heard) return;
      heard = true;
      setFirstSoundMs(Math.round(performance.now() - t0));
    };
    const said: string[] = [];

    setQuestion(q);
    setDraft("");
    setError(null);
    setBeats([]);
    setCurrent(-1);
    setWords([]);
    setFirstSoundMs(null);
    setLastReplyMs(null);
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
        if (event.type === "title") {
          setTitle(event.title);
          voice.setKeyterms([...event.title.split(/\s+/), ...q.split(/\s+/)].filter((w) => w.length > 4));
        } else if (event.type === "error") throw new Error(`planner: ${event.message}`);
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

    /** Answers what the learner said, out loud. Returns false if they want to stop. */
    const answer = async (heard: string, kind: "check-in" | "interrupt", now?: string) => {
      if (RESUME.test(heard)) return true;
      setStatus("replying");
      const r: { say?: string; intent?: string; ms?: number; error?: string } = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, said, now, heard, kind }),
        signal: abort.signal,
      }).then((x) => x.json());
      if (r.ms) setLastReplyMs(r.ms);
      if (r.say) {
        setStatus("speaking");
        await playBeat(line(r.say), abort.signal);
      }
      return r.intent !== "stop";
    };

    try {
      for (let i = 0; ; i++) {
        while (i >= list.length && !planDone) await changed();
        if (i >= list.length || abort.signal.aborted) break;
        setCurrent(i);
        setStatus("drawing");
        await list[i].ready;
        if (abort.signal.aborted) break;
        setStatus("speaking");
        const beatAbort = new AbortController();
        beatAbortRef.current = beatAbort;
        abort.signal.addEventListener("abort", () => beatAbort.abort(), { once: true });
        try {
          await playBeat(list[i], beatAbort.signal, onFirstSound);
        } catch (e) {
          if (!interruptedRef.current) throw e;
        }
        if (abort.signal.aborted) break;

        // Cut in mid-beat: listen, answer, then replay this beat from its start.
        if (interruptedRef.current) {
          interruptedRef.current = false;
          setStatus("listening");
          const heard = await awaitTurn(abort.signal);
          if (abort.signal.aborted) break;
          if (heard && !(await answer(heard, "interrupt", list[i].beat.say))) break;
          i--;
          continue;
        }
        said.push(list[i].beat.say);

        // A check-in question waits for the learner before the lesson goes on.
        const more = i + 1 < list.length || !planDone;
        if (list[i].beat.check && more) {
          setStatus("waiting");
          const heard = await awaitTurn(abort.signal);
          if (abort.signal.aborted) break;
          if (heard && !(await answer(heard, "check-in"))) break;
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
  }, [stop, showDocument, playBeat, awaitTurn, voice]);

  useEffect(() => {
    askRef.current = (q) => void ask(q);
  }, [ask]);

  /** Stops Chalky mid-beat to listen. */
  const interrupt = useCallback(() => {
    if (statusRef.current !== "speaking" || !beatAbortRef.current) return;
    interruptedRef.current = true;
    beatAbortRef.current.abort();
    audioRef.current?.stop();
    playerRef.current?.pause();
  }, []);

  // Space cuts in while Chalky speaks (unless you're typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (statusRef.current === "speaking") {
        e.preventDefault();
        interrupt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interrupt]);

  const startTalking = useCallback(async () => {
    try {
      await voice.start();
      const abort = new AbortController();
      abortRef.current = abort;
      setStatus("speaking");
      await playBeat(line(GREETING), abort.signal);
      setStatus("idle");
    } catch (e) {
      setError(`Voice couldn't start: ${String((e as Error).message ?? e)}. You can still type.`);
      setStatus("idle");
    }
  }, [voice, playBeat]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (turnRef.current) {
      setDraft("");
      turnRef.current(text);
    } else void ask(text);
  };

  const waitingForLearner = status === "waiting" || status === "listening";
  const busy = ["planning", "drawing", "speaking", "waiting", "listening", "replying"].includes(status) && !!question;
  const orbState: OrbState =
    status === "speaking" ? "speaking"
    : status === "planning" || status === "replying" || (status === "drawing" && current === 0) ? "thinking"
    : voice.started ? "listening"
    : "idle";
  const orbLevel = useCallback(() => (speakingRef.current ? (audioRef.current?.level() ?? 0) : voice.micLevel()), [voice]);
  const statusLabel: Record<Status, string> = {
    idle: voice.started ? "Listening" : "Ready", planning: "Planning…", drawing: "Drawing…", speaking: "Speaking", waiting: "Your turn",
    listening: "Listening", replying: "Thinking…", done: voice.started ? "Done · ask another" : "Done", stopped: "Stopped", error: "Error",
  };
  const showWelcome = !question && status !== "speaking";

  return (
    <div className="board-wrap">
      <div className="board" data-status={status}>
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
              placeholder={waitingForLearner ? "Answer or ask Chalky…" : "Type a question, or just say it"}
              aria-label="Question"
              data-testid="question"
            />
            <button type="submit" disabled={!draft.trim()} data-testid="ask">{waitingForLearner ? "Send" : busy ? "New lesson" : "Ask"}</button>
            {status === "speaking" && busy && (
              <button type="button" onClick={interrupt} data-testid="interrupt" title="Space">Cut in</button>
            )}
            {waitingForLearner && (
              <button type="button" className="continue" onClick={() => turnRef.current?.(null)} data-testid="continue">Continue</button>
            )}
            {busy && <button type="button" onClick={stop} data-testid="stop">Stop</button>}
          </form>
          <div className="mic" data-testid="status">
            {statusLabel[status]}
            <Orb state={orbState} level={orbLevel} size={34} />
          </div>
        </header>
        <section className="stage" data-testid="stage">
          <div className="visual">
            <canvas ref={canvasRef} aria-label="The whiteboard" />
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
          {lastReplyMs !== null && <p className="beat-meta" data-testid="reply-ms">Last answer took {(lastReplyMs / 1000).toFixed(1)} s.</p>}
        </aside>
        <footer className="caption" data-testid="caption">
          {voice.partial ? (
            <p className="heard" data-testid="heard">“{voice.partial}”</p>
          ) : (
            <p>
              {words.map((w, i) => (
                <span key={i} className="word" data-state={i < wordIndex ? "spoken" : i === wordIndex ? "now" : "pending"}>
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
