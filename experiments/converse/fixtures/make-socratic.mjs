// Builds why-is-the-sky-blue-socratic.json from the paced sky fixture: three sections, each opened by a Socratic
// question (a predict quiz beat marked opener), as the planner writes them with "Ask me first" on.
//   node experiments/converse/fixtures/make-socratic.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = "experiments/converse/fixtures";
const f = JSON.parse(readFileSync(`${dir}/why-is-the-sky-blue-paced.json`, "utf8"));
const B = Object.fromEntries(f.beats.map((b) => [b.id, b]));
const opener = (scene, say, section) => ({ say, at: say.split(" ").find((w) => w.length > 3), visual: "", mode: "talk", check: false, scene, region: { x: 0, y: 0, w: 100, h: 100 }, adds: [], points: [], quiz: "predict", opener: true, ...(section ? { section } : {}) });
const plain = (b) => {
  const { check, bridge, ...rest } = b;
  return rest;
};
const s2 = B.b5.section;
const s3 = B.b8.section;
const beats = [
  plain(B.b1),
  opener(1, "Sunlight looks white to us. What do you think white sunlight is really made of, and why?"),
  plain(B.b2),
  plain(B.b3),
  plain(B.b4),
  opener(2, "Now that light runs into the air. Which colors do you think the air bounces around the most, and why?", s2),
  { ...plain(B.b5), section: undefined },
  plain(B.b6),
  plain(B.b7),
  opener(2, "Blue light is about four hundred fifty nanometers and red about seven hundred. Roughly how many times more do you think blue gets scattered, and why?", s3),
  { ...plain(B.b8), section: undefined },
  plain(B.b9),
  plain(B.b10),
].map((b, k) => {
  const out = { ...b, id: `b${k + 1}` };
  if (out.section === undefined) delete out.section;
  return out;
});
writeFileSync(`${dir}/why-is-the-sky-blue-socratic.json`, JSON.stringify({ title: "Why the Sky Is Blue (Socratic)", beats }, null, 2));
console.log(beats.map((b) => `${b.id} ${b.mode}${b.opener ? " opener" : ""}${b.section ? ` § ${b.section}` : ""}`).join("\n"));
