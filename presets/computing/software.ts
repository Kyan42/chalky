// Software, files, security and the internet: windows, code, files, data, people and messages.
import { cubicAt, oval, pill, poly, smooth, type P } from "../geometry";
import type { Block, Part, Shape } from "../types";

const TINTED = new Set(["grey", "blue", "green", "red", "orange", "purple", "brown", "pink", "yellow"]);
/** The fill that goes with a line colour. */
const tint = (color: string) => (TINTED.has(color) ? `${color}-tint` : "grey-tint");
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const r1 = (v: number) => +v.toFixed(1);
const line = (d: string, stroke: string, width = 0.8): Shape => ({ type: "path", d, stroke, width });
const box = (x: number, y: number, w: number, h: number, stroke: string, fill?: string, r = 4, width = 1): Shape =>
  ({ type: "rect", x: r1(x), y: r1(y), w: r1(w), h: r1(h), r, stroke, width, ...(fill ? { fill } : {}) });
const dot = (cx: number, cy: number, r: number, stroke: string): Shape => ({ type: "ellipse", cx, cy, rx: r, ry: r, stroke, width: 0.8 });
const edges = (w: number, h: number) => ({ center: [w / 2, h / 2] as P, top: [w / 2, 4] as P, bottom: [w / 2, h - 4] as P, left: [4, h / 2] as P, right: [w - 4, h / 2] as P });

/** `n` columns of panes across x0..x1, `gap` apart; their boxes. */
function columns(n: number, x0: number, x1: number, y0: number, y1: number, gap = 10): [number, number, number, number][] {
  const w = (x1 - x0 - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => [x0 + i * (w + gap), y0, w, y1 - y0]);
}
function paneParts(n: number, x0: number, x1: number, y0: number, y1: number, color: string) {
  const cols = columns(n, x0, x1, y0, y1);
  const parts: Part[] = cols.map(([x, y, w, h], i) => ({ id: `pane-${i}`, label: `content pane ${i + 1}`, shapes: [box(x, y, w, h, color, "board", 3, 0.8)] }));
  const anchors: Record<string, P> = {};
  cols.forEach(([x, y, w, h], i) => (anchors[`pane-${i}`] = [r1(x + w / 2), r1(y + h / 2)]));
  return { parts, anchors };
}

// ---------------------------------------------------------------- app window

export interface AppWindowOptions { panes?: number; color?: string }
/** An app window with a title bar and `panes` content blocks side by side (1–3, default 2). */
export function makeAppWindow({ panes = 2, color = "blue" }: AppWindowOptions = {}): Block {
  const n = clamp(panes, 1, 3);
  const p = paneParts(n, 16, 84, 36, 66, color);
  return {
    id: "app-window",
    title: "App Window",
    describe: "an application window with a title bar and content panes side by side; set panes (1-3)",
    tags: ["app", "window", "program", "software", "interface", "gui"],
    size: [100, 80],
    parts: [
      { id: "window", label: "window", shapes: [box(4, 4, 92, 72, color, tint(color), 6)] },
      { id: "title-bar", label: "title bar", shapes: [line("M4 24 L96 24", color, 1), dot(16, 14, 3, color), dot(30, 14, 3, color)] },
      ...p.parts,
    ],
    anchors: { ...edges(100, 80), center: [50, 51], "title-bar": [60, 14], content: [50, 51], ...p.anchors },
  };
}
export const appWindow = makeAppWindow();

// ---------------------------------------------------------------- browser

export interface BrowserOptions { panes?: number; color?: string }
/** A web browser: two tabs, an address bar and `panes` content blocks (1–3, default 2). */
export function makeBrowser({ panes = 2, color = "blue" }: BrowserOptions = {}): Block {
  const n = clamp(panes, 1, 3);
  const p = paneParts(n, 14, 86, 54, 84, color);
  return {
    id: "browser",
    title: "Web Browser",
    describe: "a web browser window with tabs, an address bar and content panes; set panes (1-3)",
    tags: ["browser", "web", "website", "internet", "page", "url"],
    size: [100, 100],
    parts: [
      { id: "tabs", label: "tabs", shapes: [line("M8 16 L12 4 L42 4 L46 16", color, 1), line("M52 16 L56 6 L82 6 L86 16", color, 0.8)] },
      { id: "window", label: "window", shapes: [box(4, 16, 92, 80, color, tint(color), 6)] },
      { id: "address-bar", label: "address bar", shapes: [box(12, 28, 76, 14, color, "board", 7, 0.8)] },
      ...p.parts,
    ],
    anchors: {
      ...edges(100, 100), center: [50, 60], top: [27, 4], tabs: [27, 10], "tab-0": [27, 10], "tab-1": [69, 11],
      "address-bar": [50, 35], content: [50, 69], ...p.anchors,
    },
  };
}
export const browser = makeBrowser();

// ---------------------------------------------------------------- code

const INDENT = [0, 10, 10, 20, 10, 0];
const LENGTH = [40, 38, 26, 22, 34, 18];

export interface CodeOptions { lines?: number; color?: string }
/** An editor window of code: `lines` indented bars of varied length (2–6, default 4). */
export function makeCode({ lines = 4, color = "blue" }: CodeOptions = {}): Block {
  const n = clamp(lines, 2, 6);
  const gap = n <= 4 ? 15 : 13;
  const ys = Array.from({ length: n }, (_, i) => 19 + gap * i);
  const h = ys[n - 1] + 17;
  return {
    id: "code",
    title: "Code",
    describe: "source code in an editor: indented lines of code beside a line-number gutter; set lines (2-6)",
    tags: ["code", "program", "source", "programming", "editor", "script"],
    size: [100, h],
    parts: [
      { id: "editor", label: "code editor", shapes: [box(4, 4, 92, h - 8, color, tint(color), 6)] },
      { id: "gutter", label: "line-number gutter", shapes: [line(`M22 4 L22 ${h - 4}`, color)] },
      ...ys.map((y, i) => ({ id: `line-${i}`, label: `line ${i + 1} of code`, shapes: [line(`M${32 + INDENT[i]} ${y} L${32 + INDENT[i] + LENGTH[i]} ${y}`, color, 1)] })),
    ],
    anchors: {
      ...edges(100, h), gutter: [13, h / 2],
      ...Object.fromEntries(ys.map((y, i) => [`line-${i}`, [32 + INDENT[i] + LENGTH[i] / 2, y] as P])),
    },
  };
}
export const code = makeCode();

// ---------------------------------------------------------------- terminal

const PROMPT_LENGTH = [44, 30, 38, 24, 34];

export interface TerminalOptions { lines?: number; color?: string }
/** A terminal window: `lines` prompt lines (1–5, default 3), the last ending in a cursor. */
export function makeTerminal({ lines = 3, color = "blue" }: TerminalOptions = {}): Block {
  const n = clamp(lines, 1, 5);
  const gap = n <= 3 ? 18 : n === 4 ? 15 : 13;
  const ys = Array.from({ length: n }, (_, i) => 37 + gap * i);
  const h = ys[n - 1] + 18;
  const parts: Part[] = ys.map((y, i) => {
    const last = i === n - 1;
    const len = last ? 18 : PROMPT_LENGTH[i];
    return {
      id: `line-${i}`,
      label: last ? `prompt line ${i + 1}, with the cursor` : `prompt line ${i + 1}`,
      shapes: [line(`M18 ${y - 6} L27 ${y} L18 ${y + 6}`, color, 1), line(`M38 ${y} L${38 + len} ${y}`, color, 0.8),
        ...(last ? [box(64, y - 6, 9, 12, color, color === "ink" ? "grey-tint" : tint(color), 1, 0.8)] : [])],
    };
  });
  return {
    id: "terminal",
    title: "Terminal",
    describe: "a command-line terminal window with prompt lines and a blinking cursor; set lines (1-5)",
    tags: ["terminal", "command line", "shell", "console", "prompt", "commands"],
    size: [100, h],
    parts: [
      { id: "window", label: "terminal window", shapes: [box(4, 4, 92, h - 8, color, tint(color), 6)] },
      { id: "title-bar", label: "title bar", shapes: [line("M4 22 L96 22", color, 1)] },
      ...parts,
    ],
    anchors: {
      ...edges(100, h), "title-bar": [50, 13], prompt: [21, ys[n - 1]], cursor: [68, ys[n - 1]],
      ...Object.fromEntries(ys.map((y, i) => [`line-${i}`, [46, y] as P])),
    },
  };
}
export const terminal = makeTerminal();

// ---------------------------------------------------------------- file

const TEXT_LENGTH = [26, 38, 34, 38, 24];

export interface FileOptions { lines?: number; color?: string }
/** A document page with a folded corner and `lines` lines of text (0–5, default 3). */
export function makeFile({ lines = 3, color = "blue" }: FileOptions = {}): Block {
  const n = clamp(lines, 0, 5);
  const ys = Array.from({ length: n }, (_, i) => 36 + 13 * i);
  return {
    id: "file",
    title: "File",
    describe: "a document file: a page with a folded corner and lines of text; set lines (0-5)",
    tags: ["file", "document", "page", "data", "save", "text"],
    size: [80, 100],
    parts: [
      { id: "page", label: "page", shapes: [{ type: "path", d: "M10 4 L50 4 L70 24 L70 96 L10 96 Z", stroke: color, fill: tint(color) }] },
      { id: "corner", label: "folded corner", shapes: [line("M50 4 L50 24 L70 24", color)] },
      ...ys.map((y, i) => ({ id: `line-${i}`, label: `line ${i + 1} of text`, shapes: [line(`M20 ${y} L${20 + TEXT_LENGTH[i]} ${y}`, color)] })),
    ],
    anchors: {
      center: [40, 52], top: [30, 4], bottom: [40, 96], left: [10, 50], right: [70, 56], corner: [58, 16],
      ...Object.fromEntries(ys.map((y, i) => [`line-${i}`, [20 + TEXT_LENGTH[i] / 2, y] as P])),
    },
  };
}
export const file = makeFile();

// ---------------------------------------------------------------- folder

export interface FolderOptions { files?: number; color?: string }
/** A folder with a tab and `files` sheets peeking out of the top (0–3, default 1). */
export function makeFolder({ files = 1, color = "blue" }: FolderOptions = {}): Block {
  const n = clamp(files, 0, 3);
  const [tabTop, backTop, frontTop, bottom] = [28, 40, 56, 92];
  const w = [0, 36, 32, 26][n];
  const span = n ? w + 14 * (n - 1) : 0;
  const x0 = 60 - span / 2;
  const sheets = Array.from({ length: n }, (_, i) => ({ x: x0 + 14 * i, top: backTop - 6 - 10 * (n - 1 - i) }));
  // The back panel's top edge, hidden where the sheets stand in front of it.
  const back = n
    ? `M8 ${frontTop} L8 ${tabTop} L28 ${tabTop} L32 ${backTop} L${r1(x0)} ${backTop} M${r1(x0 + span)} ${backTop} L92 ${backTop} L92 ${frontTop}`
    : `M8 ${frontTop} L8 ${tabTop} L28 ${tabTop} L32 ${backTop} L92 ${backTop} L92 ${frontTop}`;
  return {
    id: "folder",
    title: "Folder",
    describe: "a folder with a tab and sheets of paper peeking out of the top; set files (0-3)",
    tags: ["folder", "directory", "files", "storage", "organise", "documents"],
    size: [100, 96],
    parts: [
      { id: "back", label: "back of the folder", shapes: [line(back, color, 1)] },
      ...sheets.map(({ x, top }, i) => {
        const nextTop = i < n - 1 ? sheets[i + 1].top : frontTop;
        return { id: `file-${i}`, label: `file ${i + 1}`, shapes: [line(poly([[x, frontTop], [x, top], [x + w, top], [x + w, nextTop]]), color, 0.8)] };
      }),
      { id: "front", label: "front of the folder", shapes: [{ type: "path", d: `M4 ${frontTop} L96 ${frontTop} L92 ${bottom} L8 ${bottom} Z`, stroke: color, fill: tint(color) }] },
    ],
    anchors: {
      center: [50, 70], top: [50, n ? sheets[0].top : tabTop], bottom: [50, bottom], left: [4, 72], right: [96, 72],
      tab: [18, 34], front: [50, 74], inside: [50, frontTop - 6],
      ...Object.fromEntries(sheets.map(({ x, top }, i) => [`file-${i}`, [r1(x + w / 2), top + 6] as P])),
    },
  };
}
export const folder = makeFolder();

// ---------------------------------------------------------------- database

export interface DatabaseOptions { disks?: number; color?: string }
/** A database: `disks` stacked cylinders (2–5, default 3), disk-0 on top. */
export function makeDatabase({ disks = 3, color = "blue" }: DatabaseOptions = {}): Block {
  const n = clamp(disks, 2, 5);
  const dh = [0, 0, 20, 18, 16, 14][n];
  const ry = 10, top = 4 + ry;
  const h = top + n * dh + ry + 4;
  const k = (ry * 4) / 3;
  const arc = (y: number) => `M10 ${y} C10 ${r1(y + k)} 90 ${r1(y + k)} 90 ${y}`;
  const parts: Part[] = Array.from({ length: n }, (_, i) => {
    const y0 = top + i * dh, y1 = y0 + dh;
    return {
      id: `disk-${i}`,
      label: i === 0 ? "top disk" : `disk ${i + 1}`,
      shapes: [
        ...(i === 0 ? [{ type: "ellipse" as const, cx: 50, cy: top, rx: 40, ry, stroke: color, fill: tint(color) }] : []),
        line(`M10 ${y0} L10 ${y1} M90 ${y0} L90 ${y1}`, color, 1),
        line(arc(y1), color, 1),
      ],
    };
  });
  return {
    id: "database",
    title: "Database",
    describe: "a database drawn as a stack of disks (cylinders); where data is stored; set disks (2-5)",
    tags: ["database", "data", "storage", "server", "sql", "records"],
    size: [100, h],
    parts,
    anchors: {
      ...edges(100, h), top: [50, 4], bottom: [50, h - 4], left: [10, h / 2], right: [90, h / 2], lid: [50, top],
      input: [50, 4], output: [50, h - 4],
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`disk-${i}`, [50, top + i * dh + dh / 2 + (i === 0 ? 0 : 4)] as P])),
    },
  };
}
export const database = makeDatabase();

// ---------------------------------------------------------------- bug

export interface ColorOptions { color?: string }

/** A software bug: a beetle with six legs and antennae. */
export function makeBug({ color = "red" }: ColorOptions = {}): Block {
  return {
    id: "bug",
    title: "Bug",
    describe: "a software bug drawn as a beetle; an error or fault in a program",
    tags: ["bug", "error", "debugging", "fault", "glitch", "testing"],
    size: [100, 100],
    parts: [
      { id: "legs", label: "legs", shapes: [line("M31 46 L18 40 L10 30 M28 62 L10 62 M31 76 L18 82 L12 94 M69 46 L82 40 L90 30 M72 62 L90 62 M69 76 L82 82 L88 94", color, 0.9)] },
      { id: "antennae", label: "antennae", shapes: [line("M44 16 C40 9 34 6 26 6 M56 16 C60 9 66 6 74 6", color, 0.9)] },
      { id: "body", label: "body", shapes: [{ type: "ellipse", cx: 50, cy: 62, rx: 22, ry: 28, stroke: color, fill: tint(color) }] },
      { id: "head", label: "head", shapes: [{ type: "ellipse", cx: 50, cy: 25, rx: 13, ry: 10, stroke: color, fill: tint(color) }] },
      { id: "wings", label: "wing cases", shapes: [line("M50 35 L50 90", color)] },
    ],
    anchors: { center: [50, 60], top: [50, 6], bottom: [50, 92], left: [10, 62], right: [90, 62], head: [50, 25], body: [50, 62], legs: [12, 62], antennae: [26, 6] },
  };
}
export const bug = makeBug();

// ---------------------------------------------------------------- gear

export interface GearOptions { teeth?: number; color?: string }
/** A gear (settings, processing) with `teeth` teeth (6–12, default 8) and a hub. */
export function makeGear({ teeth = 8, color = "grey" }: GearOptions = {}): Block {
  const n = clamp(teeth, 6, 12);
  const R = 46, r = 34, step = (Math.PI * 2) / n;
  const pts: P[] = [];
  const tips: P[] = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + k * step;
    for (const [da, rad] of [[-0.29, r], [-0.16, R], [0.16, R], [0.29, r]] as const) pts.push([50 + Math.cos(a + da * step) * rad, 50 + Math.sin(a + da * step) * rad]);
    tips.push([r1(50 + Math.cos(a) * R), r1(50 + Math.sin(a) * R)]);
  }
  return {
    id: "gear",
    title: "Gear",
    describe: "a toothed gear; settings, processing or a working machine; set teeth (6-12)",
    tags: ["gear", "settings", "process", "machine", "configuration", "engineering"],
    size: [100, 100],
    parts: [
      { id: "gear", label: "gear wheel", shapes: [{ type: "path", d: poly(pts, true), stroke: color, fill: tint(color) }] },
      { id: "hub", label: "hub", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 13, ry: 13, stroke: color, fill: "board" }] },
    ],
    anchors: { center: [50, 50], top: [50, 4], bottom: [50, 96], left: [4, 50], right: [96, 50], hub: [50, 50], ...Object.fromEntries(tips.map((p, i) => [`tooth-${i}`, p])) },
  };
}
export const gear = makeGear();

// ---------------------------------------------------------------- lock

export interface LockOptions { open?: boolean; color?: string }
/** A padlock with a keyhole, locked or (`open`) with the shackle lifted. */
export function makeLock({ open = false, color = "red" }: LockOptions = {}): Block {
  const shackle = open ? "M56 50 L56 24 C56 2 24 2 24 24 L24 34" : "M24 50 L24 30 C24 8 56 8 56 30 L56 50";
  return {
    id: "lock",
    title: open ? "Open Lock" : "Lock",
    describe: "a padlock with a keyhole; security, privacy and encryption; set open for an unlocked padlock",
    tags: ["lock", "security", "password", "encryption", "privacy", "padlock"],
    size: [80, 100],
    parts: [
      { id: "shackle", label: "shackle", shapes: [line(shackle, color, 1)] },
      { id: "body", label: "lock body", shapes: [box(8, 50, 64, 46, color, tint(color), 6)] },
      { id: "keyhole", label: "keyhole", shapes: [{ type: "ellipse", cx: 40, cy: 68, rx: 5, ry: 5, stroke: color, width: 0.8 }, line("M40 73 L40 84", color)] },
    ],
    anchors: { center: [40, 60], top: [40, open ? 8 : 13], bottom: [40, 96], left: [8, 73], right: [72, 73], shackle: [open ? 40 : 40, open ? 8 : 13], body: [40, 73], keyhole: [40, 72] },
  };
}
export const lock = makeLock();

// ---------------------------------------------------------------- key

/** A key: a round bow, a shaft and two teeth. */
export function makeKey({ color = "red" }: ColorOptions = {}): Block {
  return {
    id: "key",
    title: "Key",
    describe: "a key with a round bow and teeth; passwords, access and encryption keys",
    tags: ["key", "password", "access", "encryption", "security", "unlock"],
    size: [100, 56],
    parts: [
      { id: "bow", label: "bow", shapes: [{ type: "ellipse", cx: 24, cy: 26, rx: 20, ry: 20, stroke: color, fill: tint(color) }, dot(18, 26, 5, color)] },
      { id: "shaft", label: "shaft", shapes: [line("M44 26 L94 26", color, 1)] },
      { id: "teeth", label: "teeth", shapes: [line("M70 26 L70 42 M84 26 L84 46", color, 1)] },
    ],
    anchors: { center: [50, 28], top: [24, 6], bottom: [77, 46], left: [4, 26], right: [94, 26], bow: [24, 26], shaft: [58, 26], teeth: [77, 38], tip: [94, 26] },
  };
}
export const key = makeKey();

// ---------------------------------------------------------------- user

type Person = { x: number; base: number; s: number };
const headOf = ({ x, base, s }: Person): [P, number] => [[x, base - 66 * s], 16 * s];
function shoulderCurve({ x, base, s }: Person): P[] {
  const q = (dx: number, dy: number): P => [x + dx * s, base + dy * s];
  const pts: P[] = [];
  for (let i = 0; i <= 12; i++) pts.push(cubicAt(q(-36, 0), q(-36, -28), q(-20, -40), q(0, -40), i / 12));
  for (let i = 1; i <= 12; i++) pts.push(cubicAt(q(0, -40), q(20, -40), q(36, -28), q(36, 0), i / 12));
  return pts;
}
function circlePts([c, r]: [P, number], k = 28): P[] {
  return Array.from({ length: k }, (_, i) => [c[0] + Math.cos((i / k) * Math.PI * 2) * r, c[1] + Math.sin((i / k) * Math.PI * 2) * r]);
}
function inside(p: P, poly: P[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** The stretches of an outline not hidden behind any of the occluders, as one path. */
function visible(points: P[], closed: boolean, occluders: P[][]): string {
  const shown = points.map((p) => !occluders.some((o) => inside(p, o)));
  if (shown.every(Boolean)) return closed ? smooth(points, true) : smooth(points);
  let start = 0;
  if (closed) start = shown.indexOf(false);
  const runs: P[][] = [];
  let run: P[] = [];
  for (let k = 0; k <= points.length; k++) {
    const i = (start + k) % points.length;
    if (k === points.length && !closed) break;
    if (shown[i]) run.push(points[i]);
    else if (run.length) (runs.push(run), (run = []));
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1).map((r) => smooth(r)).join(" ");
}

export interface UserOptions { people?: number; color?: string }
/** A user: head and shoulders; `people` 2 or 3 make a team, the middle (or left) one in front. */
export function makeUser({ people = 1, color = "blue" }: UserOptions = {}): Block {
  const n = clamp(people, 1, 3);
  const h = [0, 100, 84, 80][n];
  const crowd: Person[] =
    n === 1 ? [{ x: 50, base: 96, s: 1.1 }]
    : n === 2 ? [{ x: 37, base: 80, s: 0.95 }, { x: 68, base: 80, s: 0.8 }]
    : [{ x: 26, base: 76, s: 0.68 }, { x: 50, base: 76, s: 0.9 }, { x: 74, base: 76, s: 0.68 }];
  const front = n === 2 ? 0 : n === 3 ? 1 : 0;
  const frontBody = [...shoulderCurve(crowd[front])];
  const occluders = [frontBody, circlePts(headOf(crowd[front]))];
  const parts: Part[] = crowd.map((p, i) => {
    const [c, r] = headOf(p);
    const body = shoulderCurve(p);
    const isFront = i === front;
    const bodyD = isFront ? smooth(body) + " Z" : visible(body, false, occluders);
    return {
      id: `person-${i}`,
      label: n === 1 ? "user" : `person ${i + 1}`,
      shapes: [
        { type: "ellipse", cx: r1(c[0]), cy: r1(c[1]), rx: r1(r), ry: r1(r), stroke: color, fill: tint(color) },
        { type: "path", d: bodyD, stroke: color, ...(isFront ? { fill: tint(color) } : {}) },
      ],
    };
  });
  const order = n === 1 ? [0] : n === 2 ? [1, 0] : [0, 2, 1];
  return {
    id: "user",
    title: n === 1 ? "User" : "Team",
    describe: "a user: a person's head and shoulders; set people (2-3) for a team of users",
    tags: ["user", "person", "account", "profile", "team", "people"],
    size: [100, h],
    parts: order.map((i) => parts[i]),
    anchors: {
      ...edges(100, h), top: [crowd[front].x, r1(headOf(crowd[front])[0][1] - headOf(crowd[front])[1])],
      head: [crowd[front].x, r1(headOf(crowd[front])[0][1])],
      ...Object.fromEntries(crowd.map((p, i) => [`person-${i}`, [p.x, r1(p.base - 20 * p.s)] as P])),
      ...Object.fromEntries(crowd.map((p, i) => [`head-${i}`, [p.x, r1(headOf(p)[0][1])] as P])),
    },
  };
}
export const user = makeUser();

// ---------------------------------------------------------------- chat

function bubble(x0: number, y0: number, x1: number, y1: number, tailLeft: boolean): string {
  const r = 8;
  const tail = tailLeft
    ? `L${x0 + 24} ${y1} L${x0 + 8} ${y1 + 9} L${x0 + 12} ${y1}`
    : `L${x1 - 12} ${y1} L${x1 - 8} ${y1 + 9} L${x1 - 24} ${y1}`;
  return `M${x0 + r} ${y0} L${x1 - r} ${y0} Q${x1} ${y0} ${x1} ${y0 + r} L${x1} ${y1 - r} Q${x1} ${y1} ${x1 - r} ${y1} ${tail} L${x0 + r} ${y1} Q${x0} ${y1} ${x0} ${y1 - r} L${x0} ${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} Z`;
}

export interface ChatOptions { bubbles?: number; color?: string }
/** A chat: `bubbles` speech bubbles (1–3, default 2), alternating left and right. */
export function makeChat({ bubbles = 2, color = "blue" }: ChatOptions = {}): Block {
  const n = clamp(bubbles, 1, 3);
  const bh = [0, 34, 28, 20][n];
  const h = 4 + n * bh + (n - 1) * 12 + 12;
  const boxes = Array.from({ length: n }, (_, i) => {
    const y0 = 4 + i * (bh + 12);
    const left = i % 2 === 0;
    const [x0, x1] = n === 1 ? [10, 90] : left ? [4, 70] : [30, 96];
    return { x0, x1, y0, y1: y0 + bh, left };
  });
  return {
    id: "chat",
    title: "Chat",
    describe: "a chat conversation: speech bubbles alternating left and right; messaging; set bubbles (1-3)",
    tags: ["chat", "message", "conversation", "messaging", "reply", "chatbot"],
    size: [100, h],
    parts: boxes.map(({ x0, x1, y0, y1, left }, i) => ({
      id: `bubble-${i}`,
      label: `message ${i + 1}`,
      shapes: [
        { type: "path", d: bubble(x0, y0, x1, y1, left), stroke: color, fill: i % 2 ? "board" : tint(color) },
        ...(bh >= 28 ? [line(`M${x0 + 12} ${(y0 + y1) / 2} L${x1 - 18} ${(y0 + y1) / 2}`, color)] : []),
      ],
    })),
    anchors: {
      ...edges(100, h),
      ...Object.fromEntries(boxes.map(({ x0, x1, y0, y1 }, i) => [`bubble-${i}`, [(x0 + x1) / 2, (y0 + y1) / 2] as P])),
      ...Object.fromEntries(boxes.map(({ x0, x1, y0, y1, left }, i) => [`speaker-${i}`, [left ? x0 + 8 : x1 - 8, y1 + 9] as P])),
    },
  };
}
export const chat = makeChat();

// ---------------------------------------------------------------- search

/** A magnifying glass: search, find, look up. */
export function makeSearch({ color = "blue" }: ColorOptions = {}): Block {
  return {
    id: "search",
    title: "Search",
    describe: "a magnifying glass; searching, finding and looking things up",
    tags: ["search", "find", "magnifying glass", "lookup", "query", "zoom"],
    size: [100, 100],
    parts: [
      { id: "handle", label: "handle", shapes: [{ type: "path", d: pill(66, 66, 89, 89, 7), stroke: color, fill: tint(color) }] },
      { id: "lens", label: "lens", shapes: [{ type: "ellipse", cx: 40, cy: 40, rx: 28, ry: 28, stroke: color, fill: "board" }, line("M24 40 Q24 26 38 24", color)] },
    ],
    anchors: { center: [50, 50], top: [40, 12], bottom: [80, 94], left: [12, 40], right: [94, 82], lens: [40, 40], handle: [80, 80] },
  };
}
export const search = makeSearch();

// ---------------------------------------------------------------- cursor

/** A mouse pointer arrow. */
export function makeCursor({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "cursor",
    title: "Cursor",
    describe: "a mouse pointer arrow; clicking, pointing, selecting on screen",
    tags: ["cursor", "pointer", "mouse", "click", "select", "interface"],
    size: [72, 100],
    parts: [{ id: "pointer", label: "pointer", shapes: [{ type: "path", d: "M10 4 L10 78 L27 62 L39 92 L53 86 L41 57 L63 57 Z", stroke: color, fill: "board" }] }],
    anchors: { center: [32, 50], top: [10, 4], bottom: [46, 90], left: [10, 50], right: [63, 57], tip: [10, 4], tail: [46, 89] },
  };
}
export const cursor = makeCursor();

// ---------------------------------------------------------------- globe

/** A globe of meridians and latitudes: the internet, the world wide web. */
export function makeGlobe({ color = "green" }: ColorOptions = {}): Block {
  return {
    id: "globe",
    title: "Globe",
    describe: "a wireframe globe with meridians and latitudes; the internet, the world wide web, worldwide",
    tags: ["internet", "web", "globe", "world", "online", "network"],
    size: [100, 100],
    parts: [
      { id: "globe", label: "globe", shapes: [{ type: "ellipse", cx: 50, cy: 50, rx: 44, ry: 44, stroke: color, fill: tint(color) }] },
      { id: "meridians", label: "meridians", shapes: [{ type: "path", d: oval(50, 50, 18, 44), stroke: color, width: 0.8 }] },
      { id: "latitudes", label: "latitudes", shapes: [line("M6 50 L94 50 M13 28 Q50 36 87 28 M13 72 Q50 80 87 72", color)] },
    ],
    anchors: { center: [50, 50], top: [50, 6], bottom: [50, 94], left: [6, 50], right: [94, 50], equator: [72, 50], "north-pole": [50, 6], "south-pole": [50, 94] },
  };
}
export const globe = makeGlobe();

// ---------------------------------------------------------------- cloud computing

/** Cloud computing: a cloud linked down to three devices. */
export function makeCloudComputing({ color = "green" }: ColorOptions = {}): Block {
  const devices: [number, number][] = [[16, 85], [50, 85], [84, 85]];
  return {
    id: "cloud-computing",
    title: "Cloud Computing",
    describe: "cloud computing: a cloud connected to three devices below; online storage and services",
    tags: ["cloud", "cloud computing", "server", "online", "storage", "internet"],
    size: [100, 96],
    parts: [
      { id: "cloud", label: "the cloud", shapes: [{ type: "path", d: "M24 54 C8 54 5 32 22 30 C22 12 44 6 54 18 C61 6 85 9 84 28 C99 30 98 54 80 54 Z", stroke: color, fill: tint(color) }] },
      { id: "links", label: "connections", shapes: [line("M32 56 L18 76 M50 56 L50 76 M68 56 L82 76", color)] },
      ...devices.map(([x, y], i) => ({ id: `device-${i}`, label: `device ${i + 1}`, shapes: [box(x - 11, y - 8, 22, 16, color, "board", 3, 0.9)] })),
    ],
    anchors: {
      center: [50, 50], top: [54, 8], bottom: [50, 92], left: [6, 42], right: [96, 42], cloud: [52, 36],
      ...Object.fromEntries(devices.map((p, i) => [`device-${i}`, p])),
    },
  };
}
export const cloudComputing = makeCloudComputing();

// ---------------------------------------------------------------- email

/** An envelope: email, a message sent. */
export function makeEmail({ color = "blue" }: ColorOptions = {}): Block {
  return {
    id: "email",
    title: "Email",
    describe: "a closed envelope; email, sending and receiving a message",
    tags: ["email", "envelope", "message", "mail", "inbox", "send"],
    size: [100, 72],
    parts: [
      { id: "envelope", label: "envelope", shapes: [box(4, 4, 92, 64, color, tint(color), 5)] },
      { id: "flap", label: "flap", shapes: [line("M7 8 L50 42 L93 8", color, 1)] },
    ],
    anchors: { ...edges(100, 72), flap: [50, 42], center: [50, 40] },
  };
}
export const email = makeEmail();

// ---------------------------------------------------------------- firewall

/** A firewall: a brick wall with a flame on top. */
export function makeFirewall({ color = "red" }: ColorOptions = {}): Block {
  const rows = [38, 52, 66, 80, 94];
  const seams = rows.slice(0, 4).map((y, i) => {
    const xs = i % 2 ? [17, 39, 61, 83] : [28, 50, 72];
    return xs.map((x) => `M${x} ${y} L${x} ${y + 14}`).join(" ");
  });
  return {
    id: "firewall",
    title: "Firewall",
    describe: "a firewall: a brick wall with a flame on top; network security that blocks unwanted traffic",
    tags: ["firewall", "security", "network", "protection", "block", "traffic"],
    size: [100, 100],
    parts: [
      { id: "flame", label: "flame", shapes: [{ type: "path", d: smooth([[36, 38], [30, 26], [36, 12], [42, 20], [50, 4], [58, 18], [64, 10], [70, 26], [64, 38]]), stroke: "orange", fill: "orange-tint" }] },
      { id: "wall", label: "wall", shapes: [box(6, 38, 88, 56, color, tint(color), 2)] },
      { id: "bricks", label: "bricks", shapes: [line(rows.slice(1, 4).map((y) => `M6 ${y} L94 ${y}`).join(" ") + " " + seams.join(" "), color)] },
    ],
    anchors: {
      center: [50, 60], top: [50, 4], bottom: [50, 94], left: [6, 66], right: [94, 66], wall: [50, 66], flame: [50, 24],
      outside: [2, 66], inside: [98, 66], ...Object.fromEntries(rows.slice(0, 4).map((y, i) => [`row-${i}`, [50, y + 7] as P])),
    },
  };
}
export const firewall = makeFirewall();

// ---------------------------------------------------------------- link

/** A chain link: two interlocked links; a hyperlink or a connection. */
export function makeLink({ color = "blue" }: ColorOptions = {}): Block {
  return {
    id: "link",
    title: "Link",
    describe: "two interlocked chain links; a hyperlink, URL or connection between things",
    tags: ["link", "hyperlink", "url", "chain", "connect", "web"],
    size: [100, 100],
    parts: [
      { id: "link-0", label: "first link", shapes: [{ type: "path", d: pill(26, 74, 46, 54, 15), stroke: color }] },
      { id: "link-1", label: "second link", shapes: [{ type: "path", d: pill(54, 46, 74, 26, 15), stroke: color }] },
    ],
    anchors: { center: [50, 50], top: [74, 12], bottom: [26, 88], left: [12, 74], right: [88, 26], "link-0": [34, 66], "link-1": [66, 34], head: [26, 74], tail: [74, 26] },
  };
}
export const link = makeLink();
