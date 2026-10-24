// Freezes an animation at a tick into a still document that another animation can start from.
//   npx tsx ../../tools/freeze.ts chapter.json question-frame.json [tick]
// Without a tick it uses the questionTick from the document's .manifest.json.
import { readFileSync, writeFileSync } from "node:fs";
import { withComputedRevision, type AnimationDocument } from "@clayzo/animation/authoring";
import { freezeFrame } from "../../lib/clayzo/freeze";
import type { Manifest } from "../../lib/types";

const [input, output, tickArg] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: freeze.ts <document.json> <out.json> [tick]");
  process.exit(1);
}
const document = JSON.parse(readFileSync(input, "utf8")) as AnimationDocument;
let tick = tickArg === undefined ? undefined : Number(tickArg);
if (tick === undefined) {
  const manifest = JSON.parse(readFileSync(input.replace(/\.json$/, ".manifest.json"), "utf8")) as Manifest;
  tick = manifest.questionTick ?? document.timing.durationTicks - 8;
}
writeFileSync(output, JSON.stringify(withComputedRevision(freezeFrame(document, tick, 8))));
console.log(`froze ${input} at tick ${tick} -> ${output}`);
