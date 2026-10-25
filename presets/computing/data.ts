// Data structures and algorithm pictures: arrays, lists, stacks, trees, graphs, tables, bars.
// Every block is a factory plus a default instance. Each cell, node, edge and bar is its own part with
// its own anchor, so lessons can point at, circle and send things between single elements.
import { poly, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

// ---- Helpers: draw in any units, then fit the drawing into a box whose longer side is 100. ----

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink"]);
/** The colour's pale fill, when it has one. */
const tint = (c: string) => (TINTED.has(c) ? `${c}-tint` : undefined);
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => {
  const x = Math.round(typeof v === "number" && Number.isFinite(v) ? v : d);
  return Math.min(hi, Math.max(lo, x));
};

type Style = { fill?: string; width?: number; r?: number };
const rect = (x: number, y: number, w: number, h: number, stroke: string, o: Style = {}): Shape => ({
  type: "rect", x, y, w, h, stroke, ...(o.r ? { r: o.r } : {}), ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const circle = (cx: number, cy: number, r: number, stroke: string, o: Style = {}): Shape => ({
  type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(o.fill ? { fill: o.fill } : {}), ...(o.width ? { width: o.width } : {}),
});
const line = (pts: P[], stroke: string, width?: number): Shape => ({ type: "path", d: poly(pts), stroke, ...(width ? { width } : {}) });
/** An invisible box: gives a group part (a row, a column, an overlap) a place to be circled. */
const ghost = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });

/** Arrowhead lines at `tip`, pointing along `dir`. */
const head = (tip: P, dir: P, size: number) => {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const u: P = [dir[0] / len, dir[1] / len], v: P = [-u[1], u[0]];
  const a: P = [tip[0] - u[0] * size + v[0] * size * 0.75, tip[1] - u[1] * size + v[1] * size * 0.75];
  const b: P = [tip[0] - u[0] * size - v[0] * size * 0.75, tip[1] - u[1] * size - v[1] * size * 0.75];
  return poly([a, tip, b]);
};
/** A straight arrow from a to b. */
const arrow = (a: P, b: P, stroke: string, size = 5, width?: number): Shape => ({
  type: "path", d: `${poly([a, b])} ${head(b, [b[0] - a[0], b[1] - a[1]], size)}`, stroke, ...(width ? { width } : {}),
});
/** The segment between two circles' edges (centres a and b, radii ra and rb). */
const between = (a: P, b: P, ra: number, rb: number): [P, P] => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  return [[a[0] + (dx / len) * ra, a[1] + (dy / len) * ra], [b[0] - (dx / len) * rb, b[1] - (dy / len) * rb]];
};
/** Side-of-the-chalk shading inside a square cell: a tight zigzag of diagonals (shows in every theme). */
const scribble = (x: number, y: number, size: number, stroke: string): Shape => {
  const inset = size * 0.28, s = size - inset * 2, x0 = x + inset, y0 = y + inset, K = 4;
  const pts: P[] = [];
  for (let k = 1; k < K; k++) {
    const c = (2 * s * k) / K;
    const p: P = [x0 + Math.max(0, c - s), y0 + Math.min(c, s)], q: P = [x0 + Math.min(c, s), y0 + Math.max(0, c - s)];
    pts.push(...(k % 2 ? [p, q] : [q, p]));
  }
  return line(pts, stroke, 0.8);
};

class Sketch {
  parts: Part[] = [];
  anchors: Record<string, P> = {};
  part(id: string, label: string, ...shapes: Shape[]) {
    this.parts.push({ id, label, shapes });
    return this;
  }
  at(name: string, p: P) {
    this.anchors[name] = p;
    return this;
  }
}

type Meta = Pick<Block, "id" | "title" | "describe" | "tags">;
const r1 = (v: number) => +v.toFixed(1);

/** Scales and centres a sketch drawn inside `bounds` into a box with longer side 100 (never thinner than 3:1). */
function finish(meta: Meta, sk: Sketch, bounds: [number, number, number, number], margin = 5): Block {
  const [x0, y0, x1, y1] = bounds;
  const w = x1 - x0, h = y1 - y0;
  const s = (100 - 2 * margin) / Math.max(w, h);
  let W = w * s + 2 * margin, H = h * s + 2 * margin;
  if (W >= H) (W = 100), (H = Math.max(H, 100 / 3));
  else (H = 100), (W = Math.max(W, 100 / 3));
  const ox = (W - w * s) / 2 - x0 * s, oy = (H - h * s) / 2 - y0 * s;
  const fx = (x: number) => r1(x * s + ox), fy = (y: number) => r1(y * s + oy);
  const pt = (p: P): [number, number] => [fx(p[0]), fy(p[1])];
  const path = (d: string) => {
    const out: string[] = [];
    let pending: number | null = null;
    for (const tok of d.match(/[MLCQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []) {
      if (/^[A-Z]$/i.test(tok)) out.push(tok.toUpperCase());
      else if (pending === null) pending = +tok;
      else out.push(`${fx(pending)} ${fy(+tok)}`), (pending = null);
    }
    return out.join(" ").replace(/([MLCQ]) /g, "$1");
  };
  const shape = (sh: Shape): Shape => {
    if (sh.type === "rect") return { ...sh, x: fx(sh.x), y: fy(sh.y), w: r1(sh.w * s), h: r1(sh.h * s), ...(sh.r ? { r: r1(sh.r * s) } : {}) };
    if (sh.type === "ellipse") return { ...sh, cx: fx(sh.cx), cy: fy(sh.cy), rx: r1(sh.rx * s), ry: r1(sh.ry * s) };
    return { ...sh, d: path(sh.d) };
  };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const anchors: Record<string, [number, number]> = {
    center: pt([cx, cy]), top: pt([cx, y0]), bottom: pt([cx, y1]), left: pt([x0, cy]), right: pt([x1, cy]),
  };
  for (const [k, p] of Object.entries(sk.anchors)) anchors[k] = pt(p);
  return { ...meta, size: [r1(W), r1(H)], parts: sk.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })), anchors };
}

/** A row of square cells from (0, 0): parts and anchors `${prefix}-i`, plus above-i and below-i. */
function cellRow(sk: Sketch, n: number, c: number, color: string, prefix = "cell", label = "cell", shade?: (i: number) => boolean) {
  for (let i = 0; i < n; i++) {
    const x = i * c;
    const shapes = [rect(x, 0, c, c, color, { fill: tint(color) })];
    if (shade?.(i)) shapes.push(scribble(x, 0, c, color));
    sk.part(`${prefix}-${i}`, `${label} ${i}`, ...shapes);
    sk.at(`${prefix}-${i}`, [x + c / 2, c / 2]).at(`above-${i}`, [x + c / 2, -c * 0.6]).at(`below-${i}`, [x + c / 2, c * 1.6]);
  }
}

// ---- Data structures ----

export interface ArrayOptions { n?: number; color?: string }
/** An array of `n` cells in a row (2–10, default 6). */
export function makeArray({ n = 6, color = "blue" }: ArrayOptions = {}): Block {
  n = clamp(n, 2, 10, 6);
  const sk = new Sketch(), c = 16;
  cellRow(sk, n, c, color);
  return finish(
    { id: "array", title: "Array", describe: "an array: n cells in a row, numbered from 0 left to right; set n (2-10); anchors cell-i, above-i, below-i", tags: ["array", "list", "index", "data structure", "memory", "programming"] },
    sk, [0, 0, n * c, c],
  );
}
export const array = makeArray();

export interface LinkedListOptions { n?: number; color?: string }
/** A linked list of `n` nodes joined by arrows (2–6, default 3). */
export function makeLinkedList({ n = 3, color = "blue" }: LinkedListOptions = {}): Block {
  n = clamp(n, 2, 6, 3);
  const sk = new Sketch(), w = 22, h = 20, step = 44;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    sk.part(`node-${i}`, `node ${i}`, rect(x, 0, w, h, color, { r: 3, fill: tint(color) }));
    sk.at(`node-${i}`, [x + w / 2, h / 2]);
    if (i < n - 1) sk.part(`arrow-${i}`, `pointer from node ${i} to node ${i + 1}`, arrow([x + w + 2, h / 2], [x + step - 2, h / 2], color, 4.5));
    if (i < n - 1) sk.at(`arrow-${i}`, [x + w + (step - w) / 2, h / 2]);
  }
  const last = (n - 1) * step;
  sk.at("head", [w / 2, -10]).at("tail", [last + w / 2, -10]).at("next", [last + w + 12, h / 2]);
  return finish(
    { id: "linked-list", title: "Linked List", describe: "a linked list: n nodes in a row, each pointing to the next with an arrow; set n (2-6); anchors node-i, head, tail", tags: ["linked list", "node", "pointer", "data structure", "list", "programming"] },
    sk, [0, 0, last + w, h],
  );
}
export const linkedList = makeLinkedList();

export interface StackOptions { n?: number; color?: string }
/** A stack of `n` items in an open-topped box, bottom to top (1–6, default 3), with room for one more. */
export function makeStack({ n = 3, color = "blue" }: StackOptions = {}): Block {
  n = clamp(n, 1, 6, 3);
  const sk = new Sketch(), w = 44, h = 14, top = -(n + 1) * h - 2;
  sk.part("container", "stack", line([[-8, top], [-8, 8], [w + 8, 8], [w + 8, top]], color));
  for (let i = 0; i < n; i++) {
    sk.part(`item-${i}`, `item ${i}`, rect(0, -(i + 1) * h, w, h, color, { r: 2, fill: tint(color) }));
    sk.at(`item-${i}`, [w / 2, -(i + 0.5) * h]);
  }
  sk.at("top-of-stack", [w / 2, -(n - 0.5) * h]).at("push", [w / 2, -(n + 0.5) * h]);
  return finish(
    { id: "stack", title: "Stack", describe: "a stack: n items piled in an open box, item-0 at the bottom; set n (1-6); anchors item-i, top-of-stack, push (the empty slot above)", tags: ["stack", "LIFO", "push", "pop", "data structure", "programming"] },
    sk, [-8, top, w + 8, 8],
  );
}
export const stack = makeStack();

export interface QueueOptions { n?: number; color?: string }
/** A queue of `n` items in a line (1–6, default 4): in at the back (right), out at the front (left). */
export function makeQueue({ n = 4, color = "blue" }: QueueOptions = {}): Block {
  n = clamp(n, 1, 6, 4);
  const sk = new Sketch(), step = 28, r = 10, xL = -r, xR = (n - 1) * step + r;
  for (let i = 0; i < n; i++) {
    sk.part(`item-${i}`, `item ${i}`, rect(i * step - r, -r, 2 * r, 2 * r, color, { r: 3, fill: tint(color) }));
    sk.at(`item-${i}`, [i * step, 0]);
  }
  sk.part("dequeue", "out of the front", arrow([xL - 4, 0], [xL - 18, 0], color, 5));
  sk.part("enqueue", "in at the back", arrow([xR + 18, 0], [xR + 4, 0], color, 5));
  sk.at("front", [0, 0]).at("back", [(n - 1) * step, 0]).at("out", [xL - 18, 0]).at("in", [xR + 18, 0]);
  return finish(
    { id: "queue", title: "Queue", describe: "a queue: n square items in a line, joining at the back (right) and leaving at the front (left); set n (1-6); anchors item-i, front, back, in, out", tags: ["queue", "FIFO", "enqueue", "dequeue", "data structure", "programming"] },
    sk, [xL - 18, -r, xR + 18, r],
  );
}
export const queue = makeQueue();

export interface BinaryTreeOptions { depth?: number; color?: string }
/** A full binary tree `depth` levels deep (1–4, default 3). Nodes node-L-I: level L, I-th from the left. */
export function makeBinaryTree({ depth = 3, color = "blue" }: BinaryTreeOptions = {}): Block {
  depth = clamp(depth, 1, 4, 3);
  const sk = new Sketch(), sp = 25, dy = 30, r = 8, leaves = 2 ** (depth - 1);
  const pos = (L: number, I: number): P => [(I + 0.5) * (leaves / 2 ** L) * sp, L * dy];
  for (let L = 0; L < depth; L++) {
    for (let I = 0; I < 2 ** L; I++) {
      if (L > 0) {
        const [a, b] = between(pos(L - 1, I >> 1), pos(L, I), r + 1, r + 1);
        sk.part(`edge-${L}-${I}`, `edge into node ${L}-${I}`, line([a, b], color, 0.8));
      }
    }
    for (let I = 0; I < 2 ** L; I++) {
      sk.part(`node-${L}-${I}`, `node ${L}-${I}`, circle(...pos(L, I), r, color, { fill: tint(color) }));
      sk.at(`node-${L}-${I}`, pos(L, I));
    }
  }
  sk.at("root", pos(0, 0));
  return finish(
    { id: "binary-tree", title: "Binary Tree", describe: "a full binary tree of circle nodes; set depth (1-4 levels); anchors root and node-L-I (level L, I-th from the left), edges edge-L-I", tags: ["binary tree", "tree", "node", "root", "leaf", "data structure"] },
    sk, [sp / 2 - r, -r, leaves * sp - sp / 2 + r, (depth - 1) * dy + r],
  );
}
export const binaryTree = makeBinaryTree();

export interface TreeStructureOptions { children?: number; depth?: number; color?: string }
/** A general tree: a root with `children` (2–4) children, branching unevenly `depth` (1–3) levels down. */
export function makeTreeStructure({ children = 3, depth = 2, color = "blue" }: TreeStructureOptions = {}): Block {
  children = clamp(children, 2, 4, 3);
  depth = clamp(depth, 1, 3, 2);
  type N = { L: number; I: number; kids: N[]; x: number };
  const levels: N[][] = [[{ L: 0, I: 0, kids: [], x: 0 }]];
  const pattern = [[], [2, 0, 1, 2], [1, 0, 2, 0, 1, 0]];
  for (let L = 0; L < depth; L++) {
    const next: N[] = [];
    levels[L].forEach((p, j) => {
      const k = L === 0 ? children : pattern[L][j % pattern[L].length];
      for (let c = 0; c < k; c++) {
        const node: N = { L: L + 1, I: next.length, kids: [], x: 0 };
        p.kids.push(node);
        next.push(node);
      }
    });
    levels.push(next);
  }
  // Tidy layout: leaves in slots left to right, each parent centred over its children.
  const sp = 28, dy = 32, half = 8;
  let slot = 0;
  const place = (n: N): number => (n.x = n.kids.length ? (n.kids.map(place)[0] + n.kids[n.kids.length - 1].x) / 2 : slot++ * sp);
  place(levels[0][0]);
  const sk = new Sketch();
  const at = (n: N): P => [n.x, n.L * dy];
  for (const lvl of levels) {
    for (const n of lvl) {
      sk.part(`node-${n.L}-${n.I}`, `node ${n.L}-${n.I}`, rect(n.x - half, n.L * dy - half, half * 2, half * 2, color, { r: 4, fill: tint(color) }));
      sk.at(`node-${n.L}-${n.I}`, at(n));
    }
    for (const n of lvl) {
      for (const k of n.kids) {
        const [a, b] = between(at(n), at(k), half + 2, half + 2);
        sk.part(`edge-${k.L}-${k.I}`, `edge into node ${k.L}-${k.I}`, line([[a[0], n.L * dy + half + 2], [b[0], k.L * dy - half - 2]], color, 0.8));
      }
    }
  }
  sk.at("root", [levels[0][0].x, 0]);
  const xs = levels.flat().map((n) => n.x);
  const bottom = levels.filter((l) => l.length).length - 1;
  return finish(
    { id: "tree-structure", title: "Tree", describe: "a general tree (like folders): a root with some children, each branching unevenly; set children (2-4) and depth (1-3); anchors root, node-L-I", tags: ["tree", "hierarchy", "folders", "node", "root", "data structure"] },
    sk, [Math.min(...xs) - half, -half, Math.max(...xs) + half, bottom * dy + half],
  );
}
export const treeStructure = makeTreeStructure();

export interface GraphOptions { n?: number; edges?: [number, number][]; color?: string }
/** A graph of `n` nodes round a circle (3–8, default 5), joined by `edges` ([from, to] pairs; default a ring with a chord or two). */
export function makeGraph({ n = 5, edges, color = "blue" }: GraphOptions = {}): Block {
  n = clamp(n, 3, 8, 5);
  const R = 38, r = n >= 7 ? 7 : 8.5;
  const pos = (i: number): P => [Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n) * R, Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n) * R];
  const list: [number, number][] = edges ?? [
    ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]).map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number]),
    ...(n >= 4 ? [[0, Math.floor(n / 2)] as [number, number]] : []),
    ...(n >= 6 ? [[1, n - 2] as [number, number]] : []),
  ];
  const sk = new Sketch(), seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    sk.part(`node-${i}`, `node ${i}`, circle(...pos(i), r, color, { fill: tint(color) }));
    sk.at(`node-${i}`, pos(i));
  }
  for (const [a0, b0] of list) {
    const a = Math.round(a0), b = Math.round(b0);
    if (!(a >= 0 && b >= 0 && a < n && b < n) || a === b || seen.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
    seen.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
    const [p, q] = between(pos(a), pos(b), r + 1.5, r + 1.5);
    sk.part(`edge-${a}-${b}`, `edge from node ${a} to node ${b}`, line([p, q], color, 0.8));
    sk.at(`edge-${a}-${b}`, [(pos(a)[0] + pos(b)[0]) / 2, (pos(a)[1] + pos(b)[1]) / 2]);
  }
  const ps = Array.from({ length: n }, (_, i) => pos(i));
  return finish(
    { id: "graph", title: "Graph", describe: "a graph: n circle nodes round a ring joined by edges; set n (3-8) and edges ([from, to] pairs); anchors node-i, edge-a-b", tags: ["graph", "nodes", "edges", "network", "vertices", "data structure"] },
    sk, [Math.min(...ps.map((p) => p[0])) - r, Math.min(...ps.map((p) => p[1])) - r, Math.max(...ps.map((p) => p[0])) + r, Math.max(...ps.map((p) => p[1])) + r],
  );
}
export const graph = makeGraph();

export interface HashTableOptions { buckets?: number; chain?: number; color?: string }
/** A hash table: a column of `buckets` (3–8, default 5), some with chains of up to `chain` entries (0–3, default 2). */
export function makeHashTable({ buckets = 5, chain = 2, color = "blue" }: HashTableOptions = {}): Block {
  buckets = clamp(buckets, 3, 8, 5);
  chain = clamp(chain, 0, 3, 2);
  const sk = new Sketch(), bw = 20, bh = 22, ew = 24, eh = 13, step = 42;
  const pattern = [chain, 0, 1, chain, 0, 2, 1, 0].map((k) => Math.min(k, chain));
  for (let i = 0; i < buckets; i++) {
    const y = i * bh, len = pattern[i];
    const shapes = [rect(0, y, bw, bh, color, { fill: tint(color) })];
    sk.part(`bucket-${i}`, `bucket ${i}`, ...shapes);
    sk.at(`bucket-${i}`, [bw / 2, y + bh / 2]);
    for (let j = 0; j < len; j++) {
      const x = bw + j * step;
      sk.part(`link-${i}-${j}`, `pointer to entry ${i}-${j}`, arrow([x + 2, y + bh / 2], [x + step - ew - 4, y + bh / 2], color, 4.5));
      sk.part(`entry-${i}-${j}`, `entry ${i}-${j}`, rect(x + step - ew - 2, y + (bh - eh) / 2, ew, eh, color, { r: 2, fill: tint(color) }));
      sk.at(`entry-${i}-${j}`, [x + step - 2 - ew / 2, y + bh / 2]);
    }
    sk.at(`slot-${i}`, [bw + pattern[i] * step + 8, y + bh / 2]);
  }
  const maxLen = Math.max(0, ...pattern.slice(0, buckets));
  return finish(
    { id: "hash-table", title: "Hash Table", describe: "a hash table: a column of buckets, some with chained entries off to the right; set buckets (3-8) and chain (0-3); anchors bucket-i, entry-i-j, slot-i (end of a chain)", tags: ["hash table", "hashing", "buckets", "dictionary", "data structure", "lookup"] },
    sk, [0, 0, bw + maxLen * step, buckets * bh],
  );
}
export const hashTable = makeHashTable();

export interface MatrixOptions { rows?: number; cols?: number; color?: string }
/** A matrix: a `rows` × `cols` grid of cells (1–6 each, default 3 × 3) in square brackets. */
export function makeMatrix({ rows = 3, cols = 3, color = "blue" }: MatrixOptions = {}): Block {
  rows = clamp(rows, 1, 6, 3);
  cols = clamp(cols, 1, 6, 3);
  const sk = new Sketch(), c = 16, W = cols * c, H = rows * c, g = 6, serif = 5;
  sk.part("bracket-left", "left bracket", line([[-g + serif, -4], [-g, -4], [-g, H + 4], [-g + serif, H + 4]], color));
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      sk.part(`cell-${r}-${k}`, `cell ${r}-${k}`, rect(k * c, r * c, c, c, color, { width: 0.8 }));
      sk.at(`cell-${r}-${k}`, [k * c + c / 2, r * c + c / 2]);
    }
  }
  sk.part("bracket-right", "right bracket", line([[W + g - serif, -4], [W + g, -4], [W + g, H + 4], [W + g - serif, H + 4]], color));
  for (let r = 0; r < rows; r++) sk.part(`row-${r}`, `row ${r}`, ghost(0, r * c, W, c)).at(`row-${r}`, [W / 2, r * c + c / 2]);
  for (let k = 0; k < cols; k++) sk.part(`col-${k}`, `column ${k}`, ghost(k * c, 0, c, H)).at(`col-${k}`, [k * c + c / 2, H / 2]);
  return finish(
    { id: "matrix", title: "Matrix", describe: "a matrix: a grid of cells in square brackets; set rows and cols (1-6); parts and anchors cell-r-c, row-r, col-c", tags: ["matrix", "grid", "2D array", "rows", "columns", "linear algebra"] },
    sk, [-g, -4, W + g, H + 4],
  );
}
export const matrix = makeMatrix();

const SMILEY: [number, number][] = [[1, 1], [1, 3], [3, 0], [3, 4], [4, 1], [4, 2], [4, 3]];

export interface PixelGridOptions { rows?: number; cols?: number; filled?: [number, number][]; color?: string }
/** A grid of pixels (`rows` × `cols`, 2–8, default 5 × 5) with the `filled` [r, c] cells shaded (default a smiley). */
export function makePixelGrid({ rows = 5, cols = 5, filled, color = "blue" }: PixelGridOptions = {}): Block {
  rows = clamp(rows, 2, 8, 5);
  cols = clamp(cols, 2, 8, 5);
  const on = new Set((filled ?? (rows >= 5 && cols >= 5 ? SMILEY : Array.from({ length: Math.min(rows, cols) }, (_, i) => [i, i] as [number, number]))).map(([r, c]) => `${Math.round(r)}-${Math.round(c)}`));
  const sk = new Sketch(), c = 14, W = cols * c, H = rows * c;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const shapes = [rect(k * c, r * c, c, c, color, { width: 0.8 })];
      if (on.has(`${r}-${k}`)) shapes.push(scribble(k * c, r * c, c, color));
      sk.part(`cell-${r}-${k}`, `pixel ${r}-${k}`, ...shapes);
      sk.at(`cell-${r}-${k}`, [k * c + c / 2, r * c + c / 2]);
    }
  }
  for (let r = 0; r < rows; r++) sk.part(`row-${r}`, `row ${r}`, ghost(0, r * c, W, c)).at(`row-${r}`, [W / 2, r * c + c / 2]);
  for (let k = 0; k < cols; k++) sk.part(`col-${k}`, `column ${k}`, ghost(k * c, 0, c, H)).at(`col-${k}`, [k * c + c / 2, H / 2]);
  return finish(
    { id: "pixel-grid", title: "Pixel Grid", describe: "a grid of pixels with some shaded in (default a smiley), for images and bitmaps; set rows and cols (2-8) and filled ([r, c] cells); anchors cell-r-c, row-r, col-c", tags: ["pixels", "image", "bitmap", "grid", "resolution", "graphics"] },
    sk, [0, 0, W, H],
  );
}
export const pixelGrid = makePixelGrid();

export interface TableOptions { rows?: number; cols?: number; color?: string }
/** A table with a header row over `rows` (1–6, default 3) body rows and `cols` (1–5, default 3) columns. */
export function makeTable({ rows = 3, cols = 3, color = "blue" }: TableOptions = {}): Block {
  rows = clamp(rows, 1, 6, 3);
  cols = clamp(cols, 1, 5, 3);
  const sk = new Sketch(), cw = 26, ch = 15, W = cols * cw, H = (rows + 1) * ch;
  for (let k = 0; k < cols; k++) {
    sk.part(`header-${k}`, `header ${k}`, rect(k * cw, 0, cw, ch, color, { fill: tint(color) }));
    sk.at(`header-${k}`, [k * cw + cw / 2, ch / 2]);
  }
  sk.part("header-rule", "header line", line([[0, ch], [W, ch]], color, 1.6));
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      sk.part(`cell-${r}-${k}`, `cell ${r}-${k}`, rect(k * cw, (r + 1) * ch, cw, ch, color, { width: 0.8 }));
      sk.at(`cell-${r}-${k}`, [k * cw + cw / 2, (r + 1.5) * ch]);
    }
  }
  sk.part("header", "header row", ghost(0, 0, W, ch)).at("header", [W / 2, ch / 2]);
  for (let r = 0; r < rows; r++) sk.part(`row-${r}`, `row ${r}`, ghost(0, (r + 1) * ch, W, ch)).at(`row-${r}`, [W / 2, (r + 1.5) * ch]);
  for (let k = 0; k < cols; k++) sk.part(`col-${k}`, `column ${k}`, ghost(k * cw, 0, cw, H)).at(`col-${k}`, [k * cw + cw / 2, H / 2]);
  return finish(
    { id: "table", title: "Table", describe: "a table: a header row (heavy line under it) over rows of cells, for records and databases; set rows (1-6) and cols (1-5); anchors header-c, cell-r-c, row-r, col-c", tags: ["table", "database", "records", "rows", "columns", "spreadsheet"] },
    sk, [0, 0, W, H],
  );
}
export const table = makeTable();

export interface BitsOptions { bits?: string; color?: string }
/** A row of bits from a string like "1011" (1–12 characters): 1s are shaded cells, 0s empty. */
export function makeBits({ bits = "1011", color = "blue" }: BitsOptions = {}): Block {
  let s = String(bits).replace(/[^01]/g, "").slice(0, 12);
  if (!s) s = "1011";
  const sk = new Sketch(), c = 14;
  cellRow(sk, s.length, c, color, "bit", "bit", (i) => s[i] === "1");
  return finish(
    { id: "bits", title: "Bits", describe: "a row of bits: shaded cells are 1s, empty cells 0s, left to right; set bits (a string like \"1011\", 1-12 long); anchors bit-i, above-i, below-i", tags: ["binary", "bits", "byte", "ones and zeros", "data", "number"] },
    sk, [0, 0, s.length * c, c],
  );
}
export const bits = makeBits();

export interface VennOptions { sets?: number; color?: string }
/** A Venn diagram of 2 or 3 overlapping circles (default 2). */
export function makeVenn({ sets = 2, color = "blue" }: VennOptions = {}): Block {
  sets = clamp(sets, 2, 3, 2);
  const R = 30, sk = new Sketch();
  const cs: P[] = sets === 2 ? [[-17, 0], [17, 0]] : [[-17, -10], [17, -10], [0, 19]];
  const mid: P = [cs.reduce((a, p) => a + p[0], 0) / sets, cs.reduce((a, p) => a + p[1], 0) / sets];
  const away = (p: P, d: number): P => {
    const dx = p[0] - mid[0], dy = p[1] - mid[1], len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * d, p[1] + (dy / len) * d];
  };
  cs.forEach((p, i) => sk.part(`set-${i}`, `set ${i}`, circle(...p, R, color)).at(`set-${i}`, away(p, sets === 2 ? 14 : 10)));
  for (let a = 0; a < sets; a++) {
    for (let b = a + 1; b < sets; b++) {
      const m = away([(cs[a][0] + cs[b][0]) / 2, (cs[a][1] + cs[b][1]) / 2], sets === 2 ? 0 : 8);
      sk.part(`overlap-${a}-${b}`, `overlap of sets ${a} and ${b}`, ghost(m[0] - 6, m[1] - 8, 12, 16)).at(`overlap-${a}-${b}`, m);
    }
  }
  if (sets === 3) sk.part("overlap-0-1-2", "overlap of all three sets", ghost(mid[0] - 5, mid[1] - 5, 10, 10)).at("overlap-0-1-2", mid);
  sk.at("overlap", mid);
  const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
  return finish(
    { id: "venn", title: "Venn Diagram", describe: "a Venn diagram of overlapping circles for sets; set sets (2 or 3); anchors set-i (the part only in set i), overlap-a-b, overlap (the middle)", tags: ["venn diagram", "sets", "overlap", "logic", "intersection", "union"] },
    sk, [Math.min(...xs) - R, Math.min(...ys) - R, Math.max(...xs) + R, Math.max(...ys) + R],
  );
}
export const venn = makeVenn();

export interface HeapOptions { n?: number; color?: string }
/** A heap of `n` nodes (1–7, default 6) as a complete binary tree, filled level by level; bigger nodes nearer the top. */
export function makeHeap({ n = 6, color = "blue" }: HeapOptions = {}): Block {
  n = clamp(n, 1, 7, 6);
  const levels = Math.floor(Math.log2(n)) + 1, leaves = 2 ** (levels - 1), sp = 24, dy = 28, radius = [10, 8.5, 7.5];
  const lvl = (i: number) => Math.floor(Math.log2(i + 1));
  const pos = (i: number): P => {
    const L = lvl(i), I = i + 1 - 2 ** L;
    return [(I + 0.5) * (leaves / 2 ** L) * sp, L * dy];
  };
  const sk = new Sketch();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const p = (i - 1) >> 1;
      const [a, b] = between(pos(p), pos(i), radius[lvl(p)] + 1, radius[lvl(i)] + 1);
      sk.part(`edge-${p}-${i}`, `edge from node ${p} to node ${i}`, line([a, b], color, 0.8));
    }
    sk.part(`node-${i}`, `node ${i}`, circle(...pos(i), radius[lvl(i)], color, { fill: tint(color) }));
    sk.at(`node-${i}`, pos(i));
  }
  sk.at("root", pos(0));
  if (n < 2 ** levels - 1) sk.at("next", pos(n));
  const r0 = radius[levels - 1];
  return finish(
    { id: "heap", title: "Heap", describe: "a heap: a complete binary tree of n nodes filled level by level, node-0 the root, children of i at 2i+1 and 2i+2; set n (1-7); anchors node-i, root, next (where the next node goes)", tags: ["heap", "priority queue", "binary tree", "heapsort", "data structure", "root"] },
    sk, [n === 1 ? -radius[0] + pos(0)[0] : sp / 2 - r0, -radius[0], n === 1 ? pos(0)[0] + radius[0] : leaves * sp - sp / 2 + r0, (levels - 1) * dy + r0],
  );
}
export const heap = makeHeap();

export interface KeyValueOptions { pairs?: number; color?: string }
/** Key-value pairs: `pairs` rows (1–5, default 3) of key, arrow, value. */
export function makeKeyValue({ pairs = 3, color = "blue" }: KeyValueOptions = {}): Block {
  pairs = clamp(pairs, 1, 5, 3);
  const sk = new Sketch(), h = 15, step = 28, kw = 26, vx = 52, vw = 38;
  for (let i = 0; i < pairs; i++) {
    const y = i * step;
    sk.part(`key-${i}`, `key ${i}`, rect(0, y, kw, h, color, { r: 7, fill: tint(color) }));
    sk.part(`arrow-${i}`, `key ${i} maps to value ${i}`, arrow([kw + 4, y + h / 2], [vx - 4, y + h / 2], color, 4.5));
    sk.part(`value-${i}`, `value ${i}`, rect(vx, y, vw, h, color, { r: 2, fill: tint(color) }));
    sk.at(`key-${i}`, [kw / 2, y + h / 2]).at(`value-${i}`, [vx + vw / 2, y + h / 2]).at(`arrow-${i}`, [(kw + vx) / 2, y + h / 2]);
  }
  return finish(
    { id: "key-value", title: "Key-Value Pairs", describe: "key-value pairs: rows of a rounded key box, an arrow and a value box, like a dictionary or map; set pairs (1-5); anchors key-i, value-i", tags: ["key-value", "dictionary", "map", "lookup", "data", "pairs"] },
    sk, [0, 0, vx + vw, (pairs - 1) * step + h],
  );
}
export const keyValue = makeKeyValue();

// ---- Algorithms ----

export interface SortBarsOptions { values?: number[]; color?: string }
/** Bars of different heights on a baseline, for sorting (2–10 values, default [5, 2, 8, 3, 6, 4]). */
export function makeSortBars({ values = [5, 2, 8, 3, 6, 4], color = "orange" }: SortBarsOptions = {}): Block {
  let vs = (Array.isArray(values) ? values : []).filter((v) => typeof v === "number" && Number.isFinite(v)).slice(0, 10);
  if (vs.length < 2) vs = [5, 2, 8, 3, 6, 4];
  const max = Math.max(...vs.map(Math.abs)) || 1, bw = 12, gap = 12, top = 70;
  const sk = new Sketch(), W = vs.length * (bw + gap) - gap;
  vs.forEach((v, i) => {
    const h = Math.max(6, (top * Math.max(0, v)) / max), x = i * (bw + gap);
    sk.part(`bar-${i}`, `bar ${i}`, rect(x, -h, bw, h, color, { fill: tint(color) }));
    sk.at(`bar-${i}`, [x + bw / 2, -h / 2]).at(`top-${i}`, [x + bw / 2, -h - 8]).at(`below-${i}`, [x + bw / 2, 9]);
  });
  sk.part("axis", "baseline", line([[-5, 0], [W + 5, 0]], "ink"));
  return finish(
    { id: "sort-bars", title: "Sorting Bars", describe: "bars of different heights on a baseline, to show a sort step by step; set values (2-10 numbers, heights in proportion); anchors bar-i, top-i, below-i", tags: ["sorting", "algorithm", "bubble sort", "bars", "compare", "swap"] },
    sk, [-5, -top, W + 5, 0],
  );
}
export const sortBars = makeSortBars();

export interface SearchPointerOptions { n?: number; at?: number; color?: string }
/** An array of `n` cells (2–10, default 6) with an arrow pointing down at index `at` (default 2). */
export function makeSearchPointer({ n = 6, at = 2, color = "orange" }: SearchPointerOptions = {}): Block {
  n = clamp(n, 2, 10, 6);
  at = clamp(at, 0, n - 1, 2);
  const sk = new Sketch(), c = 16, x = at * c + c / 2;
  cellRow(sk, n, c, color);
  sk.part("pointer", `pointer at index ${at}`, arrow([x, -22], [x, -4], color, 5.5));
  sk.at("pointer", [x, -22]);
  return finish(
    { id: "search-pointer", title: "Search Pointer", describe: "an array with an arrow pointing down at one index, for searching step by step; set n (2-10) and at (the index); anchors cell-i, above-i, pointer (the arrow's tail)", tags: ["search", "linear search", "binary search", "pointer", "index", "algorithm"] },
    sk, [0, -22, n * c, c],
  );
}
export const searchPointer = makeSearchPointer();

export interface RecursionOptions { depth?: number; color?: string }
/** Nested boxes `depth` deep (1–4, default 3), each call inside the one before, a dot for the base case. */
export function makeRecursion({ depth = 3, color = "orange" }: RecursionOptions = {}): Block {
  depth = clamp(depth, 1, 4, 3);
  const side = 12, band = 18, W0 = 32 + 2 * side * (depth - 1), H0 = 24 + (band + side) * (depth - 1);
  const sk = new Sketch();
  for (let i = 0; i < depth; i++) {
    const x = side * i, y = band * i, w = W0 - 2 * side * i, h = H0 - (band + side) * i, inner = i === depth - 1;
    sk.part(`level-${i}`, `call ${i}`, rect(x, y, w, h, color, { r: 4, ...(inner ? { fill: tint(color) } : {}) }));
    sk.at(`level-${i}`, inner ? [W0 / 2, y + h / 2] : [W0 / 2, y + band / 2]);
  }
  const yb = band * (depth - 1) + (H0 - (band + side) * (depth - 1)) / 2;
  sk.part("base", "base case", circle(W0 / 2, yb, 2, color));
  sk.at("base", [W0 / 2, yb]);
  return finish(
    { id: "recursion", title: "Recursion", describe: "recursion as nested boxes, each call inside the one before, a dot in the innermost for the base case; set depth (1-4); anchors level-i (in each box's top band), base", tags: ["recursion", "recursive", "function call", "base case", "call stack", "algorithm"] },
    sk, [0, 0, W0, H0],
  );
}
export const recursion = makeRecursion();

export interface FunctionBoxOptions { color?: string }
/** A function as a machine: an arrow in, a box, an arrow out. */
export function makeFunctionBox({ color = "orange" }: FunctionBoxOptions = {}): Block {
  const sk = new Sketch();
  sk.part("input", "input", arrow([0, 18], [24, 18], color, 6));
  sk.part("box", "function", rect(29, 0, 42, 36, color, { r: 4, fill: tint(color) }));
  sk.part("output", "output", arrow([76, 18], [100, 18], color, 6));
  sk.at("input", [0, 18]).at("output", [100, 18]).at("box", [50, 18]);
  return finish(
    { id: "function-box", title: "Function", describe: "a function as a box with an input arrow going in on the left and an output arrow coming out on the right; anchors input, box, output", tags: ["function", "input", "output", "procedure", "black box", "programming"] },
    sk, [0, 0, 100, 36],
  );
}
export const functionBox = makeFunctionBox();

export interface LoopOptions { color?: string }
/** A loop: a box with an arrow leaving its right side and curving round back into it. */
export function makeLoop({ color = "orange" }: LoopOptions = {}): Block {
  const sk = new Sketch();
  sk.part("box", "loop body", rect(0, 0, 46, 40, color, { r: 4, fill: tint(color) }));
  sk.part("loop", "repeat", { type: "path", d: `M48 9 C94 9 94 31 54 31 ${head([54, 31], [-1, 0], 6.5)}`, stroke: color });
  sk.at("box", [23, 20]).at("loop", [83, 20]).at("start", [48, 9]).at("end", [54, 31]);
  return finish(
    { id: "loop", title: "Loop", describe: "a loop: a box with an arrow leaving its right side and curving round back into it, to repeat; anchors box, loop (the far side of the curve)", tags: ["loop", "repeat", "iteration", "while", "for loop", "algorithm"] },
    sk, [0, 0, 84, 40],
  );
}
export const loop = makeLoop();
