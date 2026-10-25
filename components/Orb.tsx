"use client";

/**
 * The voice orb from Janani's PR #2 (components/Orb.tsx), restyled without
 * Tailwind for our board. Its size follows whoever is talking: the learner's
 * mic while listening, Chalky's voice while speaking. Thinking swirls. Its
 * colours are the board theme's chalk colours (lib/board/theme.ts), so it sits
 * with the board instead of beside it.
 */
import { useEffect, useRef, useState } from "react";
import { currentTheme, envTheme, mix, type Theme } from "@/lib/board/theme";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

function palette(theme: Theme, state: OrbState): [string, string, string] {
  const c = theme.colors;
  switch (state) {
    case "idle":
      return [c["grey-tint"], mix(c["grey-tint"], c.grey, 0.45), mix(c["grey-tint"], c.grey, 0.8)];
    case "listening":
      return [c.blue, c.green, mix(c.blue, c.ink, 0.25)];
    case "thinking":
      return [c.purple, c.blue, c.green];
    case "speaking":
      return [c.orange, c.red, mix(c.red, c.ink, 0.3)];
  }
}

export function Orb({ state, level, size = 160 }: { state: OrbState; level: () => number; size?: number }) {
  const core = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>(envTheme);
  useEffect(() => setTheme(currentTheme()), []);
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

  const [a, b, c] = palette(theme, state);
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
