"use client";

/**
 * The bare whiteboard and the one-beat loop:
 *   Play → POST /api/tts → stream PCM into Web Audio → resolve each action's
 *   `at` word against Sonic's word timestamps → every animation frame, read
 *   the audio clock and seek the Clayzo player to match.
 * Space interrupts (stop audio, freeze the wave, discard the stream, dim the
 * stage, remember the word) and Space again replays the beat from the start.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { BEAT_B1, mergeTimestamps, resolveAt, wordAt, type Beat, type WordTimestamps } from "@/lib/beat";
import { buildWaveDocument, secondsToTick, TICKS_PER_SECOND } from "@/lib/visuals/wave";
import type { BeatAudioEvent } from "@/lib/sonic";

const TOPIC = "How noise-cancelling headphones work";

type Status = "loading-player" | "ready" | "requesting" | "speaking" | "paused" | "done" | "error";

interface ResumePoint {
  beatId: string;
  wordIndex: number;
  word: string | null;
  speechSeconds: number;
}

interface Run {
  id: number;
  beat: Beat;
  abort: AbortController;
  audio: StreamPlayer | null;
  timestamps: WordTimestamps;
  /** Speech seconds at which each action starts, once its word is known. */
  actionStart: Map<string, number>;
  streamDone: boolean;
  requestedAt: number;
}

/** Everything the browser run reads back to prove what happened. */
interface Telemetry {
  source: "sonic" | null;
  log: { at: number; event: string; [k: string]: unknown }[];
  firstAudioMs: number | null;
  serverStats: unknown;
  timestampLead: { word: string; startsAt: number; audibleAt: number; leadMs: number }[];
  waveCue: { word: string; wordStart: number; firstMovedSpeech: number; lateByMs: number; ctxTime: number } | null;
  /** Every run's cue, including runs that were interrupted. */
  waveCues: NonNullable<Telemetry["waveCue"]>[];
  drift: number[];
  seeks: number;
  underrunSeconds: number;
}

declare global {
  interface Window {
    __chalky?: () => Record<string, unknown>;
  }
}

function freshTelemetry(): Telemetry {
  return { source: null, log: [], firstAudioMs: null, serverStats: null, timestampLead: [], waveCue: null, waveCues: [], drift: [], seeks: 0, underrunSeconds: 0 };
}

export function Whiteboard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const runRef = useRef<Run | null>(null);
  /** The most recent beat audio, kept after a run ends so its output level stays readable. */
  const lastAudioRef = useRef<StreamPlayer | null>(null);
  const runCounter = useRef(0);
  const seekState = useRef({ inFlight: false, lastTick: -1 });
  const telemetry = useRef<Telemetry>(freshTelemetry());
  const resumeRef = useRef<ResumePoint | null>(null);
  const statusRef = useRef<Status>("loading-player");

  const [status, setStatusState] = useState<Status>("loading-player");
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<string[]>(BEAT_B1.say.split(/\s+/));
  const [current, setCurrent] = useState(-1);
  const [resume, setResume] = useState<ResumePoint | null>(null);

  const setStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const log = useCallback((event: string, extra: Record<string, unknown> = {}) => {
    const ctx = ctxRef.current;
    telemetry.current.log.push({ at: Math.round(performance.now()), event, ctxTime: ctx ? +ctx.currentTime.toFixed(4) : null, ...extra });
  }, []);

  // The Clayzo player for `wave.draw`, created once and held paused at tick 0.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const player = await createPlayer({
          canvas: canvasRef.current!,
          document: buildWaveDocument(),
          pauseWhenOffscreen: false,
          onError: (e) => log("player-error", { message: e.message }),
        });
        if (disposed) return player.dispose();
        player.pause();
        await player.seek(0);
        playerRef.current = player;
        setStatus("ready");
      } catch (e) {
        setError(`Clayzo player failed: ${String(e)}`);
        setStatus("error");
      }
    })();
    return () => {
      disposed = true;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [log, setStatus]);

  /** Seek the wave to `tick` unless a seek is already drawing; never queue them. */
  const seekWave = useCallback((tick: number, after?: () => void) => {
    const player = playerRef.current;
    const s = seekState.current;
    if (!player || s.inFlight || tick === s.lastTick) return;
    s.inFlight = true;
    s.lastTick = tick;
    telemetry.current.seeks++;
    player.seek(tick).finally(() => {
      s.inFlight = false;
      after?.();
    });
  }, []);

  const start = useCallback(
    async (beat: Beat) => {
      setError(null);
      const ctx = (ctxRef.current ??= new AudioContext());
      await ctx.resume(); // inside the click / key press, so autoplay allows it
      const run: Run = {
        id: ++runCounter.current,
        beat,
        abort: new AbortController(),
        audio: null,
        timestamps: { words: [], start: [], end: [] },
        actionStart: new Map(),
        streamDone: false,
        requestedAt: performance.now(),
      };
      runRef.current = run;
      seekState.current.lastTick = -1;
      setCurrent(-1);
      setWords(beat.say.split(/\s+/));
      setStatus("requesting");
      log("request", { runId: run.id, beat: beat.id });

      let response: Response;
      try {
        response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: beat.say }),
          signal: run.abort.signal,
        });
      } catch (e) {
        if (run.abort.signal.aborted) return;
        throw e;
      }
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? `TTS request failed (${response.status})`);
        setStatus("error");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const handle = (event: BeatAudioEvent) => {
        const t = telemetry.current;
        if (event.type === "start") {
          t.source = event.source;
          run.audio = new StreamPlayer(ctx, event.sampleRate, event.encoding);
          lastAudioRef.current = run.audio;
        } else if (event.type === "audio" && run.audio) {
          if (t.firstAudioMs === null) {
            t.firstAudioMs = Math.round(performance.now() - run.requestedAt);
            log("first-audio", { msFromRequest: t.firstAudioMs, serverMs: event.tMs });
            setStatus("speaking");
          }
          run.audio.append(event.data);
        } else if (event.type === "timestamps") {
          const audible = run.audio?.position() ?? -1;
          event.words.forEach((w, i) =>
            t.timestampLead.push({ word: w, startsAt: event.start[i], audibleAt: +audible.toFixed(3), leadMs: Math.round((event.start[i] - Math.max(audible, 0)) * 1000) }),
          );
          run.timestamps = mergeTimestamps(run.timestamps, event);
          setWords(run.timestamps.words);
          for (const action of run.beat.actions) {
            if (run.actionStart.has(action.id)) continue;
            const index = resolveAt(action.at, run.timestamps);
            if (index >= 0) {
              run.actionStart.set(action.id, run.timestamps.start[index]);
              log("action-resolved", { action: action.do, anchor: action.at, word: run.timestamps.words[index], wordStart: run.timestamps.start[index] });
            }
          }
          log("timestamps", { words: event.words.length, serverMs: event.tMs, audibleSpeech: +audible.toFixed(3) });
        } else if (event.type === "done") {
          run.streamDone = true;
          t.serverStats = event.stats;
          log("stream-done", { serverMs: event.tMs, bytes: run.audio?.bytesReceived, receivedSeconds: run.audio?.receivedSeconds });
        } else if (event.type === "error") {
          setError(event.message);
          setStatus("error");
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || runRef.current !== run) break;
          pending += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            if (line && runRef.current === run) handle(JSON.parse(line));
          }
        }
      } catch (e) {
        if (!run.abort.signal.aborted) {
          setError(String(e));
          setStatus("error");
        }
      }
    },
    [log, setStatus],
  );

  const interrupt = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.abort.abort(); // discards everything still arriving, and the server aborts Sonic
    run.audio?.stop();
    playerRef.current?.pause();
    const speech = run.audio?.position() ?? -1;
    const index = wordAt(speech, run.timestamps);
    const point: ResumePoint = {
      beatId: run.beat.id,
      wordIndex: index,
      word: index >= 0 ? run.timestamps.words[index] : null,
      speechSeconds: +Math.max(speech, 0).toFixed(3),
    };
    resumeRef.current = point;
    setResume(point);
    runRef.current = null;
    telemetry.current.underrunSeconds += run.audio?.underrunSeconds ?? 0;
    log("interrupt", { ...point, playerTick: playerRef.current?.tick, bytes: run.audio?.bytesReceived });
    setStatus("paused");
  }, [log, setStatus]);

  const resumeBeat = useCallback(async () => {
    const point = resumeRef.current;
    log("resume", { from: point });
    // Simplest correct resume: rewind the visual and replay the sentence.
    seekState.current.lastTick = -1;
    await playerRef.current?.seek(0);
    resumeRef.current = null;
    setResume(null);
    telemetry.current.waveCue = null;
    telemetry.current.firstAudioMs = null;
    await start(BEAT_B1);
  }, [log, start]);

  const play = useCallback(() => {
    if (statusRef.current === "ready" || statusRef.current === "done" || statusRef.current === "error") {
      telemetry.current = freshTelemetry();
      seekState.current.lastTick = -1;
      playerRef.current?.seek(0);
      start(BEAT_B1).catch((e) => (setError(String(e)), setStatus("error")));
    }
  }, [setStatus, start]);

  // Space toggles interrupt / resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (e.repeat) return;
      const s = statusRef.current;
      if (s === "speaking" || s === "requesting") interrupt();
      else if (s === "paused") resumeBeat().catch((err) => (setError(String(err)), setStatus("error")));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interrupt, resumeBeat, setStatus]);

  // The sync loop: the audio clock is the master; the wave and captions follow.
  useEffect(() => {
    let raf = 0;
    let lastWord = -2;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const run = runRef.current;
      if (!run?.audio || statusRef.current !== "speaking") return;
      const speech = run.audio.position();

      const index = wordAt(speech, run.timestamps);
      if (index !== lastWord) {
        lastWord = index;
        setCurrent(index);
        if (index >= 0) log("word", { index, word: run.timestamps.words[index], speech: +speech.toFixed(3) });
      }

      for (const action of run.beat.actions) {
        const startAt = run.actionStart.get(action.id);
        if (action.do !== "wave.draw" || startAt === undefined) continue;
        const local = speech - startAt;
        const tick = local < 0 ? 0 : secondsToTick(local);
        seekWave(tick, () => {
          const player = playerRef.current;
          const now = runRef.current?.audio?.position();
          if (!player || now === undefined || now < 0) return;
          const t = telemetry.current;
          if (player.tick > 0 && !t.waveCue) {
            const i = resolveAt(action.at, run.timestamps);
            t.waveCue = {
              word: run.timestamps.words[i],
              wordStart: startAt,
              firstMovedSpeech: +now.toFixed(4),
              lateByMs: Math.round((now - startAt) * 1000),
              ctxTime: +run.audio!.ctx.currentTime.toFixed(4),
            };
            t.waveCues.push(t.waveCue);
            log("wave-started", t.waveCue);
          }
          // Drift: what the wave shows minus where the audio is, after the draw.
          if (player.tick > 0 && player.tick < secondsToTick(10)) {
            t.drift.push(+((player.tick / TICKS_PER_SECOND - (now - startAt)) * 1000).toFixed(1));
          }
        });
      }

      if (run.streamDone && run.audio.drained) {
        telemetry.current.underrunSeconds += run.audio.underrunSeconds;
        runRef.current = null;
        setCurrent(run.timestamps.words.length);
        log("beat-done");
        setStatus("done");
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [log, seekWave, setStatus]);

  // Read-back for the browser run.
  useEffect(() => {
    window.__chalky = () => {
      const ctx = ctxRef.current;
      const run = runRef.current;
      return {
        status: statusRef.current,
        audioContext: ctx ? { state: ctx.state, currentTime: ctx.currentTime, sampleRate: ctx.sampleRate } : null,
        speechSeconds: run?.audio?.position() ?? null,
        bytesReceived: run?.audio?.bytesReceived ?? null,
        lastBytesReceived: lastAudioRef.current?.bytesReceived ?? null,
        outputLevel: lastAudioRef.current?.level() ?? null,
        playerTick: playerRef.current?.tick ?? null,
        playerPlaying: playerRef.current?.playing ?? null,
        resumePoint: resumeRef.current,
        telemetry: telemetry.current,
      };
    };
  }, []);

  const micLabel: Record<Status, string> = {
    "loading-player": "Loading…",
    ready: "Ready",
    requesting: "Thinking…",
    speaking: "Speaking · Space to interrupt",
    paused: "Paused · Space to resume",
    done: "Done",
    error: "Error",
  };
  const micState = status === "speaking" || status === "requesting" ? "speaking" : status === "paused" ? "paused" : "idle";

  return (
    <div className="board-wrap">
      <div className="board" data-status={status}>
        <header className="topic">
          <h1>{TOPIC}</h1>
          <div className="mic" data-state={micState} data-testid="mic">
            <span className="dot" />
            {micLabel[status]}
          </div>
        </header>
        <section className="stage" data-dimmed={status === "paused"} data-testid="stage">
          <div className="visual">
            <canvas ref={canvasRef} aria-label="A sine wave drawing itself left to right" />
          </div>
        </section>
        <aside className="evidence">
          <div className="empty">Sources will appear here.</div>
          {resume && (
            <p data-testid="resume-point">
              Paused at beat <b>{resume.beatId}</b>, word {resume.wordIndex + 1}
              {resume.word ? ` (“${resume.word}”)` : ""}.
            </p>
          )}
        </aside>
        <footer className="caption" data-testid="caption">
          <p>
            {words.map((w, i) => (
              <span key={i} className="word" data-state={i < current ? "spoken" : i === current ? "now" : "pending"}>
                {w}{" "}
              </span>
            ))}
          </p>
        </footer>
      </div>
      <div className="controls">
        <button onClick={play} disabled={!["ready", "done", "error"].includes(status)} data-testid="play">
          Play
        </button>
        <span>Space: interrupt / resume</span>
        {error && <span className="err" data-testid="error">{error}</span>}
      </div>
    </div>
  );
}
