// Computing devices and hardware: computers and their parts, peripherals, and network gear.
import { poly, smooth, type P } from "../geometry";
import type { Block, Shape } from "../types";

const f = (v: number) => +v.toFixed(1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
/** The pale fill that goes with a line colour (ink and grey use grey-tint). */
const tint = (color: string) => (color === "ink" || color === "grey" ? "grey-tint" : `${color}-tint`);
const line = (d: string, stroke: string, width = 0.8): Shape => ({ type: "path", d, stroke, width });
const box = (x: number, y: number, w: number, h: number, stroke: string, fill?: string, r = 3, width = 1): Shape =>
  ({ type: "rect", x, y, w, h, r, stroke, ...(fill ? { fill } : {}), width });
const dot = (cx: number, cy: number, r: number, stroke: string, fill?: string, width = 0.8): Shape =>
  ({ type: "ellipse", cx, cy, rx: r, ry: r, stroke, ...(fill ? { fill } : {}), width });
const sides = (w: number, h: number): Record<string, P> => ({ center: [w / 2, h / 2], top: [w / 2, 0], bottom: [w / 2, h], left: [0, h / 2], right: [w, h / 2] });

/** A circular arc about (cx, cy) from angle a0 to a1 (degrees, 0 = right, 90 = down), as cubics. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  const step = ((a1 - a0) / segs) * (Math.PI / 180);
  const k = (4 / 3) * Math.tan(step / 4) * r;
  let a = a0 * (Math.PI / 180);
  let d = `M${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  for (let i = 0; i < segs; i++) {
    const b = a + step;
    const p0: P = [cx + r * Math.cos(a), cy + r * Math.sin(a)], p3: P = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    const c1: P = [p0[0] - k * Math.sin(a), p0[1] + k * Math.cos(a)], c2: P = [p3[0] + k * Math.sin(b), p3[1] - k * Math.cos(b)];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p3[0])} ${f(p3[1])}`;
    a = b;
  }
  return d;
}

/** Scale a block drawn in any box so its longer side is 100. */
function fit(block: Block): Block {
  const s = 100 / Math.max(...block.size);
  if (Math.abs(s - 1) < 1e-6) return block;
  const k = (v: number) => f(v * s);
  const shape = (sh: Shape): Shape =>
    sh.type === "path" ? { ...sh, d: sh.d.replace(/-?\d+(\.\d+)?/g, (m) => String(k(+m))) }
    : sh.type === "rect" ? { ...sh, x: k(sh.x), y: k(sh.y), w: k(sh.w), h: k(sh.h), ...(sh.r !== undefined ? { r: k(sh.r) } : {}) }
    : { ...sh, cx: k(sh.cx), cy: k(sh.cy), rx: k(sh.rx), ry: k(sh.ry) };
  return {
    ...block,
    size: [k(block.size[0]), k(block.size[1])],
    parts: block.parts.map((p) => ({ ...p, shapes: p.shapes.map(shape) })),
    anchors: Object.fromEntries(Object.entries(block.anchors).map(([n, [x, y]]) => [n, [k(x), k(y)]])),
  };
}

export interface ColorOptions { color?: string }

// ---------------------------------------------------------------- laptop

/** An open laptop: screen in the lid, keyboard base. */
export function makeLaptop({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "laptop",
    title: "Laptop",
    describe: "an open laptop with its screen in the lid and the keyboard base below; a personal computer",
    tags: ["laptop", "computer", "device", "hardware", "screen", "portable"],
    size: [100, 70],
    parts: [
      { id: "lid", label: "lid", shapes: [box(14, 4, 72, 48, color, tint(color), 5)] },
      { id: "screen", label: "screen", shapes: [box(24, 14, 52, 28, color, "blue-tint", 2, 0.8)] },
      { id: "base", label: "keyboard base", shapes: [{ type: "path", d: "M14 52 L86 52 L98 66 L2 66 Z", stroke: color, fill: tint(color) }] },
    ],
    anchors: { ...sides(100, 70), top: [50, 4], bottom: [50, 66], left: [2, 64], right: [98, 64], center: [50, 34], screen: [50, 28], keyboard: [50, 59], hinge: [50, 52] },
  };
}
export const laptop = makeLaptop();

// ---------------------------------------------------------------- monitor

/** A desktop monitor on a stand. */
export function makeMonitor({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "monitor",
    title: "Monitor",
    describe: "a desktop computer monitor (display, screen) on a stand; output from a computer",
    tags: ["monitor", "display", "screen", "output", "computer", "hardware"],
    size: [100, 90],
    parts: [
      { id: "stand", label: "stand", shapes: [line("M44 64 L 42 80 M56 64 L 58 80", color, 1), box(26, 80, 48, 8, color, tint(color), 3)] },
      { id: "frame", label: "frame", shapes: [box(4, 4, 92, 60, color, tint(color), 5)] },
      { id: "screen", label: "screen", shapes: [box(14, 14, 72, 40, color, "blue-tint", 2, 0.8)] },
    ],
    anchors: { ...sides(100, 90), top: [50, 4], bottom: [50, 88], left: [4, 34], right: [96, 34], center: [50, 34], screen: [50, 34], stand: [50, 82], input: [50, 72] },
  };
}
export const monitor = makeMonitor();

// ---------------------------------------------------------------- keyboard

export interface KeyboardOptions { rows?: number; color?: string }
/** A keyboard with `rows` rows of keys (2–4, default 3), the last with a space bar. */
export function makeKeyboard({ rows = 3, color = "ink" }: KeyboardOptions = {}): Block {
  const n = clamp(rows, 2, 4);
  const R = 16, top = 10, x0 = 8, x1 = 92, h = top * 2 + n * R;
  const parts: Block["parts"] = [
    { id: "case", label: "case", shapes: [box(2, 2, 96, h - 4, color, tint(color), 5)] },
    { id: "keys", label: "keys", shapes: [box(x0, top, x1 - x0, n * R, color, "board", 2, 0.8)] },
  ];
  const anchors: Record<string, P> = { ...sides(100, h), top: [50, 2], bottom: [50, h - 2], left: [2, h / 2], right: [98, h / 2], output: [50, 2] };
  for (let i = 0; i < n; i++) {
    const y = top + i * R, last = i === n - 1;
    const xs = last ? [28, 72] : Array.from({ length: 6 }, (_, j) => x0 + 14 * j + (i % 2 ? 14 : 7)).filter((x) => x < x1 - 6);
    const d = xs.map((x) => `M${f(x)} ${y} L ${f(x)} ${y + R}`).join(" ") + (last ? "" : ` M${x0} ${y + R} L ${x1} ${y + R}`);
    parts.push({ id: `row-${i}`, label: last ? "bottom row with the space bar" : `key row ${i + 1}`, shapes: [line(d, color)] });
    anchors[`row-${i}`] = [50, y + R / 2];
  }
  anchors.spacebar = [50, top + (n - 1) * R + R / 2];
  return {
    id: "keyboard",
    title: "Keyboard",
    describe: "a computer keyboard with rows of keys and a space bar; an input device; set rows (2-4)",
    tags: ["keyboard", "input", "keys", "typing", "hardware", "peripheral"],
    size: [100, h],
    parts,
    anchors,
  };
}
export const keyboard = makeKeyboard();

// ---------------------------------------------------------------- mouse

/** A computer mouse with two buttons, a scroll wheel and its cable. */
export function makeMouse({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "mouse",
    title: "Mouse",
    describe: "a computer mouse with left and right buttons, a scroll wheel and a cable; an input device",
    tags: ["mouse", "input", "click", "pointer", "hardware", "peripheral"],
    size: [64, 100],
    parts: [
      { id: "cable", label: "cable", shapes: [line("M32 22 C 32 10, 44 10, 46 2", color, 1)] },
      { id: "body", label: "body", shapes: [box(6, 22, 52, 76, color, tint(color), 26)] },
      { id: "buttons", label: "buttons", shapes: [line("M6 52 C 22 56, 42 56, 58 52 M32 22 L 32 28 M32 46 L 32 54", color)] },
      { id: "wheel", label: "scroll wheel", shapes: [box(27, 29, 10, 16, color, "board", 5, 0.8)] },
    ],
    anchors: { ...sides(64, 100), top: [32, 22], bottom: [32, 98], left: [6, 60], right: [58, 60], center: [32, 62], "left-button": [18, 38], "right-button": [46, 38], wheel: [32, 37], cable: [46, 2], output: [46, 2] },
  };
}
export const mouse = makeMouse();

// ---------------------------------------------------------------- phone

/** A smartphone with its screen and home button. */
export function makePhone({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "phone",
    title: "Phone",
    describe: "a smartphone (mobile phone) with a touch screen and a home button",
    tags: ["phone", "smartphone", "mobile", "device", "screen", "touch"],
    size: [58, 100],
    parts: [
      { id: "body", label: "body", shapes: [box(4, 2, 50, 96, color, tint(color), 9)] },
      { id: "screen", label: "screen", shapes: [box(12, 12, 34, 68, color, "blue-tint", 2, 0.8)] },
      { id: "button", label: "home button", shapes: [dot(29, 89, 3.5, color, "board")] },
    ],
    anchors: { ...sides(58, 100), top: [29, 2], bottom: [29, 98], left: [4, 50], right: [54, 50], center: [29, 50], screen: [29, 46], button: [29, 89] },
  };
}
export const phone = makePhone();

// ---------------------------------------------------------------- server

/** A tower server: a tall case with two drive bays, a power button and vents. */
export function makeServer({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "server",
    title: "Server",
    describe: "a tower server (computer case) with drive bays, a power button and vents; a computer that serves others",
    tags: ["server", "computer", "tower", "hardware", "hosting", "backend"],
    size: [64, 100],
    parts: [
      { id: "case", label: "case", shapes: [box(6, 2, 52, 96, color, tint(color), 5)] },
      { id: "drive-0", label: "drive bay 1", shapes: [box(16, 14, 32, 12, color, "board", 2, 0.8)] },
      { id: "drive-1", label: "drive bay 2", shapes: [box(16, 38, 32, 12, color, "board", 2, 0.8)] },
      { id: "power", label: "power button", shapes: [dot(32, 66, 6, color, "green-tint")] },
      { id: "vents", label: "vents", shapes: [line("M18 84 L 46 84", color)] },
    ],
    anchors: { ...sides(64, 100), top: [32, 2], bottom: [32, 98], left: [6, 50], right: [58, 50], "drive-0": [32, 20], "drive-1": [32, 44], power: [32, 66], vents: [32, 84], input: [6, 30], output: [58, 30] },
  };
}
export const server = makeServer();

// ---------------------------------------------------------------- server rack

export interface ServerRackOptions { units?: number; color?: string }
/** A rack of `units` stacked servers (2–6, default 3), each with a drive slot and two lights. */
export function makeServerRack({ units = 3, color = "ink" }: ServerRackOptions = {}): Block {
  const n = clamp(units, 2, 6);
  const W = Math.max(80, 50 + 14 * n), U = 22, top = 2, h = top + n * U + 14;
  const parts: Block["parts"] = [
    { id: "feet", label: "feet", shapes: [line(`M14 ${h - 14} L 14 ${h - 2} M${W - 14} ${h - 14} L ${W - 14} ${h - 2}`, color, 1)] },
    { id: "rack", label: "rack", shapes: [box(4, top, W - 8, n * U, color, tint(color), 4)] },
  ];
  const anchors: Record<string, P> = { ...sides(W, h), top: [W / 2, top], bottom: [W / 2, h - 2], left: [4, top + (n * U) / 2], right: [W - 4, top + (n * U) / 2], center: [W / 2, top + (n * U) / 2] };
  for (let i = 0; i < n; i++) {
    const y = top + i * U, cy = y + U / 2;
    parts.push({
      id: `unit-${i}`,
      label: `server ${i + 1}`,
      shapes: [
        ...(i ? [line(`M4 ${y} L ${W - 4} ${y}`, color)] : []),
        ...(n <= 4 ? [line(`M16 ${f(cy)} L ${f(W * 0.5)} ${f(cy)}`, color)] : []),
        dot(W - 28, cy, 2.5, "green", "green-tint"),
        dot(W - 16, cy, 2.5, "green", "green-tint"),
      ],
    });
    anchors[`unit-${i}`] = [W / 2, cy];
  }
  anchors.input = [4, top + U / 2];
  anchors.output = [W - 4, top + U / 2];
  return fit({
    id: "server-rack",
    title: "Server Rack",
    describe: "a rack of stacked servers, like in a data centre; set units (2-6 servers)",
    tags: ["server", "rack", "data centre", "cloud", "hosting", "hardware"],
    size: [W, h],
    parts,
    anchors,
  });
}
export const serverRack = makeServerRack();

// ---------------------------------------------------------------- cpu

export interface CpuOptions { pins?: number; color?: string }
/** A processor chip seen from above, with `pins` pins on each side (2–6, default 4). */
export function makeCpu({ pins = 4, color = "ink" }: CpuOptions = {}): Block {
  const n = clamp(pins, 2, 6);
  const lo = 22, hi = 78, at = (i: number) => (n === 1 ? 50 : lo + ((hi - lo) * i) / (n - 1));
  const segs: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = f(at(i));
    segs.push(`M${p} 4 L ${p} 16`, `M${p} 84 L ${p} 96`, `M4 ${p} L 16 ${p}`, `M84 ${p} L 96 ${p}`);
  }
  return {
    id: "cpu",
    title: "CPU",
    describe: "a CPU (processor, microchip) from above with pins on all four sides; the brain of a computer; set pins per side (2-6)",
    tags: ["cpu", "processor", "chip", "hardware", "compute", "microchip"],
    size: [100, 100],
    parts: [
      { id: "pins", label: "pins", shapes: [line(segs.join(" "), color)] },
      { id: "body", label: "chip", shapes: [box(16, 16, 68, 68, color, tint(color), 5)] },
      { id: "die", label: "core", shapes: [box(34, 34, 32, 32, color, "board", 2, 0.8)] },
    ],
    anchors: { ...sides(100, 100), top: [50, 4], bottom: [50, 96], left: [4, 50], right: [96, 50], die: [50, 50], core: [50, 50], "pins-top": [50, 10], "pins-bottom": [50, 90], "pins-left": [10, 50], "pins-right": [90, 50] },
  };
}
export const cpu = makeCpu();

// ---------------------------------------------------------------- gpu

export interface GpuOptions { fans?: number; color?: string }
/** A graphics card with `fans` cooling fans (1–3, default 2) and its connector along the bottom. */
export function makeGpu({ fans = 2, color = "ink" }: GpuOptions = {}): Block {
  const n = clamp(fans, 1, 3);
  const top = 4, bot = 50, cy = (top + bot) / 2;
  const slot = 84 / n, r = Math.min(17, slot / 2 - 3);
  const parts: Block["parts"] = [
    { id: "connector", label: "connector", shapes: [{ type: "path", d: "M20 50 L 20 60 L 62 60 L 62 50", stroke: color, fill: "orange-tint", width: 0.8 }] },
    { id: "card", label: "card", shapes: [box(4, top, 92, bot - top, color, tint(color), 5)] },
  ];
  const anchors: Record<string, P> = { ...sides(100, 62), top: [50, top], bottom: [41, 60], left: [4, cy], right: [96, cy], center: [50, cy], connector: [41, 56], input: [41, 60] };
  for (let i = 0; i < n; i++) {
    const cx = 8 + slot * (i + 0.5);
    const blades = [0, 120, 240].map((a) => {
      const t = (a * Math.PI) / 180, u = ((a + 70) * Math.PI) / 180;
      const p0: P = [cx + Math.cos(t) * r * 0.25, cy + Math.sin(t) * r * 0.25];
      const p1: P = [cx + Math.cos(t + 0.5) * r * 0.65, cy + Math.sin(t + 0.5) * r * 0.65];
      const p2: P = [cx + Math.cos(u) * r * 0.8, cy + Math.sin(u) * r * 0.8];
      return smooth([p0, p1, p2]);
    });
    parts.push({ id: `fan-${i}`, label: `fan ${i + 1}`, shapes: [dot(cx, cy, r, color, "board", 1), ...(r >= 12 ? [line(blades.join(" "), color)] : [dot(cx, cy, 2.5, color)])] });
    anchors[`fan-${i}`] = [f(cx), cy];
  }
  return {
    id: "gpu",
    title: "GPU",
    describe: "a GPU (graphics card) with cooling fans and its connector; for graphics and AI training; set fans (1-3)",
    tags: ["gpu", "graphics card", "hardware", "parallel", "ai", "compute"],
    size: [100, 62],
    parts,
    anchors,
  };
}
export const gpu = makeGpu();

// ---------------------------------------------------------------- ram

export interface RamOptions { chips?: number; color?: string }
/** A stick of RAM with `chips` memory chips in a row (2–8, default 4) and a notch in its contacts. */
export function makeRam({ chips = 4, color = "ink" }: RamOptions = {}): Block {
  const n = clamp(chips, 2, 8);
  const x0 = 10, x1 = 90, pitch = (x1 - x0) / n, gap = n > 5 ? 3 : 7, cw = pitch - gap;
  const parts: Block["parts"] = [
    { id: "board", label: "circuit board", shapes: [{ type: "path", d: "M2 2 L 98 2 L 98 38 L 64 38 L 64 32 L 56 32 L 56 38 L 2 38 Z", stroke: color, fill: "green-tint" }] },
  ];
  const anchors: Record<string, P> = { ...sides(100, 40), top: [50, 2], bottom: [50, 38], left: [2, 20], right: [98, 20], center: [50, 20], notch: [60, 34], contacts: [30, 38] };
  const chipParts: Block["parts"] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + pitch * i + gap / 2;
    chipParts.push({ id: `chip-${i}`, label: `memory chip ${i + 1}`, shapes: [box(f(x), 11, f(cw), 14, color, tint(color), 1.5, 0.8)] });
    anchors[`chip-${i}`] = [f(x + cw / 2), 18];
  }
  return {
    id: "ram",
    title: "RAM",
    describe: "a stick of RAM (memory module) with a row of memory chips; short-term working memory; set chips (2-8)",
    tags: ["ram", "memory", "hardware", "chips", "storage", "computer"],
    size: [100, 40],
    parts: [...parts, ...chipParts],
    anchors,
  };
}
export const ram = makeRam();

// ---------------------------------------------------------------- ssd

/** A solid-state drive: a flat case with a label and a connector at one end. */
export function makeSsd({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "ssd",
    title: "SSD",
    describe: "an SSD (solid-state drive) with its label and connector; long-term storage for files",
    tags: ["ssd", "storage", "drive", "disk", "hardware", "files"],
    size: [100, 64],
    parts: [
      { id: "case", label: "case", shapes: [box(4, 4, 92, 56, color, tint(color), 5)] },
      { id: "label", label: "label", shapes: [box(16, 16, 46, 32, color, "blue-tint", 2, 0.8)] },
      { id: "connector", label: "connector", shapes: [line("M80 18 L 80 46", color, 1), line("M90 22 L 90 42", color)] },
    ],
    anchors: { ...sides(100, 64), top: [50, 4], bottom: [50, 60], left: [4, 32], right: [96, 32], label: [39, 32], connector: [86, 32], input: [96, 32], output: [96, 32] },
  };
}
export const ssd = makeSsd();

// ---------------------------------------------------------------- battery

export interface BatteryOptions { level?: number; color?: string }
/** A battery on its side, `level` full (0–1, default 0.6): green charge, red when low. */
export function makeBattery({ level = 0.6, color = "ink" }: BatteryOptions = {}): Block {
  const l = Math.min(1, Math.max(0, level));
  const low = l < 0.25, cw = Math.max(4, 60 * l);
  return {
    id: "battery",
    title: "Battery",
    describe: "a battery on its side showing how charged it is; power and energy; set level (0-1)",
    tags: ["battery", "power", "energy", "charge", "hardware", "electricity"],
    size: [100, 52],
    parts: [
      { id: "terminal", label: "terminal", shapes: [box(88, 16, 8, 20, color, color === "ink" ? "grey-tint" : tint(color), 2)] },
      { id: "body", label: "body", shapes: [box(4, 4, 84, 44, color, "board", 7)] },
      { id: "charge", label: "charge", shapes: [box(16, 16, f(cw), 20, low ? "red" : "green", low ? "red-tint" : "green-tint", 2, 0.8)] },
    ],
    anchors: { ...sides(100, 52), top: [46, 4], bottom: [46, 48], left: [4, 26], right: [96, 26], center: [46, 26], charge: [f(16 + cw / 2), 26], terminal: [92, 26], positive: [96, 26], negative: [4, 26] },
  };
}
export const battery = makeBattery();

// ---------------------------------------------------------------- camera

/** A camera with a big lens, viewfinder bump and shutter button. */
export function makeCamera({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "camera",
    title: "Camera",
    describe: "a camera with a big lens, a viewfinder and a shutter button; an image input device",
    tags: ["camera", "photo", "image", "input", "sensor", "device"],
    size: [100, 78],
    parts: [
      { id: "shutter", label: "shutter button", shapes: [box(10, 10, 16, 10, color, tint(color), 2, 0.8)] },
      { id: "viewfinder", label: "viewfinder", shapes: [{ type: "path", d: "M30 20 L 38 4 L 62 4 L 70 20", stroke: color, fill: tint(color) }] },
      { id: "body", label: "body", shapes: [box(4, 20, 92, 54, color, tint(color), 7)] },
      { id: "lens", label: "lens", shapes: [dot(50, 47, 20, color, "board", 1), dot(50, 47, 8, color, "blue-tint")] },
    ],
    anchors: { ...sides(100, 78), top: [50, 4], bottom: [50, 74], left: [4, 47], right: [96, 47], center: [50, 47], lens: [50, 47], shutter: [18, 12], viewfinder: [50, 12], input: [50, 47] },
  };
}
export const camera = makeCamera();

// ---------------------------------------------------------------- microphone

/** A microphone on a stand: the grille head in a holder, a stem and a base. */
export function makeMicrophone({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "microphone",
    title: "Microphone",
    describe: "a microphone on a stand; turns sound into a signal; an audio input device",
    tags: ["microphone", "audio", "sound", "input", "voice", "recording"],
    size: [64, 100],
    parts: [
      { id: "head", label: "microphone head", shapes: [box(16, 4, 32, 50, color, tint(color), 16)] },
      { id: "grille", label: "grille", shapes: [line("M16 24 L 48 24 M16 38 L 48 38", color)] },
      { id: "holder", label: "holder", shapes: [line("M6 36 C 6 70, 58 70, 58 36", color, 1)] },
      { id: "stand", label: "stand", shapes: [line("M32 62 L 32 88", color, 1), box(14, 88, 36, 8, color, tint(color), 3)] },
    ],
    anchors: { ...sides(64, 100), top: [32, 4], bottom: [32, 96], left: [6, 36], right: [58, 36], center: [32, 40], head: [32, 28], input: [32, 4], stand: [32, 76], base: [32, 92] },
  };
}
export const microphone = makeMicrophone();

// ---------------------------------------------------------------- headphones

/** Over-ear headphones: a headband arching between two ear cups. */
export function makeHeadphones({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "headphones",
    title: "Headphones",
    describe: "over-ear headphones with a headband and two ear cups; an audio output device",
    tags: ["headphones", "audio", "sound", "output", "music", "listening"],
    size: [100, 90],
    parts: [
      { id: "band", label: "headband", shapes: [line(`M16 52 L 16 48 ${arc(50, 48, 34, 180, 360).replace(/^M[^C]*/, "")} L 84 52`, color, 1)] },
      { id: "left-cup", label: "left ear cup", shapes: [box(6, 48, 22, 38, color, tint(color), 9)] },
      { id: "right-cup", label: "right ear cup", shapes: [box(72, 48, 22, 38, color, tint(color), 9)] },
    ],
    anchors: { ...sides(100, 90), top: [50, 14], bottom: [50, 86], left: [6, 67], right: [94, 67], center: [50, 52], band: [50, 14], "left-cup": [17, 67], "right-cup": [83, 67], output: [17, 67] },
  };
}
export const headphones = makeHeadphones();

// ---------------------------------------------------------------- router

/** A home router: a flat box with two antennas and a row of lights. */
export function makeRouter({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "router",
    title: "Router",
    describe: "a network router with two antennas and status lights; connects devices to the internet",
    tags: ["router", "network", "internet", "wifi", "hardware", "connection"],
    size: [100, 70],
    parts: [
      { id: "antenna-0", label: "left antenna", shapes: [line("M22 38 L 14 4", color, 1)] },
      { id: "antenna-1", label: "right antenna", shapes: [line("M78 38 L 86 4", color, 1)] },
      { id: "body", label: "body", shapes: [box(4, 38, 92, 28, color, tint(color), 7)] },
      { id: "lights", label: "lights", shapes: [26, 42, 58].map((x) => dot(x, 52, 3, "green", "green-tint"))  },
    ],
    anchors: { ...sides(100, 70), top: [50, 4], bottom: [50, 66], left: [4, 52], right: [96, 52], center: [50, 52], "antenna-0": [14, 4], "antenna-1": [86, 4], lights: [42, 52], signal: [50, 10], input: [4, 52], output: [96, 52] },
  };
}
export const router = makeRouter();

// ---------------------------------------------------------------- wifi

export interface WifiOptions { bars?: number; color?: string }
/** The wifi signal symbol: a dot with `bars` arcs above it (1–4, default 3). */
export function makeWifi({ bars = 3, color = "green" }: WifiOptions = {}): Block {
  const n = clamp(bars, 1, 4);
  const R = (i: number) => 22 + 16 * i, rMax = R(n - 1);
  const half = rMax * Math.sin(Math.PI / 4);
  const W = 2 * half + 12, cx = W / 2, cy = rMax + 6, h = cy + 8;
  const parts: Block["parts"] = [{ id: "dot", label: "source", shapes: [dot(cx, cy, 4.5, color, tint(color), 1)] }];
  const anchors: Record<string, P> = { ...sides(W, h), top: [cx, cy - rMax], bottom: [cx, cy + 4], source: [cx, cy], dot: [cx, cy] };
  for (let i = 0; i < n; i++) {
    parts.push({ id: `bar-${i}`, label: `signal bar ${i + 1}`, shapes: [line(arc(cx, cy, R(i), 225, 315), color, 1)] });
    anchors[`bar-${i}`] = [cx, cy - R(i)];
  }
  anchors.center = [cx, cy - rMax / 2];
  return fit({
    id: "wifi",
    title: "Wi-Fi",
    describe: "the wifi signal symbol: a dot with arcs spreading above it; wireless network strength; set bars (1-4)",
    tags: ["wifi", "wireless", "signal", "network", "internet", "connection"],
    size: [f(W), f(h)],
    parts,
    anchors,
  });
}
export const wifi = makeWifi();

// ---------------------------------------------------------------- cable

/** A cable with a plug on the end. */
export function makeCable({ color = "ink" }: ColorOptions = {}): Block {
  return {
    id: "cable",
    title: "Cable",
    describe: "a cable curling to a plug; a wired connection for data or power",
    tags: ["cable", "wire", "plug", "connection", "usb", "network"],
    size: [100, 50],
    parts: [
      { id: "wire", label: "wire", shapes: [line(smooth([[4, 34], [18, 18], [32, 40], [46, 26], [58, 26]]), color, 1)] },
      { id: "plug", label: "plug", shapes: [box(58, 14, 24, 24, color, tint(color), 4)] },
      { id: "tip", label: "connector", shapes: [box(82, 18, 14, 16, color, "board", 1, 0.8)] },
    ],
    anchors: { ...sides(100, 50), left: [4, 34], right: [96, 26], center: [50, 26], "end-a": [4, 34], "end-b": [96, 26], plug: [70, 26], input: [4, 34], output: [96, 26] },
  };
}
export const cable = makeCable();

// ---------------------------------------------------------------- satellite

/** A satellite: a body with two solar panels and a dish. */
export function makeSatellite({ color = "ink" }: ColorOptions = {}): Block {
  const panel = (x: number) => [box(x, 34, 26, 30, color, "blue-tint", 2), line(`M${x + 13} 34 L ${x + 13} 64`, color)];
  return {
    id: "satellite",
    title: "Satellite",
    describe: "a satellite with two solar panels and a dish; space communication, GPS and broadcasting",
    tags: ["satellite", "space", "orbit", "communication", "gps", "signal"],
    size: [100, 70],
    parts: [
      { id: "arms", label: "arms", shapes: [line("M28 49 L 40 49 M60 49 L 72 49", color, 1)] },
      { id: "panel-left", label: "left solar panel", shapes: panel(2) },
      { id: "panel-right", label: "right solar panel", shapes: panel(72) },
      { id: "body", label: "body", shapes: [box(40, 32, 20, 34, color, tint(color), 3)] },
      { id: "dish", label: "dish", shapes: [line("M50 18 L 50 32", color, 1), { type: "path", d: "M28 4 Q 50 34 72 4 Z", stroke: color, fill: tint(color) }] },
    ],
    anchors: { ...sides(100, 70), top: [50, 4], bottom: [50, 66], left: [2, 49], right: [98, 49], center: [50, 40], dish: [50, 10], signal: [50, 4], "panel-left": [15, 49], "panel-right": [85, 49], body: [50, 49] },
  };
}
export const satellite = makeSatellite();

// ---------------------------------------------------------------- cell tower

export interface CellTowerOptions { waves?: number; color?: string }
/** A lattice phone mast with an antenna on top sending `waves` signal arcs each side (0–3, default 2). */
export function makeCellTower({ waves = 2, color = "ink" }: CellTowerOptions = {}): Block {
  const n = clamp(waves, 0, 3);
  const ax = 50, ay = 24, apex = 32;
  const legX = (y: number, s: number) => ax + s * 22 * ((y - apex) / (96 - apex));
  const braces = poly([[legX(52, -1), 52], [legX(52, 1), 52], [legX(74, -1), 74], [legX(74, 1), 74], [legX(96, -1), 96]]);
  const parts: Block["parts"] = [
    { id: "tower", label: "tower", shapes: [line(`M${f(legX(96, -1))} 96 L ${ax} ${apex} L ${f(legX(96, 1))} 96`, color, 1), line(braces, color)] },
    { id: "antenna", label: "antenna", shapes: [line(`M${ax} ${apex} L ${ax} ${ay + 4}`, color, 1), dot(ax, ay, 4, color, tint(color), 1)] },
  ];
  const anchors: Record<string, P> = { ...sides(100, 100), top: [ax, ay - 4], bottom: [ax, 96], center: [ax, 60], antenna: [ax, ay], signal: [ax, ay], base: [ax, 96] };
  for (let i = 0; i < n; i++) {
    const r = 16 + 13 * i;
    parts.push({ id: `wave-${i}`, label: `signal wave ${i + 1}`, shapes: [line(arc(ax, ay, r, 150, 210) + " " + arc(ax, ay, r, -30, 30), "green", 1)] });
    anchors[`wave-${i}`] = [ax + r, ay];
  }
  return {
    id: "cell-tower",
    title: "Cell Tower",
    describe: "a mobile phone mast (cell tower) sending radio signal waves from its antenna; set waves (0-3)",
    tags: ["cell tower", "mobile", "signal", "radio", "network", "antenna"],
    size: [100, 100],
    parts,
    anchors,
  };
}
export const cellTower = makeCellTower();
