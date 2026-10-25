import { oval, poly, smooth, type P } from "../geometry";
import type { Block, Shape } from "../types";

const f = (v: number) => v.toFixed(1);
const line = (a: P, b: P) => `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`;
const dot = (cx: number, cy: number, r = 2.2): Shape => ({ type: "ellipse", cx, cy, rx: r, ry: r, stroke: "ink", fill: "ink", width: 0.8 });
/** A wavy vertical line from (x, y0) down to (x, y1). */
const vwave = (x: number, y0: number, y1: number, amp: number, cycles: number, phase = 0) => {
  const pts: P[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push([x + amp * Math.sin(phase + t * cycles * Math.PI * 2), y0 + (y1 - y0) * t]);
  }
  return smooth(pts);
};
/** Mirror an SVG path's x coordinates about x = cx (paths of M/L/C/Q pairs only). */
const mirror = (d: string, cx: number) =>
  d.replace(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f(2 * cx - +x)} ${y}`);

export const fish: Block = {
  id: "fish",
  title: "Fish",
  describe: "a fish seen from the side with tail, fins, gill line and eye; lives in water, breathes with gills",
  tags: ["fish", "vertebrate", "gills", "water habitat", "food chain", "classification"],
  size: [100, 64],
  parts: [
    { id: "tail", label: "tail fin", shapes: [{ type: "path", d: "M68 32 L 94 12 C 88 24, 88 40, 94 52 Z", stroke: "blue", fill: "blue-tint" }] },
    { id: "fins", label: "fins", shapes: [{ type: "path", d: "M32 16 C 38 4, 52 4, 58 18", stroke: "blue", fill: "blue-tint" }] },
    { id: "body", label: "body", shapes: [{ type: "path", d: "M6 32 C 18 8, 56 8, 72 32 C 56 56, 18 56, 6 32 Z", stroke: "blue", fill: "blue-tint" }] },
    { id: "gills", label: "gills", shapes: [{ type: "path", d: "M30 21 C 35 27, 35 37, 30 43", stroke: "blue", width: 0.8 }, dot(18, 28)] },
  ],
  anchors: { center: [46, 32], top: [46, 8], bottom: [40, 52], left: [6, 32], right: [94, 32], mouth: [6, 32], gills: [32, 32], tail: [88, 32], fin: [45, 8] },
};

export const bird: Block = {
  id: "bird",
  title: "Bird",
  describe: "a small bird from the side with beak, wing, tail and legs",
  tags: ["bird", "vertebrate", "feathers", "flight", "food chain", "classification"],
  size: [100, 80],
  parts: [
    { id: "legs", label: "legs", shapes: [line([44, 58], [42, 76]), line([58, 58], [58, 76])].map((d) => ({ type: "path" as const, d, stroke: "orange" })) },
    { id: "beak", label: "beak", shapes: [{ type: "path", d: "M18 25 L 4 31 L 18 37", stroke: "orange", fill: "orange-tint" }] },
    {
      id: "body",
      label: "body",
      shapes: [{ type: "path", d: smooth([[16, 30], [28, 16], [40, 22], [56, 32], [76, 34], [96, 24], [88, 44], [70, 58], [46, 64], [26, 56], [17, 44]], true), stroke: "blue", fill: "blue-tint" }],
    },
    { id: "wing", label: "wing", shapes: [{ type: "path", d: "M40 40 C 54 32, 72 36, 80 42 C 68 52, 50 52, 40 40 Z", stroke: "blue", width: 0.8 }, dot(29, 28)] },
  ],
  anchors: { center: [50, 42], top: [28, 16], bottom: [50, 76], left: [4, 31], right: [96, 24], head: [28, 30], beak: [5, 31], wing: [60, 42], tail: [92, 30], legs: [50, 72] },
};

export const bee: Block = {
  id: "bee",
  title: "Bee",
  describe: "a honeybee from the side: striped body, wings and stinger; a pollinator",
  tags: ["bee", "insect", "pollination", "flowers", "invertebrate", "food chain"],
  size: [100, 76],
  parts: [
    {
      id: "wings",
      label: "wings",
      shapes: [oval(40, 20, 11, 16, -18), oval(62, 20, 11, 16, 18)].map((d) => ({ type: "path" as const, d, stroke: "blue", fill: "board", width: 0.8 })),
    },
    { id: "stinger", label: "stinger", shapes: [{ type: "path", d: "M78 50 L 94 50", stroke: "ink" }] },
    { id: "body", label: "body", shapes: [{ type: "ellipse", cx: 52, cy: 50, rx: 29, ry: 19, stroke: "orange", fill: "yellow-tint" }] },
    { id: "stripes", label: "stripes", shapes: ["M45 32 C 50 42, 50 58, 45 68", "M61 32 C 66 42, 66 58, 61 68"].map((d) => ({ type: "path" as const, d, stroke: "ink" })) },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 17, cy: 48, rx: 11, ry: 11, stroke: "ink", fill: "yellow-tint" }, dot(13, 45), { type: "path", d: "M14 37 C 12 28, 8 24, 4 22", stroke: "ink", width: 0.8 }] },
  ],
  anchors: { center: [52, 48], top: [50, 4], bottom: [52, 70], left: [6, 48], right: [94, 50], head: [17, 48], wings: [50, 16], stinger: [94, 50], body: [60, 50] },
};

const upperWing = "M46 40 C 32 8, 4 6, 8 26 C 10 40, 26 48, 46 50 Z";
const lowerWing = "M46 54 C 30 52, 12 60, 16 74 C 20 86, 40 82, 46 64 Z";
export const butterfly: Block = {
  id: "butterfly",
  title: "Butterfly",
  describe: "a butterfly seen from above with four wings, body and antennae; the adult in its life cycle",
  tags: ["butterfly", "insect", "life cycle", "metamorphosis", "pollination", "invertebrate"],
  size: [100, 90],
  parts: [
    {
      id: "wings",
      label: "wings",
      shapes: [upperWing, mirror(upperWing, 50), lowerWing, mirror(lowerWing, 50)].map((d) => ({ type: "path" as const, d, stroke: "purple", fill: "purple-tint" })),
    },
    { id: "spots", label: "wing spots", shapes: [24, 76].map((cx) => ({ type: "ellipse" as const, cx, cy: 28, rx: 5, ry: 5, stroke: "purple", width: 0.8 })) },
    { id: "body", label: "body", shapes: [{ type: "rect", x: 44, y: 26, w: 12, h: 52, r: 6, stroke: "ink", fill: "brown-tint" }] },
    { id: "antennae", label: "antennae", shapes: ["M47 26 C 45 16, 40 10, 34 6", "M53 26 C 55 16, 60 10, 66 6"].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })) },
  ],
  anchors: { center: [50, 46], top: [50, 6], bottom: [50, 82], left: [7, 30], right: [93, 30], wings: [24, 34], body: [50, 52], antennae: [34, 6], head: [50, 28] },
};

const segs: [number, number][] = [[84, 36], [64, 33], [44, 36]];
export const caterpillar: Block = {
  id: "caterpillar",
  title: "Caterpillar",
  describe: "a caterpillar from the side: round body segments, legs and a head with antennae; the larva stage",
  tags: ["caterpillar", "larva", "life cycle", "metamorphosis", "insect", "herbivore"],
  size: [100, 60],
  parts: [
    { id: "legs", label: "legs", shapes: segs.map(([x, y]) => ({ type: "path" as const, d: line([x, y + 8], [x, y + 21]), stroke: "green" })) },
    { id: "body", label: "body segments", shapes: segs.map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 13, ry: 13, stroke: "green", fill: "green-tint" })) },
    { id: "antennae", label: "antennae", shapes: ["M15 18 L 8 5", "M27 18 L 32 5"].map((d) => ({ type: "path" as const, d, stroke: "green", width: 0.8 })) },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 21, cy: 30, rx: 14, ry: 14, stroke: "green", fill: "green-tint" }, dot(16, 28)] },
  ],
  anchors: { center: [52, 34], top: [20, 6], bottom: [54, 56], left: [7, 30], right: [97, 38], head: [20, 30], body: [62, 36], legs: [62, 54], tail: [96, 38] },
};

export const frog: Block = {
  id: "frog",
  title: "Frog",
  describe: "a sitting frog from the side with big eye and folded back leg; an amphibian",
  tags: ["frog", "amphibian", "life cycle", "pond habitat", "vertebrate", "food chain"],
  size: [100, 80],
  parts: [
    {
      id: "body",
      label: "body",
      shapes: [{ type: "path", d: smooth([[8, 46], [16, 34], [32, 28], [56, 30], [78, 40], [90, 56], [80, 68], [48, 70], [24, 64], [12, 56]], true), stroke: "green", fill: "green-tint" }],
    },
    { id: "eye", label: "eye", shapes: [{ type: "ellipse", cx: 30, cy: 26, rx: 9, ry: 9, stroke: "green", fill: "green-tint" }, dot(30, 25, 2.6)] },
    { id: "mouth", label: "mouth", shapes: [{ type: "path", d: "M10 48 C 18 52, 28 52, 36 48", stroke: "green", width: 0.8 }] },
    {
      id: "legs",
      label: "legs",
      shapes: [
        { type: "path", d: oval(68, 56, 17, 10, -18), stroke: "green", fill: "green-tint" },
        { type: "path", d: "M56 72 L 92 74", stroke: "green" },
        { type: "path", d: "M30 62 L 26 74 L 16 74", stroke: "green" },
      ],
    },
  ],
  anchors: { center: [50, 50], top: [30, 16], bottom: [50, 76], left: [8, 46], right: [92, 60], eye: [30, 26], mouth: [12, 48], legs: [68, 56], head: [24, 40] },
};

export const tadpole: Block = {
  id: "tadpole",
  title: "Tadpole",
  describe: "a tadpole: round head and long wavy tail; the young water stage of a frog",
  tags: ["tadpole", "frog", "life cycle", "metamorphosis", "amphibian", "pond habitat"],
  size: [100, 50],
  parts: [
    { id: "tail", label: "tail", shapes: [{ type: "path", d: "M40 17 C 58 10, 72 28, 95 18 C 78 40, 58 34, 40 33 Z", stroke: "green", fill: "green-tint" }] },
    { id: "body", label: "body", shapes: [{ type: "ellipse", cx: 26, cy: 25, rx: 20, ry: 17, stroke: "green", fill: "green-tint" }, dot(16, 21)] },
  ],
  anchors: { center: [48, 25], top: [26, 8], bottom: [26, 42], left: [6, 25], right: [95, 18], head: [26, 25], tail: [76, 26] },
};

// The worm runs along a gentle wave; its outline is the centreline pushed out each side.
const wormC = (x: number) => 25 + 7 * Math.sin(((x - 10) / 80) * Math.PI * 2);
const wormN = (x: number): P => {
  const dy = (wormC(x + 0.5) - wormC(x - 0.5)) / 1, len = Math.hypot(1, dy);
  return [-dy / len, 1 / len];
};
const wormSide = (s: number) => [16, 26, 36, 46, 56, 66, 76, 84].map((x): P => { const n = wormN(x); return [x + n[0] * 10 * s, wormC(x) + n[1] * 10 * s]; });
const wormOutline = (() => {
  const top = wormSide(-1), bot = wormSide(1).reverse();
  const capR = (x: number, dir: number): P => [x + dir * 10, wormC(x)];
  return smooth([capR(84, 1) as P, ...bot, capR(16, -1), ...top], true, 0.9);
})();
const wormRing = (x: number) => { const n = wormN(x); return line([x - n[0] * 10, wormC(x) - n[1] * 10], [x + n[0] * 10, wormC(x) + n[1] * 10]); };

export const earthworm: Block = {
  id: "earthworm",
  title: "Earthworm",
  describe: "a wriggling earthworm with ringed segments; lives in soil and recycles dead matter",
  tags: ["earthworm", "soil", "decomposer", "invertebrate", "habitat", "food chain"],
  size: [100, 50],
  parts: [
    { id: "body", label: "body", shapes: [{ type: "path", d: wormOutline, stroke: "pink", fill: "pink-tint" }] },
    { id: "segments", label: "segments", shapes: [52, 70].map((x) => ({ type: "path" as const, d: wormRing(x), stroke: "pink", width: 0.8 })) },
    { id: "band", label: "clitellum", shapes: [{ type: "path", d: wormRing(30), stroke: "pink" }] },
  ],
  anchors: { center: [50, 25], top: [30, 12], bottom: [70, 38], left: [8, wormC(16)], right: [92, wormC(84)], head: [14, wormC(16)], tail: [88, wormC(84)], segments: [60, wormC(60)] },
};

export const ant: Block = {
  id: "ant",
  title: "Ant",
  describe: "an ant from the side: head, thorax, big abdomen, six legs and antennae; a social insect",
  tags: ["ant", "insect", "invertebrate", "colony", "classification", "food chain"],
  size: [100, 62],
  parts: [
    {
      id: "legs",
      label: "legs",
      shapes: ["M37 35 L 24 46 L 18 58", "M42 37 L 42 58", "M47 35 L 60 46 L 66 58"].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })),
    },
    { id: "antennae", label: "antennae", shapes: ["M11 21 C 9 12, 6 8, 2 5", "M20 21 C 22 12, 27 8, 33 5"].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })) },
    { id: "abdomen", label: "abdomen", shapes: [{ type: "ellipse", cx: 75, cy: 30, rx: 20, ry: 15, stroke: "ink", fill: "brown-tint" }] },
    { id: "thorax", label: "thorax", shapes: [{ type: "ellipse", cx: 42, cy: 30, rx: 9, ry: 8, stroke: "ink", fill: "brown-tint" }] },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 16, cy: 30, rx: 11, ry: 10, stroke: "ink", fill: "brown-tint" }, dot(12, 28)] },
  ],
  anchors: { center: [50, 32], top: [20, 6], bottom: [44, 58], left: [8, 30], right: [94, 30], head: [19, 30], thorax: [43, 30], abdomen: [74, 30], legs: [44, 54] },
};

const spiderLegs: [P, P, P][] = [
  [[42, 26], [24, 8], [8, 14]],
  [[40, 30], [14, 24], [2, 36]],
  [[40, 34], [14, 42], [6, 60]],
  [[42, 38], [24, 58], [16, 78]],
];
export const spider: Block = {
  id: "spider",
  title: "Spider",
  describe: "a spider seen from above with eight bent legs and two body parts; an arachnid predator",
  tags: ["spider", "arachnid", "predator", "invertebrate", "classification", "food chain"],
  size: [100, 90],
  parts: [
    {
      id: "legs",
      label: "legs",
      shapes: spiderLegs.flatMap((l) => [poly(l), mirror(poly(l), 50)]).map((d) => ({ type: "path" as const, d, stroke: "ink" })),
    },
    { id: "abdomen", label: "abdomen", shapes: [{ type: "ellipse", cx: 50, cy: 60, rx: 17, ry: 20, stroke: "ink", fill: "grey-tint" }] },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 50, cy: 31, rx: 12, ry: 11, stroke: "ink", fill: "grey-tint" }] },
  ],
  anchors: { center: [50, 46], top: [50, 8], bottom: [50, 80], left: [2, 36], right: [98, 36], head: [50, 31], abdomen: [50, 60], legs: [14, 42] },
};

const spiral = (() => {
  const pts: P[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, a = Math.PI * 0.5 + t * Math.PI * 2.2, r = 14 - t * 10;
    pts.push([60 + Math.cos(a) * r, 33 + Math.sin(a) * r]);
  }
  return smooth(pts);
})();
export const snail: Block = {
  id: "snail",
  title: "Snail",
  describe: "a snail from the side: spiral shell on a soft body with eye stalks; a mollusc",
  tags: ["snail", "mollusc", "invertebrate", "shell", "garden habitat", "herbivore"],
  size: [100, 70],
  parts: [
    { id: "stalks", label: "eye stalks", shapes: [{ type: "path", d: "M16 40 L 8 18", stroke: "grey" }, { type: "path", d: "M24 38 L 26 16", stroke: "grey" }, dot(8, 17, 2.6), dot(26, 15, 2.6)] },
    {
      id: "body",
      label: "body",
      shapes: [{ type: "path", d: "M8 60 C 8 48, 12 36, 22 36 C 30 36, 32 44, 34 54 L 86 54 C 96 56, 96 64, 86 64 L 14 64 C 9 64, 8 62, 8 60 Z", stroke: "grey", fill: "grey-tint" }],
    },
    { id: "shell", label: "shell", shapes: [{ type: "ellipse", cx: 60, cy: 32, rx: 23, ry: 22, stroke: "brown", fill: "brown-tint" }, { type: "path", d: spiral, stroke: "brown", width: 0.8 }] },
  ],
  anchors: { center: [52, 40], top: [60, 10], bottom: [50, 64], left: [8, 58], right: [94, 60], shell: [60, 32], head: [20, 44], eyes: [17, 16], foot: [70, 60] },
};

export const rabbit: Block = {
  id: "rabbit",
  title: "Rabbit",
  describe: "a sitting rabbit from the side with long ears and a fluffy tail; a herbivore mammal",
  tags: ["rabbit", "mammal", "herbivore", "food chain", "vertebrate", "habitat"],
  size: [90, 100],
  parts: [
    { id: "ears", label: "ears", shapes: [oval(23, 18, 7, 16, -14), oval(39, 19, 7, 16, 16)].map((d) => ({ type: "path" as const, d, stroke: "grey", fill: "grey-tint" })) },
    { id: "tail", label: "tail", shapes: [{ type: "ellipse", cx: 80, cy: 70, rx: 9, ry: 9, stroke: "grey", fill: "board" }] },
    { id: "body", label: "body", shapes: [{ type: "ellipse", cx: 52, cy: 70, rx: 27, ry: 23, stroke: "grey", fill: "grey-tint" }] },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 29, cy: 44, rx: 15, ry: 14, stroke: "grey", fill: "grey-tint" }, dot(24, 41)] },
    { id: "feet", label: "feet", shapes: [{ type: "path", d: "M34 94 L 62 94", stroke: "grey" }] },
  ],
  anchors: { center: [48, 58], top: [31, 3], bottom: [50, 96], left: [14, 44], right: [89, 70], head: [29, 44], ears: [31, 14], body: [54, 72], tail: [82, 70] },
};

export const fox: Block = {
  id: "fox",
  title: "Fox",
  describe: "a fox standing side-on with pointed snout, ear and bushy tail; a predator mammal",
  tags: ["fox", "mammal", "predator", "carnivore", "food chain", "habitat"],
  size: [100, 76],
  parts: [
    { id: "legs", label: "legs", shapes: [30, 44, 58, 72].map((x) => ({ type: "path" as const, d: line([x, 48], [x, 72]), stroke: "orange" })) },
    { id: "tail", label: "tail", shapes: [{ type: "path", d: "M74 36 C 86 32, 94 22, 98 8 C 102 28, 94 46, 76 50 Z", stroke: "orange", fill: "orange-tint" }] },
    { id: "body", label: "body", shapes: [{ type: "ellipse", cx: 51, cy: 42, rx: 28, ry: 13, stroke: "orange", fill: "orange-tint" }] },
    { id: "head", label: "head", shapes: [{ type: "path", d: "M34 34 L 28 10 L 20 24 C 14 26, 8 30, 3 36 C 10 42, 22 46, 34 46 Z", stroke: "orange", fill: "orange-tint" }, dot(20, 31)] },
  ],
  anchors: { center: [50, 42], top: [28, 10], bottom: [52, 72], left: [3, 36], right: [97, 44], head: [20, 34], snout: [4, 36], tail: [94, 24], legs: [51, 66] },
};

export const cow: Block = {
  id: "cow",
  title: "Cow",
  describe: "a cow standing side-on with spots, horns, muzzle, udder and tail; a farm herbivore",
  tags: ["cow", "mammal", "herbivore", "farm", "food chain", "milk"],
  size: [100, 76],
  parts: [
    { id: "legs", label: "legs", shapes: [34, 47, 70, 82].map((x) => ({ type: "path" as const, d: line([x, 48], [x, 72]), stroke: "ink" })) },
    { id: "tail", label: "tail", shapes: [{ type: "path", d: "M90 28 C 97 34, 97 44, 94 54", stroke: "ink", width: 0.8 }] },
    { id: "body", label: "body", shapes: [{ type: "rect", x: 26, y: 20, w: 64, h: 34, r: 13, stroke: "ink", fill: "board" }] },
    { id: "spots", label: "spots", shapes: [oval(62, 34, 11, 8, 10)].map((d) => ({ type: "path" as const, d, stroke: "ink", fill: "grey-tint", width: 0.8 })) },
    { id: "udder", label: "udder", shapes: [{ type: "path", d: "M52 54 C 52 64, 64 64, 64 54", stroke: "pink", fill: "pink-tint", width: 0.8 }] },
    { id: "horns", label: "horns", shapes: ["M12 16 L 8 5", "M24 16 L 28 5"].map((d) => ({ type: "path" as const, d, stroke: "grey" })) },
    {
      id: "head",
      label: "head",
      shapes: [
        { type: "ellipse", cx: 18, cy: 30, rx: 12, ry: 15, stroke: "ink", fill: "board" },
        { type: "ellipse", cx: 17, cy: 42, rx: 11, ry: 7, stroke: "pink", fill: "pink-tint" },
        dot(15, 26),
      ],
    },
  ],
  anchors: { center: [52, 40], top: [50, 6], bottom: [52, 72], left: [6, 32], right: [96, 40], head: [18, 30], body: [58, 36], udder: [58, 60], tail: [94, 50] },
};

export const birdEgg: Block = {
  id: "bird-egg",
  title: "Bird Egg",
  describe: "a speckled bird egg; the start of a bird's life cycle",
  tags: ["egg", "bird", "life cycle", "reproduction", "embryo", "nest"],
  size: [76, 100],
  parts: [
    { id: "shell", label: "eggshell", shapes: [{ type: "path", d: "M38 6 C 60 6, 70 46, 70 62 C 70 82, 56 94, 38 94 C 20 94, 6 82, 6 62 C 6 46, 16 6, 38 6 Z", stroke: "brown", fill: "brown-tint" }] },
    { id: "speckles", label: "speckles", shapes: [[44, 34], [28, 52], [52, 64], [36, 76]].map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 2.5, ry: 2.5, stroke: "brown", fill: "brown", width: 0.8 })) },
  ],
  anchors: { center: [38, 56], top: [38, 6], bottom: [38, 94], left: [6, 62], right: [70, 62], shell: [66, 40] },
};

export const feather: Block = {
  id: "feather",
  title: "Feather",
  describe: "a single bird feather with central shaft and vane",
  tags: ["feather", "bird", "adaptation", "flight", "insulation", "classification"],
  size: [60, 100],
  parts: [
    { id: "vane", label: "vane", shapes: [{ type: "path", d: "M38 84 C 4 72, 2 30, 28 4 C 56 26, 60 64, 38 84 Z", stroke: "brown", fill: "brown-tint" }] },
    { id: "barbs", label: "barbs", shapes: ["M31 42 L 11 32", "M35 62 L 53 50"].map((d) => ({ type: "path" as const, d, stroke: "brown", width: 0.8 })) },
    { id: "shaft", label: "shaft", shapes: [{ type: "path", d: "M42 96 C 37 70, 31 40, 28 8", stroke: "brown" }] },
  ],
  anchors: { center: [32, 48], top: [28, 6], bottom: [42, 96], left: [8, 46], right: [54, 46], shaft: [34, 60], vane: [20, 44], quill: [41, 90] },
};

const shellEdge = [-150, -126, -102, -78, -54, -30].map((deg): P => {
  const a = (deg * Math.PI) / 180;
  return [50 + 46 * Math.cos(a), 74 + 60 * Math.sin(a)];
});
const shellFan = (() => {
  let d = `M50 76 L${f(shellEdge[0][0])} ${f(shellEdge[0][1])}`;
  for (let i = 0; i < shellEdge.length - 1; i++) {
    const a = shellEdge[i], b = shellEdge[i + 1];
    const m: P = [50 + ((a[0] + b[0]) / 2 - 50) * 1.22, 74 + ((a[1] + b[1]) / 2 - 74) * 1.22];
    d += ` Q${f(m[0])} ${f(m[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d + " Z";
})();
export const seashell: Block = {
  id: "seashell",
  title: "Seashell",
  describe: "a scallop seashell with ribs fanning out from the hinge; the shell of a sea mollusc",
  tags: ["shell", "mollusc", "ocean habitat", "seashore", "invertebrate", "fossil"],
  size: [100, 90],
  parts: [
    { id: "shell", label: "shell", shapes: [{ type: "path", d: shellFan, stroke: "orange", fill: "orange-tint" }] },
    {
      id: "ribs",
      label: "ribs",
      shapes: shellEdge.slice(1, -1).map(([x, y]) => ({ type: "path" as const, d: line([50 + (x - 50) * 0.3, 74 + (y - 74) * 0.3], [50 + (x - 50) * 0.92, 74 + (y - 74) * 0.92]), stroke: "orange", width: 0.8 })),
    },
    { id: "hinge", label: "hinge", shapes: [{ type: "path", d: "M34 76 L 66 76 L 60 88 L 40 88 Z", stroke: "orange", fill: "orange-tint" }] },
  ],
  anchors: { center: [50, 48], top: [50, 6], bottom: [50, 88], left: [10, 44], right: [90, 44], hinge: [50, 82], ribs: [50, 30] },
};

export const coral: Block = {
  id: "coral",
  title: "Coral",
  describe: "a branching coral; a colony of tiny sea animals that builds a reef",
  tags: ["coral", "reef", "ocean habitat", "colony", "invertebrate", "ecosystem"],
  size: [90, 100],
  parts: [
    {
      id: "coral",
      label: "coral",
      shapes: [
        {
          type: "path",
          d: smooth(
            [[34, 96], [35, 74], [20, 60], [10, 38], [12, 22], [24, 24], [26, 42], [36, 54], [36, 32], [32, 14], [40, 4], [50, 8], [50, 30], [50, 50], [60, 32], [62, 20], [72, 16], [76, 26], [68, 42], [58, 62], [72, 52], [80, 42], [88, 48], [84, 58], [62, 78], [58, 96]],
            true,
            0.8,
          ),
          stroke: "pink",
          fill: "pink-tint",
        },
      ],
    },
    { id: "polyps", label: "polyps", shapes: [[18, 30], [42, 16], [68, 26], [42, 70]].map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 2.5, ry: 2.5, stroke: "pink", fill: "pink", width: 0.8 })) },
  ],
  anchors: { center: [46, 54], top: [44, 4], bottom: [46, 96], left: [10, 32], right: [88, 50], base: [46, 92], branches: [42, 24] },
};

export const jellyfish: Block = {
  id: "jellyfish",
  title: "Jellyfish",
  describe: "a jellyfish: domed bell with wavy tentacles hanging below; a soft sea animal",
  tags: ["jellyfish", "ocean habitat", "invertebrate", "predator", "classification", "food chain"],
  size: [90, 100],
  parts: [
    { id: "tentacles", label: "tentacles", shapes: [22, 38, 54, 70].map((x, i) => ({ type: "path" as const, d: vwave(x, 44, i % 2 ? 94 : 86, 4, 1.5, i * 1.2), stroke: "purple" })) },
    { id: "bell", label: "bell", shapes: [{ type: "path", d: "M8 48 C 6 10, 84 10, 82 48 Q 73 40 64 48 Q 55 40 45 48 Q 35 40 26 48 Q 17 40 8 48 Z", stroke: "purple", fill: "purple-tint" }] },
  ],
  anchors: { center: [45, 50], top: [45, 19], bottom: [46, 94], left: [8, 44], right: [82, 44], bell: [45, 32], tentacles: [46, 74] },
};
