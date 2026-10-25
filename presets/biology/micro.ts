import { blob, oval, pill, smooth, wave, type P } from "../geometry";
import type { Block, Shape } from "../types";

// A closed tube around a centreline: `at(t)` gives the centre, `hw(t)` the half-width, with rounded ends.
function tube(at: (t: number) => P, hw: (t: number) => number, steps = 14): string {
  const side: P[] = [], back: P[] = [];
  const dir = (t: number): P => {
    const a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01));
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, [x, y] = at(t), [dx, dy] = dir(t), w = hw(t);
    side.push([x - dy * w, y + dx * w]);
    back.unshift([x + dy * w, y - dx * w]);
  }
  const [ex, ey] = at(1), [edx, edy] = dir(1), [sx, sy] = at(0), [sdx, sdy] = dir(0);
  return smooth([...side, [ex + edx * hw(1), ey + edy * hw(1)], ...back, [sx - sdx * hw(0), sy - sdy * hw(0)]], true);
}

const dots = (pts: P[], r: number, stroke: string): Shape[] =>
  pts.map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: r, ry: r, stroke, width: 0.8 }));

export const plantCell: Block = {
  id: "plant-cell",
  title: "Plant cell",
  describe: "a plant cell: boxy cell wall, large central vacuole, nucleus and chloroplasts",
  tags: ["plant cell", "cell wall", "vacuole", "chloroplast", "nucleus", "eukaryote"],
  size: [100, 100],
  parts: [
    { id: "wall", label: "cell wall", shapes: [{ type: "rect", x: 6, y: 6, w: 88, h: 88, r: 12, stroke: "green", fill: "green-tint" }] },
    { id: "vacuole", label: "vacuole", shapes: [{ type: "path", d: blob(60, 54, 18, 16, [0.04, -0.03, 0.03, 0, -0.04, 0.03, -0.02, 0.02]), stroke: "blue", fill: "blue-tint", width: 0.8 }] },
    { id: "nucleus", label: "nucleus", shapes: [{ type: "ellipse", cx: 29, cy: 29, rx: 11, ry: 11, stroke: "purple", fill: "nucleus-tint" }] },
    {
      id: "chloroplasts",
      label: "chloroplasts",
      shapes: [oval(74, 24, 9, 5, -20), oval(24, 58, 9, 5, 85), oval(40, 80, 9, 5, 5)].map((d) => ({ type: "path" as const, d, stroke: "green", fill: "green-tint", width: 0.8 })),
    },
  ],
  anchors: { center: [50, 50], top: [50, 6], bottom: [50, 94], left: [6, 50], right: [94, 50], wall: [94, 40], vacuole: [60, 54], nucleus: [29, 29], chloroplast: [74, 24] },
};

export const bacterium: Block = {
  id: "bacterium",
  title: "Bacterium",
  describe: "a rod-shaped bacterium with its loop of DNA inside and a whip-like flagellum",
  tags: ["bacteria", "microbe", "prokaryote", "germ", "infection", "flagellum"],
  size: [100, 50],
  parts: [
    { id: "flagellum", label: "flagellum", shapes: [{ type: "path", d: wave(76, 98, 25, 6, 1.25), stroke: "green", width: 0.8 }] },
    { id: "wall", label: "cell wall", shapes: [{ type: "path", d: pill(22, 25, 58, 25, 19), stroke: "green", fill: "green-tint" }] },
    { id: "dna", label: "DNA", shapes: [{ type: "path", d: wave(24, 56, 25, 5, 1.5), stroke: "green", width: 0.8 }] },
  ],
  anchors: { center: [40, 25], top: [40, 6], bottom: [40, 44], left: [3, 25], right: [98, 25], dna: [40, 25], flagellum: [90, 25], wall: [40, 6] },
};

const spikeAngles = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + Math.PI / 8);
const polar = (r: number, a: number): P => [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];

export const virus: Block = {
  id: "virus",
  title: "Virus",
  describe: "a round virus particle with spike proteins around its coat and genetic material inside",
  tags: ["virus", "infection", "disease", "pathogen", "immunity", "spike protein"],
  size: [100, 100],
  parts: [
    {
      id: "spikes",
      label: "spike proteins",
      shapes: spikeAngles.flatMap((a) => {
        const [x0, y0] = polar(28, a), [x1, y1] = polar(39, a), [kx, ky] = polar(43, a);
        return [
          { type: "path" as const, d: `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`, stroke: "red", width: 0.8 },
          { type: "ellipse" as const, cx: +kx.toFixed(1), cy: +ky.toFixed(1), rx: 4.5, ry: 4.5, stroke: "red", fill: "red-tint", width: 0.8 },
        ];
      }),
    },
    { id: "coat", label: "protein coat", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 28, ry: 28, stroke: "red", fill: "red-tint" }] },
    { id: "genome", label: "genetic material", shapes: [{ type: "path", d: wave(36, 64, 50, 6, 1.5), stroke: "red", width: 0.8 }] },
  ],
  anchors: { center: [50, 50], top: [50, 3], bottom: [50, 97], left: [3, 50], right: [97, 50], coat: [50, 22], spike: polar(43, spikeAngles[6]), genome: [50, 50] },
};

export const nucleus: Block = {
  id: "nucleus",
  title: "Nucleus",
  describe: "a cell nucleus: nuclear envelope, a dark nucleolus and threads of chromatin; holds the DNA",
  tags: ["nucleus", "DNA", "chromatin", "nucleolus", "organelle", "genetics"],
  size: [100, 100],
  parts: [
    { id: "envelope", label: "nuclear envelope", shapes: [{ type: "path", d: blob(50, 50, 44, 42, [0.02, -0.02, 0.03, 0, -0.02, 0.02, -0.03, 0.02, 0, -0.02]), stroke: "purple", fill: "nucleus-tint" }] },
    { id: "nucleolus", label: "nucleolus", shapes: [{ type: "ellipse", cx: 58, cy: 56, rx: 13, ry: 12, stroke: "purple", fill: "purple-tint" }] },
    {
      id: "chromatin",
      label: "chromatin",
      shapes: [smooth([[22, 40], [30, 28], [40, 34], [50, 22], [62, 26]]), smooth([[24, 62], [30, 76], [44, 72], [52, 82]])].map((d) => ({ type: "path" as const, d, stroke: "purple", width: 0.8 })),
    },
  ],
  anchors: { center: [50, 50], top: [50, 8], bottom: [50, 92], left: [6, 50], right: [94, 50], envelope: [94, 50], nucleolus: [58, 56], chromatin: [40, 32] },
};

export const ribosome: Block = {
  id: "ribosome",
  title: "Ribosome",
  describe: "a ribosome: large and small subunits reading a strand of mRNA to build a protein",
  tags: ["ribosome", "protein synthesis", "translation", "mRNA", "organelle", "protein"],
  size: [100, 80],
  parts: [
    { id: "small", label: "small subunit", shapes: [{ type: "path", d: oval(50, 60, 28, 12), stroke: "purple", fill: "purple-tint" }] },
    { id: "large", label: "large subunit", shapes: [{ type: "path", d: blob(50, 30, 34, 22, [0, 0.04, 0.02, -0.02, 0.04, 0, 0.04, -0.02, 0.02, 0.04]), stroke: "purple", fill: "purple-tint" }] },
    { id: "mrna", label: "mRNA", shapes: [{ type: "path", d: wave(3, 97, 52, 3, 3), stroke: "blue", width: 0.8 }] },
  ],
  anchors: { center: [50, 40], top: [50, 8], bottom: [50, 72], left: [3, 52], right: [97, 52], large: [50, 28], small: [50, 64], mrna: [94, 52] },
};

const chromatid = (flip: boolean) =>
  tube(
    (t) => {
      const u = 1 - t;
      const x = u * u * u * 14 + 3 * u * u * t * 33 + 3 * u * t * t * 33 + t * t * t * 14;
      const y = 10 + 80 * (3 * u * u * t * 0.05 + 3 * u * t * t * 0.95 + t * t * t);
      return [flip ? 70 - x : x, y];
    },
    (t) => 7.5 - 2 * Math.sin(Math.PI * t),
    16,
  );

export const chromosome: Block = {
  id: "chromosome",
  title: "Chromosome",
  describe: "an X-shaped chromosome: two sister chromatids joined at the centromere",
  tags: ["chromosome", "DNA", "genetics", "chromatid", "cell division", "gene"],
  size: [70, 100],
  parts: [
    { id: "chromatid-a", label: "chromatid", shapes: [{ type: "path", d: chromatid(false), stroke: "blue", fill: "blue-tint" }] },
    { id: "chromatid-b", label: "chromatid", shapes: [{ type: "path", d: chromatid(true), stroke: "blue", fill: "blue-tint" }] },
  ],
  anchors: { center: [35, 50], top: [35, 6], bottom: [35, 94], left: [6, 50], right: [64, 50], centromere: [35, 50], chromatid: [14, 14], arm: [56, 86] },
};

const lipid = (x: number, top: boolean): Shape[] => {
  const y = top ? 11 : 59;
  return [{ type: "ellipse", cx: x, cy: y, rx: 7, ry: 7, stroke: "purple", fill: "purple-tint", width: 0.8 }];
};
const tail = (x: number, top: boolean): Shape => ({ type: "path", d: top ? `M${x} 18 L${x} 29` : `M${x} 52 L${x} 41`, stroke: "purple", width: 0.8 });
const lipidXs = [10, 27, 73, 90];

export const cellMembrane: Block = {
  id: "cell-membrane",
  title: "Cell membrane",
  describe: "a close-up of the cell membrane: a phospholipid bilayer with a channel protein through it",
  tags: ["cell membrane", "phospholipid", "bilayer", "diffusion", "transport", "protein channel"],
  size: [100, 70],
  parts: [
    { id: "tails", label: "lipid tails", shapes: lipidXs.flatMap((x) => [tail(x, true), tail(x, false)]) },
    { id: "heads", label: "phosphate heads", shapes: lipidXs.flatMap((x) => [...lipid(x, true), ...lipid(x, false)]) },
    { id: "protein", label: "channel protein", shapes: [{ type: "rect", x: 41, y: 4, w: 18, h: 62, r: 9, stroke: "blue", fill: "blue-tint" }] },
  ],
  anchors: { center: [50, 35], top: [50, 3], bottom: [50, 67], left: [3, 35], right: [97, 35], outside: [50, 0], inside: [50, 70], protein: [50, 35] },
};

export const redBloodCell: Block = {
  id: "red-blood-cell",
  title: "Red blood cell",
  describe: "a red blood cell: a disc with a dimpled middle that carries oxygen",
  tags: ["red blood cell", "blood", "oxygen", "haemoglobin", "circulation", "erythrocyte"],
  size: [100, 70],
  parts: [
    { id: "cell", label: "red blood cell", shapes: [{ type: "ellipse", cx: 50, cy: 35, rx: 44, ry: 29, stroke: "red", fill: "red-tint" }] },
    { id: "dimple", label: "dimple", shapes: [{ type: "ellipse", cx: 50, cy: 36, rx: 22, ry: 11, stroke: "red", width: 0.8 }] },
  ],
  anchors: { center: [50, 35], top: [50, 6], bottom: [50, 64], left: [6, 35], right: [94, 35], dimple: [50, 36], edge: [86, 22] },
};

export const whiteBloodCell: Block = {
  id: "white-blood-cell",
  title: "White blood cell",
  describe: "a white blood cell: a round, slightly bumpy cell with a lobed nucleus; fights infection",
  tags: ["white blood cell", "immune system", "infection", "blood", "phagocyte", "defence"],
  size: [100, 100],
  parts: [
    { id: "membrane", label: "cell membrane", shapes: [{ type: "path", d: blob(50, 50, 43, 42, [0.04, -0.02, 0.05, -0.03, 0.04, -0.02, 0.05, -0.03, 0.04, -0.02, 0.05, -0.03]), stroke: "purple", fill: "grey-tint" }] },
    {
      id: "nucleus",
      label: "lobed nucleus",
      shapes: [[30, 52], [50, 40], [70, 52]].map(([cx, cy]) => ({ type: "ellipse" as const, cx, cy, rx: 12, ry: 12, stroke: "purple", fill: "nucleus-tint" })),
    },
    { id: "granules", label: "granules", shapes: dots([[32, 76], [60, 76], [76, 28], [24, 30]], 3, "purple") },
  ],
  anchors: { center: [50, 50], top: [50, 8], bottom: [50, 92], left: [7, 50], right: [93, 50], nucleus: [50, 44], membrane: [93, 50], granules: [60, 76] },
};

export const sperm: Block = {
  id: "sperm",
  title: "Sperm cell",
  describe: "a sperm cell: oval head, short midpiece and a long swimming tail, head on the left",
  tags: ["sperm", "reproduction", "fertilisation", "gamete", "male", "cell"],
  size: [100, 40],
  parts: [
    { id: "tail", label: "tail", shapes: [{ type: "path", d: wave(44, 98, 20, 7, 1.5), stroke: "pink", width: 0.8 }] },
    { id: "midpiece", label: "midpiece", shapes: [{ type: "path", d: "M31 20 L 44 20", stroke: "pink" }] },
    { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 18, cy: 20, rx: 14, ry: 11, stroke: "pink", fill: "pink-tint" }] },
  ],
  anchors: { center: [50, 20], top: [50, 4], bottom: [50, 36], left: [3, 20], right: [98, 20], head: [18, 20], midpiece: [38, 20], tail: [80, 20] },
};

export const eggCell: Block = {
  id: "egg-cell",
  title: "Egg cell",
  describe: "an egg cell (ovum): a large round cell with a thick jelly coat and a nucleus",
  tags: ["egg cell", "ovum", "reproduction", "fertilisation", "gamete", "female"],
  size: [100, 100],
  parts: [
    { id: "coat", label: "jelly coat", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 44, ry: 44, stroke: "pink", fill: "pink-tint" }] },
    { id: "membrane", label: "cell membrane", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 31, ry: 31, stroke: "pink", fill: "board", width: 0.8 }] },
    { id: "nucleus", label: "nucleus", shapes: [{ type: "ellipse", cx: 47, cy: 48, rx: 12, ry: 12, stroke: "purple", fill: "nucleus-tint" }] },
  ],
  anchors: { center: [50, 50], top: [50, 6], bottom: [50, 94], left: [6, 50], right: [94, 50], nucleus: [47, 48], coat: [88, 30], membrane: [81, 50] },
};

export const amoeba: Block = {
  id: "amoeba",
  title: "Amoeba",
  describe: "an amoeba: a single-celled blob with pseudopods, a nucleus and a vacuole",
  tags: ["amoeba", "protist", "single-celled", "microorganism", "pseudopod", "pond life"],
  size: [100, 90],
  parts: [
    { id: "membrane", label: "cell membrane", shapes: [{ type: "path", d: smooth([[10, 14], [28, 20], [46, 18], [64, 12], [86, 10], [80, 28], [95, 50], [80, 62], [64, 64], [56, 84], [40, 82], [34, 64], [16, 62], [6, 46], [18, 32]], true), stroke: "purple", fill: "purple-tint" }] },
    { id: "nucleus", label: "nucleus", shapes: [{ type: "ellipse", cx: 44, cy: 42, rx: 11, ry: 10, stroke: "purple", fill: "nucleus-tint" }] },
    { id: "vacuole", label: "contractile vacuole", shapes: [{ type: "ellipse", cx: 70, cy: 42, rx: 6, ry: 6, stroke: "blue", fill: "blue-tint", width: 0.8 }] },
  ],
  anchors: { center: [50, 45], top: [50, 14], bottom: [48, 83], left: [6, 46], right: [95, 50], nucleus: [44, 42], vacuole: [70, 42], pseudopod: [95, 50] },
};

// Each sac is one thick arched stroke; hollow sacs fill in under thick chalk.
const sac = (y: number, half: number) => {
  const pts: P[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = (i / 8) * 2 - 1;
    pts.push([50 + u * half, y - 12 * (1 - u * u)]);
  }
  return smooth(pts);
};

export const golgi: Block = {
  id: "golgi",
  title: "Golgi apparatus",
  describe: "the Golgi apparatus: a stack of curved flattened sacs with small vesicles budding off",
  tags: ["golgi", "organelle", "protein", "vesicle", "packaging", "secretion"],
  size: [100, 90],
  parts: [
    { id: "sacs", label: "stacked sacs", shapes: [sac(30, 26), sac(48, 34), sac(66, 40), sac(84, 42)].map((d) => ({ type: "path" as const, d, stroke: "purple" })) },
    { id: "vesicles", label: "vesicles", shapes: [[84, 12, 5], [94, 36, 5], [8, 30, 5]].map(([cx, cy, r]) => ({ type: "ellipse" as const, cx, cy, rx: r, ry: r, stroke: "purple", fill: "purple-tint", width: 0.8 })) },
  ],
  anchors: { center: [50, 50], top: [50, 10], bottom: [50, 86], left: [8, 84], right: [94, 36], sacs: [50, 50], vesicle: [94, 36] },
};

const erY = (base: number) => (x: number) => base + 5 * Math.sin(((x - 8) / 84) * Math.PI * 3);
const erTube = (base: number) => tube((t) => [8 + 84 * t, erY(base)(8 + 84 * t)], () => 7, 24);
const erDots = (base: number, off: number): P[] => [16, 33, 50, 67, 84].map((x) => [x, +(erY(base)(x) + off).toFixed(1)]);

export const er: Block = {
  id: "er",
  title: "Endoplasmic reticulum",
  describe: "rough endoplasmic reticulum: folded wavy membrane tubes studded with ribosomes",
  tags: ["endoplasmic reticulum", "ER", "organelle", "ribosome", "protein", "transport"],
  size: [100, 90],
  parts: [
    { id: "membranes", label: "ER membranes", shapes: [erTube(30), erTube(60)].map((d) => ({ type: "path" as const, d, stroke: "purple", fill: "purple-tint" })) },
    { id: "ribosomes", label: "ribosomes", shapes: dots([...erDots(30, -17), ...erDots(60, 17)], 3, "blue") },
  ],
  anchors: { center: [50, 45], top: [50, 8], bottom: [50, 82], left: [2, 45], right: [98, 45], membrane: [50, 30], ribosome: [50, 13], lumen: [50, 60] },
};

export const vacuole: Block = {
  id: "vacuole",
  title: "Vacuole",
  describe: "a vacuole: a large membrane sac filled with watery cell sap",
  tags: ["vacuole", "organelle", "cell sap", "plant cell", "storage", "water"],
  size: [100, 80],
  parts: [
    { id: "membrane", label: "vacuole membrane", shapes: [{ type: "path", d: blob(50, 40, 44, 34, [0.03, -0.04, 0.02, 0.05, -0.03, 0.02, -0.04, 0.04, 0.0, -0.03]), stroke: "purple", fill: "blue-tint" }] },
    { id: "sap", label: "cell sap", shapes: [wave(28, 72, 34, 4, 1.5), wave(34, 66, 52, 4, 1.25)].map((d) => ({ type: "path" as const, d, stroke: "blue", width: 0.8 })) },
  ],
  anchors: { center: [50, 40], top: [50, 6], bottom: [50, 74], left: [6, 40], right: [94, 40], membrane: [94, 40], sap: [50, 42] },
};

export const yeast: Block = {
  id: "yeast",
  title: "Yeast",
  describe: "a yeast cell budding: an oval cell with a nucleus and a small bud growing off it",
  tags: ["yeast", "fungus", "fermentation", "budding", "microorganism", "respiration"],
  size: [100, 84],
  parts: [
    { id: "bud", label: "bud", shapes: [{ type: "ellipse", cx: 79, cy: 23, rx: 15, ry: 15, stroke: "orange", fill: "orange-tint" }] },
    { id: "cell", label: "yeast cell", shapes: [{ type: "path", d: oval(42, 50, 34, 28, -20), stroke: "orange", fill: "orange-tint" }] },
    { id: "nucleus", label: "nucleus", shapes: [{ type: "ellipse", cx: 36, cy: 46, rx: 11, ry: 11, stroke: "purple", fill: "nucleus-tint" }] },
    { id: "vacuole", label: "vacuole", shapes: [{ type: "ellipse", cx: 58, cy: 63, rx: 6, ry: 6, stroke: "orange", width: 0.8 }] },
  ],
  anchors: { center: [46, 46], top: [79, 8], bottom: [42, 80], left: [6, 52], right: [94, 23], bud: [79, 23], nucleus: [36, 46], cell: [42, 50] },
};
