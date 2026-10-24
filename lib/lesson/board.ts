/**
 * The growing whiteboard. Every beat rebuilds one Clayzo document for the whole
 * board: elements from earlier beats are drawn already finished, this beat's
 * new elements animate in from its anchor word, and two edits act on what is
 * already there by id: `highlight` (a soft yellow mark behind it for a moment)
 * and `dim` (a paper-coloured veil over it that stays until it is highlighted again).
 */
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { H, PAPER, Scene, W } from "@/experiments/visual-flex/doc";
import { drawElement, fromFlatElements, type FlatElement } from "@/experiments/visual-flex/scene";

/** An element as the model sends it on the board: a scene-language element with a name. */
export interface BoardInput extends FlatElement {
  id: string;
}

/** An element that is on the board after a beat. */
export interface BoardElement extends BoardInput {
  beat: string;
  dimmed: boolean;
}

export interface BoardSpec {
  /** Wipe the board before drawing this beat. */
  clear: boolean;
  elements: BoardInput[];
}

export const EDIT_KINDS = new Set(["highlight", "dim"]);
export const MAX_ELEMENTS = 60;

/** The element's bounds on the 100x100 grid, padded a little. */
function bounds(e: FlatElement): [number, number, number, number] {
  const a = e.args;
  let box: [number, number, number, number];
  switch (e.kind) {
    case "line":
    case "arrow":
    case "move": {
      const xs = a.filter((_, i) => i % 2 === 0).slice(0, e.kind === "move" ? 2 : undefined);
      const ys = a.filter((_, i) => i % 2 === 1).slice(0, e.kind === "move" ? 2 : undefined);
      box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      break;
    }
    case "plot":
    case "rect":
      box = [a[0], a[1], a[0] + a[2], a[1] + a[3]];
      break;
    case "circle":
      // r is in x units; the stage is 3:2, so it spans 1.5x as many y units.
      box = [a[0] - a[2], a[1] - a[2] * 1.5, a[0] + a[2], a[1] + a[2] * 1.5];
      break;
    case "bar":
      box = [a[0], a[1] - a[3], a[0] + a[2], a[1]];
      break;
    case "text": {
      const size = a[2] || 34;
      const halfW = (e.text.length * size * 0.55) / 2 / (W / 100);
      const halfH = (size * 0.7) / (H / 100);
      box = [a[0] - halfW, a[1] - halfH, a[0] + halfW, a[1] + halfH];
      break;
    }
    default:
      box = [0, 0, 0, 0];
  }
  const pad = 2;
  return [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
}

/** Grows a box around its centre to at least `min` grid units on each side. */
function atLeast([x0, y0, x1, y1]: [number, number, number, number], min: number): [number, number, number, number] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hw = Math.max((x1 - x0) / 2, min / 2), hh = Math.max((y1 - y0) / 2, min / 2);
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

function toStage([x0, y0, x1, y1]: [number, number, number, number]) {
  return { x: (x0 / 100) * W, y: (y0 / 100) * H, w: ((x1 - x0) / 100) * W, h: ((y1 - y0) / 100) * H };
}

/**
 * Which 10x10 cells of the board have something in them, as rows of `#` and
 * `.`. Spans alone weren't enough: models kept placing labels on top of each other.
 */
function occupancy(board: BoardElement[]): string {
  const cells = Array.from({ length: 10 }, () => Array<string>(10).fill("."));
  for (const e of board) {
    const [x0, y0, x1, y1] = bounds(e);
    for (let r = Math.max(0, Math.floor(y0 / 10)); r <= Math.min(9, Math.floor(y1 / 10)); r++) {
      for (let c = Math.max(0, Math.floor(x0 / 10)); c <= Math.min(9, Math.floor(x1 / 10)); c++) cells[r][c] = "#";
    }
  }
  const rows = cells.map((row, r) => `  y ${String(r * 10).padStart(2)}-${r * 10 + 10}: ${row.join(" ")}`);
  return `Occupied areas (# = something there, . = free), columns are x 0-10, 10-20, ... 90-100:\n${rows.join("\n")}`;
}

/** Description of the board for the model. */
export function describeBoard(board: BoardElement[]): string {
  if (!board.length) return "The board is empty.";
  const lines = board.map((e) => {
    const [x0, y0, x1, y1] = bounds(e).map((v) => Math.round(v));
    const label = e.text && e.kind !== "plot" ? ` "${e.text}"` : e.kind === "plot" ? ` y=${e.text}` : "";
    return `- ${e.id}: ${e.kind}${label}, ${e.color}, spans x ${x0}..${x1}, y ${y0}..${y1}${e.dimmed ? " (dimmed)" : ""}`;
  });
  return `The board already shows these ${board.length} elements from earlier beats:\n${lines.join("\n")}\n\n${occupancy(board)}`;
}

export function compileBoard(
  previous: BoardElement[],
  spec: BoardSpec,
  beatId: string,
  docId: string,
): { doc: AnimationDocument; board: BoardElement[]; added: number; highlights: number; dims: number } {
  const base = spec.clear ? [] : previous.map((e) => ({ ...e }));
  const draws = spec.elements.filter((e) => !EDIT_KINDS.has(e.kind));
  const edits = spec.elements.filter((e) => EDIT_KINDS.has(e.kind));
  if (!draws.length && !edits.length) throw new Error("elements must not be empty");
  if (base.length + draws.length > MAX_ELEMENTS) {
    throw new Error(`the board would hold ${base.length + draws.length} elements (max ${MAX_ELEMENTS}); set clear to true and redraw what this beat needs`);
  }

  // Give every new element a unique id; an edit targets the newest element with that id.
  const taken = new Set(base.map((e) => e.id));
  const fresh: BoardElement[] = draws.map((e) => {
    let id = (e.id || e.kind).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || e.kind;
    for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
    taken.add(id);
    return { ...e, id, beat: beatId, dimmed: false };
  });
  const find = (id: string) => [...fresh].reverse().find((e) => e.id === id) ?? [...base].reverse().find((e) => e.id === id);
  for (const edit of edits) {
    if (!find(edit.text)) {
      const known = [...base, ...fresh].map((e) => e.id).join(", ") || "none";
      throw new Error(`${edit.kind} targets "${edit.text}", which is not on the board (ids on the board: ${known})`);
    }
  }

  // A highlight brings a dimmed element back; a dim stays for later beats.
  for (const edit of edits) {
    const target = find(edit.text)!;
    target.dimmed = edit.kind === "dim";
  }
  const dimmedNow = new Set(edits.filter((e) => e.kind === "dim").map((e) => e.text));

  const s = new Scene();
  const still = fromFlatElements({ elements: base }).elements;
  base.forEach((e, i) => {
    drawElement(s, still[i], true);
    if (e.dimmed && !dimmedNow.has(e.id)) {
      const r = toStage(bounds(e));
      s.overlay(r.x, r.y, r.w, r.h, { at: -1, color: PAPER, opacity: 0.72, behind: false });
    }
  });
  for (const e of fromFlatElements({ elements: fresh }).elements) drawElement(s, e);
  for (const edit of edits) {
    const at = Math.max(0, Math.min(4.5, edit.at));
    if (edit.kind === "highlight") {
      // Models often point at one small dot; a mark that small and brief went unseen.
      const r = toStage(atLeast(bounds(find(edit.text)!), 14));
      s.overlay(r.x, r.y, r.w, r.h, { at, color: "yellow", opacity: 0.42, behind: true, until: at + Math.max(1.6, edit.dur) });
    } else {
      const r = toStage(bounds(find(edit.text)!));
      s.overlay(r.x, r.y, r.w, r.h, { at, color: PAPER, opacity: 0.72, behind: false });
    }
  }
  return {
    doc: s.build(docId, `board ${beatId}`),
    board: [...base, ...fresh],
    added: fresh.length,
    highlights: edits.filter((e) => e.kind === "highlight").length,
    dims: edits.filter((e) => e.kind === "dim").length,
  };
}
