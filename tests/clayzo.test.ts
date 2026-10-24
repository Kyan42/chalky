/* eslint-disable @typescript-eslint/no-explicit-any */
// Checks the Clayzo helpers against the kit's sample chapter:  npx tsx worker/kit/sample.ts && npm test
import { readFileSync } from "node:fs";
import { assertValidAnimationDocument, valueAt, withComputedRevision } from "@clayzo/animation/authoring";
import { freezeFrame } from "../lib/clayzo/freeze";
import { inkNodes } from "../lib/clayzo/ink";
import { pcm16ToWav, pcm16Seconds } from "../lib/wav";

const doc = JSON.parse(readFileSync("public/dev/sample.json", "utf8"));
const tick = 2400; // 10 s in
const frozen = withComputedRevision(freezeFrame(doc, tick, 8));
assertValidAnimationDocument(frozen);
const before = doc.compositions.main.nodes;
const after = frozen.compositions.main.nodes;
let compared = 0;
for (const id of Object.keys(after)) {
  const a = JSON.stringify(valueAt(before[id].transform.scale, tick));
  const b = JSON.stringify(valueAt(after[id].transform.scale, 0));
  if (a !== b) throw new Error(`scale mismatch on ${id}: ${a} vs ${b}`);
  const oa = JSON.stringify(valueAt(before[id].opacity, tick));
  const ob = JSON.stringify(valueAt(after[id].opacity, 0));
  if (oa !== ob) throw new Error(`opacity mismatch on ${id}`);
  compared++;
}
const dropped = Object.keys(before).filter((id) => !(id in after));
console.log(`freeze ok: ${compared} nodes match at tick ${tick}; dropped ${dropped.join(", ")}`);
if (Object.values(after).some((n: any) => n.type === "audio")) throw new Error("audio left in frozen frame");

const ink = inkNodes(
  [{ points: [[100, 100, 0.5, 0], [200, 150, 0.5, 300], [300, 120, 0.5, 600]], color: "#FFD84D", size: 8, tick, offsetMs: 0 }],
  { prefix: "ink", outTick: 480, startTickFor: () => 48 },
);
frozen.compositions.main.nodes[ink[0].id] = { ...ink[0] } as any;
frozen.compositions.main.rootNodeIds.push(ink[0].id);
frozen.timing.durationTicks = 480; frozen.compositions.main.durationTicks = 480;
for (const n of Object.values(frozen.compositions.main.nodes) as any[]) n.outTick = 480;
assertValidAnimationDocument(withComputedRevision(frozen));
console.log("ink ok:", JSON.stringify((ink[0].operators![0] as any).end.keyframes.map((k: any) => [k.tick, k.value])));

const pcm = new Uint8Array(48000); // 1 s at 24 kHz 16-bit
const wav = pcm16ToWav(pcm, 24000);
if (wav.length !== 48044 || String.fromCharCode(...wav.slice(0, 4)) !== "RIFF") throw new Error("bad wav");
console.log("wav ok:", pcm16Seconds(pcm.length, 24000), "s");
