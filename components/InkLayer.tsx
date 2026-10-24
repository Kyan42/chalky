"use client";

import { getStroke } from "perfect-freehand";
import { useEffect, useRef } from "react";
import { CANVAS, type StrokeData, type StrokePoint } from "@/lib/types";

export const INK_COLORS = ["#FFD84D", "#FF5C8A", "#4DA3FF", "#7BE07F", "#F4F1EA"];

type Props = {
  enabled: boolean;
  strokes: StrokeData[];
  color: string;
  size: number;
  /** Called with a finished stroke in document coordinates (1920x1080). */
  onStroke: (stroke: Omit<StrokeData, "tick" | "offsetMs">) => void;
};

/** Draws freehand ink over the stage. Strokes are stored in document coordinates so they line up with the animation. */
export function InkLayer({ enabled, strokes, color, size, onStroke }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ points: StrokePoint[]; startedAt: number } | null>(null);
  const props = useRef({ strokes, color, size });
  useEffect(() => {
    props.current = { strokes, color, size };
  });

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / CANVAS.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const all = [...props.current.strokes];
    if (live.current) all.push({ points: live.current.points, color: props.current.color, size: props.current.size, tick: 0, offsetMs: 0 });
    for (const stroke of all) {
      const outline = getStroke(
        stroke.points.map(([x, y, p]) => [x, y, p]),
        { size: stroke.size * 1.6, thinning: 0.5, smoothing: 0.6, streamline: 0.4 },
      );
      if (outline.length < 2) continue;
      ctx.fillStyle = stroke.color;
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
    }
  };

  // Match the canvas's pixel size to its box.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redraw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(redraw, [strokes]);

  const toDoc = (event: React.PointerEvent): StrokePoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * CANVAS.width,
      ((event.clientY - rect.top) / rect.height) * CANVAS.height,
      event.pressure || 0.5,
      live.current ? performance.now() - live.current.startedAt : 0,
    ];
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 h-full w-full touch-none"
      style={{ cursor: enabled ? "crosshair" : "default", pointerEvents: enabled ? "auto" : "none" }}
      onPointerDown={(event) => {
        if (!enabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        live.current = { points: [], startedAt: performance.now() };
        live.current.points.push(toDoc(event));
        redraw();
      }}
      onPointerMove={(event) => {
        if (!live.current) return;
        live.current.points.push(toDoc(event));
        redraw();
      }}
      onPointerUp={() => {
        const stroke = live.current;
        live.current = null;
        if (stroke && stroke.points.length > 1) onStroke({ points: stroke.points, color: props.current.color, size: props.current.size });
        redraw();
      }}
    />
  );
}

/** The stage frame with ink on top, as a PNG, for the tutor to look at. */
export async function snapshot(stageCanvas: HTMLCanvasElement | null, strokes: StrokeData[]): Promise<Blob | null> {
  const out = document.createElement("canvas");
  out.width = 1280;
  out.height = 720;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#0E1020";
  ctx.fillRect(0, 0, out.width, out.height);
  if (stageCanvas) {
    try {
      ctx.drawImage(stageCanvas, 0, 0, out.width, out.height);
    } catch {
      // A canvas we can't read; the ink alone still helps.
    }
  }
  const scale = out.width / CANVAS.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const stroke of strokes) {
    const outline = getStroke(stroke.points.map(([x, y, p]) => [x, y, p]), { size: stroke.size * 1.6, thinning: 0.5, smoothing: 0.6 });
    if (outline.length < 2) continue;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
  return await new Promise((resolve) => out.toBlob(resolve, "image/png"));
}
