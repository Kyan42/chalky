// A sheet of blocks, rendered to a PNG: every block a module exports, five across, named underneath.
//   npx tsx presets/sheet.ts <module> [theme] [out.png]
//   npx tsx presets/sheet.ts presets/biology/organs.ts chalk presets/out/sheet-organs.png
// <module> is any file exporting blocks (presets/biology/index.ts gives all of them). Themes as in
// presets/themes.ts by id; default chalk. Needs the clayzo CLI and presets/out/fonts/Manrope.ttf.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Board } from "./board";
import * as themes from "./themes";
import type { Block } from "./types";

const [modulePath, themeId = "chalk", outArg] = process.argv.slice(2);
if (!modulePath) throw new Error("usage: npx tsx presets/sheet.ts <module> [theme] [out.png]");
const theme = Object.values(themes).find((t): t is themes.Theme => typeof t === "object" && t !== null && "id" in t && t.id === themeId);
if (!theme) throw new Error(`no theme "${themeId}"`);
const THEME = theme;

const isBlock = (v: unknown): v is Block => typeof v === "object" && v !== null && "parts" in v && "size" in v && "anchors" in v;

async function main() {
  const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as Record<string, unknown>;
  const seen = new Set<string>();
  const blocks = Object.values(mod).flatMap((v) => (Array.isArray(v) ? v : [v])).filter(isBlock).filter((b) => !seen.has(b.id) && seen.add(b.id));
  if (!blocks.length) throw new Error(`${modulePath} exports no blocks`);

  const COLS = 5;
  const rows = Math.ceil(blocks.length / COLS);
  const cellW = 1920 / COLS, cellH = 220;
  const height = Math.max(1080, rows * cellH + 40);
  const b = new Board({ font: { uri: "fonts/Manrope.ttf", family: "Manrope" }, theme: THEME, height });
  blocks.forEach((block, i) => {
    const x = cellW * (i % COLS) + cellW / 2, y = 20 + Math.floor(i / COLS) * cellH + cellH * 0.42;
    b.place(block, { x, y, size: cellH * 0.6, ...(i ? { with: true, delay: 0.05 } : {}) });
    b.label(block.title, { x, y: y + cellH * 0.43, size: 26, color: "grey", with: true });
  });

  const out = new URL("./out/", import.meta.url);
  mkdirSync(out, { recursive: true });
  const name = basename(modulePath).replace(/\.ts$/, "");
  const json = new URL(`sheet-${name}-${THEME.id}.json`, out);
  const doc = b.build(`sheet-${name}`, `${name} blocks`, { hold: 0.5 });
  writeFileSync(json, JSON.stringify(doc));
  const png = resolve(outArg ?? new URL(`sheet-${name}-${THEME.id}.png`, out).pathname);
  const r = spawnSync("clayzo", ["render-frame", json.pathname, png, "--tick", String(doc.timing.durationTicks - 16), "--max-dimension", "1600"], { encoding: "utf8" });
  const result = /\{"command".*\}/.exec(r.stdout ?? "")?.[0];
  if (r.status !== 0 || !result) throw new Error(`clayzo failed: ${r.stderr || r.stdout}`);
  const { diagnostics } = JSON.parse(result) as { diagnostics: { errors: number } };
  console.log(`${blocks.length} blocks → ${png}${diagnostics.errors ? ` (${diagnostics.errors} render errors)` : ""}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
