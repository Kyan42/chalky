// A block is one small whiteboard drawing (a sun, a leaf, a CO2 molecule) that a lesson places on the
// board and chains with others: arrows between them, molecules travelling from one to another,
// circling a part. It is plain data: line art in its own box, grouped into named parts, with named
// anchor points to aim at. `board.ts` places blocks and chains the steps into one Clayzo document.

/** A whiteboard colour name ("ink", "green", "green-tint", …) or a hex string. */
export type Paint = string;

export type Shape = (
  /** An SVG path in the block's box. Use M, L, C, Q, Z; arcs (A) are flattened to straight lines. */
  | { type: "path"; d: string }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; r?: number }
) & {
  /** Marker colour of the outline. Drawn on stroke by stroke. */
  stroke?: Paint;
  /** A pale tint behind the outline; fades in once its outline is drawn. */
  fill?: Paint;
  /** Marker thickness as a multiple of the board's marker. Default 1. */
  width?: number;
};

export type Part = {
  id: string;
  /** What the part is, for the tutor and the model: "nucleus", "roots". */
  label: string;
  /** Drawn in this order. */
  shapes: Shape[];
};

export type Block = {
  id: string;
  title: string;
  /** One line the lesson model reads to choose it. */
  describe: string;
  tags: string[];
  /** The block's box: shapes use 0..w and 0..h, y down. */
  size: [w: number, h: number];
  /** Drawn in this order, back to front. */
  parts: Part[];
  /** Named points in the box for arrows, labels and travel to start or end at. */
  anchors: Record<string, [number, number]>;
};
