// Calls /api/amend on a saved plan (no audio) and checks the beats: ids, scenes, check-in, timing.
//   node scripts/amend-check.mjs [fixture] [insert|replace] [index]
import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const [name = "why-is-the-sky-blue", kind = "insert", at = "1"] = process.argv.slice(2);
const f = JSON.parse(readFileSync(`experiments/converse/fixtures/${name}.json`, "utf8"));
const index = Number(at);
const op = kind === "insert" ? "insert_after" : "replace_from";
const beats = kind === "insert" ? f.beats.slice(0, index + 2) : f.beats;
const t0 = Date.now();
const res = await fetch(`${BASE}/api/amend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: f.question, beats, op, index, note: "The learner doesn't see what a wavelength is; try ripples on water with numbers.", heard: "I still don't get it", prefix: kind === "insert" ? "d1" : "r1" }) });
const out = [];
let first = null;
for (const line of (await res.text()).trim().split("\n")) {
  const ev = JSON.parse(line);
  if (ev.type === "beat") {
    first ??= ev.tMs;
    out.push(ev.beat);
  } else if (ev.type === "error") console.log("ERROR", ev.message);
}
const maxScene = Math.max(...beats.map((b) => b.scene));
for (const b of out) console.log(`${b.id} scene ${b.scene} ${b.mode}${b.check ? " CHECK" : ""} adds[${b.adds.map((a) => a.id)}] points[${b.points.map((p) => p.id)}] region ${JSON.stringify(b.region)}\n   ${b.say}`);
const ok = (n, c) => console.log(`${c ? "PASS" : "FAIL"}  ${n}`);
ok(`ids prefixed`, out.every((b) => b.id.startsWith(kind === "insert" ? "d1-" : "r1-")));
ok(`first non-talk beat is a draw in a new scene (> ${maxScene})`, (() => { const b = out.find((x) => x.mode !== "talk"); return b && b.mode === "draw" && b.scene > maxScene; })());
if (kind === "insert") {
  ok(`2 to 4 beats (${out.length})`, out.length >= 2 && out.length <= 4);
  ok("last beat is a check-in", out.at(-1)?.check === true);
} else ok(`4 to 8 beats (${out.length})`, out.length >= 4 && out.length <= 8);
console.log(`first beat after ${first} ms, all in ${Date.now() - t0} ms`);
