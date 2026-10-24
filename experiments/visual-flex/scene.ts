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
  const cleaned = expr.replace(/\bpi\b/g, "PI").replace(/\^/g, "**");
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
  for (const e of elements) {
    const at = Math.max(0, Math.min(4.5, e.at ?? 0));
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
  return s.build(id, "L3 scene");
}
