import { base, constant, hex, keyed, stroke, trim, type PathNode } from "@clayzo/animation/authoring";
import type { StrokeData } from "../types";

/** Ink is snapped to the frame grid: 8 ticks per frame at 240 ticks per second and 30 fps. */
const FRAME_TICKS = 8;
const snap = (tick: number) => Math.max(0, Math.round(tick / FRAME_TICKS) * FRAME_TICKS);

/**
 * The student's strokes as Clayzo path nodes that draw on with `trim`, the way they were drawn.
 *
 * `startTickFor(stroke)` says when (in the target document's ticks) each stroke starts drawing;
 * it takes as long as the student took to draw it. Pass `drawn: true` for strokes that should
 * simply be there from the start.
 */
export function inkNodes(
  strokes: StrokeData[],
  options: { prefix: string; outTick: number; startTickFor?: (stroke: StrokeData) => number; drawn?: boolean },
): PathNode[] {
  return strokes
    .filter((s) => s.points.length >= 2)
    .map((s, index) => {
      const id = `${options.prefix}-${index}`;
      const durationMs = Math.max(1, s.points[s.points.length - 1][3]);
      const start = options.drawn ? 0 : snap(options.startTickFor?.(s) ?? 0);
      const end = Math.max(start + FRAME_TICKS, snap(start + (durationMs / 1000) * 240));
      return {
        ...base(id, { outTick: options.outTick }),
        type: "path",
        path: constant({
          contours: [
            {
              closed: false,
              vertices: s.points.map(([x, y]) => ({ point: { x, y }, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } })),
            },
          ],
        }),
        style: { stroke: stroke(hex(s.color), s.size) },
        operators: options.drawn
          ? []
          : [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0, "hold"], [start, 0, "linear"], [end, 1]]) })],
      } satisfies PathNode;
    });
}
