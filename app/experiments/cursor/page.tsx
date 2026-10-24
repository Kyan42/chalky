"use client";

/**
 * Dev page for the Chalky cursor: /experiments/cursor
 *
 * A fake board with four labelled boxes and an arrow; buttons run each gesture
 * against a wall clock, and "Speak" fetches one sentence from /api/tts, plays
 * it with the stream player and drives a script from the word timestamps, so
 * the cursor lands on the anchor words. Resize the board to check alignment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChalkyCursor, { type CursorStep, type GridBox } from "@/components/ChalkyCursor";
import { StreamPlayer } from "@/lib/audio/stream-player";
import { mergeTimestamps, resolveAt, type WordTimestamps } from "@/lib/beat";
import type { BeatAudioEvent } from "@/lib/sonic";
import { unlockAudio } from "@/lib/voice/audio";

const BOXES: Record<string, GridBox> = {
  sun: { x: 8, y: 10, w: 20, h: 28 },
  molecule: { x: 58, y: 14, w: 22, h: 24 },
  "blue-wave": { x: 8, y: 62, w: 32, h: 20 },
  "red-wave": { x: 56, y: 66, w: 36, h: 18 },
};
const LABELS: Record<string, string> = { sun: "Sun", molecule: "Air molecule", "blue-wave": "Blue wave (short)", "red-wave": "Red wave (long)" };

const SENTENCE = "Light from the sun hits a tiny molecule, and the short blue wave scatters far more than the long red wave does.";
/** Which word each cursor cue lands on in SENTENCE. */
const CUES: { word: string; target: string; gesture: CursorStep["gesture"]; to?: string }[] = [
  { word: "sun", target: "sun", gesture: "point" },
  { word: "molecule", target: "molecule", gesture: "circle" },
  { word: "blue", target: "blue-wave", gesture: "point" },
  { word: "red", target: "blue-wave", gesture: "sweep", to: "red-wave" },
];

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
}

export default function CursorPage() {
  const [width, setWidth] = useState(720);
  const [look, setLook] = useState<"chalk" | "hand">("chalk");
  const [script, setScript] = useState<CursorStep[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [clockLabel, setClockLabel] = useState("0.0");
  const [speaking, setSpeaking] = useState(false);
  const [words, setWords] = useState<{ word: string; t: number }[]>([]);

  // Two clocks: the wall clock for the buttons, the audio clock while a sentence plays.
  const wallStart = useRef(performance.now());
  const audio = useRef<StreamPlayer | null>(null);
  const clock = useCallback(() => {
    const a = audio.current;
    if (a) return Math.max(0, a.position());
    return (performance.now() - wallStart.current) / 1000;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockLabel(clock().toFixed(1)), 100);
    return () => clearInterval(id);
  }, [clock]);

  const say = (line: string) => setLog((l) => [`${clock().toFixed(2)}s  ${line}`, ...l].slice(0, 12));

  const run = (steps: Omit<CursorStep, "t">[], gap = 2.2) => {
    audio.current?.stop();
    audio.current = null;
    const now = clock();
    const next = steps.map((s, i) => ({ ...s, t: now + i * gap }));
    setScript(next);
    say(next.map((s) => `${s.gesture} ${s.target}${s.to ? ` → ${s.to}` : ""} @${s.t.toFixed(1)}`).join(", "));
  };

  const speak = async () => {
    const ctx = await unlockAudio();
    audio.current?.stop();
    setSpeaking(true);
    setScript([]);
    setWords([]);
    let timestamps: WordTimestamps = { words: [], start: [], end: [] };
    let player: StreamPlayer | null = null;
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: SENTENCE }) });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      for await (const ev of ndjson<BeatAudioEvent>(res)) {
        if (ev.type === "start") {
          player = new StreamPlayer(ctx, ev.sampleRate, ev.encoding);
          audio.current = player;
        } else if (ev.type === "audio" && player) {
          player.append(ev.data);
        } else if (ev.type === "timestamps") {
          timestamps = mergeTimestamps(timestamps, ev);
          setWords(timestamps.words.map((w, i) => ({ word: w, t: timestamps.start[i] })));
          // Rebuild the script from every cue whose word is timed so far.
          const steps: CursorStep[] = [];
          for (const c of CUES) {
            const i = resolveAt(c.word, timestamps);
            if (i >= 0) steps.push({ t: timestamps.start[i], target: c.target, gesture: c.gesture, ...(c.to ? { to: c.to } : {}) });
          }
          setScript(steps);
        } else if (ev.type === "done") {
          say(`speech: ${timestamps.words.length} words timed, first audio ${ev.stats.firstAudioMs} ms`);
        } else if (ev.type === "error") throw new Error(ev.message);
      }
      while (player && !(player as StreamPlayer).drained) await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      say(`speech failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setSpeaking(false);
    }
  };

  const reset = () => {
    audio.current?.stop();
    audio.current = null;
    wallStart.current = performance.now();
    setScript([]);
    say("reset");
  };

  const arrow = useMemo(() => {
    const a = BOXES.sun, b = BOXES.molecule;
    return { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
  }, []);

  return (
    <main style={{ padding: 16, background: "#2b2b2b", minHeight: "100vh", color: "#ddd", font: "14px system-ui" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>Chalky cursor</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => run([{ target: "sun", gesture: "point" }])} data-testid="point">Point at sun</button>
        <button onClick={() => run([{ target: "molecule", gesture: "circle" }])} data-testid="circle">Circle molecule</button>
        <button onClick={() => run([{ target: "blue-wave", gesture: "sweep", to: "red-wave" }])} data-testid="sweep">Sweep blue → red</button>
        <button onClick={() => run([{ target: "red-wave", gesture: "sweep" }])} data-testid="sweep-along">Sweep along red</button>
        <button onClick={() => run([{ target: "sun", gesture: "point" }, { target: "molecule", gesture: "circle" }, { target: "blue-wave", gesture: "sweep", to: "red-wave" }, { target: "red-wave", gesture: "point" }])} data-testid="run-all">Run all</button>
        <button onClick={() => void speak()} disabled={speaking} data-testid="speak">{speaking ? "Speaking…" : "Speak (Sonic + timestamps)"}</button>
        <button onClick={reset} data-testid="reset">Reset</button>
        <span style={{ marginLeft: 12 }}>board: </span>
        <button onClick={() => setWidth(480)} data-testid="size-small">480</button>
        <button onClick={() => setWidth(720)} data-testid="size-medium">720</button>
        <button onClick={() => setWidth(1050)} data-testid="size-large">1050</button>
        <span style={{ marginLeft: 12 }}>look: </span>
        <button onClick={() => setLook("chalk")} data-testid="look-chalk">chalk</button>
        <button onClick={() => setLook("hand")} data-testid="look-hand">hand</button>
        <span style={{ marginLeft: "auto" }} data-testid="clock">t = {clockLabel} s</span>
      </div>

      {/* The fake board: paper, four boxes placed in grid percentages, an arrow, and the cursor overlay on top. */}
      <div data-testid="board" style={{ position: "relative", width, aspectRatio: "3 / 2", background: "#f7f5ef", borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", color: "#1f2a44" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
          <defs>
            <marker id="arrow-head" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L6,3 L0,6 Z" fill="#1f2a44" />
            </marker>
          </defs>
          <line x1={arrow.x1 + 1} y1={arrow.y1} x2={arrow.x2 - 1} y2={arrow.y2} stroke="#1f2a44" strokeWidth="0.6" vectorEffect="non-scaling-stroke" markerEnd="url(#arrow-head)" />
          {/* waves drawn inside their boxes */}
          <path d={wavePath(BOXES["blue-wave"], 7)} fill="none" stroke="#2E86E4" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <path d={wavePath(BOXES["red-wave"], 2)} fill="none" stroke="#E4572E" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </svg>
        {Object.entries(BOXES).map(([id, b]) => (
          <div
            key={id}
            data-testid={`el-${id}`}
            style={{ position: "absolute", left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, border: "2px solid #1f2a44", borderRadius: id === "sun" || id === "molecule" ? "50%" : 6, display: "grid", placeItems: "end center", padding: "0 0 4%", fontSize: Math.round(width / 48), fontWeight: 600, background: id === "sun" ? "rgba(244,177,131,0.35)" : "transparent" }}
          >
            {LABELS[id]}
          </div>
        ))}
        <ChalkyCursor boxes={BOXES} script={script} clock={clock} look={look} />
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#aaa", marginBottom: 4 }}>script</div>
          <pre data-testid="script" style={{ margin: 0, fontSize: 12, color: "#ddd" }}>{script.map((s) => `${s.t.toFixed(2)}s  ${s.gesture} ${s.target}${s.to ? ` → ${s.to}` : ""}`).join("\n") || "(none)"}</pre>
          {words.length > 0 && (
            <p style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
              {words.map((w, i) => (
                <span key={i} style={{ marginRight: 6, color: CUES.some((c) => resolveAt(c.word, { words: [w.word], start: [0], end: [0] }) === 0) ? "#F4B183" : undefined }}>
                  {w.word}
                  <sub>{w.t.toFixed(1)}</sub>
                </span>
              ))}
            </p>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#aaa", marginBottom: 4 }}>log</div>
          <pre data-testid="log" style={{ margin: 0, fontSize: 12, color: "#ddd", whiteSpace: "pre-wrap" }}>{log.join("\n") || "(nothing yet)"}</pre>
        </div>
      </div>
    </main>
  );
}

/** A sine wave across a grid box, `cycles` periods wide. */
function wavePath(b: GridBox, cycles: number): string {
  const steps = 60;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = b.x + 2 + (b.w - 4) * u;
    const y = b.y + b.h * 0.42 + Math.sin(u * cycles * Math.PI * 2) * b.h * 0.22;
    parts.push(`${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return parts.join(" ");
}
