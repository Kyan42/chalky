// How a board looks. Blocks name colours by role ("green", "green-tint", "ink"); a theme says what
// those names are and how fills are drawn, so the same blocks work on a whiteboard or a chalkboard.

export type Theme = {
  id: string;
  /** Colour for every name blocks and steps use. */
  colors: Record<string, string>;
  /** Line thickness in pixels on the board, whatever size a block is drawn at. */
  marker: number;
  /**
   * How a "-tint" fill is drawn: `wash`, a flat pale fill that fades in; `hatch`, scribbled
   * side-of-the-chalk strokes clipped to the shape, drawn on like someone shading it in; or `none`,
   * outlines only (the shape is still filled with the board colour, so what it overlaps stays hidden).
   */
  fill: "wash" | "hatch" | "none";
  hatch?: { spacing: number; width: number; opacity: number; angle: number; seconds: number };
  /** Opacity of a highlighter swipe. */
  highlighter: number;
  /** Chalk dust over everything drawn: grain and slightly broken edges (a shader on the GPU). */
  chalk?: { grain: number };
  /** Faint eraser smears on the board behind everything. */
  smudges?: boolean;
};

export const WHITEBOARD: Theme = {
  id: "whiteboard",
  colors: {
    board: "#FBFAF7",
    ink: "#23262F",
    grey: "#8A8F9C",
    "grey-tint": "#ECEDF1",
    blue: "#2F6FDB",
    "blue-tint": "#DCE8FB",
    green: "#2E9E57",
    "green-tint": "#DDF2E3",
    red: "#E0474C",
    "red-tint": "#FBDCDD",
    orange: "#EE8A22",
    "orange-tint": "#FDE7CF",
    yellow: "#F5C518",
    "yellow-tint": "#FFF3BF",
    purple: "#7B5BD6",
    "purple-tint": "#E8E1FA",
    "nucleus-tint": "#D6CAF6",
    brown: "#8B5A3C",
    "brown-tint": "#EFE2D6",
    highlighter: "#FFE45C",
  },
  marker: 5,
  fill: "wash",
  highlighter: 0.7,
};

// The chalk look: chalk-textured outlines on a white board, in the whiteboard's colours. Outlines
// only; shapes are filled with the board colour so overlaps stay clean.
export const CHALK: Theme = {
  id: "chalk",
  colors: { ...WHITEBOARD.colors },
  marker: 6,
  fill: "none",
  highlighter: WHITEBOARD.highlighter,
  chalk: { grain: 0.85 },
};

// Chalk on a green slate board, with faint eraser smears. Lines are the pastel chalk sticks a
// teacher keeps in the tray.
export const CHALKBOARD: Theme = {
  ...CHALK,
  id: "chalkboard",
  colors: {
    board: "#25332D",
    ink: "#F1EEE4",
    grey: "#AEB5AE",
    "grey-tint": "#D9DCD6",
    blue: "#8EC5EE",
    "blue-tint": "#8EC5EE",
    green: "#A8DC8E",
    "green-tint": "#A8DC8E",
    red: "#F28C82",
    "red-tint": "#F28C82",
    orange: "#F6B36A",
    "orange-tint": "#F6B36A",
    yellow: "#F7DC6F",
    "yellow-tint": "#F7DC6F",
    purple: "#C5ABF2",
    "purple-tint": "#C5ABF2",
    "nucleus-tint": "#DCCBFA",
    brown: "#D6AA80",
    "brown-tint": "#D6AA80",
    highlighter: "#F7DC6F",
  },
  highlighter: 0.3,
  smudges: true,
};
