"use client";

import { useEffect, useState } from "react";

/** Claude Code-style status words, shuffled while an animation is being made. */
const WORDS = [
  "Sketching",
  "Storyboarding",
  "Doodling",
  "Chalking",
  "Keyframing",
  "Choreographing",
  "Inking",
  "Tweening",
  "Diagramming",
  "Easing in",
  "Colouring in",
  "Springing",
  "Composing",
  "Rehearsing the voiceover",
  "Untangling arrows",
  "Lining things up",
  "Polishing",
  "Timing it to the words",
];

const COLORS = ["#4DA3FF", "#2ED3B7", "#FFD84D", "#FF5C8A", "#A78BFA"];

function useCycle(length: number, ms: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1 + Math.floor(Math.random() * 3)) % length), ms);
    return () => clearInterval(id);
  }, [length, ms]);
  return index;
}

function useElapsed(since: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!since) return null;
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Shown while an animation is being made: shapes drawing themselves, a rotating status word,
 * and the builder's real progress underneath so it's clear work is happening.
 */
export function BuildingLoader({
  title,
  progress,
  since,
  compact,
}: {
  title: string;
  progress?: string;
  since?: number;
  compact?: boolean;
}) {
  const word = WORDS[useCycle(WORDS.length, 2200)];
  const elapsed = useElapsed(since);
  const size = compact ? 96 : 150;

  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 120 120" className="overflow-visible">
        <style>{`
          .chalk { fill: none; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
          .draw { stroke-dasharray: 260; animation: chalk-draw 3.6s cubic-bezier(.65,0,.35,1) infinite; }
          .d1 { animation-delay: 0s } .d2 { animation-delay: .5s } .d3 { animation-delay: 1s } .d4 { animation-delay: 1.5s }
          .orbit { transform-origin: 60px 60px; animation: chalk-orbit 6s linear infinite; }
          @keyframes chalk-draw { 0% { stroke-dashoffset: 260 } 45%,70% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: -260 } }
          @keyframes chalk-orbit { to { transform: rotate(360deg) } }
        `}</style>
        <circle className="chalk draw d1" cx="38" cy="44" r="20" stroke={COLORS[0]} />
        <path className="chalk draw d2" d="M70 26 L96 66 L58 66 Z" stroke={COLORS[2]} />
        <path className="chalk draw d3" d="M18 92 C32 74, 46 108, 60 92 S88 74, 102 92" stroke={COLORS[1]} />
        <path className="chalk draw d4" d="M44 50 L72 50 M66 44 L72 50 L66 56" stroke={COLORS[3]} />
        <g className="orbit">
          <circle cx="60" cy="6" r="4" fill={COLORS[4]} />
          <circle cx="114" cy="60" r="3" fill={COLORS[1]} />
          <circle cx="12" cy="74" r="2.5" fill={COLORS[2]} />
        </g>
      </svg>

      <div className={compact ? "space-y-1" : "space-y-2"}>
        <div className={`${compact ? "text-lg" : "text-2xl"} h-[1.4em] overflow-hidden font-semibold`}>
          <span key={word} className="loader-word inline-block bg-gradient-to-r from-[#8EC5FF] via-white to-[#2ED3B7] bg-[length:200%_100%] bg-clip-text text-transparent">
            {word}…
          </span>
        </div>
        <p className="text-sm text-[var(--muted)]">
          {title}
          {progress ? ` · ${progress}` : ""}
          {elapsed ? ` · ${elapsed}` : ""}
        </p>
      </div>
    </div>
  );
}
