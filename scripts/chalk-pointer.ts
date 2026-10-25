// Clayzo preview of Chalky's pointer (components/chalkPointer.ts): it glides in, leaning
// into the move, settles with a little bounce, then blinks.
//   npx tsx scripts/chalk-pointer.ts out/chalk-pointer.json
//   clayzo render-frame out/chalk-pointer.json out/chalk-pointer.png --samples 6 --max-dimension 480
import { writeFileSync } from "node:fs";
import {
  ANIMATION_DOCUMENT_VERSION,
  assertValidAnimationDocument,
  base,
  constant,
  fill,
  hex,
  keyed,
  parseSvgPath,
  stroke,
  withComputedRevision,
  type AnimationDocument,
  type CubicBezier,
  type SceneNode,
} from "@clayzo/animation/authoring";
import { ANGLE, CHEEKS, COLORS, DUST, EYES, INK, SHAPES, SMILE } from "../components/chalkPointer";

const W = 480, H = 320, TPS = 240, END = 3 * TPS;
const OUT: CubicBezier = { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 };
const IN_OUT: CubicBezier = { x1: 0.65, y1: 0, x2: 0.35, y2: 1 };
const path = (d: string) => constant(parseSvgPath(d).path);
const nodes: Record<string, SceneNode> = {
  board: { ...base("board", { outTick: END, x: W / 2, y: H / 2 }), type: "rect", size: constant({ width: W, height: H }), cornerRadius: constant(0), style: { fill: fill(hex("#FBFAF7")) } },
};

// The stick, tilted, inside a group that moves and leans as one.
const stick: string[] = [];
SHAPES.forEach((s, i) => {
  const id = `shape-${i}`;
  nodes[id] = {
    ...base(id, { outTick: END }),
    type: "path",
    path: path(s.d),
    style: {
      ...(s.fill ? { fill: fill(hex(s.fill), s.opacity ?? 1) } : {}),
      ...(s.stroke ? { stroke: stroke(hex(s.stroke), s.width ?? 1, { opacity: s.opacity ?? 1 }) } : {}),
    },
  };
  stick.push(id);
});
CHEEKS.forEach((c, i) => {
  const id = `cheek-${i}`;
  nodes[id] = { ...base(id, { outTick: END, x: c.cx, y: c.cy }), type: "ellipse", size: constant({ width: c.rx * 2, height: c.ry * 2 }), style: { fill: fill(hex(COLORS.cheek), 0.85) } };
  stick.push(id);
});
// Eyes blink at 2.0 s: squash to a line for three frames and open again.
const f = (s: number) => Math.round((s * TPS) / 8) * 8;
EYES.forEach((e, i) => {
  const id = `eye-${i}`;
  nodes[id] = {
    ...base(id, {
      outTick: END,
      x: e.cx,
      y: e.cy,
      scale: keyed(`${id}.scale`, [
        [0, { x: 1, y: 1, z: 1 }, "hold"],
        [f(2.0), { x: 1, y: 1, z: 1 }, IN_OUT],
        [f(2.0) + 16, { x: 1.1, y: 0.12, z: 1 }, "hold"],
        [f(2.0) + 32, { x: 1.1, y: 0.12, z: 1 }, OUT],
        [f(2.0) + 56, { x: 1, y: 1, z: 1 }],
      ]),
    }),
    type: "ellipse",
    size: constant({ width: e.r * 2, height: e.r * 2 }),
    style: { fill: fill(hex(INK)) },
  };
  stick.push(id);
});
nodes.smile = { ...base("smile", { outTick: END }), type: "path", path: path(SMILE), style: { stroke: stroke(hex(INK), 1.2) } };
stick.push("smile");
nodes.stick = { ...base("stick", { outTick: END, rotation: ANGLE }), type: "group", children: stick };

// Dust puffs pop at the tip once it lands.
const dust: string[] = [];
DUST.forEach((d, i) => {
  const id = `dust-${i}`;
  const at = f(0.62 + i * 0.05);
  nodes[id] = {
    ...base(id, {
      outTick: END,
      x: d.cx,
      y: d.cy,
      scale: keyed(`${id}.scale`, [
        [0, { x: 0, y: 0, z: 1 }, "hold"],
        [at, { x: 0, y: 0, z: 1 }, { mass: 1, stiffness: 300, damping: 16 }],
        [at + 120, { x: 1, y: 1, z: 1 }],
      ]),
    }),
    type: "ellipse",
    size: constant({ width: d.r * 2, height: d.r * 2 }),
    style: { fill: fill(hex(COLORS.dust), d.opacity), stroke: stroke(hex("#E9D9A6"), 0.6, { opacity: d.opacity }) },
  };
  dust.push(id);
});

// The whole pointer: glides in from the right leaning forward, lands at 0.6 s, and settles.
nodes.pointer = {
  ...base("pointer", {
    outTick: END,
    scale: 3.6,
    position: keyed("pointer.pos", [
      [0, { x: 560, y: 260, z: 0 }, "hold"],
      [f(0.1), { x: 560, y: 260, z: 0 }, OUT],
      [f(0.62), { x: 210, y: 200, z: 0 }, "hold"],
    ]),
    rotation: keyed("pointer.rot", [
      [0, { x: 0, y: 0, z: -14 }, "hold"],
      [f(0.1), { x: 0, y: 0, z: -14 }, OUT],
      [f(0.62), { x: 0, y: 0, z: 5 }, { mass: 1, stiffness: 220, damping: 14 }],
      [f(1.3), { x: 0, y: 0, z: 0 }],
    ]),
  }),
  type: "group",
  children: [...dust, "stick"],
};

const doc = withComputedRevision({
  version: ANIMATION_DOCUMENT_VERSION,
  id: "chalk-pointer",
  revision: "",
  name: "Chalk pointer",
  canvas: { width: W, height: H, pixelAspectRatio: 1, backgroundColor: hex("#FBFAF7") },
  timing: { ticksPerSecond: TPS, frameRate: { numerator: 30, denominator: 1 }, durationTicks: END, displayStartTick: 0 },
  assets: {},
  compositions: { main: { id: "main", name: "main", width: W, height: H, durationTicks: END, nodes, rootNodeIds: ["board", "pointer"] } },
  rootCompositionId: "main",
  components: {},
  markers: [],
  capabilities: { required: [], optional: [], unsupportedPolicy: "warn" },
} as AnimationDocument);
assertValidAnimationDocument(doc);
writeFileSync(process.argv[2] ?? "chalk-pointer.json", JSON.stringify(doc));
