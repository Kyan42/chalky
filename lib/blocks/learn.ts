/**
 * A block the drawer authors itself in a slow-mode free beat: the JSON schema it answers in (flat, for
 * structured output) and the check that turns its answer into a Block, or drops it. It is drawn by the
 * same renderer as the catalog (lib/blocks/render.ts), so it comes out in the board's chalk style.
 * Pure, so the server (lib/lesson/draw.ts) and scripts can share it.
 */
import { parseSvgPath } from "@clayzo/animation/authoring";
import { PALETTE } from "@/experiments/visual-flex/doc";
import { blockById, blockKey, type Block, type Part, type Shape } from "./index";

const COLORS = Object.keys(PALETTE);
const PAINTS = new Set([...COLORS, ...COLORS.map((c) => `${c}-tint`)]);
const MAX_PARTS = 8;
const MAX_SHAPES = 30;
/** SVG path commands the renderer draws (arcs are flattened, so leave them out). */
const PATH = /^[MLCQZmlcqz0-9eE.,\s-]+$/;

const SHAPE = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["path", "ellipse", "rect"] },
    d: { type: "string" },
    cx: { type: "number" },
    cy: { type: "number" },
    rx: { type: "number" },
    ry: { type: "number" },
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
    r: { type: "number" },
    stroke: { type: "string", enum: COLORS },
    fill: { type: "string" },
  },
  required: ["type", "d", "cx", "cy", "rx", "ry", "x", "y", "w", "h", "r", "stroke", "fill"],
  additionalProperties: false,
};

export const NEW_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    describe: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    w: { type: "number" },
    h: { type: "number" },
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, label: { type: "string" }, shapes: { type: "array", items: SHAPE } },
        required: ["id", "label", "shapes"],
        additionalProperties: false,
      },
    },
    anchors: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
        required: ["name", "x", "y"],
        additionalProperties: false,
      },
    },
  },
  required: ["id", "title", "describe", "tags", "w", "h", "parts", "anchors"],
  additionalProperties: false,
};

/** The prompt section that lets a free beat author one new block. */
export const NEW_BLOCK_LANGUAGE = `New drawing (this beat only): when something this beat draws has no block in the catalog, you may draw it ONCE as a new block, in the same hand-drawn chalk style as the catalog, and later lessons will reuse it. Put it in newBlocks and place it with a block element whose text is its id, exactly like a catalog block (labels, arrows and highlights work on it the same way).
A new block is simple line art in its own box, like a teacher's quick sketch: w and h are its box (60-200 units each, y down), drawn back to front as parts (1-${MAX_PARTS}), each a few shapes (${MAX_SHAPES} at most in all, usually 4-15):
- path: d is an SVG path in the box using only M, L, C, Q and Z (no arcs); put 0 in the number fields.
- ellipse: cx, cy, rx, ry; d "".
- rect: x, y, w, h and corner radius r; d "".
Every shape has a stroke (a board colour) and a fill: "" for none, or a pale "<colour>-tint" behind it. Outlines that say what it is, no text inside, everything inside the box. Give it an id of lowercase words joined by dashes ("hot-air-balloon"), a title, a one-line describe of what it shows, 3-6 tags (what it is and the topics it belongs to), part ids and labels ("basket", "flame"), and anchors: named points in its box ("top", "flame", "rope") that arrows and labels can aim at.
Never make a new block for something a listed block already shows, and never more than one; newBlocks is [] when nothing this beat draws is missing.`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const slug = (v: unknown) =>
  str(v, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function cleanShape(raw: Record<string, unknown>, w: number, h: number): Shape | null {
  const stroke = PAINTS.has(str(raw.stroke, 20)) ? str(raw.stroke, 20) : "ink";
  const fill = PAINTS.has(str(raw.fill, 20)) ? str(raw.fill, 20) : undefined;
  const paint = { stroke, ...(fill ? { fill } : {}) };
  // A little slack outside the box: a stroke on its edge is fine, a shape off in the distance is not.
  const inX = (v: number) => v >= -0.1 * w && v <= 1.1 * w;
  const inY = (v: number) => v >= -0.1 * h && v <= 1.1 * h;
  if (raw.type === "path") {
    const d = str(raw.d, 4000);
    if (!d || !PATH.test(d) || !/^\s*[Mm]/.test(d)) return null;
    const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (nums.length < 4 || nums.some((n) => Math.abs(n) > 3 * Math.max(w, h))) return null;
    // The renderer throws on a path it can't parse, which would cost the whole scene.
    try {
      if (parseSvgPath(d).diagnostics.some((x) => x.code !== "arc_flattened")) return null;
    } catch {
      return null;
    }
    return { type: "path", d, ...paint };
  }
  if (raw.type === "ellipse") {
    const [cx, cy, rx, ry] = [num(raw.cx), num(raw.cy), num(raw.rx), num(raw.ry)];
    if (cx === null || cy === null || !rx || !ry || rx <= 0 || ry <= 0 || !inX(cx) || !inY(cy)) return null;
    return { type: "ellipse", cx, cy, rx, ry, ...paint };
  }
  if (raw.type === "rect") {
    const [x, y, rw, rh] = [num(raw.x), num(raw.y), num(raw.w), num(raw.h)];
    if (x === null || y === null || !rw || !rh || rw <= 0 || rh <= 0 || !inX(x) || !inY(y) || !inX(x + rw) || !inY(y + rh)) return null;
    const r = Math.max(0, num(raw.r) ?? 0);
    return { type: "rect", x, y, w: rw, h: rh, ...(r ? { r } : {}), ...paint };
  }
  return null;
}

/**
 * The model's new block as a Block, or null when it is unusable (no shapes left, a bad box) or not new
 * (the catalog, or an earlier lesson, already has its id). Shapes that fail the check are dropped.
 */
export function cleanNewBlock(raw: unknown): Block | null {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = slug(b.id);
  if (!id || blockById(id) || !blockKey(id)) return null;
  const w = num(b.w), h = num(b.h);
  if (!w || !h || w < 20 || h < 20 || w > 400 || h > 400) return null;
  let budget = MAX_SHAPES;
  const parts: Part[] = (Array.isArray(b.parts) ? b.parts : []).slice(0, MAX_PARTS).flatMap((p, i) => {
    const part = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const shapes = (Array.isArray(part.shapes) ? part.shapes : [])
      .map((s) => cleanShape((s && typeof s === "object" ? s : {}) as Record<string, unknown>, w, h))
      .filter((s): s is Shape => !!s)
      .slice(0, Math.max(0, budget));
    budget -= shapes.length;
    return shapes.length ? [{ id: slug(part.id) || `part-${i + 1}`, label: str(part.label, 40) || slug(part.id) || `part ${i + 1}`, shapes }] : [];
  });
  if (!parts.length) return null;
  const anchors: Block["anchors"] = { center: [w / 2, h / 2], top: [w / 2, 0], bottom: [w / 2, h], left: [0, h / 2], right: [w, h / 2] };
  for (const a of Array.isArray(b.anchors) ? b.anchors.slice(0, 12) : []) {
    const r = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const name = slug(r.name), x = num(r.x), y = num(r.y);
    if (name && x !== null && y !== null) anchors[name] = [Math.max(0, Math.min(w, x)), Math.max(0, Math.min(h, y))];
  }
  const title = str(b.title, 60) || id.replace(/-/g, " ");
  return {
    id,
    title,
    describe: str(b.describe, 200) || title.toLowerCase(),
    tags: [...new Set((Array.isArray(b.tags) ? b.tags : []).map((t) => str(t, 30).toLowerCase()).filter(Boolean))].slice(0, 8),
    size: [w, h],
    parts,
    anchors,
  };
}
