import type { Block } from "../types";
import { cell, dna, mitochondrion, neuron } from "./cells";
import { co2, glucose, h2o, o2 } from "./molecules";
import { cloud, drop, energy, sun } from "./nature";
import { leaf, plant, tree } from "./plants";

export { cell, cloud, co2, dna, drop, energy, glucose, h2o, leaf, mitochondrion, neuron, o2, plant, sun, tree };

export const BIOLOGY: Block[] = [sun, cloud, drop, energy, leaf, plant, tree, cell, mitochondrion, dna, neuron, co2, o2, h2o, glucose];
