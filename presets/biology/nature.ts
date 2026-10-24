import type { Block } from "../types";

export const sun: Block = {
  id: "sun",
  title: "Sun",
  describe: "a sun: circle with rays; source of light and energy",
  tags: ["light", "energy", "photosynthesis", "heat", "seasons", "food chain"],
  size: [100, 100],
  parts: [
    { id: "disc", label: "sun", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 21, ry: 21, stroke: "orange", fill: "yellow-tint" }] },
    {
      id: "rays",
      label: "sunlight",
      shapes: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const p = (r: number) => `${(50 + Math.cos(a) * r).toFixed(1)} ${(50 + Math.sin(a) * r).toFixed(1)}`;
        return { type: "path" as const, d: `M${p(30)} L${p(44)}`, stroke: "orange" };
      }),
    },
  ],
  anchors: { center: [50, 50], top: [50, 4], bottom: [50, 96], left: [4, 50], right: [96, 50], "bottom-right": [83, 83], "bottom-left": [17, 83] },
};

export const cloud: Block = {
  id: "cloud",
  title: "Cloud",
  describe: "a puffy cloud; air, the sky, rain or water vapour",
  tags: ["water cycle", "rain", "weather", "evaporation", "condensation", "air"],
  size: [100, 60],
  parts: [
    {
      id: "cloud",
      label: "cloud",
      shapes: [
        {
          type: "path",
          d: "M22 50 C 8 50, 6 32, 20 29 C 20 13, 42 8, 50 21 C 57 7, 82 11, 80 30 C 94 30, 95 50, 80 50 Z",
          stroke: "blue",
          fill: "blue-tint",
        },
      ],
    },
  ],
  anchors: { center: [50, 34], top: [50, 12], bottom: [50, 52], left: [8, 40], right: [92, 40] },
};

export const drop: Block = {
  id: "drop",
  title: "Water drop",
  describe: "a single water droplet; water, H2O, rain, moisture",
  tags: ["water", "H2O", "rain", "water cycle", "osmosis", "transpiration"],
  size: [70, 100],
  parts: [
    {
      id: "drop",
      label: "water",
      shapes: [
        { type: "path", d: "M35 8 C 35 8, 62 46, 62 64 C 62 80, 50 92, 35 92 C 20 92, 8 80, 8 64 C 8 46, 35 8, 35 8 Z", stroke: "blue", fill: "blue-tint" },
        { type: "path", d: "M20 66 C 20 58, 23 51, 27 45", stroke: "blue", width: 0.8 },
      ],
    },
  ],
  anchors: { center: [35, 64], top: [35, 8], bottom: [35, 92], left: [8, 64], right: [62, 64] },
};

export const energy: Block = {
  id: "energy",
  title: "Energy",
  describe: "a lightning bolt; energy, ATP, a signal or spark",
  tags: ["energy", "ATP", "respiration", "electricity", "signal"],
  size: [60, 100],
  parts: [
    {
      id: "bolt",
      label: "energy",
      shapes: [{ type: "path", d: "M36 6 L 10 56 L 28 56 L 20 94 L 50 40 L 32 40 L 44 6 Z", stroke: "orange", fill: "yellow-tint" }],
    },
  ],
  anchors: { center: [30, 50], top: [40, 6], bottom: [20, 94], left: [10, 56], right: [50, 40] },
};
