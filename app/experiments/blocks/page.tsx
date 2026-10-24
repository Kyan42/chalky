"use client";

/**
 * Janani's biology blocks on our stage: /experiments/blocks
 *
 * Two boards in the WebGL player: every block five across (toggle part boxes and anchors), and
 * her photosynthesis script re-expressed as scene-language elements and compiled by the live
 * preset compiler (lib/lesson/presets.ts), the same path a lesson beat takes. Both documents go
 * through checkCoverage. Add ?t=<seconds> to open both boards paused at that time; a capture
 * script can call window.seekBoards(seconds).
 */
import { checkCoverage, createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BLOCKS } from "@/lib/blocks";
import { galleryDoc, PART_COLORS, PHOTOSYNTHESIS, photosynthesisDoc } from "@/lib/blocks/demo";
import { PALETTE } from "@/experiments/visual-flex/doc";

const TPS = 240;
/** The last frame's tick: documents are 20 s and draw nothing at their end tick. */
const LAST = 20 * TPS - 4;
const toTick = (seconds: number) => Math.max(0, Math.min(LAST, Math.round((seconds * TPS) / 4) * 4));

declare global {
  interface Window {
    seekBoards?: (seconds: number) => Promise<void>;
    blocksReady?: boolean;
    blocksCoverage?: Record<string, { supported: boolean; reasons: readonly string[] }>;
  }
}

const fontLoader = (() => {
  let bytes: Promise<Uint8Array> | null = null;
  return { fontAssetLoader: () => (bytes ??= fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))) };
})();

type Coverage = { supported: boolean; reasons: readonly string[] } | null;

function Board({ doc, label, register }: { doc: AnimationDocument; label: string; register: (key: string, p: PlayerHandle | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [coverage, setCoverage] = useState<Coverage>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let player: PlayerHandle | null = null;
    let gone = false;
    (async () => {
      const cov = await checkCoverage(doc as never, fontLoader).catch((e) => ({ supported: false, reasons: [String(e)] }));
      if (gone) return;
      setCoverage(cov);
      window.blocksCoverage = { ...(window.blocksCoverage ?? {}), [label]: cov };
      player = await createPlayer({ canvas: ref.current!, document: doc as never, loaders: fontLoader, pauseWhenOffscreen: false, stateMachine: false, loop: true, onError: (e) => setError(e.message) });
      if (gone) return player.dispose();
      const t = new URLSearchParams(location.search).get("t");
      if (t !== null) {
        player.pause();
        await player.seek(toTick(Number(t)));
      } else player.play();
      register(label, player);
    })().catch((e) => setError(String(e)));
    return () => {
      gone = true;
      register(label, null);
      player?.dispose();
    };
  }, [doc, label, register]);
  return (
    <figure style={styles.figure}>
      <canvas ref={ref} style={styles.canvas} aria-label={label} />
      <figcaption style={styles.caption}>
        <b>{label}</b>{" "}
        {coverage === null ? <span style={{ color: "#8a857a" }}>checking coverage…</span> : coverage.supported ? (
          <span data-testid="coverage" style={{ color: PALETTE.green }}>checkCoverage: supported</span>
        ) : (
          <span data-testid="coverage" style={{ color: PALETTE.red }}>checkCoverage: unsupported ({coverage.reasons.join("; ")})</span>
        )}
        {error && <span style={{ color: PALETTE.red }}> · player error: {error}</span>}
      </figcaption>
    </figure>
  );
}

export default function BlocksPage() {
  const [overlay, setOverlay] = useState(false);
  const players = useRef(new Map<string, PlayerHandle>());
  const gallery = useMemo(() => galleryDoc(overlay), [overlay]);
  const photo = useMemo(() => photosynthesisDoc(), []);

  const register = useCallback((key: string, p: PlayerHandle | null) => {
    if (p) players.current.set(key, p);
    else players.current.delete(key);
    if (players.current.size === 2) window.blocksReady = true;
  }, []);

  useEffect(() => {
    window.seekBoards = async (seconds: number) => {
      const tick = toTick(seconds);
      await Promise.all([...players.current.values()].map(async (p) => {
        p.pause();
        await p.seek(tick);
      }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    };
  }, []);

  const replay = () => players.current.forEach((p) => {
    void p.seek(0).then(() => p.play());
  });

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>Chalky · experiments</div>
          <h1 style={styles.title}>Janani&apos;s biology blocks on our board</h1>
        </div>
        <div style={styles.controls}>
          <label style={styles.toggle}>
            <input type="checkbox" data-testid="overlay" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Show part boxes and anchors
          </label>
          <button style={styles.button} onClick={replay}>Replay</button>
        </div>
      </header>
      <section style={styles.boards}>
        <Board doc={gallery} label={overlay ? "All 15 blocks (parts and anchors)" : "All 15 blocks"} register={register} />
        <Board doc={photo.doc} label="Photosynthesis, through the preset compiler" register={register} />
      </section>
      <section style={styles.notes}>
        <div>
          <h2 style={styles.h2}>Parts and anchors</h2>
          <table style={styles.table}>
            <tbody>
              {BLOCKS.map((b) => (
                <tr key={b.id}>
                  <td style={styles.td}><b>{b.id}</b></td>
                  <td style={styles.td}>
                    {b.parts.map((p, k) => (
                      <span key={p.id} style={{ color: PALETTE[PART_COLORS[k % PART_COLORS.length]], marginRight: 10 }}>{p.id}</span>
                    ))}
                  </td>
                  <td style={{ ...styles.td, color: "#8a857a" }}>{Object.keys(b.anchors).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 style={styles.h2}>Photosynthesis layout report</h2>
          <p style={styles.p}>
            {photo.report.shapes.length} shapes, {photo.report.texts.length} labels, {photo.report.dangling.length} dangling refs
            {photo.report.dangling.length ? `: ${photo.report.dangling.join("; ")}` : ""}, {photo.report.nudged} nudged.
          </p>
          <h2 style={styles.h2}>The beat, in scene language</h2>
          <pre style={styles.pre}>{PHOTOSYNTHESIS.map((e) => JSON.stringify(e)).join("\n")}</pre>
        </div>
      </section>
    </main>
  );
}

const ink = "#1F2A44";
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#EFECE4", color: ink, fontFamily: "Inter, system-ui, sans-serif", padding: "20px 28px", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 14 },
  kicker: { fontSize: 14, color: "#6b6b6b" },
  title: { fontSize: 28, margin: "4px 0 0", fontWeight: 700 },
  controls: { display: "flex", gap: 14, alignItems: "center" },
  toggle: { fontSize: 15, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" },
  button: { fontSize: 15, padding: "6px 14px", borderRadius: 8, border: "1px solid #cfc9bb", background: "#FBFAF6", cursor: "pointer" },
  boards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 560px), 1fr))", gap: 18 },
  figure: { margin: 0, background: "#FBFAF6", border: "1px solid #E2DED3", borderRadius: 12, padding: 10 },
  canvas: { width: "100%", aspectRatio: "3 / 2", display: "block", borderRadius: 8, background: "#F7F5EF" },
  caption: { fontSize: 14, marginTop: 8 },
  notes: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))", gap: 24, marginTop: 20 },
  h2: { fontSize: 17, margin: "0 0 8px" },
  table: { borderCollapse: "collapse", fontSize: 13 },
  td: { padding: "3px 10px 3px 0", verticalAlign: "top" },
  p: { fontSize: 14, margin: "0 0 14px" },
  pre: { fontSize: 11.5, background: "#FBFAF6", border: "1px solid #E2DED3", borderRadius: 8, padding: 10, overflowX: "auto", lineHeight: 1.45 },
};
