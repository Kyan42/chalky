// One board: a saved four-scene lesson played through. Each new scene must leave the old ones on the board
// (the camera moves to fresh space), and the board must stay smooth with every scene on it: compile time per
// beat (from the transcript) and the page's frame time per scene count (requestAnimationFrame deltas).
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-one-board.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const OUT = join(process.cwd(), "experiments/one-board", process.env.RUN ?? "run");
mkdirSync(OUT, { recursive: true });
const BEATS = Number(process.env.BEATS ?? 15);
const t0 = Date.now();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => /^\[board\] b\d+/.test(m.text()) && console.log(`        ${m.text()}`));
await page.addInitScript(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    const scene = Number(document.querySelector(".board")?.dataset.scene ?? 0);
    window.__frames.push([scene, t - last]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const st = () => page.evaluate(() => ({ status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "", beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null, scene: Number(document.querySelector(".board")?.dataset.scene ?? 0), view: document.querySelector(".board")?.dataset.view }));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=${BEATS}&intake=0`);
await page.fill('[data-testid="question"]', "Why is the sky blue?");
await page.click('[data-testid="ask"]');
let lastScene = 0;
const views = [];
const until = Date.now() + 8 * 60_000;
while (Date.now() < until) {
  const s = await st();
  if (s.scene && s.scene !== lastScene) {
    await page.waitForTimeout(1600); // past the camera's glide
    await page.screenshot({ path: join(OUT, `scene-${s.scene}.png`) });
    views.push(`${s.scene}@${(await st()).view}`);
    console.log(`  scene ${s.scene} at ${s.beat}, view ${(await st()).view}`);
    lastScene = s.scene;
  }
  if (/Done|Ready/.test(s.status) || (s.status === "Your turn" && s.beat === `b${BEATS}`)) break;
  if (s.status === "Your turn") await page.click('[data-testid="continue"]').catch(() => {});
  await page.waitForTimeout(250);
}
const frames = await page.evaluate(() => window.__frames);
await page.goto("about:blank");
await page.waitForTimeout(1500);
await browser.close();
check("the lesson reached four scenes", lastScene >= 4, views.join(" "));
const f = readdirSync(DIR).map((n) => ({ n, m: statSync(join(DIR, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
const t = f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
const compiled = (t?.events ?? []).filter((e) => e.kind === "board-compiled");
for (const n of [0, 1, 2, 3]) {
  const c = compiled.filter((e) => e.otherScenes.length === n).map((e) => e.ms);
  if (c.length) console.log(`        compile with ${n} other scene(s): ${c.join(", ")} ms`);
}
check("old scenes stay on the board (scene 4 compiled with scenes 1-3)", compiled.some((e) => e.scene === 4 && e.otherScenes.join() === "1,2,3"), JSON.stringify(compiled.at(-1)));
const q = (xs, p) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
for (const sc of [1, 2, 3, 4]) {
  const d = frames.filter(([s]) => s === sc).map(([, d]) => d);
  if (d.length) console.log(`        frame time with ${sc} scene(s) on the board: p50 ${q(d, 0.5).toFixed(1)} ms, p95 ${q(d, 0.95).toFixed(1)} ms, max ${Math.max(...d).toFixed(0)} ms (${d.length} frames)`);
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; screenshots in ${OUT}`);
