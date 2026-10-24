"use client";

/**
 * The voice orb from Janani's PR #2 (components/Orb.tsx), restyled without
 * Tailwind for our light board. Its size follows whoever is talking: the
 * learner's mic while listening, Chalky's voice while speaking. Thinking swirls.
 */
import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const PALETTES: Record<OrbState, [string, string, string]> = {
  idle: ["#d9d4c7", "#c9c3b4", "#b8b1a1"],
  listening: ["#4DA3FF", "#2ED3B7", "#4D7BFF"],
  thinking: ["#A78BFA", "#4DA3FF", "#2ED3B7"],
  speaking: ["#F4B183", "#E4572E", "#C2410C"],
};

export function Orb({ state, level, size = 160 }: { state: OrbState; level: () => number; size?: number }) {
  const core = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const loop = () => {
      smooth += (Math.min(1, level() * 5) - smooth) * 0.25;
      if (core.current) core.current.style.transform = `scale(${1 + Math.min(0.35, smooth * 0.6)})`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  const [a, b, c] = PALETTES[state];
  const gradient = `linear-gradient(135deg, ${a}, ${b} 55%, ${c})`;
  return (
    <div className="orb" style={{ width: size, height: size }} aria-label={`Chalky is ${state}`} data-state={state}>
      <div className="orb-glow" style={{ background: gradient }} />
      <div ref={core} className="orb-core">
        <div className="orb-ball" style={{ background: gradient, animation: state === "thinking" ? "orb-spin 2.4s linear infinite" : "orb-breathe 5s ease-in-out infinite" }} />
      </div>
    </div>
  );
}
