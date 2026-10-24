// Plans one lesson via /api/plan and reports its pacing: words per beat, modes, sections, check-ins and bridges.
// Saves it as a fixture (experiments/converse/fixtures/<slug>-paced.json) so the player can replay it without a planner call.
//   node scripts/pacing-check.mjs "Why is the sky blue?"
import { writeFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const question = process.argv[2] ?? "Why is the sky blue?";
const t0 = Date.now();
const res = await fetch(`${BASE}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
let title = "";
const beats = [];
for (const line of (await res.text()).trim().split("\n")) {
  const ev = JSON.parse(line);
  if (ev.type === "title") title = ev.title;
  else if (ev.type === "beat") beats.push(ev.beat);
  else if (ev.type === "error") console.log("ERROR", ev.message);
}
const words = beats.map((b) => b.say.split(/\s+/).length);
let since = 0;
const gaps = [];
for (const b of beats) {
  since++;
  if (b.check) (gaps.push(since), (since = 0));
}
for (const b of beats) console.log(`${b.id.padEnd(4)} ${b.mode.padEnd(5)} s${b.scene} ${String(b.say.split(/\s+/).length).padStart(2)}w${b.section ? `  § ${b.section}` : ""}${b.check ? `  CHECK → bridge: ${b.bridge ?? "(none)"}` : ""}\n      ${b.say}`);
const modes = beats.reduce((m, b) => ((m[b.mode] = (m[b.mode] ?? 0) + 1), m), {});
console.log(`\n"${title}": ${beats.length} beats in ${((Date.now() - t0) / 1000).toFixed(1)} s; words per beat min ${Math.min(...words)}, median ${words.slice().sort((a, b) => a - b)[Math.floor(words.length / 2)]}, max ${Math.max(...words)}; modes ${JSON.stringify(modes)}`);
console.log(`sections: ${beats.filter((b) => b.section).length}; check-ins: ${gaps.length}, beats between them: ${gaps.join(", ")}; check-ins with a bridge: ${beats.filter((b) => b.check && b.bridge).length}/${gaps.length}`);
const slug = question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const board = beats.flatMap((b) => b.adds.map((a) => ({ id: a.id, kind: "element", label: a.what, scene: b.scene, beat: b.id })));
writeFileSync(`experiments/converse/fixtures/${slug}-paced.json`, JSON.stringify({ question, title, capturedAt: new Date().toISOString(), beats, board }, null, 2));
console.log(`saved experiments/converse/fixtures/${slug}-paced.json`);
