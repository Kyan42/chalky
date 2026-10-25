/**
 * Scenery blocks: Leo's forest and podium illustrations (scripts/forest-icons.ts on his
 * codex/chalky-tutor-ui-and-icons branch), rebuilt as real catalog blocks with parts the lesson
 * can point at, anchors arrows can aim at, and describe/tags the Moss index and the drawer read.
 *
 * His geometry is kept (absolute M, L, C, Q, Z only, as lib/blocks/render.ts parses). His "white"
 * fills are the board colour here (a theme has no white), and the code marks on the computer screen
 * are blue instead of white, which would vanish on a chalk theme where a tint is the board colour.
 */
import type { Block, Shape } from "@/presets/types";

const path = (d: string, stroke: string, fill?: string, width?: number): Shape => ({ type: "path", d, stroke, ...(fill ? { fill } : {}), ...(width ? { width } : {}) });
const ellipse = (cx: number, cy: number, rx: number, ry: number, stroke: string, fill?: string): Shape => ({ type: "ellipse", cx, cy, rx, ry, stroke, ...(fill ? { fill } : {}) });

/** A conifer's three tiers as one closed outline, apex at (x, y), scaled by s. */
function pine(x: number, y: number, s: number): string {
  const pts: [number, number][] = [
    [0, 0], [-15, 24], [-7, 24], [-21, 46], [-8, 46], [-23, 68], [23, 68], [8, 46], [21, 46], [7, 24], [15, 24],
  ];
  return pts.map(([dx, dy], i) => `${i ? "L" : "M"}${(x + dx * s).toFixed(1)} ${(y + dy * s).toFixed(1)}`).join(" ") + " Z";
}
const trunk = () => path("M45 88 L47 43 L54 43 L57 88 Z", "brown", "brown-tint");
const SIDES = { top: [50, 6] as [number, number], bottom: [50, 92] as [number, number], left: [8, 50] as [number, number], right: [92, 50] as [number, number] };

export const forestOak: Block = {
  id: "forest-oak",
  title: "Old oak",
  describe: "an old oak tree: a thick trunk, two branches and a wide leafy crown",
  tags: ["tree", "oak", "forest", "woodland", "deciduous", "ecosystem", "habitat", "carbon", "oxygen", "shade"],
  size: [100, 100],
  parts: [
    { id: "trunk", label: "trunk", shapes: [trunk()] },
    { id: "crown", label: "leafy crown", shapes: [path("M48 58 C31 68 16 58 20 46 C7 35 20 20 31 24 C33 7 57 9 62 19 C81 12 92 28 82 39 C96 56 75 67 62 59 Z", "green", "green-tint")] },
    { id: "branches", label: "branches", shapes: [path("M51 65 L34 48", "brown", undefined, 0.7), path("M52 58 L69 43", "brown", undefined, 0.7)] },
  ],
  anchors: { center: [50, 50], crown: [50, 36], trunk: [51, 72], branches: [52, 56], top: [50, 9], bottom: [51, 88], left: [10, 42], right: [92, 42] },
};

export const forestPine: Block = {
  id: "forest-pine",
  title: "Pine tree",
  describe: "a pine tree: a tall conifer with three tiers of needles over a short trunk",
  tags: ["tree", "pine", "conifer", "evergreen", "forest", "taiga", "mountain", "winter", "timber"],
  size: [100, 100],
  parts: [
    { id: "trunk", label: "trunk", shapes: [trunk()] },
    { id: "crown", label: "needles", shapes: [path(pine(50, 8, 1), "green", "green-tint")] },
  ],
  anchors: { center: [50, 50], crown: [50, 44], trunk: [51, 80], top: [50, 8], bottom: [51, 88], left: [27, 76], right: [73, 76] },
};

export const forestBirch: Block = {
  id: "forest-birch",
  title: "Birch tree",
  describe: "a birch tree: a round crown over a slender pale trunk with dark bark marks",
  tags: ["tree", "birch", "forest", "woodland", "deciduous", "bark", "pioneer species", "spring"],
  size: [100, 100],
  parts: [
    { id: "crown", label: "crown", shapes: [ellipse(49, 34, 29, 28, "green", "green-tint")] },
    { id: "trunk", label: "pale trunk", shapes: [path("M43 90 L46 33 L53 30 L58 90 Z", "brown", "board")] },
    { id: "bark", label: "bark marks", shapes: ["M46 47 L51 48", "M51 59 L55 58", "M44 73 L49 72", "M52 83 L57 82"].map((d) => path(d, "brown", undefined, 0.7)) },
  ],
  anchors: { center: [50, 50], crown: [49, 34], trunk: [50, 65], bark: [51, 66], top: [49, 6], bottom: [50, 90], left: [20, 34], right: [78, 34] },
};

export const forestGrove: Block = {
  id: "forest-grove",
  title: "Forest grove",
  describe: "a small grove: two pines flanking a round-crowned tree on a strip of ground",
  tags: ["forest", "grove", "woods", "trees", "ecosystem", "habitat", "biodiversity", "deforestation", "carbon sink"],
  size: [100, 100],
  parts: [
    { id: "ground", label: "ground", shapes: [path("M8 90 Q50 80 92 90", "brown")] },
    { id: "left-pine", label: "left pine", shapes: [path("M24 84 L24 43", "brown"), path(pine(25, 15, 0.62), "green", "green-tint")] },
    { id: "right-pine", label: "right pine", shapes: [path("M74 85 L74 43", "brown"), path(pine(75, 13, 0.66), "green", "green-tint")] },
    { id: "middle-tree", label: "middle tree", shapes: [path("M48 91 L48 58 L54 58 L54 91 Z", "brown", "brown-tint"), ellipse(51, 48, 24, 29, "green", "green-tint")] },
  ],
  anchors: { center: [50, 55], ground: [50, 86], "left-pine": [25, 40], "right-pine": [75, 40], "middle-tree": [51, 48], top: [51, 19], bottom: [50, 90], left: [8, 60], right: [92, 60] },
};

export const forestSapling: Block = {
  id: "forest-sapling",
  title: "New sapling",
  describe: "a young sapling: a thin bending shoot with two fresh leaves, newly planted",
  tags: ["sapling", "young tree", "reforestation", "planting", "forest", "spring", "life cycle"],
  size: [100, 100],
  parts: [
    { id: "ground", label: "ground", shapes: [path("M24 87 Q50 78 77 87", "brown")] },
    { id: "stem", label: "stem", shapes: [path("M50 84 Q46 59 54 30", "green")] },
    {
      id: "leaves",
      label: "leaves",
      shapes: [path("M49 61 C23 65 18 43 21 35 C42 34 52 47 49 61 Z", "green", "green-tint"), path("M51 45 C49 25 65 16 82 17 C81 35 68 49 51 45 Z", "green", "green-tint")],
    },
  ],
  anchors: { center: [50, 55], stem: [50, 70], leaves: [50, 42], "left-leaf": [34, 48], "right-leaf": [66, 32], ground: [50, 84], top: [54, 28], bottom: [50, 86], left: [20, 45], right: [82, 20] },
};

const frond = (i: number): Shape[] => {
  const y = 75 - i * 12, x = 49 + i * 2;
  return [
    path(`M${x} ${y} Q${x - 27} ${y + 2} ${x - 28} ${y - 14} Q${x - 8} ${y - 16} ${x} ${y} Z`, "green", "green-tint", 0.8),
    path(`M${x} ${y} Q${x + 25} ${y - 1} ${x + 29} ${y - 18} Q${x + 9} ${y - 18} ${x} ${y} Z`, "green", "green-tint", 0.8),
  ];
};
export const forestFern: Block = {
  id: "forest-fern",
  title: "Fern",
  describe: "a fern: an arching stem with pairs of leafy fronds, the forest floor's undergrowth",
  tags: ["fern", "frond", "undergrowth", "forest floor", "shade", "spores", "moist", "plant", "prehistoric"],
  size: [100, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [path("M47 90 Q48 54 65 12", "green")] },
    { id: "fronds", label: "fronds", shapes: [0, 1, 2, 3, 4].flatMap(frond) },
  ],
  anchors: { center: [50, 55], stem: [50, 70], fronds: [50, 50], tip: [65, 12], top: [65, 12], bottom: [47, 90], left: [21, 60], right: [86, 30] },
};

export const forestMushroom: Block = {
  id: "forest-mushroom",
  title: "Woodland mushroom",
  describe: "a woodland mushroom: a spotted red cap on a pale stem, with blades of grass",
  tags: ["mushroom", "fungus", "fungi", "toadstool", "decomposer", "forest floor", "spores", "mycelium", "decay", "nutrient cycle"],
  size: [100, 100],
  parts: [
    { id: "stem", label: "stem", shapes: [path("M40 85 L45 48 L56 48 L62 85 Q52 93 40 85 Z", "brown", "brown-tint")] },
    { id: "cap", label: "cap", shapes: [path("M12 51 C18 5 79 5 88 51 Q51 66 12 51 Z", "red", "red-tint")] },
    { id: "spots", label: "spots", shapes: [ellipse(34, 37, 5, 4, "red", "board"), ellipse(58, 28, 6, 4, "red", "board"), ellipse(72, 45, 4, 3, "red", "board")] },
    { id: "grass", label: "grass", shapes: ["M20 88 L16 78", "M23 88 L28 79", "M77 88 L81 77"].map((d) => path(d, "green", undefined, 0.7)) },
  ],
  anchors: { center: [50, 52], cap: [50, 30], stem: [51, 68], spots: [58, 28], grass: [22, 84], top: [50, 16], bottom: [51, 90], left: [12, 51], right: [88, 51] },
};

export const computerPodium: Block = {
  id: "computer-podium",
  title: "Computer on a podium",
  describe: "a computer monitor showing code, standing on a wooden podium",
  tags: ["computer", "monitor", "screen", "code", "programming", "software", "technology", "lecture", "podium", "presentation", "desk"],
  size: [100, 100],
  parts: [
    { id: "podium", label: "podium", shapes: [path("M25 65 L73 65 L78 93 L20 93 Z", "brown", "brown-tint"), path("M16 60 L82 60 L86 67 L13 67 Z", "brown", "yellow-tint")] },
    { id: "screen", label: "screen", shapes: [path("M24 12 L77 12 L77 49 L24 49 Z", "blue", "blue-tint"), path("M29 17 L72 17 L72 43 L29 43 Z", "blue", "blue-tint", 0.7)] },
    { id: "stand", label: "stand", shapes: [path("M46 49 L55 49 L56 56 L65 59 L36 59 L45 56 Z", "brown", "brown-tint")] },
    { id: "code", label: "code on the screen", shapes: ["M36 25 L32 29 L36 33", "M64 25 L68 29 L64 33", "M54 23 L47 36"].map((d) => path(d, "blue", undefined, 0.7)) },
  ],
  anchors: { center: [50, 50], screen: [50, 30], code: [50, 29], podium: [49, 78], stand: [50, 54], top: [50, 12], bottom: [49, 93], left: [13, 64], right: [86, 64] },
};

export const SCENERY: Block[] = [forestOak, forestPine, forestBirch, forestGrove, forestSapling, forestFern, forestMushroom, computerPodium];
