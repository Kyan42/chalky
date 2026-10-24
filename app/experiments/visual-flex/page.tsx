"use client";

/**
 * Side-by-side render of the visual flexibility experiment.
 *
 * Segments: 0 = title card, 1..8 = one beat each (L1–L4 Opus 5.5 outputs in a
 * 2x2 grid with stats for both models), 9 = summary. A capture script drives it
 * with `window.renderFrame(segment, seconds)`, which seeks every player and
 * resolves once the frame is drawn. Opening the page by hand plays it live.
 */
import { checkCoverage, createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BASE = "/experiments/visual-flex";
const LEAD = 0.6;
const HOLD = 1.5;
const TITLE_SECONDS = 3.5;
const SUMMARY_SECONDS = 9;
const TPS = 240;
const FRAME_TICKS = 4;
const DOC_END = 6 * TPS;
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
const LEVELS = [1, 2, 3, 4] as const;
const LEVEL_NAMES: Record<number, string> = {
  1: "L1 · Fixed primitive",
  2: "L2 · Parameterized primitives",
  3: "L3 · Scene language",
  4: "L4 · Raw Clayzo code",
};
const LEVEL_BLURB: Record<number, string> = {
  1: "Model picks one of 10 animations by name. No parameters.",
  2: "Up to 3 primitives with parameters, labels and a layout.",
  3: "Model places lines, plots, shapes and text on a 100x100 grid with timing.",
  4: "Model writes TypeScript against the Clayzo authoring API.",
};

interface Attempt { ttftMs: number | null; apiMs: number; inputTokens: number; outputTokens: number; stopReason: string | null; error: string | null }
interface Generation {
  beat: string; level: number; model: string; attempts: Attempt[];
  firstTryValid: boolean; finalValid: boolean; msToValid: number | null; totalMs: number; docFile: string | null; nodes: number | null;
}
interface Beat { id: string; question: string; say: string; at: string }
interface Results { beats: Beat[]; generations: Generation[] }
interface BeatAudio { words: string[]; start: number[]; end: number[]; duration: number; anchorStart: number }
interface Summary { recommendation?: string }

type Segment = { kind: "title"; duration: number } | { kind: "beat"; beat: Beat; audio: BeatAudio | null; duration: number } | { kind: "summary"; duration: number };

declare global {
  interface Window {
    renderFrame?: (segment: number, seconds: number) => Promise<void>;
    flexInfo?: { segments: { kind: string; id?: string; duration: number; lead: number }[] };
    flexCoverage?: Record<string, { supported: boolean; reasons: readonly string[] }>;
    flexReady?: boolean;
  }
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

const fontLoader = (() => {
  let bytes: Promise<Uint8Array> | null = null;
  return {
    fontAssetLoader: () => (bytes ??= fetch("/fonts/Inter-SemiBold.otf").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))),
  };
})();

function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
const sec = (ms: number | null | undefined) => (ms == null || Number.isNaN(ms) ? "–" : `${(ms / 1000).toFixed(1)} s`);

export default function VisualFlexPage() {
  const [results, setResults] = useState<Results | null>(null);
  const [audio, setAudio] = useState<Record<string, BeatAudio | null>>({});
  const [summary, setSummary] = useState<Summary>({});
  const [segment, setSegment] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const players = useRef<(PlayerHandle | null)[]>([null, null, null, null]);
  const loadedSegment = useRef(-1);
  const docs = useRef<Record<string, unknown>>({});

  useEffect(() => {
    (async () => {
      try {
        const r: Results = await fetch(`${BASE}/results.json`, { cache: "no-store" }).then((x) => x.json());
        const a: Record<string, BeatAudio | null> = {};
        await Promise.all(r.beats.map(async (b) => {
          a[b.id] = await fetch(`${BASE}/audio/${b.id}.json`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        }));
        const s: Summary = await fetch(`${BASE}/summary.json`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
        await Promise.all(r.generations.filter((g) => g.docFile).map(async (g) => {
          docs.current[g.docFile!] = await fetch(`${BASE}/${g.docFile}`).then((x) => x.json());
        }));
        const coverage: NonNullable<Window["flexCoverage"]> = {};
        for (const [file, doc] of Object.entries(docs.current)) {
          coverage[file] = await checkCoverage(doc as never, fontLoader).catch((e) => ({ supported: false, reasons: [String(e)] }));
        }
        window.flexCoverage = coverage;
        setAudio(a);
        setSummary(s);
        setResults(r);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const segments = useMemo<Segment[]>(() => {
    if (!results) return [];
    return [
      { kind: "title", duration: TITLE_SECONDS },
      ...results.beats.map((beat): Segment => {
        const au = audio[beat.id] ?? null;
        return { kind: "beat", beat, audio: au, duration: LEAD + (au ? au.duration : 5) + HOLD };
      }),
      { kind: "summary", duration: SUMMARY_SECONDS },
    ];
  }, [results, audio]);

  const gen = useCallback((beat: string, level: number, model: string) => results?.generations.find((g) => g.beat === beat && g.level === level && g.model === model), [results]);

  /** (Re)creates the four players for a beat segment. */
  const loadSegment = useCallback(async (index: number) => {
    if (loadedSegment.current === index) return;
    players.current.forEach((p) => p?.dispose());
    players.current = [null, null, null, null];
    loadedSegment.current = index;
    const seg = segments[index];
    if (seg?.kind !== "beat") return;
    await Promise.all(LEVELS.map(async (level, i) => {
      const g = gen(seg.beat.id, level, OPUS);
      const canvas = canvases.current[i];
      if (!g?.docFile || !canvas) return;
      const player = await createPlayer({
        canvas, document: docs.current[g.docFile] as never, loaders: fontLoader,
        pauseWhenOffscreen: false, stateMachine: false, resolution: "display", maxPixelRatio: 1,
        onError: (e) => console.warn("player", g.docFile, e.message),
      });
      player.pause();
      players.current[i] = player;
    }));
  }, [segments, gen]);

  const renderFrame = useCallback(async (index: number, t: number) => {
    setSegment(index);
    setSeconds(t);
    // Let React lay out this segment's canvases before players attach to them.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (document.querySelector(`main[data-segment="${index}"]`)) break;
    }
    await loadSegment(index);
    const seg = segments[index];
    if (seg?.kind === "beat") {
      const visual = t - LEAD - (seg.audio?.anchorStart ?? 0);
      const tick = Math.max(0, Math.min(DOC_END - FRAME_TICKS, Math.round((visual * TPS) / FRAME_TICKS) * FRAME_TICKS));
      await Promise.all(players.current.map((p) => p?.seek(tick)));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  }, [segments, loadSegment]);

  useEffect(() => {
    if (!segments.length) return;
    window.renderFrame = renderFrame;
    window.flexInfo = { segments: segments.map((s) => ({ kind: s.kind, id: s.kind === "beat" ? s.beat.id : undefined, duration: s.duration, lead: LEAD })) };
    window.flexReady = true;
  }, [segments, renderFrame]);

  // Live preview when opened by hand (?play): steps through segments in real time without audio.
  useEffect(() => {
    if (!segments.length || !new URLSearchParams(location.search).has("play")) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < segments.length && !stop; i++) {
        const t0 = performance.now();
        while (!stop && (performance.now() - t0) / 1000 < segments[i].duration) await renderFrame(i, (performance.now() - t0) / 1000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [segments, renderFrame]);

  if (error) return <main style={styles.page}><p>Failed to load results: {error}</p></main>;
  if (!results) return <main style={styles.page}><p style={{ color: "#6b6b6b" }}>Loading results and checking coverage…</p></main>;
  const seg = segments[segment];

  return (
    <main style={styles.page} data-segment={segment}>
      {seg.kind === "title" && <TitleCard />}
      {seg.kind === "summary" && <SummaryCard results={results} summary={summary} />}
      {seg.kind === "beat" && (
        <>
          <header style={styles.header}>
            <div style={styles.kicker}>Beat {segment} of {results.beats.length} · visuals by Claude Opus 5.5, effort low</div>
            <div style={styles.question}>{seg.beat.question}</div>
          </header>
          <section style={styles.grid}>
            {LEVELS.map((level, i) => {
              const o = gen(seg.beat.id, level, OPUS);
              const h = gen(seg.beat.id, level, HAIKU);
              return (
                <div key={level} style={styles.panel}>
                  <div style={styles.canvasWrap}>
                    <canvas ref={(el) => { canvases.current[i] = el; }} width={450} height={300} style={styles.canvas} />
                    {!o?.docFile && <div style={styles.noDoc}>No valid document</div>}
                  </div>
                  <div style={styles.stats}>
                    <div style={styles.levelName}>{LEVEL_NAMES[level]}</div>
                    <StatRow label="Opus 5.5" g={o} />
                    <StatRow label="Haiku 5.5" g={h} />
                  </div>
                </div>
              );
            })}
          </section>
          <Caption audio={seg.audio} say={seg.beat.say} anchor={seg.beat.at} t={seconds - LEAD} />
        </>
      )}
    </main>
  );
}

function StatRow({ label, g }: { label: string; g?: Generation }) {
  if (!g) return <div style={styles.stat}><b>{label}</b> –</div>;
  const out = g.attempts.reduce((s, a) => s + a.outputTokens, 0);
  return (
    <div style={styles.stat}>
      <div><b>{label}</b></div>
      <div>{g.finalValid ? `valid doc in ${sec(g.msToValid)}` : "no valid doc"}{g.attempts.length > 1 ? " (1 repair)" : ""}</div>
      <div style={{ color: g.firstTryValid ? "#2E9E5B" : "#E4572E" }}>{g.firstTryValid ? "valid on first try" : "invalid on first try"}</div>
      <div style={{ color: "#6b6b6b" }}>first token {sec(g.attempts[0]?.ttftMs)} · {out} tokens out</div>
    </div>
  );
}

function Caption({ audio, say, anchor, t }: { audio: BeatAudio | null; say: string; anchor: string; t: number }) {
  const words = audio?.words ?? say.split(/\s+/);
  return (
    <footer style={styles.caption}>
      {words.map((w, i) => {
        const spoken = audio ? t >= audio.start[i] : false;
        const now = audio ? spoken && (i === words.length - 1 || t < audio.start[i + 1]) : false;
        const isAnchor = norm(w) === norm(anchor);
        return (
          <span key={i} style={{ color: now ? "#E4572E" : spoken ? "#1F2A44" : "#b9b4a8", textDecoration: isAnchor ? "underline" : "none", textUnderlineOffset: 6, marginRight: "0.28em" }}>
            {w}
          </span>
        );
      })}
      <span style={styles.anchorNote}>visuals start on the underlined word</span>
    </footer>
  );
}

function TitleCard() {
  return (
    <section style={styles.card}>
      <div style={styles.kicker}>Chalky · visual flexibility experiment</div>
      <h1 style={styles.title}>How much freedom can the planner have, and how long does it take?</h1>
      <ol style={styles.levelList}>
        {LEVELS.map((l) => (
          <li key={l} style={{ marginBottom: 14 }}><b>{LEVEL_NAMES[l]}.</b> {LEVEL_BLURB[l]}</li>
        ))}
      </ol>
      <p style={styles.note}>8 lesson beats × 4 levels × 2 models (Claude Opus 5.5 and Claude Haiku 5.5, effort low). Voice: Cartesia Sonic.</p>
    </section>
  );
}

function SummaryCard({ results, summary }: { results: Results; summary: Summary }) {
  const rows = LEVELS.flatMap((level) => [OPUS, HAIKU].map((model) => {
    const gs = results.generations.filter((g) => g.level === level && g.model === model);
    const ms = gs.filter((g) => g.msToValid != null).map((g) => g.msToValid!);
    return {
      level, model, median: median(ms), p95: p95(ms),
      first: gs.filter((g) => g.firstTryValid).length, final: gs.filter((g) => g.finalValid).length, n: gs.length,
      tokens: median(gs.map((g) => g.attempts.reduce((s, a) => s + a.outputTokens, 0))),
    };
  }));
  return (
    <section style={styles.card}>
      <div style={styles.kicker}>Results · time from request to a validated document</div>
      <table style={styles.table}>
        <thead>
          <tr>{["Level", "Model", "Median", "p95", "Valid first try", "Valid after 1 repair", "Median tokens out"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.level}-${r.model}`}>
              <td style={styles.td}>{r.model === OPUS ? LEVEL_NAMES[r.level] : ""}</td>
              <td style={styles.td}>{r.model === OPUS ? "Opus 5.5" : "Haiku 5.5"}</td>
              <td style={styles.tdNum}>{sec(r.median)}</td>
              <td style={styles.tdNum}>{sec(r.p95)}</td>
              <td style={styles.tdNum}>{r.first}/{r.n}</td>
              <td style={styles.tdNum}>{r.final}/{r.n}</td>
              <td style={styles.tdNum}>{Math.round(r.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.recommendation && <p style={styles.recommend}>{summary.recommendation}</p>}
    </section>
  );
}

const ink = "#1F2A44";
const styles: Record<string, React.CSSProperties> = {
  page: { width: 1600, height: 900, background: "#EFECE4", color: ink, fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden", display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "24px 40px" },
  header: { height: 84 },
  kicker: { fontSize: 18, color: "#6b6b6b", letterSpacing: 0.3 },
  question: { fontSize: 36, fontWeight: 700, marginTop: 6 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 20, flex: 1, minHeight: 0 },
  panel: { display: "flex", gap: 18, background: "#FBFAF6", borderRadius: 14, padding: 14, alignItems: "center", border: "1px solid #E2DED3" },
  canvasWrap: { position: "relative", width: 450, height: 300, flex: "none" },
  canvas: { width: 450, height: 300, borderRadius: 8, display: "block", background: "#F7F5EF" },
  noDoc: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#E4572E", fontSize: 22, fontWeight: 600 },
  stats: { display: "flex", flexDirection: "column", gap: 12, fontSize: 16, lineHeight: 1.35 },
  levelName: { fontSize: 21, fontWeight: 700 },
  stat: { fontSize: 15.5 },
  caption: { height: 92, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 600, position: "relative", paddingTop: 8 },
  anchorNote: { position: "absolute", right: 0, bottom: 0, fontSize: 14, color: "#8a857a", fontWeight: 400 },
  card: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 80px" },
  title: { fontSize: 54, lineHeight: 1.15, margin: "16px 0 36px", fontWeight: 700 },
  levelList: { fontSize: 28, lineHeight: 1.35, paddingLeft: 36, margin: 0 },
  note: { fontSize: 22, color: "#6b6b6b", marginTop: 30 },
  table: { borderCollapse: "collapse", fontSize: 22, marginTop: 20, width: "100%" },
  th: { textAlign: "left", borderBottom: `2px solid ${ink}`, padding: "8px 12px", fontSize: 19 },
  td: { padding: "7px 12px", borderBottom: "1px solid #DDD8CC" },
  tdNum: { padding: "7px 12px", borderBottom: "1px solid #DDD8CC", fontVariantNumeric: "tabular-nums" },
  recommend: { fontSize: 25, marginTop: 26, fontWeight: 600, lineHeight: 1.35 },
};
