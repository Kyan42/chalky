import { pill, poly, type P } from "../geometry";
import type { Block } from "../types";

const f = (v: number) => v.toFixed(1);
const pt = (p: P) => `${f(p[0])} ${f(p[1])}`;
const mirror = (d: string, w: number) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f(w - +x)} ${y}`);

export const body: Block = {
  id: "body",
  title: "Human Body",
  describe: "a simple standing human outline, front view, with head, arms, chest and legs",
  tags: ["human body", "person", "anatomy", "organs", "health", "organ systems"],
  size: [64, 100],
  parts: [
    { id: "arms", label: "arms", shapes: [{ type: "path", d: pill(19, 30, 7, 58, 5.5), stroke: "pink", fill: "pink-tint" }, { type: "path", d: pill(45, 30, 57, 58, 5.5), stroke: "pink", fill: "pink-tint" }] },
    { id: "legs", label: "legs", shapes: [{ type: "path", d: pill(26, 56, 20, 92, 6), stroke: "pink", fill: "pink-tint" }, { type: "path", d: pill(38, 56, 44, 92, 6), stroke: "pink", fill: "pink-tint" }] },
    { id: "chest", label: "chest", shapes: [{ type: "path", d: "M18 30 C 18 25, 21 24, 26 24 L 38 24 C 43 24, 46 25, 46 30 L 44 58 C 40 62, 24 62, 20 58 Z", stroke: "pink", fill: "pink-tint" }] },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 32, cy: 12, rx: 9.5, ry: 10, stroke: "pink", fill: "pink-tint" }] },
  ],
  anchors: { center: [32, 46], top: [32, 2], bottom: [32, 98], left: [4, 50], right: [60, 50], head: [32, 12], chest: [32, 34], stomach: [32, 50], knee: [23, 76] },
};

// Fingers fanned around a pivot below the palm; the outline runs wrist → thumb → fingers → wrist.
function digit(b: P, deg: number, len: number, w: number): string {
  const a = (deg * Math.PI) / 180;
  const d: P = [Math.sin(a), -Math.cos(a)], n: P = [Math.cos(a), Math.sin(a)];
  const at = (s: number, t: number): P => [b[0] + n[0] * s + d[0] * t, b[1] + n[1] * s + d[1] * t];
  return `L${pt(at(-w, 0))} L${pt(at(-w, len))} Q${pt(at(-w, len + w))} ${pt(at(0, len + w))} Q${pt(at(w, len + w))} ${pt(at(w, len))} L${pt(at(w, 0))}`;
}
const pivot: P = [50, 92];
const fingers = [[-25, 34], [-8.5, 40], [8.5, 37], [25, 28]].map(([deg, len]) => {
  const a = (deg * Math.PI) / 180;
  return digit([pivot[0] + Math.sin(a) * 40, pivot[1] - Math.cos(a) * 40], deg, len, 6);
});
const handOutline = `M34 98 L 28 80 ${digit([25, 70], -55, 20, 7)} ${fingers.join(" ")} L 74 82 L 66 98 Z`;

export const hand: Block = {
  id: "hand",
  title: "Hand",
  describe: "an open human hand with palm, four fingers and a thumb",
  tags: ["hand", "fingers", "touch", "human body", "skeleton", "senses"],
  size: [90, 100],
  parts: [
    { id: "hand", label: "hand", shapes: [{ type: "path", d: handOutline, stroke: "pink", fill: "pink-tint" }] },
    { id: "palm", label: "palm", shapes: [{ type: "path", d: "M38 86 C 34 78, 34 70, 38 62", stroke: "pink", width: 0.8 }] },
  ],
  anchors: { center: [48, 60], top: [46, 6], bottom: [50, 98], left: [6, 52], right: [86, 40], palm: [52, 72], thumb: [12, 50], fingers: [48, 28], wrist: [50, 96] },
};

export const foot: Block = {
  id: "foot",
  title: "Foot",
  describe: "a human foot from the side: ankle, heel, sole and toes",
  tags: ["foot", "toes", "heel", "human body", "walking", "skeleton"],
  size: [100, 72],
  parts: [
    { id: "foot", label: "foot", shapes: [{ type: "path", d: "M20 4 L 20 32 C 20 42, 10 46, 10 56 C 10 64, 16 68, 26 68 L 84 68 C 96 68, 98 56, 90 52 C 74 46, 58 40, 48 30 C 42 24, 40 14, 42 4", stroke: "pink", fill: "pink-tint" }] },
    { id: "toes", label: "toes", shapes: [{ type: "path", d: "M78 51 C 81 56, 81 63, 78 68", stroke: "pink", width: 0.8 }] },
  ],
  anchors: { center: [50, 52], top: [31, 4], bottom: [50, 68], left: [10, 56], right: [96, 60], ankle: [31, 26], heel: [14, 62], toes: [88, 60], sole: [50, 68] },
};

export const skull: Block = {
  id: "skull",
  title: "Skull",
  describe: "a human skull, front view: cranium, eye sockets, nose hole and teeth",
  tags: ["skull", "bone", "skeleton", "head", "brain", "cranium"],
  size: [86, 100],
  parts: [
    { id: "cranium", label: "skull", shapes: [{ type: "path", d: "M43 6 C 66 6, 80 22, 80 44 C 80 56, 75 62, 68 64 L 68 80 C 68 88, 60 94, 43 94 C 26 94, 18 88, 18 80 L 18 64 C 11 62, 6 56, 6 44 C 6 22, 20 6, 43 6 Z", stroke: "ink", fill: "board" }] },
    { id: "eye-sockets", label: "eye sockets", shapes: [{ type: "ellipse", cx: 28, cy: 44, rx: 9, ry: 10, stroke: "ink", fill: "grey-tint" }, { type: "ellipse", cx: 58, cy: 44, rx: 9, ry: 10, stroke: "ink", fill: "grey-tint" }] },
    { id: "nose", label: "nasal cavity", shapes: [{ type: "path", d: "M43 58 L 37 68 L 49 68 Z", stroke: "ink", fill: "grey-tint", width: 0.8 }] },
    { id: "teeth", label: "teeth", shapes: ["M24 80 L 62 80", "M31 74 L 31 86", "M43 74 L 43 87", "M55 74 L 55 86"].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })) },
  ],
  anchors: { center: [43, 50], top: [43, 6], bottom: [43, 94], left: [6, 44], right: [80, 44], cranium: [43, 22], "eye-socket": [28, 44], jaw: [43, 88], teeth: [43, 80] },
};

const rib = (y: number, out: number, drop: number) => `M45 ${y} C ${45 - out * 0.5} ${y - 6}, ${50 - out} ${y - 2}, ${50 - out} ${y + drop}`;
const ribsLeft = [rib(26, 32, 12), rib(46, 38, 14), rib(66, 36, 14)];

export const ribcage: Block = {
  id: "ribcage",
  title: "Ribcage",
  describe: "a ribcage, front view: breastbone in the middle, collarbones and curved ribs either side",
  tags: ["ribs", "ribcage", "bone", "skeleton", "chest", "breathing"],
  size: [100, 90],
  parts: [
    { id: "collarbones", label: "collarbones", shapes: ["M46 10 C 36 6, 24 8, 12 12", "M54 10 C 64 6, 76 8, 88 12"].map((d) => ({ type: "path" as const, d, stroke: "ink" })) },
    { id: "sternum", label: "breastbone", shapes: [{ type: "path", d: "M50 14 L 50 62", stroke: "ink" }] },
    { id: "ribs", label: "ribs", shapes: [...ribsLeft, ...ribsLeft.map((d) => mirror(d, 100))].map((d) => ({ type: "path" as const, d, stroke: "ink" })) },
  ],
  anchors: { center: [50, 46], top: [50, 6], bottom: [50, 84], left: [10, 56], right: [90, 56], sternum: [50, 36], ribs: [22, 44], collarbone: [26, 8] },
};

const skelLeft = {
  arm: poly([[10, 26], [5, 45], [3, 63]]),
  leg: poly([[26, 68], [24, 82], [23, 96], [15, 97]]),
};

export const skeleton: Block = {
  id: "skeleton",
  title: "Skeleton",
  describe: "a whole simple human skeleton: skull, spine, ribs, arms, pelvis and legs",
  tags: ["skeleton", "bones", "human body", "support", "movement", "joints"],
  size: [64, 100],
  parts: [
    { id: "shoulders", label: "collarbones", shapes: [{ type: "path", d: "M10 26 L 54 26", stroke: "ink", width: 0.8 }] },
    // One bold ribcage outline: separate ribs merge into a smudge at this chalk weight.
    { id: "ribs", label: "ribcage", shapes: [{ type: "ellipse", cx: 32, cy: 42, rx: 15, ry: 12, stroke: "ink", width: 0.8, fill: "board" }] },
    { id: "spine", label: "spine", shapes: [{ type: "path", d: "M32 22 L 32 62", stroke: "ink", width: 0.8 }] },
    { id: "arms", label: "arm bones", shapes: [skelLeft.arm, mirror(skelLeft.arm, 64)].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })) },
    { id: "pelvis", label: "pelvis", shapes: [{ type: "path", d: "M22 61 C 22 70, 42 70, 42 61 Z", stroke: "ink", fill: "board" }] },
    { id: "legs", label: "leg bones", shapes: [skelLeft.leg, mirror(skelLeft.leg, 64)].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })) },
    { id: "skull", label: "skull", shapes: [{ type: "ellipse", cx: 32, cy: 12, rx: 9.5, ry: 10, stroke: "ink", fill: "board" }] },
  ],
  anchors: { center: [32, 50], top: [32, 2], bottom: [32, 98], left: [6, 60], right: [58, 60], skull: [32, 12], ribs: [32, 42], pelvis: [32, 63], legs: [23, 82] },
};

export const knee: Block = {
  id: "knee",
  title: "Knee Joint",
  describe: "a knee joint: thigh bone above, shin bone below, cartilage cushioning the gap between them",
  tags: ["knee", "joint", "bone", "cartilage", "skeleton", "movement"],
  size: [70, 100],
  parts: [
    { id: "femur", label: "femur (thigh bone)", shapes: [{ type: "path", d: "M26 2 L 26 20 C 18 22, 13 28, 13 34 C 13 40, 22 41, 35 40 C 48 41, 57 40, 57 34 C 57 28, 52 22, 44 20 L 44 2", stroke: "ink", fill: "board" }] },
    { id: "cartilage", label: "cartilage", shapes: [{ type: "ellipse", cx: 35, cy: 52, rx: 22, ry: 3.5, stroke: "blue", fill: "blue-tint" }] },
    { id: "tibia", label: "tibia (shin bone)", shapes: [{ type: "path", d: "M26 98 L 26 80 C 24 74, 12 72, 12 68 C 12 64, 58 64, 58 68 C 58 72, 46 74, 44 80 L 44 98", stroke: "ink", fill: "board" }] },
  ],
  anchors: { center: [35, 52], top: [35, 2], bottom: [35, 98], left: [10, 52], right: [60, 52], femur: [35, 16], tibia: [35, 86], cartilage: [35, 52], joint: [58, 52] },
};

export const trachea: Block = {
  id: "trachea",
  title: "Trachea",
  describe: "the windpipe (trachea) with cartilage rings, splitting into two bronchi towards the lungs",
  tags: ["trachea", "windpipe", "bronchi", "breathing", "lungs", "respiratory system"],
  size: [80, 100],
  parts: [
    { id: "trachea", label: "trachea (windpipe)", shapes: [{ type: "path", d: "M31 4 L 31 50 C 27 57, 16 70, 6 84 L 17 92 C 26 79, 34 68, 40 63 C 46 68, 54 79, 63 92 L 74 84 C 64 70, 53 57, 49 50 L 49 4", stroke: "blue", fill: "blue-tint" }] },
    { id: "rings", label: "cartilage rings", shapes: ["M31 16 L 49 16", "M31 29 L 49 29", "M31 42 L 49 42"].map((d) => ({ type: "path" as const, d, stroke: "blue", width: 0.8 })) },
    { id: "bronchi", label: "bronchi", shapes: ["M17 72 L 27 80", "M63 72 L 53 80"].map((d) => ({ type: "path" as const, d, stroke: "blue", width: 0.8 })) },
  ],
  anchors: { center: [40, 50], top: [40, 4], bottom: [40, 92], left: [8, 86], right: [72, 86], windpipe: [40, 24], "left-bronchus": [12, 88], "right-bronchus": [68, 88], fork: [40, 60] },
};

export const mouth: Block = {
  id: "mouth",
  title: "Mouth",
  describe: "an open mouth with lips, a row of top teeth and the tongue; where digestion starts",
  tags: ["mouth", "teeth", "tongue", "digestion", "eating", "taste"],
  size: [100, 74],
  parts: [
    { id: "lips", label: "lips", shapes: [{ type: "path", d: "M8 18 C 30 12, 70 12, 92 18 C 88 50, 72 70, 50 70 C 28 70, 12 50, 8 18 Z", stroke: "pink", fill: "red-tint" }] },
    {
      id: "teeth",
      label: "teeth",
      shapes: [
        { type: "path", d: "M16 20 C 34 17, 66 17, 84 20 L 80 36 C 64 33, 36 33, 20 36 Z", stroke: "ink", fill: "board" },
        ...["M36 19 L 36 33", "M50 18 L 50 33", "M64 19 L 64 33"].map((d) => ({ type: "path" as const, d, stroke: "ink", width: 0.8 })),
      ],
    },
    { id: "tongue", label: "tongue", shapes: [{ type: "path", d: "M28 62 C 28 46, 72 46, 72 62 C 64 68, 36 68, 28 62 Z", stroke: "red", fill: "pink-tint" }] },
  ],
  anchors: { center: [50, 40], top: [50, 15], bottom: [50, 70], left: [8, 18], right: [92, 18], teeth: [50, 27], tongue: [50, 56], lips: [50, 70] },
};

export const embryo: Block = {
  id: "embryo",
  title: "Embryo",
  describe: "a curled early human embryo or fetus with a big head and umbilical cord",
  tags: ["embryo", "fetus", "pregnancy", "reproduction", "development", "growth"],
  size: [90, 100],
  parts: [
    { id: "cord", label: "umbilical cord", shapes: [{ type: "path", d: "M70 70 C 82 74, 84 86, 88 96", stroke: "pink", width: 0.8 }] },
    { id: "body", label: "body", shapes: [{ type: "path", d: "M30 38 C 14 56, 20 88, 48 92 C 70 94, 84 80, 76 64 C 72 56, 64 54, 62 50 Z", stroke: "pink", fill: "pink-tint" }] },
    { id: "limbs", label: "limb buds", shapes: ["M58 62 C 52 62, 48 58, 48 54", "M62 84 C 54 82, 52 76, 56 72"].map((d) => ({ type: "path" as const, d, stroke: "pink", width: 0.8 })) },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 50, cy: 30, rx: 23, ry: 22, stroke: "pink", fill: "pink-tint" }] },
  ],
  anchors: { center: [48, 54], top: [50, 8], bottom: [48, 92], left: [20, 60], right: [78, 64], head: [50, 30], body: [36, 72], cord: [84, 88] },
};

export const bloodDrop: Block = {
  id: "blood-drop",
  title: "Blood Drop",
  describe: "a single red drop of blood; blood, bleeding, blood type or a blood test",
  tags: ["blood", "circulation", "red blood cells", "plasma", "blood type", "heart"],
  size: [70, 100],
  parts: [
    {
      id: "drop",
      label: "blood",
      shapes: [
        { type: "path", d: "M35 8 C 35 8, 62 46, 62 64 C 62 80, 50 92, 35 92 C 20 92, 8 80, 8 64 C 8 46, 35 8, 35 8 Z", stroke: "red", fill: "red-tint" },
        { type: "path", d: "M20 66 C 20 58, 23 51, 27 45", stroke: "red", width: 0.8 },
      ],
    },
  ],
  anchors: { center: [35, 64], top: [35, 8], bottom: [35, 92], left: [8, 64], right: [62, 64] },
};

export const heartbeat: Block = {
  id: "heartbeat",
  title: "Heartbeat",
  describe: "an ECG heartbeat pulse line with one sharp spike; heart rate, pulse, a living heart",
  tags: ["heartbeat", "pulse", "ECG", "heart", "circulation", "exercise"],
  size: [100, 50],
  parts: [
    { id: "pulse", label: "heartbeat", shapes: [{ type: "path", d: "M2 30 L 20 30 Q 26 20 32 30 L 38 30 L 43 37 L 51 4 L 59 46 L 65 30 L 72 30 Q 80 18 88 30 L 98 30", stroke: "red" }] },
  ],
  anchors: { center: [50, 28], top: [51, 4], bottom: [59, 46], left: [2, 30], right: [98, 30], spike: [51, 4], baseline: [20, 30] },
};
