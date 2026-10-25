// A real plan change through /api/amend, checked against the scene rules: an intake rewrite after beat 1
// of a saved lesson (one Sonnet call). Every scene must hold at most four drawings, with no overlapping
// regions and no element drawn twice; the amend's own report (call.layout) is printed too.
//   BASE_URL=http://localhost:3006 node scripts/amend-scenes-check.mjs [fixture]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const NAME = process.argv[2] ?? "why-is-the-sky-blue-paced";
const fx = JSON.parse(readFileSync(join(process.cwd(), "experiments/converse/fixtures", `${NAME}.json`), "utf8"));
const NOTE =
  process.env.NOTE ??
  "The learner already knows that sunlight is a mix of colors and that blue has a shorter wavelength. Skip that: go deep on Rayleigh scattering (why small molecules scatter short waves so much more, the fourth-power law with real numbers), then why the sky isn't violet (the sun's spectrum, our eyes' cones), then sunsets.";
const t0 = Date.now();
const res = await fetch(`${BASE}/api/amend`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: fx.question, beats: fx.beats, op: "replace_from", index: 1, note: NOTE, heard: "I know the colors part already, I want the real physics.", prefix: "r1", intake: true }),
});
const text = await res.text();
const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const beats = events.filter((e) => e.type === "beat").map((e) => e.beat);
const done = events.find((e) => e.type === "done");
const err = events.find((e) => e.type === "error");
if (err) console.log("ERROR", err.message);
console.log(`amend: ${beats.length} beats in ${((Date.now() - t0) / 1000).toFixed(1)} s; first beat at ${beats.length ? events.find((e) => e.type === "beat").tMs : "-"} ms`);
const kept = fx.beats.slice(0, 1);
const all = [...kept, ...beats];
for (const b of beats) console.log(`  ${b.id}: scene ${b.scene} ${b.mode} [${[b.region.x, b.region.y, b.region.w, b.region.h].map(Math.round).join(", ")}] ${b.adds.map((a) => a.id).join(",")}${b.points?.length ? ` -> ${b.points.map((p) => p.id).join(",")}` : ""}`);
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
for (const s of [...new Set(all.map((b) => b.scene))].sort((a, b) => a - b)) {
  const draws = all.filter((b) => b.scene === s && b.mode === "draw");
  const pairs = draws.flatMap((a, i) => draws.slice(i + 1).filter((b) => overlap(a.region, b.region) > 1).map((b) => `${a.id}/${b.id}`));
  const ids = draws.flatMap((b) => b.adds.map((a) => a.id));
  check(`scene ${s}: ${draws.length} drawing(s), at most 4; no overlaps; no duplicate ids`, draws.length <= 4 && !pairs.length && new Set(ids).size === ids.length, [pairs.join(" "), ids.join(",")].filter(Boolean).join(" | "));
}
const layout = done?.call?.layout;
console.log(`  amend report: ${JSON.stringify(layout?.scenes ?? null)}; deduped ${JSON.stringify(layout?.deduped ?? [])}, replaced ${layout?.replaced ?? "-"}, moved on ${layout?.movedOn ?? "-"}`);
for (const n of layout?.notes ?? []) console.log(`  note: ${n}`);
check("the report is on the call log (the transcript's amend-done carries it)", !!layout);
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
