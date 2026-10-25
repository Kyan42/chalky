"use client";

/**
 * The learner's pen over the whiteboard: freehand strokes (perfect-freehand),
 * kept in board pixels so they line up with the drawing at any size. Ported
 * from the video-integration branch's ink layer.
 */
import { getStroke } from "perfect-freehand";
import { useEffect, useRef } from "react";
import type { InkPoint, InkStroke } from "@/lib/lesson/ink";

/** The learner's chalk: blue first, so it never reads as Chalky's red loops. */
export const INK_COLORS = ["#2F6FDB", "#2E9E57", "#EE8A22", "#23262F"];
const INK_SIZE = 7;

function paint(ctx: CanvasRenderingContext2D, stroke: InkStroke) {
  const outline = getStroke(stroke.points, { size: INK_SIZE * 1.6, thinning: 0.5, smoothing: 0.6, streamline: 0.4 });
  if (outline.length < 2) return;
  ctx.fillStyle = stroke.color;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

interface Props {
  /** The board's size in pixels; strokes are stored in this space. */
  width: number;
  height: number;
  enabled: boolean;
  strokes: InkStroke[];
  color: string;
  /** A stroke is starting (Chalky should stop talking). */
  onPenDown?: () => void;
  onStroke: (stroke: InkStroke) => void;
}

export function InkLayer({ width, height, enabled, strokes, color, onPenDown, onStroke }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<InkPoint[] | null>(null);
  const latest = useRef({ strokes, color });
  useEffect(() => {
    latest.current = { strokes, color };
  });

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    for (const s of latest.current.strokes) paint(ctx, s);
    if (live.current) paint(ctx, { points: live.current, color: latest.current.color });
  };

  // Match the canvas's pixels to its box.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(redraw, [strokes]);

  const toBoard = (event: React.PointerEvent): InkPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * width, ((event.clientY - rect.top) / rect.height) * height, event.pressure || 0.5];
  };

  return (
    <canvas
      ref={canvasRef}
      className="ink"
      data-testid="ink"
      style={{ cursor: enabled ? "crosshair" : "default", pointerEvents: enabled ? "auto" : "none" }}
      onPointerDown={(event) => {
        if (!enabled) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Not a live pointer (a synthetic event): the stroke still draws, just without capture.
        }
        onPenDown?.();
        live.current = [toBoard(event)];
        redraw();
      }}
      onPointerMove={(event) => {
        if (!live.current) return;
        live.current.push(toBoard(event));
        redraw();
      }}
      onPointerUp={() => {
        const points = live.current;
        live.current = null;
        if (points && points.length > 1) onStroke({ points, color: latest.current.color });
        redraw();
      }}
    />
  );
}

/**
 * The board as the learner sees it, their ink on top, as a JPEG for the reply
 * model to look at: base64 without the data: prefix. The board is read from its
 * WebGL canvas right after a frame draws; if that comes back unreadable, the ink
 * alone still says what they drew.
 */
export function snapshotBoard(board: HTMLCanvasElement | null, strokes: InkStroke[], width: number, height: number): string | null {
  const out = document.createElement("canvas");
  out.width = 900;
  out.height = Math.round((900 * height) / width);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#FBFAF7";
  ctx.fillRect(0, 0, out.width, out.height);
  if (board) {
    try {
      ctx.drawImage(board, 0, 0, out.width, out.height);
    } catch {
      // A canvas we can't read: the ink alone still helps.
    }
  }
  ctx.setTransform(out.width / width, 0, 0, out.height / height, 0, 0);
  for (const s of strokes) paint(ctx, s);
  return out.toDataURL("image/jpeg", 0.82).split(",")[1] ?? null;
}
