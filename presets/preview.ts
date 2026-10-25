// Writes preview documents for a theme: two lessons chained from blocks.
//   npx tsx presets/preview.ts [chalk|whiteboard|chalkboard|inkwash|doodle|silhouette]
//   → presets/out/<theme>-photosynthesis.json, -respiration.json
// Labels need presets/out/fonts/Manrope.ttf (the font the app ships in public/fonts).
import { mkdirSync, writeFileSync } from "node:fs";
import { cell, co2, drop, energy, glucose, h2o, mitochondrion, o2, plant, sun } from "./biology";
import { Board } from "./board";
import { CHALK, CHALKBOARD, DOODLE, INKWASH, SILHOUETTE, WHITEBOARD } from "./themes";

const theme = [CHALK, WHITEBOARD, CHALKBOARD, INKWASH, DOODLE, SILHOUETTE].find((t) => t.id === process.argv[2]) ?? CHALK;
const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const font = { uri: "fonts/Manrope.ttf", family: "Manrope" };
const write = (name: string, b: Board, title: string) =>
  writeFileSync(new URL(`${theme.id}-${name}.json`, out), JSON.stringify(b.build(`${theme.id}-${name}`, title, { hold: 1.5 })));

// The block gallery is presets/sheet.ts now (all 100 blocks, any theme).

// Photosynthesis: light, water and carbon dioxide go in; sugar and oxygen come out.
{
  const b = new Board({ font, theme });
  const p = b.place(plant, { x: 960, y: 610, size: 600 });
  const s = b.place(sun, { x: 320, y: 230, size: 230 });
  b.label("light", { ...s.at("bottom", 0, 40), with: true, delay: 0.3 });
  b.arrow(s.at("bottom-right"), p.at("leaf", -40, -10), { color: "orange", bend: 0.15 });

  b.travel(drop, { from: p.at("roots"), to: p.at("leaves", 0, 30), size: 60, count: 3, bend: 0.05 });
  b.label("water", { ...p.at("roots", 150, 0), with: true });

  b.travel(co2, { from: { x: 1720, y: 520 }, to: p.at("leaf"), size: 120, count: 3, bend: -0.12 });
  b.label("carbon dioxide", { x: 1720, y: 440, with: true });

  b.highlight(p, { part: "leaves", pad: 24 });
  b.pulse(p, { with: true, delay: 0.3 });

  const g = b.place(glucose, { x: 1320, y: 720, size: 150, enter: "pop" });
  b.arrow(p.at("leaf", 30, 30), g.at("left"), { bend: 0.2, with: true });
  b.label("glucose (food)", { ...g.at("bottom", 0, 50) });

  b.travel(o2, { from: p.at("leaf"), to: { x: 1560, y: 170 }, size: 90, count: 3, stay: true, bend: 0.12 });
  b.label("oxygen", { x: 1560, y: 290, with: true, delay: 1.2 });
  write("photosynthesis", b, "Photosynthesis");
}

// Respiration: a cell takes in glucose and oxygen; its mitochondria release energy, carbon dioxide and water.
{
  const b = new Board({ font, theme });
  const c = b.place(cell, { x: 760, y: 540, size: 600 });
  b.label("a cell", { ...c.at("bottom", 0, 56), with: true, delay: 0.6 });
  const m = b.place(mitochondrion, { x: 900, y: 610, size: 190 });
  b.highlight(m, { pad: 16 });
  b.label("mitochondrion", { ...m.at("right", 200, 70), with: true, delay: 0.3 });

  b.travel(glucose, { from: { x: 220, y: 300 }, to: m.at("left"), size: 90, count: 2, bend: 0.1 });
  b.label("glucose", { x: 220, y: 210, with: true });
  b.travel(o2, { from: { x: 220, y: 820 }, to: m.at("left"), size: 80, count: 3, bend: -0.1, with: true, delay: 0.5 });
  b.label("oxygen", { x: 220, y: 910, with: true });

  b.pulse(m);
  const e = b.place(energy, { x: 1560, y: 330, size: 190, enter: "pop" });
  b.arrow(m.at("right"), e.at("left"), { color: "orange", bend: -0.2, with: true });
  b.label("energy", { ...e.at("bottom", 0, 50) });

  b.travel(co2, { from: m.at("right"), to: { x: 1640, y: 720 }, size: 110, count: 2, stay: true, bend: 0.1 });
  b.travel(h2o, { from: m.at("right"), to: { x: 1640, y: 900 }, size: 90, count: 2, stay: true, bend: 0.15, with: true, delay: 0.4 });
  b.label("carbon dioxide + water", { x: 1640, y: 1010, with: true, delay: 1.2 });
  write("respiration", b, "Respiration");
}
console.log("wrote", theme.id, "previews to", out.pathname);
