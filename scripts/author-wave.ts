// Builds and validates the wave document in Node, and writes it for inspection.
// Run: npx tsx scripts/author-wave.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { valueAt } from "@clayzo/animation/authoring";
import { buildWaveDocument, DRAW_TICKS } from "../lib/visuals/wave";

const doc = buildWaveDocument();
mkdirSync("out", { recursive: true });
writeFileSync("out/wave.json", JSON.stringify(doc, null, 2));
const wave = doc.compositions.main.nodes.wave as { operators: { end: unknown }[] };
const end = wave.operators[0].end as Parameters<typeof valueAt>[0];
console.log("valid; revision", (doc as { revision?: string }).revision);
for (const t of [0, 96, 192, 288, DRAW_TICKS, 479]) console.log("tick", t, "trim.end", valueAt(end, t));
