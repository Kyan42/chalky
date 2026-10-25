// How a board looks. Blocks name colours by role ("green", "green-tint", "ink"); a theme says what
// those names are and how fills are drawn, so the same blocks work on a whiteboard or a chalkboard.

export type Theme = {
  id: string;
  /** Colour for every name blocks and steps use. */
  colors: Record<string, string>;
  /** Line thickness in pixels on the board, whatever size a block is drawn at. */
  marker: number;
  /**
   * How a "-tint" fill is drawn:
   * - `wash`: a flat pale fill that fades in.
   * - `hatch`: scribbled side-of-the-chalk strokes clipped to the shape, drawn on like shading.
   * - `none`: outlines only (the shape is still filled with the board colour, so what it overlaps stays hidden).
   * - `pigment`: watercolour, on its own layer under every line, loose, uneven and a little off register.
   * - `solid`: a silhouette: every shape filled with the one `shape` colour, thin lines cut out of it.
   */
  fill: "wash" | "hatch" | "none" | "pigment" | "solid";
  /** Every line in this one colour (ink drawings), instead of each block's own. */
  outline?: string;
  /** Curves drawn as a few straight segments, for a cut-paper, angular look. */
  angular?: boolean;
  /** Pixels a hand-drawn line wobbles by (the line shader without chalk grain). */
  wobble?: number;
  /** The watercolour layer of `pigment` fills: how far it sits off the lines, and how uneven the pigment is (0..1). */
  watercolor?: { offset: [number, number]; grain: number };
  /** Little sparkles and circles doodled beside each drawn block. */
  doodles?: boolean;
  hatch?: { spacing: number; width: number; opacity: number; angle: number; seconds: number };
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
  },
  marker: 5,
  fill: "wash",
};

// Ink and watercolour, like a sketchbook illustration: bold black ink lines with a slight wobble,
// and loose watercolour fills that sit a little off the lines. "-tint" names the paint.
export const INKWASH: Theme = {
  id: "inkwash",
  colors: {
    board: "#F3F1EC",
    ink: "#171717",
    grey: "#5E5E5E",
    red: "#C8402F",
    orange: "#D9862B",
    blue: "#3D6FC2",
    green: "#2F7D3A",
    "grey-tint": "#B9B6AE",
    "blue-tint": "#6E9BDB",
    "green-tint": "#3F9449",
    "red-tint": "#DB5B50",
    "orange-tint": "#EE9C40",
    "yellow-tint": "#F2C94C",
    "purple-tint": "#9474CF",
    "nucleus-tint": "#6C4DB1",
    "brown-tint": "#A87449",
    highlighter: "#F2C94C",
  },
  marker: 4.5,
  outline: "ink",
  fill: "pigment",
  wobble: 1.6,
  watercolor: { offset: [7, 5], grain: 0.9 },
};

// A warm notebook doodle: one dark brown pen on sunny yellow, no fills, sparkles scattered around.
export const DOODLE: Theme = {
  id: "doodle",
  colors: {
    board: "#F6C744",
    ink: "#4A2C12",
    grey: "#6E4A1E",
    red: "#B5462B",
    orange: "#8A4E16",
    blue: "#4A2C12",
    green: "#4A2C12",
    highlighter: "#F9DE8A",
  },
  marker: 4.5,
  outline: "ink",
  fill: "none",
  wobble: 1.3,
  doodles: true,
};

// Cut-paper silhouettes: solid light-green shapes on a deep green ground, built from straight
// segments, thin lines cut out of them; no outlines.
export const SILHOUETTE: Theme = {
  id: "silhouette",
  colors: {
    board: "#1E4A2C",
    shape: "#58A55D",
    ink: "#CFE9D1",
    grey: "#9DCDA0",
    red: "#B7E4B9",
    orange: "#B7E4B9",
    highlighter: "#3B7A47",
  },
  marker: 7,
  fill: "solid",
  angular: true,
};

// The chalk look: thick chalk-textured outlines on a white board, in the whiteboard's colours. Outlines
// only; shapes are filled with the board colour so overlaps stay clean.
export const CHALK: Theme = {
  id: "chalk",
  colors: { ...WHITEBOARD.colors },
  // A fat stick: thick lines whose edges break up a little more, the grain a touch lighter so they don't turn to dust.
  marker: 11,
  fill: "none",
  chalk: { grain: 0.8 },
  wobble: 3.2,
};

// Chalk on a green slate board, with faint eraser smears. Lines are the pastel chalk sticks a
// teacher keeps in the tray.
export const CHALKBOARD: Theme = {
  ...CHALK,
  id: "chalkboard",
  marker: 6,
  chalk: { grain: 0.85 },
  wobble: 2.5,
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
  },
  smudges: true,
};
