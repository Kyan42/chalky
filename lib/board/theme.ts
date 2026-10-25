/**
 * How the board looks. Janani's themes (presets/themes.ts on her `presets` branch) on our stage:
 * the same ids, colour roles and fill modes, so her blocks need no changes, with the marker width
 * in our 1200x800 units.
 *
 * - CHALK (the default): chalk-textured outlines on white, no fills; shapes are filled with the
 *   board colour so what they overlap stays hidden. The grain is her SkSL shader (lib/board/chalk.ts).
 * - CHALKBOARD: pastel chalk on green slate, with faint eraser smears behind everything.
 * - WHITEBOARD: the earlier marker look, clean lines with pale wash fills.
 *
 * The theme comes from NEXT_PUBLIC_CHALKY_THEME (chalk | chalkboard | whiteboard), and in the
 * browser `?theme=` on the page overrides it.
 */

export type FillMode = "wash" | "hatch" | "none";

export interface Theme {
  id: "chalk" | "chalkboard" | "whiteboard";
  /** Colour for every name blocks and the scene language use ("ink", "green", "green-tint", "board", …). */
  colors: Record<string, string>;
  /** Line thickness in stage units (1200x800), whatever size a shape is drawn at. */
  marker: number;
  /**
   * How a "-tint" fill is drawn: `wash`, a flat pale fill that fades in; `hatch`, scribbled
   * side-of-the-chalk strokes clipped to the shape; or `none`, outlines only (the shape is still
   * filled with the board colour, so what it overlaps stays hidden).
   */
  fill: FillMode;
  hatch?: { spacing: number; width: number; opacity: number; angle: number; seconds: number };
  /** Chalk dust over everything drawn: grain and slightly broken edges (a shader on the GPU). */
  chalk?: { grain: number };
  /** Faint eraser smears on the board behind everything. */
  smudges?: boolean;
}

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
  marker: 4,
  fill: "wash",
};

export const CHALK: Theme = {
  id: "chalk",
  colors: { ...WHITEBOARD.colors },
  marker: 5,
  fill: "none",
  chalk: { grain: 0.85 },
};

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
  },
  smudges: true,
};

export const THEMES: readonly Theme[] = [CHALK, CHALKBOARD, WHITEBOARD];
export const DEFAULT_THEME = CHALK;

/** The colour names the drawing model may use (every name without a "-tint"). */
export const COLOR_NAMES = Object.keys(WHITEBOARD.colors).filter((k) => k !== "board" && !k.endsWith("-tint"));

export function themeById(id: string | null | undefined): Theme | null {
  return THEMES.find((t) => t.id === (id ?? "").trim().toLowerCase()) ?? null;
}

/** The theme the build was configured with (NEXT_PUBLIC_CHALKY_THEME), CHALK unless set. */
export function envTheme(): Theme {
  return themeById(process.env.NEXT_PUBLIC_CHALKY_THEME) ?? DEFAULT_THEME;
}

/** The theme in force: `?theme=` on the page in the browser, else the environment's. */
export function currentTheme(): Theme {
  if (typeof location !== "undefined") {
    const q = themeById(new URLSearchParams(location.search).get("theme"));
    if (q) return q;
  }
  return envTheme();
}

/** Hex a..b mixed by t. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour name or hex on the theme; unknown names fall back to `fallback`. */
export function themeHex(theme: Theme, name: string | undefined, fallback = "ink"): string {
  const v = name && (theme.colors[name] ?? (/^#[0-9a-f]{6}$/i.test(name) ? name : undefined));
  return v ?? theme.colors[fallback] ?? theme.colors.ink;
}

/** The pale tint of a colour on the theme: its "-tint" if named, else the colour pulled 80% toward the board. */
export function tintHex(theme: Theme, name: string | undefined): string {
  const base = name && !name.endsWith("-tint") ? name : (name ?? "ink").replace(/-tint$/, "");
  return theme.colors[`${base}-tint`] ?? mix(themeHex(theme, base), theme.colors.board, 0.8);
}
