/**
 * Chalky's pointer: a stubby stick of yellow chalk with a face, its worn tip at
 * the origin. Drawn upright (tip down at 0,0, the stick rising to y = -51) and
 * tilted by ANGLE, so the tip points down-left like a held pencil. Shared by
 * ChalkyCursor's SVG and the Clayzo preview in scripts/chalk-pointer.ts, so
 * both draw exactly these shapes.
 */

export const ANGLE = 32;

export const INK = "#3A3248";
export const COLORS = {
  chalk: "#FCE38A",
  worn: "#F2C44E",
  shine: "#FFF8DA",
  cheek: "#FF9FB2",
  dust: "#FFF4CC",
};

export interface PointerShape {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
}

/** The stick: rounded top, straight sides, a cone worn to a blunt point at the tip. */
export const BODY = "M -2.6 -0.6 Q 0 1.4 2.6 -0.6 L 9 -13 L 9 -42 C 9 -48 5 -51 0 -51 C -5 -51 -9 -48 -9 -42 L -9 -13 Z";
/** The worn cone, a shade darker. */
export const WORN = "M -2.6 -0.6 Q 0 1.4 2.6 -0.6 L 9 -13 Q 0 -10.5 -9 -13 Z";

/** Back to front, under the face. */
export const SHAPES: PointerShape[] = [
  { d: BODY, fill: COLORS.chalk },
  { d: WORN, fill: COLORS.worn },
  // A soft shine down the left side.
  { d: "M -5.2 -17 L -5.2 -40", stroke: COLORS.shine, width: 2.6, opacity: 0.9 },
  { d: BODY, stroke: INK, width: 1.7 },
  { d: "M -9 -13 Q 0 -10.5 9 -13", stroke: INK, width: 1.2, opacity: 0.55 },
];

/** Eyes (blink about their centres), cheeks and a small smile. */
export const EYES: { cx: number; cy: number; r: number }[] = [
  { cx: -3.6, cy: -31, r: 1.7 },
  { cx: 3.6, cy: -31, r: 1.7 },
];
export const CHEEKS: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: -6, cy: -27, rx: 1.9, ry: 1.2 },
  { cx: 6, cy: -27, rx: 1.9, ry: 1.2 },
];
export const SMILE = "M -2.4 -26.6 Q 0 -24.2 2.4 -26.6";

/** A puff of chalk dust where the tip touches: untilted, around the origin. */
export const DUST: { cx: number; cy: number; r: number; opacity: number }[] = [
  { cx: -3.5, cy: 4, r: 2.2, opacity: 0.8 },
  { cx: 2.5, cy: 6, r: 1.5, opacity: 0.65 },
  { cx: -7.5, cy: 1, r: 1.2, opacity: 0.55 },
  { cx: 0.5, cy: 9.5, r: 1, opacity: 0.45 },
];
