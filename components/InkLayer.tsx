"use client";

/**
 * The learner's pen over the whiteboard: freehand strokes (perfect-freehand),
 * kept in the board's world pixels, so they line up with the drawing at any
 * size and move with it when the board zooms out. Ported from the
 * video-integration branch's ink layer.
 */
import { getStroke } from "perfect-freehand";
import { useEffect, useRef } from "react";
import type { InkPoint, InkStroke } from "@/lib/lesson/ink";

/**
 * Where the board's camera is, on the 100x100 grid: the world point at the
 * board's centre, and how much it is scaled (1 is the whole board, below 1
 * zoomed out). A world grid point maps to the screen as (p - c) * s + 50.
 */
export interface InkCamera {
  cx: number;
  cy: number;
  s: number;
}
export const NO_ZOOM: InkCamera = { cx: 50, cy: 50, s: 1 };

/** The world-to-screen transform, in board pixels: screen = world * s + t. */
function cameraMatrix(c: InkCamera, width: number, height: number) {
  return { s: c.s, tx: ((50 - c.cx * c.s) / 100) * width, ty: ((50 - c.cy * c.s) / 100) * height };
}

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
  /** The board's camera right now; read every frame, so the ink follows a zoom as it animates. */
  camera?: () => InkCamera;
}

export function InkLayer({ width, height, enabled, strokes, color, onPenDown, onStroke, camera }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<InkPoint[] | null>(null);
  const latest = useRef({ strokes, color, camera });
  useEffect(() => {
    latest.current = { strokes, color, camera };
  });
  const view = () => latest.current.camera?.() ?? NO_ZOOM;

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const kx = canvas.width / width, ky = canvas.height / height;
    const m = cameraMatrix(view(), width, height);
    ctx.setTransform(kx * m.s, 0, 0, ky * m.s, kx * m.tx, ky * m.ty);
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

  // Follow the camera: redraw whenever it moves (a zoom is a second of frames; otherwise this does nothing).
  useEffect(() => {
    let raf = 0;
    let last = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const c = view();
      const key = `${c.cx.toFixed(3)},${c.cy.toFixed(3)},${c.s.toFixed(4)}`;
      if (key !== last) {
        last = key;
        redraw();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A pointer position as a world point (board pixels before any zoom). */
  const toBoard = (event: React.PointerEvent): InkPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const m = cameraMatrix(view(), width, height);
    const sx = ((event.clientX - rect.left) / rect.width) * width, sy = ((event.clientY - rect.top) / rect.height) * height;
    return [(sx - m.tx) / m.s, (sy - m.ty) / m.s, event.pressure || 0.5];
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
export function snapshotBoard(board: HTMLCanvasElement | null, strokes: InkStroke[], width: number, height: number, camera: InkCamera = NO_ZOOM): string | null {
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
  const m = cameraMatrix(camera, width, height);
  const kx = out.width / width, ky = out.height / height;
  ctx.setTransform(kx * m.s, 0, 0, ky * m.s, kx * m.tx, ky * m.ty);
  for (const s of strokes) paint(ctx, s);
  return out.toDataURL("image/jpeg", 0.82).split(",")[1] ?? null;
}
