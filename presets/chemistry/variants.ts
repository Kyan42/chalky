// The factories at other settings, for a sheet: npx tsx presets/sheet.ts presets/chemistry/variants.ts
// Each copy gets its own id and title so the sheet shows them side by side.
import type { Block } from "../types";
import * as c from "./index";

const v = (block: Block, title: string): Block => ({ ...block, id: `${block.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title });

export const VARIANTS: Block[] = [
  v(c.makeAtom({ protons: 1, neutrons: 0, electrons: 1 }), "Hydrogen Atom"),
  v(c.makeAtom({ protons: 11, neutrons: 12, electrons: 11 }), "Sodium Atom"),
  v(c.makeLewisDot({ dots: 8 }), "Lewis Dot, 8"),
  v(c.makePeriodicTable({ highlight: "noble-gases" }), "Noble Gases"),
  v(c.makeEnergyLevels({ levels: 3, electron: 2 }), "Excited Electron"),
  v(c.makeMolecule({ atoms: [{ el: "C", x: 0, y: 0 }, { el: "C", x: 36, y: 0 }, { el: "C", x: 72, y: 0 }, { el: "O", x: 108, y: 0 }], bonds: [[0, 1], [1, 2], [2, 3, 2]] }), "Custom Molecule"),
  v(c.makeWaterMolecule({ lonePairs: true }), "Water, Lone Pairs"),
  v(c.makeBenzene({ style: "circle" }), "Benzene, Circle"),
  v(c.makeCovalentBond({ atoms: ["O", "O"], order: 2 }), "O=O Shared Pairs"),
  v(c.makeBeaker({ fill: 0.85, liquid: "green", bubbles: 4 }), "Full Green Beaker"),
  v(c.makeTestTube({ fill: 0.3, liquid: "red" }), "Red Test Tube"),
  v(c.makeBunsenBurner({ flame: "roaring" }), "Roaring Flame"),
  v(c.makeThermometer({ reading: 0.9 }), "Hot Thermometer"),
  v(c.makeParticles({ state: "gas", n: 6 }), "Gas"),
  v(c.makeParticles({ state: "liquid", n: 10 }), "Liquid"),
  v(c.makeEnergyProfile({ exothermic: false, catalyst: true }), "Endothermic + Catalyst"),
  v(c.makeReactionArrow({ kind: "reversible" }), "Equilibrium"),
  v(c.makePhScale({ value: 2 }), "pH 2"),
  v(c.makeConcentration({ n: 14 }), "Concentrated"),
  v(c.makeGasSyringe({ volume: 0.2 }), "Compressed Gas"),
];
