import type { Manifest, StrokeData } from "../types";

/**
 * Which on-screen elements the student's ink points at, best match first. Uses the bounds the
 * animation recorded in its manifest and the elements visible at `tick`.
 */
export function circledElements(manifest: Manifest | null | undefined, tick: number, strokes: StrokeData[], limit = 3) {
  if (!manifest || strokes.length === 0) return [];
  const points = strokes.flatMap((s) => s.points);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const ink = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const inkArea = Math.max(1, (ink.x1 - ink.x0) * (ink.y1 - ink.y0));

  return manifest.elements
    .filter((e) => e.firstTick <= tick && tick < e.lastTick)
    .map((e) => {
      const b = { x0: e.bounds.x, y0: e.bounds.y, x1: e.bounds.x + e.bounds.width, y1: e.bounds.y + e.bounds.height };
      const overlap = Math.max(0, Math.min(ink.x1, b.x1) - Math.max(ink.x0, b.x0)) * Math.max(0, Math.min(ink.y1, b.y1) - Math.max(ink.y0, b.y0));
      const area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
      // How much of the element is covered, and how much of the ink is on it.
      return { label: e.label, concept: e.concept, score: overlap / area + overlap / inkArea };
    })
    .filter((e) => e.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ label, concept }) => ({ label, concept }));
}
