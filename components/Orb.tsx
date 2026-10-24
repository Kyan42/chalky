"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "hearing" | "thinking" | "speaking";

/**
 * The voice orb. Its size follows whoever is talking: the student's mic while listening, the
 * tutor's voice while speaking. Thinking swirls.
 */
export function Orb({ state, levels, size = 220 }: { state: OrbState; levels: () => { mic: number; agent: number }; size?: number }) {
  const core = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const loop = () => {
      const { mic, agent } = levels();
      const s = stateRef.current;
      const target = s === "speaking" ? agent : s === "listening" || s === "hearing" ? mic : 0;
      smooth += (target - smooth) * 0.25;
      if (core.current) core.current.style.transform = `scale(${1 + Math.min(0.35, smooth * 0.6)})`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [levels]);

  const palette =
    state === "thinking"
      ? "from-[#A78BFA] via-[#4DA3FF] to-[#2ED3B7]"
      : state === "speaking"
        ? "from-[#F4F1EA] via-[#8EC5FF] to-[#4DA3FF]"
        : state === "idle"
          ? "from-[#2A2F4D] via-[#333A60] to-[#1C2040]"
          : "from-[#4DA3FF] via-[#2ED3B7] to-[#4D7BFF]";

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} aria-label={`Tutor is ${state}`}>
      <div
        className={`absolute inset-0 rounded-full bg-gradient-to-br ${palette} opacity-40 blur-2xl transition-colors duration-700`}
        style={{ animation: "orb-breathe 4s ease-in-out infinite" }}
      />
      <div ref={core} className="absolute inset-[8%] rounded-full transition-transform duration-75">
        <div
          className={`h-full w-full rounded-full bg-gradient-to-br ${palette} shadow-[inset_0_-20px_60px_rgba(0,0,0,0.35),inset_0_20px_40px_rgba(255,255,255,0.25)] transition-colors duration-700`}
          style={{ animation: state === "thinking" ? "orb-spin 2.4s linear infinite" : "orb-breathe 5s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}
