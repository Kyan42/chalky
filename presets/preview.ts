// Writes preview documents: every biology block drawn on one board, and a photosynthesis lesson
// chained from blocks.
//   npx tsx presets/preview.ts      → presets/out/gallery.json, presets/out/photosynthesis.json
// Labels need presets/out/fonts/Manrope.ttf (the font the app ships in public/fonts).
import { mkdirSync, writeFileSync } from "node:fs";
import { BIOLOGY, co2, drop, glucose, o2, plant, sun } from "./biology";
import { Board } from "./board";

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const font = { uri: "fonts/Manrope.ttf", family: "Manrope" };

// Every block, five across, each drawn a beat after the last.
{
  const b = new Board({ font });
  BIOLOGY.forEach((block, i) => {
    const x = 192 + (i % 5) * 384, y = 170 + Math.floor(i / 5) * 350;
    b.place(block, { x, y, size: 190, ...(i ? { with: true, delay: 0.25 } : {}) });
    b.label(block.title, { x, y: y + 140, size: 30, color: "grey", with: true, delay: 0.4 });
  });
  writeFileSync(new URL("gallery.json", out), JSON.stringify(b.build("blocks-gallery", "Biology blocks", { hold: 1.5 })));
}

// Photosynthesis, chained from blocks: light, water and carbon dioxide go in; sugar and oxygen come out.
{
  const b = new Board({ font });
  const p = b.place(plant, { x: 960, y: 610, size: 600 });
  const s = b.place(sun, { x: 320, y: 230, size: 230 });
  b.label("light", { ...s.at("bottom", 0, 40), with: true, delay: 0.3 });
  b.arrow(s.at("bottom-right"), p.at("leaf", -40, -10), { color: "orange", bend: 0.15 });

  b.travel(drop, { from: p.at("roots"), to: p.at("leaves", 0, 30), size: 60, count: 3, bend: 0.05 });
  b.label("water", { ...p.at("roots", 120, 0), with: true });

  b.travel(co2, { from: { x: 1720, y: 520 }, to: p.at("leaf"), size: 120, count: 3, bend: -0.12 });
  b.label("carbon dioxide", { x: 1720, y: 440, with: true });

  b.highlight(p, { part: "leaves", pad: 24 });
  b.pulse(p, { with: true, delay: 0.3 });

  const g = b.place(glucose, { x: 1320, y: 720, size: 150, enter: "pop" });
  b.arrow(p.at("leaf", 30, 30), g.at("left"), { bend: 0.2, with: true });
  b.label("glucose (food)", { ...g.at("bottom", 0, 50) });

  b.travel(o2, { from: p.at("leaf"), to: { x: 1560, y: 170 }, size: 90, count: 3, stay: true, bend: 0.12 });
  b.label("oxygen", { x: 1560, y: 290, with: true, delay: 1.2 });
  writeFileSync(new URL("photosynthesis.json", out), JSON.stringify(b.build("photosynthesis", "Photosynthesis", { hold: 1.5 })));
}
console.log("wrote", out.pathname);
