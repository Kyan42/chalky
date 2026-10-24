/**
 * Scene language v2: presets that lay themselves out. The model says what to
 * draw and roughly where; this compiler owns the geometry the model can't see:
 *
 * - labels go on the free side of their element (or inside it when they fit),
 *   never on top of another label or shape;
 * - `connect` / `rays` draw arrows between element ids, snapped to their edges;
 * - `flow`, `cycle` and `equation` lay out a whole row, ring or formula;
 * - free text is nudged off anything it would cover.
 *
 * Elements arrive grouped by beat. Earlier beats draw already finished; the
 * current beat animates from its anchor word. References are resolved against
 * what was actually placed, so beats can be generated in parallel and still
 * point at each other by id. A reference to an id nobody drew is dropped and
 * counted.
 */
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { H, PAPER, Scene, W, type Pt } from "@/experiments/visual-flex/doc";
import { compileFn } from "@/experiments/visual-flex/scene";

/** One element as the model sends it (every field present; unused ones empty). */
export interface PresetElement {
  id: string;
  kind: string;
  at: number;
  dur: number;
  color: string;
  args: number[];
  /** A label, a formula, "A|B|C" steps, or a plot's expression. */
  text: string;
  /** Comma-separated element ids this one connects to or acts on. */
  refs: string;
}

export const PRESET_KINDS = ["circle", "box", "label", "connect", "rays", "flow", "cycle", "equation", "arrow", "line", "plot", "bar", "move", "text", "highlight", "dim"] as const;

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Placed {
  id: string;
  kind: string;
  box: Box;
  /** A circle's centre and radius, for edge snapping. */
  circle?: { cx: number; cy: number; r: number };
}

export interface LayoutReport {
  texts: { id: string; box: Box; owner?: string }[];
  shapes: { id: string; box: Box }[];
  dangling: string[];
  nudged: number;
}

const sx = (x: number) => (x / 100) * W;
const sy = (y: number) => (y / 100) * H;
const clampAt = (at: number) => Math.max(0, Math.min(18, at || 0));
const clampDur = (dur: number) => Math.max(0.1, Math.min(3, dur || 0.6));
const area = (b: Box) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const intersect = (a: Box, b: Box): Box => ({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) });
const overlap = (a: Box, b: Box) => area(intersect(a, b));
const grow = (b: Box, d: number): Box => ({ x1: b.x1 - d, y1: b.y1 - d, x2: b.x2 + d, y2: b.y2 + d });
const centre = (b: Box): Pt => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
const MARGIN = 14;
const STAGE: Box = { x1: MARGIN, y1: MARGIN, x2: W - MARGIN, y2: H - MARGIN };

/** Approximate size of a single line of Inter SemiBold. */
function textSize(str: string, size: number) {
  return { w: Math.max(size, str.length * size * 0.56), h: size * 1.25 };
}

function outside(b: Box) {
  return area(b) - overlap(b, STAGE);
}

export function compilePresetBoard(beats: PresetElement[][], currentBeat: number, docId: string): { doc: AnimationDocument; report: LayoutReport } {
  const s = new Scene();
  const placed = new Map<string, Placed>();
  const occupied: { id: string; box: Box; text: boolean }[] = [];
  const report: LayoutReport = { texts: [], shapes: [], dangling: [], nudged: 0 };
  const dimmed = new Set<string>();

  const occupy = (id: string, box: Box, text = false) => occupied.push({ id, box, text });
  const register = (p: Placed) => {
    placed.set(p.id, p);
    report.shapes.push({ id: p.id, box: p.box });
  };
  const cost = (b: Box, ignore: Set<string>) => occupied.reduce((sum, o) => (ignore.has(o.id) ? sum : sum + overlap(grow(b, 6), o.box) * (o.text ? 3 : 1)), 0) + outside(b) * 4;

  /** Places a text at the cheapest candidate centre; shrinks once if every spot collides. */
  const placeText = (id: string, str: string, candidates: Pt[], size: number, o: { at: number; color: string }, ignore: Set<string>, owner?: string) => {
    if (!str.trim()) return;
    let best: { c: Pt; size: number; box: Box; cost: number } | null = null;
    for (const sz of [size, size * 0.82]) {
      const { w, h } = textSize(str, sz);
      for (const c of candidates) {
        const box = { x1: c[0] - w / 2, y1: c[1] - h / 2, x2: c[0] + w / 2, y2: c[1] + h / 2 };
        const k = cost(box, ignore);
        if (!best || k < best.cost - 1) best = { c, size: sz, box, cost: k };
        if (k === 0) break;
      }
      if (best && best.cost === 0) break;
    }
    if (!best) return;
    s.text(str, best.c[0], best.c[1], { at: o.at, size: best.size, color: o.color, width: best.box.x2 - best.box.x1 + 24 });
    occupy(id, best.box, true);
    report.texts.push({ id, box: best.box, owner });
  };

  /** Candidate label centres around a box: inside first if asked, then below, above, right, left. */
  const around = (b: Box, str: string, size: number, inside: boolean): Pt[] => {
    const { w, h } = textSize(str, size);
    const [cx, cy] = centre(b);
    const gap = 10;
    const out: Pt[] = [];
    if (inside && w < (b.x2 - b.x1) * 0.9 && h < (b.y2 - b.y1) * 0.7) out.push([cx, cy]);
    out.push([cx, b.y2 + gap + h / 2], [cx, b.y1 - gap - h / 2], [b.x2 + gap + w / 2, cy], [b.x1 - gap - w / 2, cy]);
    out.push([b.x2 + gap + w / 2, b.y2 + h / 2], [b.x1 - gap - w / 2, b.y1 - h / 2], [b.x2 + gap + w / 2, b.y1 - h / 2], [b.x1 - gap - w / 2, b.y2 + h / 2]);
    return out;
  };

  /** Where a ray from the centre of `p` toward `toward` leaves its outline. */
  const edge = (p: Placed, toward: Pt, pad = 8): Pt => {
    const [cx, cy] = p.circle ? [p.circle.cx, p.circle.cy] : centre(p.box);
    const dx = toward[0] - cx, dy = toward[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    if (p.circle) return [cx + (dx / len) * (p.circle.r + pad), cy + (dy / len) * (p.circle.r + pad)];
    const hw = (p.box.x2 - p.box.x1) / 2 + pad, hh = (p.box.y2 - p.box.y1) / 2 + pad;
    const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return [cx + dx * t, cy + dy * t];
  };

  const lineBox = (pts: readonly Pt[], pad = 6): Box => ({
    x1: Math.min(...pts.map((p) => p[0])) - pad, y1: Math.min(...pts.map((p) => p[1])) - pad,
    x2: Math.max(...pts.map((p) => p[0])) + pad, y2: Math.max(...pts.map((p) => p[1])) + pad,
  });

  const refsOf = (e: PresetElement) => e.refs.split(",").map((r) => r.trim()).filter(Boolean);
  const resolve = (e: PresetElement, n: number): Placed[] | null => {
    const ids = refsOf(e).slice(0, n);
    const found = ids.map((id) => placed.get(id));
    if (ids.length < n || found.some((f) => !f)) {
      report.dangling.push(`${e.kind} ${e.id} -> ${ids.filter((_, i) => !found[i]).join(",") || "(none)"}`);
      return null;
    }
    return found as Placed[];
  };

  const draw = (e: PresetElement, still: boolean) => {
    const at = still ? -1 : clampAt(e.at);
    const dur = clampDur(e.dur);
    const a = e.args;
    const col = e.color || "ink";
    const id = e.id || `${e.kind}-${placed.size}`;
    const labelSize = 26;
    switch (e.kind) {
      case "circle": {
        const cx = sx(a[0]), cy = sy(a[1]), r = Math.max(8, (a[2] / 100) * W);
        const filled = a[3] !== 0;
        s.circle(cx, cy, r, { at, color: col, filled });
        const box = { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r };
        register({ id, kind: "circle", box, circle: { cx, cy, r } });
        occupy(id, box);
        if (e.text) placeText(`${id}:label`, e.text, around(box, e.text, labelSize, !filled), labelSize, { at: still ? -1 : at + 0.15, color: filled ? "ink" : col }, new Set(filled ? [] : [id]), id);
        return;
      }
      case "box": {
        const x = sx(a[0]), y = sy(a[1]), w = Math.max(16, sx(a[2])), h = Math.max(16, sy(a[3]));
        const filled = a[4] === 1;
        s.box(x, y, w, h, { at, color: col, filled });
        const box = { x1: x, y1: y, x2: x + w, y2: y + h };
        register({ id, kind: "box", box });
        occupy(id, box);
        if (e.text) placeText(`${id}:label`, e.text, around(box, e.text, labelSize, true), labelSize, { at: still ? -1 : at + 0.15, color: filled ? "ink" : col }, new Set([id]), id);
        return;
      }
      case "label": {
        const [target] = resolve(e, 1) ?? [];
        if (!target) return;
        placeText(id, e.text, around(target.box, e.text, a[0] || labelSize, false), a[0] || labelSize, { at, color: col }, new Set(), target.id);
        return;
      }
      case "connect":
      case "rays": {
        const ends = resolve(e, 2);
        if (!ends) return;
        const [from, to] = ends;
        const fc = from.circle ? ([from.circle.cx, from.circle.cy] as Pt) : centre(from.box);
        const tc = to.circle ? ([to.circle.cx, to.circle.cy] as Pt) : centre(to.box);
        const count = e.kind === "rays" ? Math.max(2, Math.min(5, Math.round(a[0] || 3))) : 1;
        const ang = Math.atan2(tc[1] - fc[1], tc[0] - fc[0]);
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const spread = e.kind === "rays" ? 26 : 0;
        const pts: Pt[] = [];
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * spread;
          const p0 = edge(from, [tc[0] + nx * off, tc[1] + ny * off]);
          const p1 = edge(to, [fc[0] + nx * off, fc[1] + ny * off]);
          const start: Pt = [p0[0] + nx * off, p0[1] + ny * off];
          const end: Pt = [p1[0] + nx * off, p1[1] + ny * off];
          if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 24) continue;
          s.arrow(start, end, { at: at < 0 ? at : at + i * 0.12, dur, color: col, width: e.kind === "rays" ? 5 : 6 });
          pts.push(start, end);
        }
        if (!pts.length) return;
        const box = lineBox(pts);
        register({ id, kind: e.kind, box });
        occupy(id, box);
        if (e.text) {
          const [mx, my] = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
          const { w, h } = textSize(e.text, 22);
          const d = (spread * count) / 2 + 12 + Math.abs(nx) * w * 0.5 + Math.abs(ny) * h * 0.5;
          placeText(`${id}:label`, e.text, [[mx + nx * d, my + ny * d], [mx - nx * d, my - ny * d], [mx, my - h], [mx, my + h]], 22, { at: still ? -1 : at + dur, color: col }, new Set([id]), id);
        }
        return;
      }
      case "flow": {
        const steps = e.text.split("|").map((t) => t.trim()).filter(Boolean).slice(0, 5);
        if (steps.length < 2) return;
        const x = sx(a[0]), y = sy(a[1]), w = sx(a[2]), h = sy(a[3]);
        const n = steps.length;
        const gap = Math.min(70, w * 0.12);
        const bw = (w - gap * (n - 1)) / n;
        const bh = Math.min(h, 110);
        const top = y + (h - bh) / 2;
        const size = Math.max(16, Math.min(26, (bw - 16) / (Math.max(...steps.map((t) => t.length)) * 0.56)));
        steps.forEach((label, i) => {
          const bx = x + i * (bw + gap);
          const t = at < 0 ? at : at + (i * dur) / n;
          s.box(bx, top, bw, bh, { at: t, color: col, filled: false });
          const box = { x1: bx, y1: top, x2: bx + bw, y2: top + bh };
          register({ id: `${id}.${i}`, kind: "box", box });
          occupy(`${id}.${i}`, box);
          s.text(label, bx + bw / 2, top + bh / 2, { at: at < 0 ? at : t + 0.1, size, color: "ink", width: bw - 8 });
          report.texts.push({ id: `${id}.${i}:label`, box: { x1: bx + 8, y1: top + bh / 2 - size * 0.6, x2: bx + bw - 8, y2: top + bh / 2 + size * 0.6 }, owner: `${id}.${i}` });
          if (i < n - 1) s.arrow([bx + bw + 8, top + bh / 2], [bx + bw + gap - 8, top + bh / 2], { at: at < 0 ? at : t + dur / n / 2, dur: 0.3, color: "ink" });
        });
        register({ id, kind: "flow", box: { x1: x, y1: top, x2: x + w, y2: top + bh } });
        return;
      }
      case "cycle": {
        const steps = e.text.split("|").map((t) => t.trim()).filter(Boolean).slice(0, 6);
        if (steps.length < 2) return;
        const cx = sx(a[0]), cy = sy(a[1]), r = Math.max(40, (a[2] / 100) * W);
        const n = steps.length;
        steps.forEach((label, i) => {
          const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2, a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
          const arc: Pt[] = [];
          for (let k = 0; k <= 20; k++) {
            const t = a0 + 0.3 + ((a1 - a0 - 0.6) * k) / 20;
            arc.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
          }
          const t = at < 0 ? at : at + (i * dur) / n;
          s.stroke(arc.slice(0, -1), { at: t, dur: dur / n, color: col, width: 6 });
          s.arrow(arc[arc.length - 2], arc[arc.length - 1], { at: at < 0 ? at : t + dur / n, dur: 0.05, color: col, width: 6 });
          const px = cx + Math.cos(a0) * r, py = cy + Math.sin(a0) * r;
          const node = { x1: px - 10, y1: py - 10, x2: px + 10, y2: py + 10 };
          s.circle(px, py, 9, { at: t, color: col });
          register({ id: `${id}.${i}`, kind: "circle", box: node, circle: { cx: px, cy: py, r: 10 } });
          occupy(`${id}.${i}`, node);
          const out = 1 + 0.32;
          placeText(`${id}.${i}:label`, label, [[cx + Math.cos(a0) * r * out, cy + Math.sin(a0) * r * out], ...around(node, label, 24, false)], 24, { at: at < 0 ? at : t + 0.1, color: "ink" }, new Set(), `${id}.${i}`);
        });
        const box = { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r };
        register({ id, kind: "cycle", box });
        occupy(id, box);
        return;
      }
      case "equation": {
        const size = a[2] || 36;
        placeText(id, e.text, [[sx(a[0]), sy(a[1])], [sx(a[0]), sy(a[1]) + size * 1.6], [sx(a[0]), sy(a[1]) - size * 1.6]], size, { at, color: col }, new Set());
        const t = report.texts[report.texts.length - 1];
        if (t?.id === id) register({ id, kind: "equation", box: t.box });
        return;
      }
      case "arrow": {
        const p0: Pt = [sx(a[0]), sy(a[1])], p1: Pt = [sx(a[2]), sy(a[3])];
        s.arrow(p0, p1, { at, dur, color: col, width: 6 });
        const box = lineBox([p0, p1]);
        register({ id, kind: "arrow", box });
        occupy(id, box);
        if (e.text) {
          const [mx, my] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          placeText(`${id}:label`, e.text, [[mx, my - 26], [mx, my + 26], ...around(box, e.text, 22, false)], 22, { at: still ? -1 : at + dur, color: col }, new Set([id]), id);
        }
        return;
      }
      case "line": {
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < a.length; i += 2) pts.push([sx(a[i]), sy(a[i + 1])]);
        if (pts.length < 2) return;
        s.stroke(pts, { at, dur, color: col, width: 6 });
        const box = lineBox(pts);
        register({ id, kind: "line", box });
        occupy(id, box);
        if (e.text) placeText(`${id}:label`, e.text, around(box, e.text, labelSize, false), labelSize, { at: still ? -1 : at + dur, color: col }, new Set(), id);
        return;
      }
      case "plot": {
        const f = compileFn(e.text);
        const [bx, by, bw, bh] = a;
        const [x0, x1] = a.length >= 6 ? [a[4], a[5]] : [0, 1];
        const xs = Array.from({ length: 121 }, (_, i) => x0 + ((x1 - x0) * i) / 120);
        const ys = xs.map(f).map((v) => (Number.isFinite(v) ? v : 0));
        const lo = Math.min(...ys), hi = Math.max(...ys) === lo ? lo + 1 : Math.max(...ys);
        const pts: Pt[] = xs.map((_, i) => [sx(bx + (bw * i) / 120), sy(by + bh * (1 - (ys[i] - lo) / (hi - lo)))]);
        s.stroke(pts, { at, dur, color: col, width: 7 });
        const box = { x1: sx(bx), y1: sy(by), x2: sx(bx + bw), y2: sy(by + bh) };
        register({ id, kind: "plot", box });
        occupy(id, box);
        return;
      }
      case "bar": {
        const x = sx(a[0]), base = sy(a[1]), w = sx(a[2]), h = sy(a[3]);
        s.bar(x, base, w, h, { at, dur, color: col });
        const box = { x1: x, y1: base - h, x2: x + w, y2: base };
        register({ id, kind: "bar", box });
        occupy(id, box);
        if (e.text) placeText(`${id}:label`, e.text, [[x + w / 2, base + 22], [x + w / 2, base - h - 22]], 22, { at: still ? -1 : at + dur, color: "ink" }, new Set([id]), id);
        return;
      }
      case "move": {
        const p0: Pt = [sx(a[0]), sy(a[1])], p1: Pt = [sx(a[2]), sy(a[3])];
        const r = ((a[4] || 1.2) / 100) * W;
        s.mover(p0, p1, r, { at, dur, color: col });
        const box = { x1: p1[0] - r, y1: p1[1] - r, x2: p1[0] + r, y2: p1[1] + r };
        register({ id, kind: "move", box, circle: { cx: p1[0], cy: p1[1], r } });
        return;
      }
      case "text": {
        const x = sx(a[0]), y = sy(a[1]), size = a[2] || 30;
        const offsets: Pt[] = [[0, 0], [0, 30], [0, -30], [40, 0], [-40, 0], [0, 60], [0, -60], [80, 0], [-80, 0]];
        const before = report.texts.length;
        placeText(id, e.text, offsets.map(([dx, dy]) => [x + dx, y + dy] as Pt), size, { at, color: col }, new Set());
        const t = report.texts[before];
        if (t && (Math.abs(centre(t.box)[0] - x) > 1 || Math.abs(centre(t.box)[1] - y) > 1)) report.nudged++;
        if (t) register({ id, kind: "text", box: t.box });
        return;
      }
      case "highlight": {
        const [target] = resolve(e, 1) ?? [];
        if (!target) return;
        dimmed.delete(target.id);
        const b = grow(target.box, 14);
        const minW = 90, minH = 70;
        const [cx, cy] = centre(b);
        const w = Math.max(minW, b.x2 - b.x1), h = Math.max(minH, b.y2 - b.y1);
        s.overlay(cx - w / 2, cy - h / 2, w, h, { at: still ? -1 : at, color: "yellow", opacity: still ? 0 : 0.42, behind: true, until: still ? undefined : at + Math.max(1.6, dur) });
        return;
      }
      case "dim": {
        const [target] = resolve(e, 1) ?? [];
        if (!target) return;
        dimmed.add(target.id);
        const b = grow(target.box, 8);
        s.overlay(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1, { at, color: PAPER, opacity: 0.45, behind: false });
        return;
      }
    }
  };

  beats.forEach((elements, i) => {
    const still = currentBeat < 0 || i < currentBeat;
    if (currentBeat >= 0 && i > currentBeat) return;
    for (const e of elements) {
      // An earlier beat's highlight is over; skip it when drawing finished beats.
      if (still && e.kind === "highlight") continue;
      draw(e, still);
    }
  });
  return { doc: s.build(docId, "preset board"), report };
}

/**
 * Scales and moves one beat's drawing into the region it was given, if it
 * spills more than a little outside it (models drawing in parallel don't see
 * their neighbours, and a fast model will happily draw a circle over half the
 * board). Coordinates are grid units; label, connect, rays and edits carry none.
 */
export function fitToRegion(elements: PresetElement[], region: { x: number; y: number; w: number; h: number }): PresetElement[] {
  const xs: number[] = [], ys: number[] = [];
  const point = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const e of elements) {
    const a = e.args;
    switch (e.kind) {
      case "circle":
      case "cycle":
        point(a[0] - a[2], a[1] - a[2] * 1.5);
        point(a[0] + a[2], a[1] + a[2] * 1.5);
        break;
      case "box":
      case "flow":
      case "plot":
        point(a[0], a[1]);
        point(a[0] + a[2], a[1] + a[3]);
        break;
      case "bar":
        point(a[0], a[1] - a[3]);
        point(a[0] + a[2], a[1]);
        break;
      case "arrow":
      case "move":
        point(a[0], a[1]);
        point(a[2], a[3]);
        break;
      case "line":
        for (let i = 0; i + 1 < a.length; i += 2) point(a[i], a[i + 1]);
        break;
      case "equation":
      case "text":
        point(a[0], a[1]);
        break;
    }
  }
  if (!xs.length) return elements;
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const slack = 0.15;
  const inside = bx0 >= region.x - region.w * slack && bx1 <= region.x + region.w * (1 + slack) && by0 >= region.y - region.h * slack && by1 <= region.y + region.h * (1 + slack);
  if (inside) return elements;
  const k = Math.min(1, region.w / Math.max(1e-6, bx1 - bx0), region.h / Math.max(1e-6, by1 - by0));
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const rx = region.x + region.w / 2, ry = region.y + region.h / 2;
  const X = (x: number) => rx + (x - cx) * k, Y = (y: number) => ry + (y - cy) * k;
  return elements.map((e) => {
    const a = [...e.args];
    switch (e.kind) {
      case "circle":
      case "cycle":
        return { ...e, args: [X(a[0]), Y(a[1]), a[2] * k, ...a.slice(3)] };
      case "box":
      case "flow":
      case "plot":
        return { ...e, args: [X(a[0]), Y(a[1]), a[2] * k, a[3] * k, ...a.slice(4)] };
      case "bar":
        return { ...e, args: [X(a[0]), Y(a[1]), a[2] * k, a[3] * k] };
      case "arrow":
      case "move":
        return { ...e, args: [X(a[0]), Y(a[1]), X(a[2]), Y(a[3]), ...a.slice(4)] };
      case "line":
        return { ...e, args: a.map((v, i) => (i % 2 === 0 ? X(v) : Y(v))) };
      case "equation":
      case "text":
        return { ...e, args: [X(a[0]), Y(a[1]), ...a.slice(2)] };
      default:
        return e;
    }
  });
}

/** Counts layout defects on a compiled board. */
export function scoreLayout(report: LayoutReport) {
  const frac = (a: Box, b: Box) => overlap(a, b) / Math.max(1, Math.min(area(a), area(b)));
  let textText = 0;
  let textShape = 0;
  const t = report.texts;
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) if (frac(t[i].box, t[j].box) > 0.1) textText++;
    for (const sh of report.shapes) {
      if (sh.id === t[i].owner || sh.id === t[i].id || t[i].id.startsWith(`${sh.id}:`)) continue;
      if (["flow", "cycle"].includes(sh.id.split(".")[0]) && t[i].id.startsWith(sh.id.split(".")[0])) continue;
      if (frac(t[i].box, sh.box) > 0.25) textShape++;
    }
  }
  const off = [...t.map((x) => x.box), ...report.shapes.map((x) => x.box)].filter((b) => outside(b) > area(b) * 0.1).length;
  return { textText, textShape, offStage: off, dangling: report.dangling.length, nudged: report.nudged, texts: t.length, shapes: report.shapes.length };
}
