/**
 * The learner's ink on the board: freehand strokes, and what they mark. A
 * closed-ish stroke circles whatever it goes round; any other stroke touches
 * what it crosses, and an arrow-like stroke points at what its end lands on.
 * Works in board pixels (W x H) against element boxes on the 100x100 grid.
 */

/** [x, y, pressure] in board pixels. */
export type InkPoint = [number, number, number];

export interface InkStroke {
  points: InkPoint[];
  color: string;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type InkHow = "circled" | "pointed at" | "drew over";
const ORDER: Record<InkHow, number> = { circled: 0, "pointed at": 1, "drew over": 2 };

export interface InkMark {
  id: string;
  label: string;
  how: InkHow;
  /** Marked by the learner's last stroke: what "this" most likely means. */
  latest?: boolean;
}

/** What the learner's ink says, for /api/converse. */
export interface InkSummary {
  marks: InkMark[];
  /** Strokes that mark nothing on the board (a sketch of their own). */
  loose: number;
}

const inside = (x: number, y: number, poly: [number, number][]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** A stroke that ends near where it started, relative to its size: a loop round something. */
function isLoop(pts: [number, number][]): boolean {
  if (pts.length < 8) return false;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return span > 3 && gap < span * 0.35;
}

/**
 * Which board elements the strokes mark, most specific first: things circled
 * (the tightest first, so "the nucleus" beats "the cell" it sits in), then
 * what an arrow points at, then what a stroke crosses.
 */
export function readInk(
  strokes: InkStroke[],
  boxes: Record<string, GridRect>,
  labels: Record<string, string>,
  size: { w: number; h: number },
): InkSummary {
  const ids = Object.keys(boxes).filter((id) => labels[id] !== undefined);
  const best = new Map<string, { how: InkHow; rank: number; stroke: number }>();
  let stroke = -1;
  // Each element keeps its strongest mark: circled beats pointed at beats drew over.
  const mark = (id: string, how: InkHow, rank: number) => {
    const prev = best.get(id);
    if (!prev || ORDER[how] < ORDER[prev.how] || (ORDER[how] === ORDER[prev.how] && rank < prev.rank)) best.set(id, { how, rank, stroke });
    else prev.stroke = stroke;
  };
  let loose = 0;
  for (const s of strokes) {
    const pts = s.points.map(([x, y]) => [(x / size.w) * 100, (y / size.h) * 100] as [number, number]);
    if (pts.length < 2) continue;
    stroke++;
    let marked = false;
    if (isLoop(pts)) {
      for (const id of ids) {
        const b = boxes[id];
        // Nine sample points over the box: most of them inside the loop means it was circled.
        let n = 0;
        for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) if (inside(b.x + b.w * fx, b.y + b.h * fy, pts)) n++;
        if (n >= 6) {
          mark(id, "circled", b.w * b.h);
          marked = true;
        }
      }
    } else {
      const [ex, ey] = pts[pts.length - 1];
      let near: { id: string; d: number } | null = null;
      for (const id of ids) {
        const b = boxes[id];
        const dx = Math.max(b.x - ex, 0, ex - (b.x + b.w)), dy = Math.max(b.y - ey, 0, ey - (b.y + b.h));
        const d = Math.hypot(dx, dy);
        if (d < 4 && (!near || d < near.d || (d === near.d && b.w * b.h < boxes[near.id].w * boxes[near.id].h))) near = { id, d };
      }
      if (near) {
        mark(near.id, "pointed at", boxes[near.id].w * boxes[near.id].h);
        marked = true;
      }
      for (const id of ids) {
        const b = boxes[id];
        const hits = pts.filter(([x, y]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h).length;
        if (hits >= Math.max(2, pts.length * 0.25)) {
          mark(id, "drew over", b.w * b.h);
          marked = true;
        }
      }
    }
    if (!marked) loose++;
  }
  const marks = [...best.entries()]
    .sort((a, b) => ORDER[a[1].how] - ORDER[b[1].how] || a[1].rank - b[1].rank)
    .slice(0, 5)
    .map(([id, m]) => ({ id, label: labels[id], how: m.how, ...(m.stroke === stroke ? { latest: true } : {}) }));
  return { marks, loose };
}
