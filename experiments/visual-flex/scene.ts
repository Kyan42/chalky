/**
 * Level 3: a small scene language. The model places shapes on a 100×100 grid
 * (x right, y down) and says when each appears; this compiles it to Clayzo.
 */
import { H, Scene, W, type Pt } from "./doc";

type Anim = { at?: number; dur?: number; color?: string };
export type SceneElement =
  | ({ kind: "line"; points: [number, number][]; width?: number; closed?: boolean } & Anim)
  | ({ kind: "plot"; fn: string; box: [number, number, number, number]; xRange?: [number, number]; yRange?: [number, number]; width?: number } & Anim)
  | ({ kind: "circle"; cx: number; cy: number; r: number; filled?: boolean } & Anim)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number; filled?: boolean } & Anim)
  | ({ kind: "arrow"; from: [number, number]; to: [number, number] } & Anim)
  | ({ kind: "bar"; x: number; baseline: number; w: number; h: number } & Anim)
  | ({ kind: "move"; from: [number, number]; to: [number, number]; r?: number } & Anim)
  | ({ kind: "text"; x: number; y: number; text: string; size?: number; align?: "left" | "center" | "right" } & Anim);

export interface Level3Spec {
  elements: SceneElement[];
}

const sx = (x: number) => (x / 100) * W;
const sy = (y: number) => (y / 100) * H;
const pt = (p: [number, number]): Pt => [sx(p[0]), sy(p[1])];

const ALLOWED = new Set(["sin", "cos", "tan", "exp", "log", "sqrt", "abs", "pow", "min", "max", "floor", "PI", "E"]);

/** Compiles a math expression in `x` without giving it access to anything else. */
export function compileFn(expr: string): (x: number) => number {
  // A unary minus becomes (-1)*: "-x^4" is -(x^4) in maths, and JavaScript refuses "-x**4" outright.
  const cleaned = expr.replace(/\bpi\b/g, "PI").replace(/\^/g, "**").replace(/(^|[(*/+\-,]\s*)-/g, "$1(-1)*");
  if (!/^[\d\s.+\-*/(),xA-Za-z]*$/.test(cleaned)) throw new Error(`plot fn has disallowed characters: ${expr}`);
  for (const name of cleaned.match(/[A-Za-z_]+/g) ?? []) {
    if (name !== "x" && !ALLOWED.has(name)) throw new Error(`plot fn uses unknown name "${name}" (allowed: x, ${[...ALLOWED].join(", ")})`);
  }
  const body = cleaned.replace(/\b(sin|cos|tan|exp|log|sqrt|abs|pow|min|max|floor|PI|E)\b/g, "Math.$1");
  const f = new Function("x", `"use strict"; return (${body});`) as (x: number) => number;
  const probe = f(0.5);
  if (typeof probe !== "number") throw new Error(`plot fn does not return a number: ${expr}`);
  return f;
}

export function compileLevel3(spec: Level3Spec, id: string) {
  const elements = (spec.elements ?? []).slice(0, 40);
  if (!elements.length) throw new Error("elements must not be empty");
  const s = new Scene();
  for (const e of elements) drawElement(s, e);
  return s.build(id, "L3 scene");
}

/** Draws one element into `s`. `still` draws it already finished (an earlier beat's element). */
export function drawElement(s: Scene, e: SceneElement, still = false) {
  {
    const at = still ? -1 : Math.max(0, Math.min(4.5, e.at ?? 0));
    const dur = Math.max(0.1, Math.min(3, e.dur ?? 0.6));
    switch (e.kind) {
      case "line":
        if (!e.points || e.points.length < 2) throw new Error("line needs at least 2 points");
        s.stroke(e.points.map(pt), { at, dur, color: e.color, width: e.width ?? 6, closed: e.closed });
        break;
      case "plot": {
        const f = compileFn(e.fn);
        const [bx, by, bw, bh] = e.box;
        const [x0, x1] = e.xRange ?? [0, 1];
        const samples = Array.from({ length: 121 }, (_, i) => x0 + ((x1 - x0) * i) / 120);
        const ys = samples.map(f).map((v) => (Number.isFinite(v) ? v : 0));
        const [y0, y1] = e.yRange ?? [Math.min(...ys), Math.max(...ys) === Math.min(...ys) ? Math.min(...ys) + 1 : Math.max(...ys)];
        const pts: Pt[] = samples.map((_, i) => {
          const u = i / 120;
          const v = Math.max(0, Math.min(1, (ys[i] - y0) / (y1 - y0)));
          return [sx(bx + bw * u), sy(by + bh * (1 - v))];
        });
        s.stroke(pts, { at, dur, color: e.color ?? "red", width: e.width ?? 8 });
        break;
      }
      case "circle":
        s.circle(sx(e.cx), sy(e.cy), (e.r / 100) * W, { at, color: e.color, filled: e.filled });
        break;
      case "rect":
        s.box(sx(e.x), sy(e.y), sx(e.w), sy(e.h), { at, color: e.color, filled: e.filled });
        break;
      case "arrow":
        s.arrow(pt(e.from), pt(e.to), { at, dur, color: e.color });
        break;
      case "bar":
        s.bar(sx(e.x), sy(e.baseline), sx(e.w), sy(e.h), { at, dur, color: e.color });
        break;
      case "move":
        s.mover(pt(e.from), pt(e.to), ((e.r ?? 1.2) / 100) * W, { at, dur, color: e.color });
        break;
      case "text":
        s.text(e.text, sx(e.x), sy(e.y), { at, size: e.size ?? 34, color: e.color, align: e.align });
        break;
      default:
        throw new Error(`unknown element kind "${(e as { kind: string }).kind}"`);
    }
  }
}

/** One element as the model sends it: every field present, numbers packed into `args`. */
export interface FlatElement {
  kind: string;
  at: number;
  dur: number;
  color: string;
  args: number[];
  text: string;
}

/** Level 3 sends each element's numbers as `args` in a fixed order per kind. */
export function fromFlatElements(json: { elements: FlatElement[] }): Level3Spec {
  return {
    elements: json.elements.map((e): SceneElement => {
      const a = e.args;
      const need = (n: number) => {
        if (a.length < n) throw new Error(`${e.kind} needs ${n} args, got ${a.length}`);
      };
      const common = { at: e.at, dur: e.dur, color: e.color };
      switch (e.kind) {
        case "line": {
          need(4);
          const points: [number, number][] = [];
          for (let i = 0; i + 1 < a.length; i += 2) points.push([a[i], a[i + 1]]);
          return { kind: "line", points, ...common };
        }
        case "plot":
          need(4);
          return { kind: "plot", fn: e.text, box: [a[0], a[1], a[2], a[3]], xRange: a.length >= 6 ? [a[4], a[5]] : undefined, ...common };
        case "circle":
          need(3);
          return { kind: "circle", cx: a[0], cy: a[1], r: a[2], filled: a[3] !== 0, ...common };
        case "rect":
          need(4);
          return { kind: "rect", x: a[0], y: a[1], w: a[2], h: a[3], filled: a[4] !== 0, ...common };
        case "arrow":
          need(4);
          return { kind: "arrow", from: [a[0], a[1]], to: [a[2], a[3]], ...common };
        case "bar":
          need(4);
          return { kind: "bar", x: a[0], baseline: a[1], w: a[2], h: a[3], ...common };
        case "move":
          need(4);
          return { kind: "move", from: [a[0], a[1]], to: [a[2], a[3]], r: a[4], ...common };
        case "text":
          need(2);
          return { kind: "text", x: a[0], y: a[1], size: a[2], text: e.text, ...common };
        default:
          throw new Error(`unknown element kind "${e.kind}"`);
      }
    }),
  };
}
