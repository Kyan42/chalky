// Checks two layout rules without a model call:  npx tsx scripts/test-layout.ts
// 1. a later block or shape moves off a label (or, for blocks, another drawing) already placed;
// 2. a circle or box labelled with a block's name is swapped for that block (lib/blocks/swap.ts).
import { asBlock } from "@/lib/blocks/swap";
import { compilePresetBoard, type PresetElement } from "@/lib/lesson/presets";

const el = (id: string, kind: string, args: number[], text = "", refs = "", at = 0): PresetElement => ({ id, kind, at, dur: 0.6, color: "ink", args, text, refs });
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const overlap = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

// 1a. A molecule block lands on a free-text label from an earlier beat: it should move off it.
{
  const { report } = compilePresetBoard([[el("factory", "text", [50, 50, 26], "food factory")], [el("co2", "block", [50, 50, 8], "co2")]], 1, "t1");
  const label = report.texts.find((t) => t.id === "factory")!;
  const block = report.shapes.find((s) => s.id === "co2")!;
  check("block moves off a label", report.nudged >= 1 && overlap(label.box, block.box) === 0, `nudged ${report.nudged}, overlap ${overlap(label.box, block.box).toFixed(0)}`);
}
// 1b. A block on a free spot is not moved.
{
  const { report } = compilePresetBoard([[el("factory", "text", [20, 20, 26], "food factory")], [el("co2", "block", [70, 70, 8], "co2")]], 1, "t2");
  check("block on a free spot stays", report.nudged === 0, `nudged ${report.nudged}`);
}
// 1c. A chloroplast circle drawn over an earlier "Leaf cell" label moves off it.
{
  const { report } = compilePresetBoard([[el("leafcell", "text", [40, 40, 26], "Leaf cell")], [el("chloro", "circle", [40, 40, 5, 1], "")]], 1, "t3");
  const label = report.texts.find((t) => t.id === "leafcell")!;
  const circle = report.shapes.find((s) => s.id === "chloro")!;
  check("circle moves off a label", report.nudged >= 1 && overlap(label.box, circle.box) === 0, `nudged ${report.nudged}`);
}
// 1d. A dot inside a container circle is allowed (shapes may overlap shapes).
{
  const { report } = compilePresetBoard([[el("cell", "circle", [50, 50, 20, 0], "")], [el("nucleus", "circle", [50, 50, 4, 1], "")]], 1, "t4");
  check("shape inside a shape is not moved", report.nudged === 0, `nudged ${report.nudged}`);
}
// 1e. A second block on top of a first moves off it.
{
  const { report } = compilePresetBoard([[el("plant", "block", [50, 55, 30], "plant")], [el("co2", "block", [50, 55, 8], "co2")]], 1, "t5");
  const plant = report.shapes.find((s) => s.id === "plant")!;
  const co2 = report.shapes.find((s) => s.id === "co2")!;
  const whole = (co2.box.x2 - co2.box.x1) * (co2.box.y2 - co2.box.y1);
  check("block moves (mostly) off another block", report.nudged >= 1 && overlap(plant.box, co2.box) <= whole * 0.5, `nudged ${report.nudged}, ${Math.round((100 * overlap(plant.box, co2.box)) / whole)}% still over it`);
}

// 2. Swaps.
const swap = (kind: string, text: string, args: number[]) => asBlock(el("x", kind, args, text));
check('box "Leaf" becomes the leaf block + label', swap("box", "Leaf", [20, 20, 30, 20])?.[0].text === "leaf" && swap("box", "Leaf", [20, 20, 30, 20])?.[1].kind === "label");
check('circle "a cell" becomes cell', swap("circle", "a cell", [50, 50, 10, 1])?.[0].text === "cell");
check('circle "CO2" becomes co2 with diameter size', JSON.stringify(swap("circle", "CO2", [50, 50, 4, 1])?.[0].args) === "[50,50,8]");
check('"Water drop" matches the drop block', swap("circle", "Water drop", [10, 10, 5, 1])?.[0].text === "drop");
check('"Leaf cell" is not a block', swap("box", "Leaf cell", [0, 0, 10, 10]) === null);
check('"Chloroplast" is not a block', swap("circle", "Chloroplast", [0, 0, 5, 1]) === null);
check("a line is never swapped", swap("line", "leaf", [0, 0, 10, 10]) === null);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
