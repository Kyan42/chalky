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
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbState } from "@/components/Orb";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { mergeTimestamps, resolveAt, wordAt, type WordTimestamps } from "@/lib/beat";
import { compilePresetBoard, type PresetElement } from "@/lib/lesson/presets";
import type { PlanEvent, PlannedBeat } from "@/lib/lesson/types";
import type { BeatAudioEvent } from "@/lib/sonic";
import { unlockAudio } from "@/lib/voice/audio";
import { useListening } from "@/lib/voice/useListening";

const TPS = 240;
const FRAME_TICKS = 4;
/** Documents are 20 s long (experiments/visual-flex/doc.ts), enough for any highlight in a beat. */
const DOC_END = 20 * TPS;
const GAP_SECONDS = 0.45;
/** Speakers ring on for a moment after the audio ends; keep the mic closed a little longer. */
const ECHO_TAIL_MS = 300;
const WORDS_PER_SECOND = 2.6;
const HIGHLIGHT_SECONDS = 1.8;
const GREETING = "Hey, I'm Chalky! What do you want to learn today?";
/** Replies that just mean "carry on" (from Janani's session controller), answered without a model call. */
const RESUME = /^\W*(ok(ay)?|sure|yes|yeah|yep|got it|makes sense|that makes sense|thanks?( you)?|cool|great)?\W*(resume|continue|keep going|go on|carry on|next|never ?mind|move on)?\W*$/i;

type Status = "idle" | "planning" | "speaking" | "waiting" | "listening" | "replying" | "done" | "stopped" | "error";

/** none: talk beat. local: a point beat built here from the planner's ids. pending/ready/failed: the drawer. */
type DrawState = "none" | "pending" | "ready" | "failed" | "local";

interface BeatState {
  beat: PlannedBeat;
  plannedAtMs: number;
  draw: DrawState;
  elements: PresetElement[] | null;
  drawMs?: number;
  model?: string;
  error?: string | null;
  /** Seconds after its anchor word the drawing arrived; unset when it was in time. */
  lateSec?: number;
  /** Resolves when the drawing settles, with its elements or null. */
  ready: Promise<PresetElement[] | null>;
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

/** The element groups of beat `i`'s scene: earlier beats as drawn, then `current` for beat `i` itself. */
function sceneGroups(list: BeatState[], i: number, current: PresetElement[]): PresetElement[][] {
  const scene = list[i].beat.scene;
  const groups: PresetElement[][] = [];
  for (let j = 0; j < i; j++) {
    const b = list[j];
    if (b.beat.scene !== scene || b.beat.mode === "talk") continue;
    groups.push(b.elements ?? []);
  }
  groups.push(current);
  return groups;
}

function compileScene(groups: PresetElement[][]): AnimationDocument | null {
  if (!groups.some((g) => g.length)) return null;
  const { doc, report } = compilePresetBoard(groups, groups.length - 1, `board-${Date.now()}`);
  if (report.dangling.length) console.info(`[board] dangling refs: ${report.dangling.join("; ")}`);
  return doc;
}

export default function Lesson() {
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("Ask Chalky anything");
  const [status, setStatus] = useState<Status>("idle");
  const [beats, setBeats] = useState<BeatState[]>([]);
  const [current, setCurrent] = useState(-1);
  const [words, setWords] = useState<string[]>([]);
  const [wordIndexNow, setWordIndexNow] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [firstSoundMs, setFirstSoundMs] = useState<number | null>(null);
  const [lessonSoundMs, setLessonSoundMs] = useState<number | null>(null);
  const [lastReplyMs, setLastReplyMs] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const playerGen = useRef(0);
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
  const playBeat = useCallback(async (state: BeatState, signal: AbortSignal, compile: Compile | null, onFirstSound?: () => void) => {
    const ctx = await unlockAudio();
    setWords(state.beat.say.split(/\s+/));
    setWordIndexNow(-1);
    speakingRef.current = true;
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
      await showDocument(compile(currentElements));
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!audio) return;
      const t = audio.position();
      if (t < 0) return;
      setWordIndexNow(wordAt(t, timestamps));
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

    try {
      // The board as it can be shown right now; a drawing still in flight binds when it lands.
      let initial: PresetElement[] = [];
      if (compile && state.draw === "local") initial = pointElements(state.beat, () => null);
      else if (compile && state.elements) initial = state.elements;
      const [response] = await Promise.all([
        fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: state.beat.say }), signal }),
        compile ? show(initial) : Promise.resolve(),
      ]);
      if (!response.ok || !response.body) throw new Error(`speech failed (${response.status})`);
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
        } else if (event.type === "done") {
          streamDone = true;
          // Every word is timed now: place a point beat's highlights exactly.
          if (compile && state.draw === "local" && anchorStart !== null) {
            const base = anchorStart;
            const exact = pointElements(state.beat, (word) => {
              const i = resolveAt(word, timestamps);
              return i >= 0 ? timestamps.start[i] - base : null;
            });
            const initialAts = pointElements(state.beat, () => null).map((e) => e.at);
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
      }
    } finally {
      playing = false;
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
    const since = () => Math.round(performance.now() - t0);
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
    setLastReplyMs(null);
    setTitle("Planning…");
    setStatus("planning");
    await showDocument(undefined);

    const post = (path: string, body: unknown) =>
      fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });

    // The opener: one line to say while the planner thinks.
    const opener = post("/api/opener", { question: q })
      .then((r) => r.json())
      .then((r: { say?: string }) => (typeof r.say === "string" ? r.say : null))
      .catch(() => null);

    const list: BeatState[] = [];
    let planDone = false;
    let notify: () => void = () => {};
    const changed = () => new Promise<void>((r) => (notify = r));
    let firstBeat: () => void = () => {};
    const firstBeatPlanned = new Promise<void>((r) => (firstBeat = r));

    // Planner: every draw beat is drawn as soon as it is planned, from the layout alone, so beats draw in parallel.
    const planning = (async () => {
      const res = await post("/api/plan", { question: q });
      if (!res.ok || !res.body) throw new Error(`planning failed (${res.status})`);
      for await (const event of ndjson<PlanEvent>(res)) {
        if (event.type === "title") {
          setTitle(event.title);
          voice.setKeyterms([...event.title.split(/\s+/), ...q.split(/\s+/)].filter((w) => w.length > 4));
        } else if (event.type === "error") throw new Error(`planner: ${event.message}`);
        else if (event.type === "beat") {
          const beat = event.beat;
          const state: BeatState = { beat, plannedAtMs: since(), draw: "none", elements: [], ready: Promise.resolve(null) };
          if (beat.mode === "point" && beat.points.length) {
            state.draw = "local";
          } else if (beat.mode !== "talk") {
            state.draw = "pending";
            state.elements = null;
            const earlier = list.filter((b) => b.beat.scene === beat.scene && b.beat.mode === "draw").map((b) => b.beat);
            state.ready = post("/api/draw", { question: q, beat, earlier })
              .then((r) => r.json())
              .then((r: { elements?: PresetElement[]; ms?: number; model?: string; error?: string | null }) => {
                state.elements = r.elements ?? [];
                state.draw = state.elements.length ? "ready" : "failed";
                state.drawMs = r.ms;
                state.model = r.model;
                state.error = r.error ?? null;
                return state.elements.length ? state.elements : null;
              })
              .catch((e: Error) => {
                state.elements = [];
                state.draw = "failed";
                state.error = abort.signal.aborted ? "stopped" : String(e.message ?? e);
                return null;
              })
              .finally(() => setBeats([...list]));
          }
          list.push(state);
          setBeats([...list]);
          if (list.length === 1) firstBeat();
          notify();
        }
      }
    })().finally(() => {
      planDone = true;
      firstBeat();
      notify();
    });
    planning.catch((e) => {
      if (!abort.signal.aborted) {
        setError(String(e.message ?? e));
        setStatus("error");
      }
    });

    /** Answers what the learner said, out loud. Returns false if they want to stop. */
    const answer = async (heardText: string, kind: "check-in" | "interrupt", now?: string) => {
      if (RESUME.test(heardText)) return true;
      setStatus("replying");
      const r: { say?: string; intent?: string; ms?: number; error?: string } = await post("/api/reply", { question: q, said, now, heard: heardText, kind }).then((x) => x.json());
      if (r.ms) setLastReplyMs(r.ms);
      if (r.say) {
        setStatus("speaking");
        await playBeat(line(r.say), abort.signal, null);
      }
      return r.intent !== "stop";
    };

    try {
      // Say the opener if it lands before the first beat does.
      const first = await Promise.race([opener, firstBeatPlanned.then(() => null)]);
      if (first && !abort.signal.aborted) {
        setStatus("speaking");
        await playBeat(line(first), abort.signal, null, onFirstSound);
      }

      for (let i = 0; ; i++) {
        if (i >= list.length && !planDone) setStatus("planning");
        while (i >= list.length && !planDone) await changed();
        if (i >= list.length || abort.signal.aborted) break;
        setCurrent(i);
        setStatus("speaking");
        const compile: Compile | null = list[i].beat.mode === "talk" ? null : (currentElements) => compileScene(sceneGroups(list, i, currentElements));
        const beatAbort = new AbortController();
        beatAbortRef.current = beatAbort;
        abort.signal.addEventListener("abort", () => beatAbort.abort(), { once: true });
        try {
          await playBeat(list[i], beatAbort.signal, compile, onLessonSound);
        } catch (e) {
          if (!interruptedRef.current) throw e;
        }
        setBeats([...list]);
        if (abort.signal.aborted) break;

        // Cut in mid-beat: listen, answer, then replay this beat from its start.
        if (interruptedRef.current) {
          interruptedRef.current = false;
          setStatus("listening");
          const heardText = await awaitTurn(abort.signal);
          if (abort.signal.aborted) break;
          if (heardText && !(await answer(heardText, "interrupt", list[i].beat.say))) break;
          i--;
          continue;
        }
        said.push(list[i].beat.say);

        // A check-in question waits for the learner before the lesson goes on.
        const more = i + 1 < list.length || !planDone;
        if (list[i].beat.check && more) {
          setStatus("waiting");
          const heardText = await awaitTurn(abort.signal);
          if (abort.signal.aborted) break;
          if (heardText && !(await answer(heardText, "check-in"))) break;
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
      await playBeat(line(GREETING), abort.signal, null);
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
  const busy = ["planning", "speaking", "waiting", "listening", "replying"].includes(status) && !!question;
  const orbState: OrbState =
    status === "speaking" ? "speaking"
    : status === "planning" || status === "replying" ? "thinking"
    : voice.started ? "listening"
    : "idle";
  const orbLevel = useCallback(() => (speakingRef.current ? (audioRef.current?.level() ?? 0) : voice.micLevel()), [voice]);
  const statusLabel: Record<Status, string> = {
    idle: voice.started ? "Listening" : "Ready", planning: "Planning…", speaking: "Speaking", waiting: "Your turn",
    listening: "Listening", replying: "Thinking…", done: voice.started ? "Done · ask another" : "Done", stopped: "Stopped", error: "Error",
  };
  const showWelcome = !question && status !== "speaking";

  const drawLabel = (b: BeatState) => {
    switch (b.draw) {
      case "none": return "no drawing";
      case "local": return `points at ${b.beat.points.map((p) => p.id).join(", ")} · no model call`;
      case "pending": return "drawing…";
      case "failed": return `drawing failed: ${b.error ?? "unknown"}`;
      case "ready": return `drawn in ${((b.drawMs ?? 0) / 1000).toFixed(1)} s (${(b.model ?? "").replace("claude-", "")}) · ${b.elements?.length ?? 0} elements${b.lateSec ? ` · landed ${b.lateSec} s after its word` : ""}`;
    }
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
                <li key={b.beat.id} data-state={i === current ? "now" : i < current ? "done" : "next"} data-scene={b.beat.scene}>
                  <span className="beat-say">{b.beat.say}</span>
                  <span className="beat-meta">
                    scene {b.beat.scene} · {b.beat.mode}{b.beat.check ? " · check-in" : ""} · planned at {(b.plannedAtMs / 1000).toFixed(1)} s · {drawLabel(b)}
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
          {lastReplyMs !== null && <p className="beat-meta" data-testid="reply-ms">Last answer took {(lastReplyMs / 1000).toFixed(1)} s.</p>}
        </aside>
        <footer className="caption" data-testid="caption">
          {voice.partial ? (
            <p className="heard" data-testid="heard">“{voice.partial}”</p>
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
