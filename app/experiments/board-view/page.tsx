"use client";
// Renders one saved board document at a given tick: /experiments/board-view?src=<file>&tick=<n>
// Used by the visual-model comparison; files live in public/experiments/board-compare/.
import { createPlayer } from "@clayzo/webgl-player";
import { useEffect, useRef, useState } from "react";

const fontLoader = { fontAssetLoader: () => fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)) };

export default function BoardView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState("loading");
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      const doc = await fetch(`/experiments/board-compare/${params.get("src")}`).then((r) => r.json());
      const player = await createPlayer({ canvas: ref.current!, document: doc, loaders: fontLoader, pauseWhenOffscreen: false, stateMachine: false });
      player.pause();
      await player.seek(Number(params.get("tick") ?? 1436));
      setInfo(params.get("src") ?? "");
      (window as unknown as { ready: boolean }).ready = true;
    })().catch((e) => setInfo(String(e)));
  }, []);
  return (
    <main style={{ background: "#fff", padding: 0, margin: 0 }}>
      <canvas ref={ref} style={{ width: 900, height: 600, display: "block" }} />
      <p id="info" style={{ font: "14px system-ui", margin: 4 }}>{info}</p>
    </main>
  );
}
