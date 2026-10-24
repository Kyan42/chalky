"use client";

/**
 * Clayzo spike: checkCoverage, seek precision, many players, and swapping a
 * running player's document. Results are written to `window.__clayzoSpike`
 * and printed on the page; scripts/e2e.mjs reads them.
 */
import { useEffect, useRef, useState } from "react";
import { checkCoverage, createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import { buildWaveDocument, DRAW_TICKS, TICKS_PER_SECOND } from "@/lib/visuals/wave";
import { inkExtent, snapshot } from "@/lib/visuals/inspect";

const PLAYER_COUNT = 6;

declare global {
  interface Window {
    __clayzoSpike?: Record<string, unknown>;
  }
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ClayzoSpike() {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string>("running…");

  useEffect(() => {
    let cancelled = false;
    const players: PlayerHandle[] = [];
    const results: Record<string, unknown> = { done: false };
    window.__clayzoSpike = results;
    const print = () => setLog(JSON.stringify(results, null, 2));

    (async () => {
      const doc = buildWaveDocument();
      results.ticksPerSecond = doc.timing.ticksPerSecond;
      results.frameRate = doc.timing.frameRate;

      // 1. Coverage.
      results.coverage = await checkCoverage(doc);
      print();

      // 2. Seek precision on a paused player.
      const canvas = mainRef.current!;
      const errors: string[] = [];
      const t0 = performance.now();
      const player = await createPlayer({
        canvas,
        document: doc,
        resolution: "document",
        pauseWhenOffscreen: false,
        onError: (e) => errors.push(e.message),
      });
      results.createPlayerMs = Math.round(performance.now() - t0);
      players.push(player);
      player.pause();

      const seekRows: { requested: number; reported: number; seekMs: number; inkExtent: number }[] = [];
      const ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 48, 96, 97, 98, 99, 100, 101, 192, 288, 383, 384, 479, 600];
      for (const t of ticks) {
        const s = performance.now();
        await player.seek(t);
        const seekMs = performance.now() - s;
        const extent = inkExtent(snapshot(canvas));
        seekRows.push({ requested: t, reported: player.tick, seekMs: +seekMs.toFixed(2), inkExtent: +extent.toFixed(4) });
      }
      results.seek = seekRows;

      // Seek cost when called once per animation frame, like the sync loop does.
      const perFrame: number[] = [];
      for (let i = 0; i < 60; i++) {
        await nextFrame();
        const s = performance.now();
        await player.seek(Math.round((i / 60) * DRAW_TICKS));
        perFrame.push(performance.now() - s);
      }
      perFrame.sort((a, b) => a - b);
      results.seekPerFrameMs = {
        median: +perFrame[30].toFixed(2),
        p95: +perFrame[57].toFixed(2),
        max: +perFrame[59].toFixed(2),
      };

      // Does play() advance at 240 ticks per wall second?
      await player.seek(0);
      const w0 = performance.now();
      player.play();
      await wait(1000);
      const playedTicks = player.tick;
      const wall = (performance.now() - w0) / 1000;
      player.pause();
      results.playRate = { ticks: playedTicks, wallSeconds: +wall.toFixed(3), ticksPerWallSecond: +(playedTicks / wall).toFixed(1) };
      print();

      // 3. Updating a running player's document. PlayerHandle has no setter, so
      //    the only route is dispose + createPlayer (what ClayzoPlayer does).
      await player.seek(200);
      player.play();
      await wait(200);
      const variant = buildWaveDocument({ id: "wave-draw-variant", cycles: 5, color: "#2E86E4" });
      const s = performance.now();
      player.dispose();
      players.splice(players.indexOf(player), 1);
      let swapped: PlayerHandle | null = null;
      let swapError: string | null = null;
      try {
        swapped = await createPlayer({ canvas, document: variant, resolution: "document", pauseWhenOffscreen: false });
        players.push(swapped);
        swapped.pause();
        await swapped.seek(200);
      } catch (e) {
        swapError = String(e);
      }
      results.documentSwap = {
        hasSetDocumentMethod: "setDocument" in (swapped ?? {}) || "load" in (swapped ?? {}),
        method: "dispose() then createPlayer() on the same canvas",
        ms: Math.round(performance.now() - s),
        error: swapError,
        tickAfterSeek: swapped?.tick,
      };
      print();

      // 4. Many players at once.
      const grid = gridRef.current!;
      const many: { player: PlayerHandle; frames: number }[] = [];
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const c = document.createElement("canvas");
        c.style.width = "100%";
        grid.appendChild(c);
        const entry = { player: null as unknown as PlayerHandle, frames: 0 };
        entry.player = await createPlayer({
          canvas: c,
          document: buildWaveDocument({ id: `wave-${i}`, cycles: 2 + i }),
          loop: true,
          pauseWhenOffscreen: false,
          onFrame: () => entry.frames++,
          onError: (e) => errors.push(`player ${i}: ${e.message}`),
        });
        many.push(entry);
        players.push(entry.player);
      }
      for (const m of many) m.player.play();
      const startTicks = many.map((m) => m.player.tick);
      await wait(1500);
      results.manyPlayers = many.map((m, i) => ({
        index: i,
        playing: m.player.playing,
        framesIn1500ms: m.frames,
        ticksAdvanced: m.player.tick - startTicks[i],
      }));
      results.errors = errors;
      results.ticksPerSecondConvention = TICKS_PER_SECOND;
      results.done = true;
      if (!cancelled) print();
    })().catch((e) => {
      results.fatal = String(e?.stack ?? e);
      results.done = true;
      print();
    });

    return () => {
      cancelled = true;
      for (const p of players) p.dispose();
    };
  }, []);

  return (
    <main style={{ padding: 16, color: "#eee", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Clayzo spike</h1>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 480 }}>
          <canvas ref={mainRef} style={{ width: 480, height: 320, display: "block" }} />
          <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 8 }} />
        </div>
        <pre id="spike-log" style={{ flex: 1, whiteSpace: "pre-wrap" }}>{log}</pre>
      </div>
    </main>
  );
}
