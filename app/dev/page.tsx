"use client";

// Plays the kit's sample chapter (npx tsx worker/kit/sample.ts) with the real stage and ink layer.
// Needs no API keys: useful for checking the player, the kit's look and drawing.
// /dev?doc=detour plays public/dev/detour.json instead.
import { useEffect, useMemo, useRef, useState } from "react";
import { BuildingLoader } from "@/components/BuildingLoader";
import { INK_COLORS, InkLayer } from "@/components/InkLayer";
import { Stage, type StageHandle } from "@/components/Stage";
import type { Manifest, StrokeData } from "@/lib/types";

export default function DevPage() {
  const stage = useRef<StageHandle>(null);
  const [tick, setTick] = useState(0);
  const [strokes, setStrokes] = useState<StrokeData[]>([]);
  const [paused, setPaused] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadedAt] = useState(() => Date.now());

  const [doc] = useState(() => (typeof window === "undefined" ? "sample" : new URLSearchParams(window.location.search).get("doc") ?? "sample"));
  const clip = useMemo(
    () => ({
      key: doc,
      segment: { _id: doc, kind: "chapter", documentUrl: `/dev/${doc}.json`, assets: [], manifest: null, durationTicks: 7200, ticksPerSecond: 240 },
      startTick: 0,
      autoplay: true,
      stopAtTick: undefined as number | undefined,
    }),
    [doc],
  );
  useEffect(() => {
    void fetch("/dev/sample.manifest.json").then((r) => r.json()).then(setManifest);
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Stage check</h1>
      <Stage ref={stage} clip={clip} onTick={setTick} onEnded={() => setPaused(true)} onError={(e) => console.error(e)}>
        <InkLayer
          enabled={paused}
          strokes={strokes}
          color={INK_COLORS[0]}
          size={8}
          onStroke={(s) => setStrokes((all) => [...all, { ...s, tick, offsetMs: 0 }])}
        />
      </Stage>
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <button className="rounded-full bg-white/10 px-4 py-1.5" onClick={() => {
            if (stage.current?.playing()) stage.current.pause();
            else stage.current?.play();
            setPaused(!stage.current?.playing());
          }}>
          play / pause
        </button>
        <button className="rounded-full bg-white/10 px-4 py-1.5" onClick={() => void stage.current?.seek(Math.max(0, (manifest?.questionTick ?? 6000) + 40))}>
          jump to question
        </button>
        <button className="rounded-full bg-white/10 px-4 py-1.5" onClick={() => setStrokes([])}>
          clear ink
        </button>
        <span>tick {tick} · {(tick / 240).toFixed(1)}s</span>
      </div>
      <h2 className="pt-6 text-xl font-semibold">Building loader</h2>
      <div className="grid grid-cols-2 gap-6 rounded-2xl bg-[var(--surface)] p-8">
        <BuildingLoader title="Chapter 1: The Mystery of the Growing Tree" progress="Reading kit.ts" since={loadedAt - 95_000} />
        <BuildingLoader compact title="Animating “Why leaves are green”" progress="Rendering the animation" since={loadedAt - 20_000} />
      </div>
    </main>
  );
}
