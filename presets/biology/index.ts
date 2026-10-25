import type { Block } from "../types";
import * as animals from "./animals";
import * as body from "./body";
import { cell, dna, mitochondrion, neuron } from "./cells";
import * as flora from "./flora";
import * as micro from "./micro";
import * as molecules from "./molecules";
import { cloud, drop, energy, sun } from "./nature";
import * as organs from "./organs";
import { leaf, plant, tree } from "./plants";

export { cell, cloud, dna, drop, energy, leaf, mitochondrion, neuron, plant, sun, tree };
export * from "./animals";
export * from "./body";
export * from "./flora";
export * from "./micro";
export * from "./molecules";
export * from "./organs";

const blocks = (mod: Record<string, unknown>) => Object.values(mod).filter((v): v is Block => typeof v === "object" && v !== null && "parts" in v && "anchors" in v);

/** Every biology block, by topic: light and water, plants, cells, molecules, the human body, animals. */
export const BY_TOPIC: Record<string, Block[]> = {
  "light and water": [sun, cloud, drop, energy],
  plants: [leaf, plant, tree, ...blocks(flora)],
  cells: [cell, mitochondrion, dna, neuron, ...blocks(micro)],
  molecules: blocks(molecules),
  organs: blocks(organs),
  body: blocks(body),
  animals: blocks(animals),
};

export const BIOLOGY: Block[] = Object.values(BY_TOPIC).flat();
