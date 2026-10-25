/**
 * `block` and `travel` for the preset compiler (lib/lesson/presets.ts), kept here so the
 * compiler only needs a `case` that calls in. Blocks render through ./render.ts; what they cover
 * is registered with the compiler in stage pixels so its existing machinery works on them:
 *
 * - the block's box is registered and occupied under its element id: labels avoid it, `label`
 *   with refs = id sits next to it, `connect` / `rays` snap to its edge, `dim` covers it;
 * - every part is registered (not occupied) under "<id>.<part>" and "<id>-<part>" (draw.ts runs
 *   refs through cleanId, which turns dots into dashes), so highlight and connect can aim at one;
 * - every anchor that isn't also a part name is registered as a zero-radius circle under
 *   "<id>.<anchor>" / "<id>-<anchor>", so a connect to it ends right at that point;
 * - when the element id differs from the block id, the block id is an alias if still free.
 *
 * A block id the catalog doesn't know drops the element and counts it as dangling.
 */
import type { Scene } from "@/experiments/visual-flex/doc";
import { blockById } from "./index";
import { renderBlock, renderLoop, renderTravel, ungx, ungy, type Box, type Pt, type Rendered } from "./render";
import type { Block } from "./types";

/** The compiler's placed element, structurally (lib/lesson/presets.ts `Placed`). */
export interface PlacedLike {
  id: string;
  kind: string;
  box: Box;
  circle?: { cx: number; cy: number; r: number };
}

/** The scene-language element, structurally (lib/lesson/presets.ts `PresetElement`). */
export interface ElementLike {
  id: string;
  kind: string;
  at: number;
  dur: number;
  color: string;
  args: number[];
  text: string;
  refs: string;
}

export interface BlockContext {
  scene: Scene;
  placed: Map<string, PlacedLike>;
  /** Registers a shape for layout reports and references. */
  register: (p: PlacedLike) => void;
  /** Marks a stage box as taken, so labels and free text avoid it. */
  occupy: (id: string, box: Box) => void;
  dangling: string[];
}

export const BLOCK_KINDS = ["block", "travel"] as const;

/** Rendered blocks per scene, by every id they answer to, for pulses on highlight. */
const rendered = new WeakMap<Scene, Map<string, Rendered>>();
/** The block element id each part key belongs to, per scene. */
const ownerOf = new WeakMap<Scene, Map<string, string>>();
/** Anchor points per scene by "<id>.<anchor>" and "<id>-<anchor>", for travel ends. */
const anchorPoints = new WeakMap<Scene, Map<string, Pt>>();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const centreOf = (p: PlacedLike): Pt => (p.circle ? [p.circle.cx, p.circle.cy] : [(p.box.x1 + p.box.x2) / 2, (p.box.y1 + p.box.y2) / 2]);
const keys = (id: string, name: string) => [`${id}.${name}`, `${id}-${name}`];

function findBlock(e: ElementLike, ctx: BlockContext): Block | null {
  const name = e.text.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const block = blockById(name) ?? blockById(e.id.toLowerCase());
  if (!block) ctx.dangling.push(`${e.kind} ${e.id} -> unknown block "${e.text}"`);
  return block ?? null;
}

function drawBlock(ctx: BlockContext, e: ElementLike, at: number) {
  const block = findBlock(e, ctx);
  if (!block) return;
  const a = e.args;
  const size = clamp(a[2] || 20, 4, 60);
  let cx = Number.isFinite(a[0]) ? a[0] : 50, cy = Number.isFinite(a[1]) ? a[1] : 50;
  // Keep the whole block on the board.
  const [w, h] = block.size;
  const halfX = (size * (w / Math.max(w, h))) / 2, halfY = (size * 1.5 * (h / Math.max(w, h))) / 2;
  cx = clamp(cx, 2 + halfX, 98 - halfX);
  cy = clamp(cy, 2 + halfY, 98 - halfY);
  const r = renderBlock(ctx.scene, block, { cx, cy, size, at, dur: e.dur > 0.3 ? e.dur : undefined, enter: a[3] === 1 ? "pop" : "draw" });
  const ids = [e.id];
  if (e.id !== block.id && !ctx.placed.has(block.id)) ids.push(block.id);
  const byId = rendered.get(ctx.scene) ?? new Map<string, Rendered>();
  rendered.set(ctx.scene, byId);
  const points = anchorPoints.get(ctx.scene) ?? new Map<string, Pt>();
  anchorPoints.set(ctx.scene, points);
  const owners = ownerOf.get(ctx.scene) ?? new Map<string, string>();
  ownerOf.set(ctx.scene, owners);
  // Arrows snap to a circle round the drawing's body, not its box (a leaf's box is half empty).
  const [ccx, ccy] = r.anchors.center ?? [(r.box.x1 + r.box.x2) / 2, (r.box.y1 + r.box.y2) / 2];
  const circle = { cx: ccx, cy: ccy, r: 0.4 * Math.min(r.box.x2 - r.box.x1, r.box.y2 - r.box.y1) };
  // Sides every block answers to, for anchors the model guesses ("leaf.top"); named anchors win.
  const sides: Record<string, Pt> = {
    center: [ccx, ccy],
    top: [ccx, r.box.y1], bottom: [ccx, r.box.y2], left: [r.box.x1, ccy], right: [r.box.x2, ccy],
  };
  const anchors = { ...sides, ...r.anchors };
  ids.forEach((id, i) => {
    if (i === 0) {
      ctx.register({ id, kind: "block", box: r.box, circle });
      ctx.occupy(id, r.box);
    } else ctx.placed.set(id, { id, kind: "block", box: r.box, circle });
    byId.set(id, r);
    for (const [part, box] of Object.entries(r.parts)) {
      for (const k of keys(id, part)) {
        ctx.placed.set(k, { id: k, kind: "part", box });
        owners.set(k, id);
      }
    }
    for (const [name, [x, y]] of Object.entries(anchors)) {
      for (const k of keys(id, name)) {
        points.set(k, [x, y]);
        if (!r.parts[name]) ctx.placed.set(k, { id: k, kind: "anchor", box: { x1: x, y1: y, x2: x, y2: y }, circle: { cx: x, cy: y, r: 0 } });
      }
    }
  });
}

/** A travel end: an anchor's exact point, else the centre of a placed element; stage pixels. */
function resolvePoint(ctx: BlockContext, ref: string): Pt | null {
  const anchor = anchorPoints.get(ctx.scene)?.get(ref);
  if (anchor) return anchor;
  const p = ctx.placed.get(ref);
  return p ? centreOf(p) : null;
}

function drawTravel(ctx: BlockContext, e: ElementLike, at: number) {
  const block = findBlock(e, ctx);
  if (!block) return;
  const a = e.args;
  let from: Pt | null = a.length >= 4 ? [a[0], a[1]] : null;
  let to: Pt | null = a.length >= 4 ? [a[2], a[3]] : null;
  // Positional: "fromRef,toRef"; "xy" (or nothing) for an end that comes from args.
  const refs = e.refs.split(",").map((r) => r.trim()).map((r) => (r === "xy" ? "" : r));
  if (refs[0]) {
    const p = resolvePoint(ctx, refs[0]);
    if (p) from = [ungx(p[0]), ungy(p[1])];
    else if (!from) ctx.dangling.push(`travel ${e.id} -> ${refs[0]}`);
  }
  if (refs[1]) {
    const p = resolvePoint(ctx, refs[1]);
    if (p) to = [ungx(p[0]), ungy(p[1])];
    else if (!to) ctx.dangling.push(`travel ${e.id} -> ${refs[1]}`);
  }
  if (!from || !to) return;
  const stay = a[6] === 1;
  const t = renderTravel(ctx.scene, block, { from, to, size: clamp(a[4] || 5, 2, 14), count: a[5] || 3, stay, at, bend: 0.12 });
  ctx.register({ id: e.id, kind: "travel", box: t.ends.length ? merge(t.ends) : t.box });
  t.ends.forEach((box, i) => ctx.occupy(`${e.id}:end${i}`, box));
}

const merge = (bs: Box[]): Box => ({ x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)) });

/** Draws a `block` or `travel` element. `at < 0` draws it as an earlier beat left it. */
export function drawBlockElement(ctx: BlockContext, e: ElementLike, at: number) {
  if (e.kind === "block") drawBlock(ctx, e, at);
  else if (e.kind === "travel") drawTravel(ctx, e, at);
}

/**
 * A highlight on a block or one of its parts: Janani's hand-drawn loop around it (instead of
 * the soft yellow mark) and a bounce of the block (her script circles the leaves and pulses
 * the plant together). Returns false for anything else.
 */
export function highlightBlock(ctx: BlockContext, target: PlacedLike, at: number, dur: number, color = "red"): boolean {
  if (target.kind !== "block" && target.kind !== "part") return false;
  if (at < 0) return true; // an earlier beat's highlight is over
  renderLoop(ctx.scene, target.box, { at, dur: 0.6, color, until: at + Math.max(1.6, dur), pad: target.kind === "part" ? 10 : 16 });
  const owner = target.kind === "block" ? target.id : ownerOf.get(ctx.scene)?.get(target.id);
  if (owner) rendered.get(ctx.scene)?.get(owner)?.pulse(at + 0.35);
  return true;
}

const REF_KINDS = new Set(["connect", "rays", "label", "highlight", "dim"]);

/**
 * A beat's elements in drawing order: things that refer to others by id after everything else,
 * keeping order otherwise. Models often write the arrow to a block before the block itself, and
 * the compiler resolves refs against what it has drawn so far. Timing (`at`) is unaffected.
 */
export function shapesFirst<T extends ElementLike>(elements: T[]): T[] {
  const late = (e: T) => REF_KINDS.has(e.kind) || (e.kind === "travel" && e.refs.split(",").some((r) => r.trim() && r.trim() !== "xy"));
  return [...elements.filter((e) => !late(e)), ...elements.filter(late)];
}

/** Which travel ends come from args (not refs). */
const argEnds = (e: ElementLike) => {
  const refs = e.refs.split(",").map((r) => r.trim());
  return [!refs[0] || refs[0] === "xy", !refs[1] || refs[1] === "xy"];
};

/** Grid points a `block` or `travel` covers, for fitting a beat into its region (fitToRegion). */
export function blockExtent(e: ElementLike): Pt[] {
  const a = e.args;
  if (e.kind === "block") {
    const block = blockById(e.text.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (!block || a.length < 3) return [];
    const [w, h] = block.size, m = Math.max(w, h);
    const hx = (a[2] * w) / m / 2, hy = (a[2] * 1.5 * h) / m / 2;
    return [[a[0] - hx, a[1] - hy], [a[0] + hx, a[1] + hy]];
  }
  if (e.kind === "travel" && a.length >= 4) {
    const [from, to] = argEnds(e);
    return [...(from ? [[a[0], a[1]] as Pt] : []), ...(to ? [[a[2], a[3]] as Pt] : [])];
  }
  return [];
}

/** A `block` or `travel`'s args moved by X/Y and scaled by k (fitToRegion). */
export function scaleBlockArgs(e: ElementLike, X: (x: number) => number, Y: (y: number) => number, k: number): number[] {
  const a = [...e.args];
  if (e.kind === "block" && a.length >= 3) return [X(a[0]), Y(a[1]), a[2] * k, ...a.slice(3)];
  if (e.kind === "travel" && a.length >= 4) {
    const [from, to] = argEnds(e);
    return [from ? X(a[0]) : a[0], from ? Y(a[1]) : a[1], to ? X(a[2]) : a[2], to ? Y(a[3]) : a[3], ...(a.length > 4 ? [a[4] * k, ...a.slice(5)] : [])];
  }
  return a;
}
