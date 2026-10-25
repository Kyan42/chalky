"use client";

/**
 * Dev page for the hybrid microphone: /experiments/mic
 *
 * Start the mic, then talk: with "Chalky is speaking" off the mic is open and
 * each utterance is logged; with it on the mic is muted and holding Space
 * barges in (the event fires on key down, the utterance on key up).
 */
import { useEffect, useRef, useState } from "react";
import { Orb } from "@/components/Orb";
import { useHybridMic, type MicMode } from "@/lib/voice/useHybridMic";

interface Entry {
  t: string;
  kind: string;
  text: string;
}

export default function MicPage() {
  const [speaking, setSpeaking] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [key, setKey] = useState("Space");
  const t0 = useRef(performance.now());
  const add = (kind: string, text = "") => setLog((l) => [{ t: ((performance.now() - t0.current) / 1000).toFixed(2), kind, text }, ...l].slice(0, 40));

  const mic = useHybridMic({
    speaking,
    key,
    onBargeIn: () => add("barge-in", "(Chalky would stop talking now)"),
    onBargeInCancelled: () => add("barge-in cancelled", "(too short or nothing heard; Chalky carries on)"),
    onPartial: () => {},
    onUtterance: (text, meta) => add("utterance", `${JSON.stringify(text)} via ${meta.via}, ${meta.turns} turn(s)${meta.holdMs ? `, held ${Math.round(meta.holdMs)} ms` : ""}`),
    onError: (m) => add("error", m),
  });

  // Space toggles nothing here; "s" flips the fake speaking state so a keyboard-only test can drive it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyS" && !(e.target as HTMLElement)?.matches("input,textarea")) setSpeaking((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label: Record<MicMode, string> = {
    off: "mic off",
    paused: "paused: hearing nothing",
    open: "open mic: just talk",
    muted: `muted while Chalky speaks: hold ${key} to barge in`,
    held: "listening (key held)",
    tail: "key released: waiting for the end of the turn",
    voice: "Chalky speaking: talk to interrupt (voice barge-in)",
  };

  return (
    <main style={{ padding: 16, background: "#2b2b2b", minHeight: "100vh", color: "#ddd", font: "14px system-ui" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>Hybrid mic</h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {!mic.started && (
          <button onClick={() => void mic.start().catch(() => {})} data-testid="start">Start mic</button>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={speaking} onChange={(e) => setSpeaking(e.target.checked)} data-testid="speaking" />
          Chalky is speaking (fake; or press S)
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          barge-in key
          <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="key">
            <option>Space</option>
            <option>KeyB</option>
            <option>Enter</option>
          </select>
        </label>
        <Orb state={mic.mode === "open" || mic.mode === "held" || mic.mode === "tail" ? "listening" : speaking ? "speaking" : "idle"} level={mic.level} size={40} />
      </div>
      <p data-testid="mode" data-mode={mic.mode} style={{ fontSize: 16, margin: "0 0 8px", color: mic.mode === "held" || mic.mode === "open" ? "#4DA3FF" : "#ddd" }}>
        mode: <b>{mic.mode}</b> — {label[mic.mode]}
      </p>
      <p data-testid="partial" style={{ minHeight: 24, fontStyle: "italic", color: "#2ED3B7", margin: "0 0 12px" }}>{mic.partial ? `“${mic.partial}”` : "…"}</p>
      {mic.error && <p data-testid="error" style={{ color: "#ff8a80" }}>{mic.error}</p>}
      <div style={{ color: "#aaa", marginBottom: 4 }}>events</div>
      <ol data-testid="log" style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13 }}>
        {log.map((e, i) => (
          <li key={i} data-kind={e.kind} style={{ padding: "2px 0", borderBottom: "1px solid #3a3a3a" }}>
            <span style={{ color: "#888", marginRight: 8 }}>{e.t}s</span>
            <b style={{ color: e.kind === "utterance" ? "#2ED3B7" : e.kind.startsWith("barge") ? "#F4B183" : "#ddd" }}>{e.kind}</b> {e.text}
          </li>
        ))}
      </ol>
    </main>
  );
}
