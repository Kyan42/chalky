"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_PREFERENCES, LANGUAGES, parsePreferences, type Preferences as Settings } from "@/lib/preferences";

export default function Preferences() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_PREFERENCES);
  const [voices, setVoices] = useState<{id: string; name: string; language: string}[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [loading, setLoading] = useState(false);
  async function loadVoices() {
    setLoading(true); setVoiceError("");
    try {
      const response = await fetch("/api/cartesia/voices");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setVoices(data.voices);
    } catch { setVoiceError("Voices couldn’t load. Try again."); }
    finally { setLoading(false); }
  }
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    document.cookie = `chalky-preferences=${encodeURIComponent(JSON.stringify(next))}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }
  const [speed, setSpeed] = useState("default");
  useEffect(() => {
    setSettings(parsePreferences(document.cookie.split("; ").find(p => p.startsWith("chalky-preferences="))?.split("=")[1]));
    const saved = document.cookie.split("; ").find((part) => part.startsWith("chalky-speed="))?.split("=")[1];
    if (saved && ["0.75", "0.92", "1", "1.15", "1.3"].includes(saved)) setSpeed(saved);
  }, []);
  return <>
    <button className="preferences-gear" aria-label="Preferences" title="Preferences" onClick={() => { dialog.current?.showModal(); if (!voices.length) void loadVoices(); }}>
      <svg width="39.2" height="39.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="m9.5 3-.6 2.4-1.5.9L5 5.6 2.5 10l1.8 1.7v1.7L2.5 15 5 19.4l2.4-.7 1.5.9.6 2.4h5l.6-2.4 1.5-.9 2.4.7 2.5-4.4-1.8-1.6v-1.7l1.8-1.7L19 5.6l-2.4.7-1.5-.9-.6-2.4z" />
        <circle cx="12" cy="12.5" r="3.5" />
      </svg>
    </button>
    <dialog ref={dialog} className="preferences-panel" aria-labelledby="preferences-title" onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="preferences-content">
        <header><h2 id="preferences-title">Make yourself comfortable.</h2><button aria-label="Close preferences" onClick={() => dialog.current?.close()}>×</button></header>
        <div className="preferences-grid">
        <div className="preference-field">
          <label htmlFor="lesson-voice">Voice</label>
          <p>Choose who you learn with.</p>
          <select id="lesson-voice" value={settings.voice} onChange={e => update("voice", e.target.value)}>
            <option value="">Chalky · default voice</option>
            {settings.voice && !voices.some(v => v.id === settings.voice) && <option value={settings.voice}>Saved voice</option>}
            {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.language}</option>)}
          </select>
          {loading && <p role="status">Loading voices…</p>}
          {voiceError && <p role="alert">{voiceError} <button onClick={() => void loadVoices()}>Retry</button></p>}
        </div>
        <div className="preference-field">
        <label htmlFor="speaking-speed">Speaking speed</label>
        <p>A pace that feels right for you.</p>
        <select id="speaking-speed" value={speed} onChange={(event) => {
          const value = event.target.value;
          setSpeed(value);
          document.cookie = value === "default" ? "chalky-speed=; Max-Age=0; Path=/; SameSite=Lax" : `chalky-speed=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
        }}>
          <option value="default">Default</option><option value="0.75">Slow · 0.75×</option><option value="0.92">Relaxed · 0.92×</option><option value="1">Natural · 1×</option><option value="1.15">Quick · 1.15×</option><option value="1.3">Brisk · 1.3×</option>
        </select>
        </div>
        <div className="preference-field">
          <label htmlFor="lesson-language">Lesson language</label><p>The language Chalky teaches in.</p>
          <select id="lesson-language" value={settings.language} onChange={e => update("language", e.target.value as Settings["language"])}>{Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
        </div>
        <div className="preference-field">
          <label htmlFor="lesson-visuals">Visual detail</label><p>How much you’d like to see drawn.</p>
          <select id="lesson-visuals" value={settings.visuals} onChange={e => update("visuals", e.target.value as Settings["visuals"])}><option value="balanced">A balance of visuals and voice</option><option value="more">More diagrams and visual examples</option><option value="less">Fewer visuals, more conversation</option></select>
        </div>
        <div className="preference-field">
          <label htmlFor="lesson-approach">Learning approach</label><p>What helps things click?</p>
          <select id="lesson-approach" value={settings.approach} onChange={e => update("approach", e.target.value as Settings["approach"])}><option value="balanced">A little of everything</option><option value="analogies">Everyday analogies</option><option value="practice">Practice problems and questions</option></select>
        </div>
        <div className="preference-field">
          <label htmlFor="lesson-pace">Teaching pace</label><p>Separate from how fast the voice speaks.</p>
          <select id="lesson-pace" value={settings.pace} onChange={e => update("pace", e.target.value as Settings["pace"])}><option value="balanced">Adapt as we go</option><option value="stepwise">Step by step, with more check-ins</option><option value="concise">Concise, get to the point</option></select>
        </div>
        </div>
        <p className="preferences-note">Saved automatically on this browser. Changes apply to new speech and lesson content; already prepared content keeps its settings. Lesson language changes Chalky’s responses, not microphone recognition.</p>
      </div>
    </dialog>
  </>;
}
