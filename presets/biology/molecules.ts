import type { Block } from "../types";

/**
 * A molecule is one circle, told apart by its colour: simple enough to send a
 * stream of them travelling between blocks, and a label says which it is.
 */
const molecule = (id: string, title: string, describe: string, tags: string[], stroke: string, fill: string): Block => ({
  id,
  title,
  describe: `${describe} (one circle)`,
  tags,
  size: [60, 60],
  parts: [{ id: "molecule", label: title.toLowerCase(), shapes: [{ type: "ellipse", cx: 30, cy: 30, rx: 25, ry: 25, stroke, fill }] }],
  anchors: { center: [30, 30], top: [30, 5], bottom: [30, 55], left: [5, 30], right: [55, 30] },
});

export const co2 = molecule("co2", "Carbon dioxide", "a CO2 molecule, the gas plants take in and animals breathe out", ["CO2", "carbon dioxide", "photosynthesis", "respiration", "gas"], "ink", "grey-tint");
export const o2 = molecule("o2", "Oxygen", "an O2 molecule, the gas plants give off and we breathe in", ["O2", "oxygen", "photosynthesis", "respiration", "breathing"], "red", "red-tint");
export const h2o = molecule("h2o", "Water molecule", "an H2O molecule", ["H2O", "water", "osmosis", "transpiration"], "blue", "blue-tint");
export const glucose = molecule("glucose", "Glucose", "a glucose (sugar) molecule: food and stored energy", ["glucose", "sugar", "food", "carbohydrate", "energy"], "brown", "brown-tint");
export const atp = molecule("atp", "ATP", "an ATP molecule, the cell's energy currency", ["ATP", "energy", "respiration", "mitochondria", "cell"], "orange", "yellow-tint");
export const aminoAcid = molecule("amino-acid", "Amino acid", "an amino acid, a building block of proteins", ["amino acid", "protein", "digestion", "ribosome"], "purple", "purple-tint");
export const nitrogen = molecule("nitrogen", "Nitrogen", "an N2 molecule, most of the air and what plants need for growth", ["nitrogen", "N2", "air", "nitrogen cycle", "fertiliser"], "pink", "pink-tint");
export const ion = molecule("ion", "Ion", "a charged particle such as sodium or potassium, for nerve signals and osmosis", ["ion", "sodium", "potassium", "salt", "nerve impulse"], "green", "green-tint");
