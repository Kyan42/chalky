import { cubicAt, oval, smooth, wave, type P } from "../geometry";
import type { Block, Shape } from "../types";

const f = (v: number) => v.toFixed(1);
const at = (p: P) => `${f(p[0])} ${f(p[1])}`;
/** A smooth curve through the points, continuing a path (starts with L, not M). */
const onward = (points: P[]) => smooth(points).replace(/^M/, "L");
/** A closed band between a top edge (left to right) and a bottom edge (left to right). */
const band = (top: P[], bottom: P[]) => smooth(top) + " " + onward([...bottom].reverse()) + " Z";
const line = (d: string, stroke: string, width = 0.8): Shape => ({ type: "path", d, stroke, width });

// ---------------------------------------------------------------- heart

export const heart: Block = {
  id: "heart",
  title: "Heart",
  describe: "a human heart with the aorta arching out of the top, the vena cava and a septum between its left and right sides",
  tags: ["heart", "circulation", "blood", "aorta", "ventricle", "atrium", "pump"],
  size: [100, 100],
  parts: [
    {
      id: "vena-cava",
      label: "vena cava",
      shapes: [{ type: "path", d: "M22 44 L 22 8 M36 36 L 36 8", stroke: "blue" }],
    },
    {
      id: "aorta",
      label: "aorta",
      shapes: [{ type: "path", d: "M46 34 L 46 22 C 46 10, 54 4, 66 4 C 78 4, 88 10, 88 22 L 88 32 L 76 32 L 76 22 C 76 18, 72 16, 66 16 C 60 16, 58 18, 58 24 L 58 32", stroke: "red", fill: "red-tint" }],
    },
    {
      id: "heart",
      label: "heart",
      shapes: [{ type: "path", d: "M50 36 C 38 26, 12 28, 12 52 C 12 72, 34 86, 54 96 C 72 86, 90 70, 88 50 C 86 30, 62 28, 50 36 Z", stroke: "red", fill: "red-tint" }],
    },
    { id: "septum", label: "septum", shapes: [line("M52 46 C 50 60, 52 74, 56 86", "red")] },
  ],
  anchors: {
    center: [50, 62], top: [50, 4], bottom: [54, 96], left: [12, 52], right: [88, 50],
    aorta: [82, 10], "vena-cava": [29, 10], "right-side": [32, 60], "left-side": [72, 60],
  },
};

// ---------------------------------------------------------------- lungs

export const lungs: Block = {
  id: "lungs",
  title: "Lungs",
  describe: "a pair of lungs with the windpipe splitting into two bronchi; breathing and gas exchange",
  tags: ["lungs", "breathing", "respiration", "bronchi", "trachea", "gas exchange", "oxygen"],
  size: [100, 100],
  parts: [
    {
      id: "right-lung",
      label: "right lung",
      shapes: [{ type: "path", d: "M40 30 C 30 20, 12 30, 8 56 C 4 82, 12 96, 26 94 C 36 92, 42 90, 42 80 L 42 36 C 42 33, 41 31, 40 30 Z", stroke: "pink", fill: "pink-tint" }],
    },
    {
      id: "left-lung",
      label: "left lung",
      shapes: [{ type: "path", d: "M60 30 C 70 20, 88 30, 92 56 C 96 82, 88 96, 74 94 C 64 92, 60 88, 62 80 C 66 72, 66 64, 60 60 L 58 36 C 58 33, 59 31, 60 30 Z", stroke: "pink", fill: "pink-tint" }],
    },
    { id: "trachea", label: "trachea", shapes: [{ type: "path", d: "M50 4 L 50 42", stroke: "blue" }] },
    { id: "bronchi", label: "bronchi", shapes: [line("M50 42 C 42 46, 34 52, 28 64 M50 42 C 58 46, 66 52, 74 64", "blue")] },
  ],
  anchors: {
    center: [50, 60], top: [50, 4], bottom: [50, 94], left: [6, 60], right: [94, 60],
    trachea: [50, 16], "right-lung": [24, 66], "left-lung": [78, 70], bronchi: [36, 52],
  },
};

// ---------------------------------------------------------------- brain

export const brain: Block = {
  id: "brain",
  title: "Brain",
  describe: "a human brain from the side: folded cerebrum, cerebellum at the back and the brainstem below",
  tags: ["brain", "nervous system", "cerebrum", "cerebellum", "neurons", "thinking"],
  size: [100, 84],
  parts: [
    { id: "brainstem", label: "brainstem", shapes: [{ type: "path", d: "M54 62 C 56 70, 56 76, 54 82 M66 62 C 66 70, 66 76, 68 82", stroke: "pink" }] },
    {
      id: "cerebellum",
      label: "cerebellum",
      shapes: [{ type: "path", d: oval(78, 60, 15, 10, -10), stroke: "pink", fill: "pink-tint" }],
    },
    {
      id: "cerebrum",
      label: "cerebrum",
      shapes: [{ type: "path", d: smooth([[8, 40], [14, 20], [34, 7], [58, 5], [80, 11], [94, 28], [92, 46], [76, 52], [56, 60], [30, 60], [12, 54]], true), stroke: "pink", fill: "pink-tint" }],
    },
    {
      id: "folds",
      label: "folds",
      shapes: [
        line(wave(24, 78, 24, 5, 2.5), "pink"),
        line("M22 46 C 34 38, 48 42, 60 36", "pink"),
      ],
    },
  ],
  anchors: {
    center: [50, 34], top: [55, 5], bottom: [60, 82], left: [8, 40], right: [94, 30],
    cerebrum: [40, 30], cerebellum: [80, 62], brainstem: [60, 76], front: [10, 36],
  },
};

// ---------------------------------------------------------------- stomach

export const stomach: Block = {
  id: "stomach",
  title: "Stomach",
  describe: "a J-shaped stomach with the oesophagus coming in at the top and the small intestine leaving at the bottom",
  tags: ["stomach", "digestion", "oesophagus", "acid", "enzymes", "food"],
  size: [100, 100],
  parts: [
    {
      id: "stomach",
      label: "stomach",
      shapes: [{
        type: "path",
        d: "M42 4 L 42 24 C 44 40, 50 56, 36 60 L 22 60 C 14 62, 8 66, 6 76 L 6 96 L 20 96 L 20 80 C 20 76, 22 74, 28 74 C 42 80, 58 90, 74 82 C 90 74, 94 50, 88 32 C 84 16, 68 10, 56 18 L 56 4",
        stroke: "pink", fill: "pink-tint",
      }],
    },
    { id: "folds", label: "stomach lining folds", shapes: [line("M62 32 C 70 42, 76 54, 74 66", "pink")] },
  ],
  anchors: {
    center: [64, 52], top: [49, 4], bottom: [13, 96], left: [6, 80], right: [91, 48],
    oesophagus: [49, 10], "small-intestine": [13, 92], fundus: [72, 22],
  },
};

// ---------------------------------------------------------------- liver

const liverEdge = (t: number) => cubicAt([40, 58], [30, 62], [18, 64], [8, 52], t);
const gallEnd = liverEdge(0.4);

export const liver: Block = {
  id: "liver",
  title: "Liver",
  describe: "a liver: a big right lobe and a smaller left lobe, with the green gall bladder tucked underneath",
  tags: ["liver", "digestion", "bile", "gall bladder", "detox", "organ"],
  size: [100, 82],
  parts: [
    {
      id: "liver",
      label: "liver",
      shapes: [{ type: "path", d: "M8 24 C 20 8, 60 6, 94 14 C 98 18, 94 24, 86 28 C 70 40, 54 52, 40 58 C 30 62, 18 64, 8 52 C 4 44, 4 32, 8 24 Z", stroke: "brown", fill: "brown-tint" }],
    },
    { id: "lobes", label: "lobe divide", shapes: [line("M58 12 C 56 24, 52 34, 46 46", "brown")] },
    {
      id: "gall-bladder",
      label: "gall bladder",
      shapes: [{ type: "path", d: `M40 58 C 46 70, 40 80, 33 79 C 26 78, 24 70, ${at(gallEnd)}`, stroke: "green", fill: "green-tint" }],
    },
  ],
  anchors: {
    center: [44, 34], top: [50, 9], bottom: [34, 79], left: [5, 38], right: [95, 16],
    "right-lobe": [28, 34], "left-lobe": [72, 22], "gall-bladder": [34, 72],
  },
};

// ---------------------------------------------------------------- kidney

export const kidney: Block = {
  id: "kidney",
  title: "Kidney",
  describe: "a bean-shaped kidney with its artery, vein and the ureter leading down to the bladder",
  tags: ["kidney", "excretion", "urine", "filtering", "ureter", "nephron"],
  size: [84, 100],
  parts: [
    {
      id: "kidney",
      label: "kidney",
      shapes: [{ type: "path", d: "M32 4 C 12 4, 6 28, 6 48 C 6 70, 12 92, 32 92 C 48 92, 54 80, 50 68 C 46 58, 46 44, 50 34 C 54 20, 50 4, 32 4 Z", stroke: "brown", fill: "red-tint" }],
    },
    { id: "medulla", label: "medulla", shapes: [line("M34 24 C 25 26, 23 40, 23 48 C 23 58, 25 70, 34 74", "brown")] },
    { id: "artery", label: "renal artery", shapes: [line("M49 38 L 80 30", "red", 1)] },
    { id: "vein", label: "renal vein", shapes: [line("M48 52 L 80 50", "blue", 1)] },
    { id: "ureter", label: "ureter", shapes: [line("M50 66 C 60 74, 62 84, 62 98", "orange", 1)] },
  ],
  anchors: {
    center: [30, 48], top: [32, 4], bottom: [62, 98], left: [6, 48], right: [80, 40],
    artery: [78, 31], vein: [78, 50], ureter: [61, 88], cortex: [12, 48],
  },
};

// ---------------------------------------------------------------- intestines

export const intestines: Block = {
  id: "intestines",
  title: "Intestines",
  describe: "the intestines: the large intestine framing the coiled small intestine; digestion and absorption",
  tags: ["intestines", "digestion", "absorption", "small intestine", "large intestine", "gut"],
  size: [100, 100],
  parts: [
    {
      id: "large-intestine",
      label: "large intestine",
      shapes: [{ type: "path", d: "M4 96 L 4 18 C 4 10, 10 4, 18 4 L 82 4 C 90 4, 96 10, 96 18 L 96 96 L 82 96 L 82 24 C 82 20, 80 18, 76 18 L 24 18 C 20 18, 18 20, 18 24 L 18 96 Z", stroke: "pink", fill: "pink-tint" }],
    },
    {
      id: "small-intestine",
      label: "small intestine",
      shapes: [{ type: "path", d: "M36 32 L 62 32 C 71 32, 71 46, 62 46 L 38 46 C 29 46, 29 60, 38 60 L 62 60 C 71 60, 71 74, 62 74 L 38 74 C 29 74, 29 88, 38 88 L 66 88", stroke: "pink" }],
    },
  ],
  anchors: {
    center: [50, 56], top: [50, 4], bottom: [50, 96], left: [4, 56], right: [96, 56],
    "large-intestine": [50, 11], "small-intestine": [50, 60], colon: [89, 50],
  },
};

// ---------------------------------------------------------------- bladder

export const bladder: Block = {
  id: "bladder",
  title: "Bladder",
  describe: "the bladder: a round bag filled by two ureters from the kidneys and emptied through the urethra",
  tags: ["bladder", "urine", "excretion", "ureter", "urethra", "kidney"],
  size: [100, 100],
  parts: [
    { id: "ureters", label: "ureters", shapes: [line("M22 42 C 16 30, 14 16, 12 4 M78 42 C 84 30, 86 16, 88 4", "orange", 1)] },
    {
      id: "bladder",
      label: "bladder",
      shapes: [{ type: "path", d: "M50 32 C 76 26, 90 46, 86 64 C 82 80, 66 88, 50 88 C 34 88, 18 80, 14 64 C 10 46, 24 26, 50 32 Z", stroke: "pink", fill: "yellow-tint" }],
    },
    { id: "urethra", label: "urethra", shapes: [{ type: "path", d: "M50 88 L 50 99", stroke: "pink" }] },
  ],
  anchors: {
    center: [50, 60], top: [50, 4], bottom: [50, 99], left: [14, 62], right: [86, 62],
    ureter: [14, 14], urethra: [50, 96], urine: [50, 62],
  },
};

// ---------------------------------------------------------------- pancreas

export const pancreas: Block = {
  id: "pancreas",
  title: "Pancreas",
  describe: "the pancreas: a long gland with a broad head and tapering tail, and the duct running through it",
  tags: ["pancreas", "insulin", "enzymes", "digestion", "hormones", "gland"],
  size: [100, 60],
  parts: [
    {
      id: "pancreas",
      label: "pancreas",
      shapes: [{ type: "path", d: "M6 30 C 4 12, 20 4, 34 10 C 50 16, 70 6, 88 8 C 98 10, 98 26, 88 30 C 72 34, 54 44, 38 50 C 20 56, 8 48, 6 30 Z", stroke: "pink", fill: "yellow-tint" }],
    },
    { id: "duct", label: "pancreatic duct", shapes: [line("M18 34 C 38 30, 62 22, 84 19", "orange")] },
  ],
  anchors: {
    center: [48, 28], top: [50, 9], bottom: [30, 52], left: [5, 30], right: [96, 18],
    head: [18, 28], tail: [86, 19], duct: [50, 27],
  },
};

// ---------------------------------------------------------------- eye

export const eye: Block = {
  id: "eye",
  title: "Eye",
  describe: "a human eye from the front: almond-shaped lids, a blue iris and a dark pupil",
  tags: ["eye", "sight", "vision", "iris", "pupil", "senses"],
  size: [100, 64],
  parts: [
    { id: "eyelids", label: "eyelids", shapes: [{ type: "path", d: "M4 32 C 26 -4, 74 -4, 96 32 C 74 68, 26 68, 4 32 Z", stroke: "ink", fill: "board" }] },
    { id: "iris", label: "iris", shapes: [{ type: "ellipse", cx: 50, cy: 32, rx: 16, ry: 16, stroke: "blue", fill: "blue-tint" }] },
    { id: "pupil", label: "pupil", shapes: [{ type: "ellipse", cx: 50, cy: 32, rx: 5, ry: 5, stroke: "ink" }] },
  ],
  anchors: {
    center: [50, 32], top: [50, 5], bottom: [50, 59], left: [4, 32], right: [96, 32],
    iris: [62, 22], pupil: [50, 32], "eye-white": [80, 32],
  },
};

// ---------------------------------------------------------------- ear

export const ear: Block = {
  id: "ear",
  title: "Ear",
  describe: "an outer ear from the side: the curled rim, the earlobe and the opening of the ear canal",
  tags: ["ear", "hearing", "sound", "senses", "ear canal", "earlobe"],
  size: [72, 100],
  parts: [
    {
      id: "ear",
      label: "outer ear",
      shapes: [{ type: "path", d: "M14 36 C 12 14, 28 2, 44 4 C 62 6, 70 22, 64 42 C 60 56, 50 62, 48 76 C 46 90, 38 98, 28 96 C 20 94, 16 88, 18 80", stroke: "pink", fill: "pink-tint" }],
    },
    { id: "rim", label: "ear rim", shapes: [line("M28 34 C 28 22, 36 16, 44 18 C 54 20, 54 34, 48 42 C 42 50, 36 56, 36 66", "pink")] },
    { id: "canal", label: "ear canal", shapes: [line("M14 52 C 22 50, 26 58, 22 66", "pink", 1)] },
  ],
  anchors: {
    center: [38, 50], top: [42, 4], bottom: [30, 96], left: [12, 50], right: [66, 34],
    canal: [18, 58], lobe: [34, 88], rim: [58, 20],
  },
};

// ---------------------------------------------------------------- tooth

export const tooth: Block = {
  id: "tooth",
  title: "Tooth",
  describe: "a molar tooth: the crown above the gum line, two roots below and the pulp inside",
  tags: ["tooth", "teeth", "enamel", "molar", "dentist", "digestion"],
  size: [80, 100],
  parts: [
    {
      id: "crown",
      label: "crown",
      shapes: [{ type: "path", d: "M14 22 C 14 6, 30 4, 40 12 C 50 4, 66 6, 66 22 C 66 36, 64 46, 62 56 L 18 56 C 16 46, 14 36, 14 22 Z", stroke: "ink", fill: "board" }],
    },
    {
      id: "root",
      label: "roots",
      shapes: [{ type: "path", d: "M18 56 C 18 70, 20 84, 24 92 C 28 98, 34 96, 34 86 C 34 78, 36 70, 40 70 C 44 70, 46 78, 46 86 C 46 96, 52 98, 56 92 C 60 84, 62 70, 62 56", stroke: "ink", fill: "board" }],
    },
    { id: "pulp", label: "pulp", shapes: [{ type: "rect", x: 30, y: 26, w: 20, h: 16, r: 7, stroke: "pink", fill: "pink-tint", width: 0.8 }] },
  ],
  anchors: {
    center: [40, 50], top: [40, 6], bottom: [40, 96], left: [14, 30], right: [66, 30],
    crown: [24, 20], root: [26, 82], pulp: [40, 34],
  },
};

// ---------------------------------------------------------------- tongue

export const tongue: Block = {
  id: "tongue",
  title: "Tongue",
  describe: "a tongue seen from above, with the groove down its middle; taste",
  tags: ["tongue", "taste", "senses", "taste buds", "mouth", "digestion"],
  size: [80, 100],
  parts: [
    {
      id: "tongue",
      label: "tongue",
      shapes: [{ type: "path", d: "M12 12 C 26 4, 54 4, 68 12 C 76 40, 74 76, 56 90 C 46 98, 34 98, 24 90 C 6 76, 4 40, 12 12 Z", stroke: "pink", fill: "pink-tint" }],
    },
    { id: "groove", label: "midline groove", shapes: [line("M40 22 C 40 42, 40 56, 40 70", "pink")] },
  ],
  anchors: {
    center: [40, 50], top: [40, 7], bottom: [40, 96], left: [8, 46], right: [72, 46],
    tip: [40, 88], back: [40, 14], side: [64, 60],
  },
};

// ---------------------------------------------------------------- skin

const surface: P[] = [[8, 22], [22, 18], [36, 24], [50, 19], [64, 24], [78, 18], [92, 22]];
const epiBase: P[] = [[8, 38], [22, 34], [36, 40], [50, 35], [64, 40], [78, 34], [92, 38]];
const fatTop: P[] = [[8, 66], [92, 66]];

export const skin: Block = {
  id: "skin",
  title: "Skin",
  describe: "a cut-away block of skin: epidermis on top, dermis with a hair and blood vessel, fatty layer below",
  tags: ["skin", "epidermis", "dermis", "hair", "sweat", "temperature", "organ"],
  size: [100, 100],
  parts: [
    { id: "epidermis", label: "epidermis", shapes: [{ type: "path", d: band(surface, epiBase), stroke: "pink", fill: "pink-tint" }] },
    { id: "dermis", label: "dermis", shapes: [{ type: "path", d: band(epiBase, fatTop), stroke: "pink", fill: "red-tint" }] },
    { id: "fat", label: "fat layer", shapes: [{ type: "path", d: "M8 66 L 92 66 L 92 96 L 8 96 Z", stroke: "orange", fill: "yellow-tint" }] },
    {
      id: "fat-cells",
      label: "fat cells",
      shapes: [26, 50, 74].map((cx) => ({ type: "ellipse" as const, cx, cy: 81, rx: 7, ry: 6, stroke: "orange", width: 0.8 })),
    },
    { id: "blood-vessel", label: "blood vessel", shapes: [line(wave(58, 88, 52, 3, 1.5), "red")] },
    { id: "hair", label: "hair", shapes: [line("M42 60 C 40 44, 36 24, 30 4", "brown")] },
  ],
  anchors: {
    center: [50, 50], top: [50, 18], bottom: [50, 96], left: [8, 50], right: [92, 50],
    epidermis: [70, 30], dermis: [20, 52], fat: [62, 81], hair: [31, 8],
  },
};

// ---------------------------------------------------------------- bone

export const bone: Block = {
  id: "bone",
  title: "Bone",
  describe: "a long bone: a straight shaft with a knobbly end at each side",
  tags: ["bone", "skeleton", "calcium", "marrow", "support", "joint"],
  size: [100, 50],
  parts: [
    {
      id: "bone",
      label: "bone",
      shapes: [{
        type: "path",
        d: "M22 15 L 78 15 C 80 4, 94 2, 96 12 C 98 18, 95 23, 92 25 C 95 27, 98 32, 96 38 C 94 48, 80 46, 78 35 L 22 35 C 20 46, 6 48, 4 38 C 2 32, 5 27, 8 25 C 5 23, 2 18, 4 12 C 6 2, 20 4, 22 15 Z",
        stroke: "ink", fill: "board",
      }],
    },
  ],
  anchors: {
    center: [50, 25], top: [50, 15], bottom: [50, 35], left: [3, 25], right: [97, 25],
    shaft: [50, 25], "left-end": [12, 25], "right-end": [88, 25],
  },
};

// ---------------------------------------------------------------- muscle (flexed biceps)

export const muscle: Block = {
  id: "muscle",
  title: "Muscle",
  describe: "a flexed arm with the biceps muscle bulging on the upper arm; muscles and movement",
  tags: ["muscle", "biceps", "arm", "movement", "exercise", "contraction"],
  size: [100, 96],
  parts: [
    {
      id: "arm",
      label: "arm",
      shapes: [{
        type: "path",
        d: "M6 54 C 14 34, 38 20, 56 34 C 64 40, 68 48, 70 56 C 68 46, 64 38, 64 30 C 58 22, 60 6, 74 4 C 88 2, 98 14, 92 26 C 90 30, 88 32, 88 36 C 90 52, 94 70, 88 80 C 84 88, 76 92, 66 92 L 6 92 Z",
        stroke: "pink", fill: "pink-tint",
      }],
    },
    { id: "biceps", label: "biceps", shapes: [{ type: "path", d: oval(36, 62, 22, 12, -12), stroke: "red", fill: "red-tint", width: 0.8 }] },
  ],
  anchors: {
    center: [50, 56], top: [74, 4], bottom: [40, 92], left: [6, 72], right: [94, 60],
    biceps: [36, 62], elbow: [86, 84], fist: [78, 16],
  },
};

// ---------------------------------------------------------------- blood vessel

export const bloodVessel: Block = {
  id: "blood-vessel",
  title: "Blood Vessel",
  describe: "a cut-open blood vessel: a tube with a thick wall around the hollow lumen that blood flows through",
  tags: ["blood vessel", "artery", "vein", "circulation", "blood", "lumen"],
  size: [100, 64],
  parts: [
    {
      id: "wall",
      label: "vessel wall",
      shapes: [
        { type: "path", d: "M22 5 L 84 5 C 98 5, 98 59, 84 59 L 22 59", stroke: "red", fill: "red-tint" },
        { type: "ellipse", cx: 22, cy: 32, rx: 18, ry: 27, stroke: "red", fill: "red-tint" },
      ],
    },
    { id: "lumen", label: "lumen", shapes: [{ type: "ellipse", cx: 22, cy: 32, rx: 7, ry: 14, stroke: "red", fill: "board", width: 0.8 }] },
    { id: "flow", label: "blood flow", shapes: [line("M54 32 L 84 32 M74 22 L 84 32 L 74 42", "red")] },
  ],
  anchors: {
    center: [50, 32], top: [55, 5], bottom: [55, 59], left: [4, 32], right: [95, 32],
    lumen: [22, 32], wall: [60, 5], flow: [84, 32],
  },
};

// ---------------------------------------------------------------- spine

// A side view: four vertebrae stacked along the spine's gentle S-curve, each a rounded block with its
// bony spur pointing back (to the right), wide gaps between them (the discs) so thick chalk keeps them apart.
const spineRows: [number, number][] = [[4, 6], [30, 1], [56, 2], [82, 8]];
const vertebra = (y: number, dx: number): Shape[] => [
  { type: "rect", x: 6 + dx, y, w: 30, h: 14, r: 4, stroke: "ink", fill: "grey-tint" },
  { type: "path", d: `M${36 + dx} ${y + 7} L ${52 + dx} ${y + 14}`, stroke: "ink" },
];

export const spine: Block = {
  id: "spine",
  title: "Spine",
  describe: "a side view of the backbone: a curved stack of vertebrae with their bony spurs at the back",
  tags: ["spine", "backbone", "vertebrae", "skeleton", "spinal cord", "posture"],
  size: [64, 100],
  parts: spineRows.map(([y, dx], i) => ({ id: `vertebra-${i + 1}`, label: "vertebra", shapes: vertebra(y, dx) })),
  anchors: {
    center: [26, 50], top: [26, 4], bottom: [28, 93], left: [6, 50], right: [58, 50],
    vertebra: [20, 48], "upper-back": [26, 10], "lower-back": [28, 86], spur: [52, 50],
  },
};
