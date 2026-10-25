// The scene rules on a plan change (lib/lesson/scenes.ts), on the shape of Keyon's photosynthesis run
// (20261025035433): an intake rewrite after beat 1 that puts every beat in beat 1's scene, seven of them
// drawings with overlapping regions, and declares the ATP battery twice.
//   npx tsx scripts/test-amend-scenes.ts
import { collides, MAX_DRAWS_PER_SCENE, SceneGuard } from "../lib/lesson/scenes";
import type { PlannedBeat, Region } from "../lib/lesson/types";

const R = (x: number, y: number, w: number, h: number): Region => ({ x, y, w, h });
const beat = (id: string, mode: PlannedBeat["mode"], scene: number, region: Region, adds: [string, string][], say: string, points: { id: string; word: string }[] = []): PlannedBeat => ({
  id,
  say,
  at: say.split(" ")[0],
  visual: say,
  mode,
  check: false,
  scene,
  region,
  adds: adds.map(([id, what]) => ({ id, what })),
  points,
});

const kept = [beat("b1", "draw", 1, R(10, 10, 60, 70), [["leaf", "a leaf"], ["sun", "the sun"]], "Here is a leaf in the sun.")];
const amend = [
  beat("r1-1", "draw", 1, R(60, 10, 35, 35), [["atp", "ATP battery"]], "Inside, light charges an ATP battery."),
  beat("r1-2", "point", 1, R(60, 10, 35, 35), [], "That battery powers everything next.", [{ id: "atp", word: "battery" }]),
  beat("r1-3", "draw", 1, R(15, 50, 50, 40), [["thylakoid", "thylakoid stacks"]], "The thylakoids stack up like coins."),
  beat("r1-4", "draw", 1, R(20, 20, 60, 60), [["calvin", "Calvin cycle"]], "The Calvin cycle turns carbon dioxide into sugar."),
  beat("r1-5", "draw", 1, R(55, 15, 30, 30), [["atp-2", "ATP battery"]], "It spends the ATP battery to do it."),
  beat("r1-6", "draw", 1, R(10, 10, 40, 40), [["co2", "carbon dioxide"]], "Carbon dioxide comes in from the air."),
  beat("r1-7", "talk", 1, R(0, 0, 100, 100), [], "So light makes energy, and the cycle spends it."),
  beat("r1-8", "draw", 1, R(30, 30, 40, 40), [["glucose", "glucose"]], "Out comes glucose."),
  beat("r1-9", "draw", 1, R(40, 40, 40, 40), [["o2", "oxygen"]], "And oxygen leaves the leaf."),
  beat("r1-10", "point", 1, R(40, 40, 40, 40), [], "Oxygen is the leftover.", [{ id: "o2", word: "Oxygen" }]),
];

const st = { scene: 1, known: new Map<number, Set<string>>([[1, new Set(["leaf", "sun"])]]) };
const guard = new SceneGuard(kept);
const out: PlannedBeat[] = [];
for (const b of amend) {
  // As checkBeat would: scenes never go back, and the beat's adds become known in its scene.
  const scene = Math.max(st.scene, b.scene);
  st.scene = scene;
  if (!st.known.has(scene)) st.known.set(scene, new Set());
  for (const a of b.adds) st.known.get(scene)!.add(a.id);
  out.push(guard.guard({ ...b, scene }, st));
}
const report = guard.summary();
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
for (const b of out) console.log(`     ${b.id}: scene ${b.scene} ${b.mode} [${[b.region.x, b.region.y, b.region.w, b.region.h].map(Math.round).join(", ")}] ${b.adds.map((a) => a.id).join(",")}${b.points.length ? ` -> ${b.points.map((p) => p.id).join(",")}` : ""}`);
const all = [...kept, ...out];
const scenes = [...new Set(all.map((b) => b.scene))];
for (const s of scenes) {
  const draws = all.filter((b) => b.scene === s && b.mode === "draw");
  check(`scene ${s}: at most ${MAX_DRAWS_PER_SCENE} drawings`, draws.length <= MAX_DRAWS_PER_SCENE, `${draws.length}`);
  const pairs = draws.flatMap((a, i) => draws.slice(i + 1).filter((b) => collides(a.region, b.region)).map((b) => `${a.id}/${b.id}`));
  check(`scene ${s}: no overlapping regions`, !pairs.length, pairs.join(" "));
  const ids = draws.flatMap((b) => b.adds.map((a) => a.id));
  const labels = draws.flatMap((b) => b.adds.map((a) => a.what.toLowerCase()));
  check(`scene ${s}: no duplicate ids or labels`, new Set(ids).size === ids.length && new Set(labels).size === labels.length, ids.join(","));
}
check("the second ATP battery was referred to, not drawn", report.deduped.includes("atp-2") && !out.some((b) => b.adds.some((a) => a.id === "atp-2")), report.deduped.join(","));
check("the point at the oxygen follows it to its scene", (() => {
  const o2 = out.find((b) => b.adds.some((a) => a.id === "o2"));
  const p = out.find((b) => b.id === "r1-10");
  return !!o2 && !!p && p.scene === o2.scene;
})());
console.log(`     report: ${JSON.stringify(report.scenes)}; replaced ${report.replaced}, moved on ${report.movedOn}`);
for (const n of report.notes) console.log(`     note: ${n}`);
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
