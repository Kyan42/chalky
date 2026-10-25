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
 * Second row: every kind of the scene language (circle, box, flow, cycle, equation, arrow, line,
 * plot, bar, move, text, connect, rays, label) through the live preset compiler in the page's theme
 * (?theme=), with a highlight on a shape, on an equation and on a label, and a dim: what a lesson
 * draws, kind by kind. Add ?t=<seconds> to pause everything at that time.
 *
 * Below: her own documents, built by her presets/board.ts (scratchpad copy, Inter instead of
 * Manrope) and played in the same WebGL player: ?ref=photosynthesis|gallery|respiration.
 */
import { checkCoverage, createPlayer, type PlayerFrameStats, type PlayerHandle } from "@clayzo/webgl-player";
import { base, constant, fill, hex, type AnimationDocument, type SceneNode } from "@clayzo/animation/authoring";
import { useEffect, useMemo, useRef, useState } from "react";
import { END, finishDocument, Scene } from "@/experiments/visual-flex/doc";
import { CHALK_SKSL, chalkEffect } from "@/lib/board/chalk";
import { CHALK, currentTheme, envTheme, THEMES, type Theme } from "@/lib/board/theme";
import { compilePresetBoard, type PresetElement } from "@/lib/lesson/presets";

const fontLoader = (() => {
  let bytes: Promise<Uint8Array> | null = null;
  return { fontAssetLoader: () => (bytes ??= fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))) };
})();

type Variant = "grain" | "grain-noscale" | "off";

const el = (id: string, kind: string, at: number, args: number[], text = "", refs = "", color = "ink", dur = 0.6): PresetElement => ({ id, kind, at, dur, color, args, text, refs });

/** Every kind, as two beats: the first drawn still, the second animating with highlights and a dim. */
const KINDS: PresetElement[][] = [
  [
    el("sun", "circle", 0, [12, 22, 7, 1], "Sun", "", "yellow", 0.8),
    el("cell", "box", 0.3, [30, 10, 24, 22, 1], "Cell", "", "blue", 0.8),
    el("hole", "circle", 0.6, [68, 20, 6, 0], "Pore", "", "green", 0.6),
    el("steps", "flow", 1, [4, 72, 50, 16], "Light|Sugar|Energy", "", "ink", 1.2),
    el("ring", "cycle", 1.2, [84, 30, 9], "Day|Night|Dawn", "", "purple", 1.2),
    el("eq", "equation", 2, [76, 62, 30], "6 CO2 + 6 H2O -> sugar + 6 O2", "", "ink", 0.6),
    el("bar1", "bar", 2.2, [60, 96, 7, 22], "before", "", "green", 0.6),
    el("bar2", "bar", 2.5, [70, 96, 7, 34], "after", "", "red", 0.6),
    el("wave", "plot", 2.8, [80, 78, 18, 14, 0, 1], "sin(x*12)", "", "blue", 1),
    el("path", "line", 3.2, [6, 50, 16, 44, 24, 54], "a path", "", "brown", 0.6),
    el("to", "arrow", 3.6, [30, 40, 50, 56], "to", "", "orange", 0.6),
    el("dot", "move", 4, [30, 44, 50, 60, 1.4], "", "", "red", 1),
    el("note", "text", 4.2, [60, 46, 26], "free text", "", "grey", 0.4),
  ],
  [
    el("sun-cell", "connect", 0, [], "warms", "sun,cell", "orange", 0.6),
    el("light", "rays", 0.3, [3], "", "sun,hole", "yellow", 0.8),
    el("cell-label", "label", 0.6, [], "a plant cell", "cell", "blue"),
    el("h1", "highlight", 1, [], "", "sun", "yellow", 1.8),
    el("d1", "dim", 1.5, [], "", "steps", "ink", 0.5),
    el("h2", "highlight", 2.2, [], "", "eq", "yellow", 1.8),
    el("h3", "highlight", 3.4, [], "", "cell-label", "blue", 1.8),
    el("h4", "highlight", 4.4, [], "", "ring.1", "yellow", 1.8),
  ],
];

function testDoc(variant: Variant, grain = 0.85): AnimationDocument {
  const s = new Scene(CHALK);
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
  const [theme, setTheme] = useState<Theme>(envTheme);
  useEffect(() => setTheme(currentTheme()), []);
  const kinds = useMemo(() => compilePresetBoard(KINDS, 1, `kinds-${theme.id}`, theme), [theme]);
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
      <h2 style={{ fontSize: 17, margin: "22px 0 10px" }}>
        Every kind through the preset compiler, theme <b data-testid="theme">{theme.id}</b>{" "}
        {THEMES.map((t) => (
          <a key={t.id} href={`?theme=${t.id}`} style={{ marginLeft: 10, fontWeight: 400, fontSize: 14 }}>{t.id}</a>
        ))}
      </h2>
      <div style={{ maxWidth: 1100 }}>
        <Board doc={kinds.doc} label={`kinds-${theme.id}`} loop />
        <p style={{ fontSize: 13 }}>{kinds.report.shapes.length} shapes, {kinds.report.texts.length} labels, dangling: {kinds.report.dangling.join("; ") || "none"}</p>
      </div>
      <h2 style={{ fontSize: 17, margin: "22px 0 10px" }}>Janani&apos;s {refName} (her board.ts, her shader, played here)</h2>
      <div style={{ maxWidth: 1100 }}>
        {refDoc ? <Board doc={refDoc} label={`ref-${refName}`} loop /> : <p>no reference document at /experiments/chalk-ref/{refName}.json</p>}
      </div>
    </main>
  );
}
