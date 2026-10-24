// Compiles a sample of every level-1/2/3 construct to catch builder bugs before any model runs.
import { compileLevel1, compileLevel2, PRIMITIVE_NAMES } from "./primitives";
import { compileLevel3 } from "./scene";
for (const name of PRIMITIVE_NAMES) compileLevel1(name, `smoke-${name}`);
compileLevel2({ layout: "row", caption: "Two waves cancel", items: [
  { primitive: "wave", params: { cycles: 3, label: "noise" } },
  { primitive: "wave", params: { cycles: 3, phase: 180, color: "blue", label: "anti-noise" } },
] }, "smoke-l2");
compileLevel3({ elements: [
  { kind: "plot", fn: "sin(2*pi*x*3)", box: [5, 20, 90, 30], at: 0, dur: 1.5 },
  { kind: "arrow", from: [10, 80], to: [60, 80], at: 1 },
  { kind: "text", x: 50, y: 10, text: "Hello", at: 0.2 },
  { kind: "bar", x: 70, baseline: 95, w: 8, h: 30, at: 1.5 },
  { kind: "move", from: [10, 60], to: [90, 60], at: 0.5, dur: 2 },
  { kind: "circle", cx: 80, cy: 30, r: 5, at: 2 },
  { kind: "rect", x: 20, y: 55, w: 20, h: 10, filled: false, at: 2 },
  { kind: "line", points: [[0, 0], [50, 50]], at: 0 },
] }, "smoke-l3");
console.log("all builders produce valid documents");
