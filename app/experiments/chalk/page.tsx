"use client";

/**
 * Chalk shader test and Janani's reference boards: /experiments/chalk
 *
 * Top row: one small document on our stage (a few strokes, an outline circle, a box, a label),
 * three times: with Janani's chalk effect node (her CHALK_SKSL as is), with the same shader minus
 * its `renderScale` uniform, and with no effect. Each runs checkCoverage and reports the player's
 * per-frame `effectsApplied` and `unsupported` counts, so "draws", "passed through" and "breaks
 * playback" can be told apart.
 *
 * Below: her own documents, built by her presets/board.ts (scratchpad copy, Inter instead of
 * Manrope) and played in the same WebGL player: ?ref=photosynthesis|gallery|respiration.
 */
import { checkCoverage, createPlayer, type PlayerFrameStats, type PlayerHandle } from "@clayzo/webgl-player";
import { base, constant, fill, hex, type AnimationDocument, type SceneNode } from "@clayzo/animation/authoring";
import { useEffect, useMemo, useRef, useState } from "react";
import { END, finishDocument, Scene } from "@/experiments/visual-flex/doc";
import { CHALK_SKSL, chalkEffect } from "@/lib/board/chalk";

const fontLoader = (() => {
  let bytes: Promise<Uint8Array> | null = null;
  return { fontAssetLoader: () => (bytes ??= fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))) };
})();

type Variant = "grain" | "grain-noscale" | "off";

function testDoc(variant: Variant, grain = 0.85): AnimationDocument {
  const s = new Scene();
  s.stroke([[80, 120], [360, 90], [520, 200], [700, 110]], { at: 0, dur: 0.8, color: "ink", width: 6 });
  s.circle(260, 420, 120, { at: 0.5, color: "green", filled: false, width: 6 });
  s.box(520, 320, 300, 180, { at: 1, color: "blue", filled: false });
  s.stroke([[900, 150], [1100, 150]], { at: 1.4, dur: 0.4, color: "red", width: 6 });
  s.arrow([900, 300], [1100, 420], { at: 1.8, dur: 0.5, color: "orange", width: 6 });
  s.circle(1000, 620, 60, { at: 2.2, color: "purple", filled: true });
  s.text("chalk grain test", 600, 720, { at: 2.4, size: 34, color: "ink" });
  const nodes: Record<string, SceneNode> = { ...s.nodes };
  const paper: SceneNode = {
    ...base("paper", { outTick: END, x: 600, y: 400 }),
    type: "rect",
    size: constant({ width: 1200, height: 800 }),
    cornerRadius: constant(0),
    style: { fill: fill(hex("#FBFAF7")) },
  } as SceneNode;
  nodes.paper = paper;
  let roots = ["paper", ...s.order];
  if (variant !== "off") {
    nodes.drawing = { ...base("drawing", { outTick: END }), type: "group", children: s.order } as SceneNode;
    const sksl = variant === "grain-noscale" ? CHALK_SKSL.replace("uniform float2 renderScale;", "").replace(/renderScale\.x/g, "1.0") : CHALK_SKSL;
    nodes.chalk = chalkEffect("chalk", "drawing", END, grain, sksl);
    roots = ["paper", "chalk"];
  }
  return finishDocument(`chalk-test-${variant}`, `chalk test ${variant}`, nodes, roots);
}

interface Stats {
  coverage: string;
  frames: number;
  effectsApplied: number;
  unsupported: string;
  totalMs: string;
  gpuMs: string;
  error: string | null;
}

function Board({ doc, label, loop }: { doc: AnimationDocument | null; label: string; loop: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    if (!doc) return;
    let player: PlayerHandle | null = null;
    let gone = false;
    const acc = { frames: 0, effects: 0, unsupported: new Map<string, number>(), total: [] as number[], gpu: [] as number[] };
    let coverage = "…";
    let error: string | null = null;
    const publish = () => {
      const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(2) : "–");
      setStats({ coverage, frames: acc.frames, effectsApplied: acc.effects, unsupported: [...acc.unsupported].map(([k, v]) => `${k}:${v}`).join(" ") || "none", totalMs: med(acc.total), gpuMs: med(acc.gpu), error });
    };
    (async () => {
      const cov = await checkCoverage(doc as never, fontLoader).catch((e) => ({ supported: false, reasons: [String(e)] }));
      coverage = cov.supported ? "supported" : `unsupported (${cov.reasons.join("; ")})`;
      if (gone) return;
      publish();
      player = await createPlayer({
        canvas: ref.current!, document: doc as never, loaders: fontLoader, pauseWhenOffscreen: false, stateMachine: false, loop,
        onFrame: (f: PlayerFrameStats) => {
          acc.frames++;
          acc.effects += f.effectsApplied;
          for (const [k, v] of Object.entries(f.unsupported)) acc.unsupported.set(k, (acc.unsupported.get(k) ?? 0) + v);
          acc.total.push(f.totalMs);
          if (f.gpuMs !== undefined) acc.gpu.push(f.gpuMs);
          if (acc.frames % 30 === 0) publish();
        },
        onError: (e) => {
          error = e.message;
          publish();
        },
      });
      if (gone) return player.dispose();
      const t = new URLSearchParams(location.search).get("t");
      if (t !== null) {
        player.pause();
        await player.seek(Math.round((Number(t) * 240) / 4) * 4);
      } else player.play();
      (window as unknown as { chalkPlayers: Record<string, PlayerHandle> }).chalkPlayers ??= {};
      (window as unknown as { chalkPlayers: Record<string, PlayerHandle> }).chalkPlayers[label] = player;
    })().catch((e) => {
      error = String(e);
      publish();
    });
    return () => {
      gone = true;
      player?.dispose();
    };
  }, [doc, label, loop]);
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={ref} style={{ width: "100%", aspectRatio: `${doc?.canvas.width ?? 3} / ${doc?.canvas.height ?? 2}`, display: "block", background: "#eee" }} aria-label={label} />
      <figcaption style={{ fontSize: 13, marginTop: 6, fontFamily: "ui-monospace, monospace" }} data-testid={`stats-${label}`}>
        <b>{label}</b>
        {stats ? ` · coverage ${stats.coverage} · frames ${stats.frames} · effectsApplied ${stats.effectsApplied} · unsupported ${stats.unsupported} · totalMs ${stats.totalMs} · gpuMs ${stats.gpuMs}${stats.error ? ` · ERROR ${stats.error}` : ""}` : " · loading"}
      </figcaption>
    </figure>
  );
}

export default function ChalkPage() {
  const [refDoc, setRefDoc] = useState<AnimationDocument | null>(null);
  const [refName, setRefName] = useState("");
  const params = useMemo(() => (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()), []);
  const grain = Number(params.get("grain") ?? 0.85);
  const docs = useMemo(() => (["grain", "grain-noscale", "off"] as Variant[]).map((v) => ({ v, doc: testDoc(v, grain) })), [grain]);
  useEffect(() => {
    const name = `${params.get("theme") ?? "chalk"}-${params.get("ref") ?? "photosynthesis"}`;
    setRefName(name);
    fetch(`/experiments/chalk-ref/${name}.json`).then((r) => (r.ok ? r.json() : null)).then(setRefDoc).catch(() => setRefDoc(null));
  }, [params]);
  return (
    <main style={{ padding: 20, fontFamily: "Inter, system-ui, sans-serif", background: "#ddd", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Chalk shader in @clayzo/webgl-player (grain {grain})</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {docs.map(({ v, doc }) => <Board key={v} doc={doc} label={v} loop />)}
      </div>
      <h2 style={{ fontSize: 17, margin: "22px 0 10px" }}>Janani&apos;s {refName} (her board.ts, her shader, played here)</h2>
      <div style={{ maxWidth: 1100 }}>
        {refDoc ? <Board doc={refDoc} label={`ref-${refName}`} loop /> : <p>no reference document at /experiments/chalk-ref/{refName}.json</p>}
      </div>
    </main>
  );
}
