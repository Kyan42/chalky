// A full lesson whose intake answer rewrites the plan (the photosynthesis run that tangled one board),
// played through on the scripted mic with a frame at every scene and every few seconds. Checks, from the
// transcript: each scene's drawings (kept + rewritten) at most four, the amend's report, and the scenes the
// board actually showed.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-intake-rewrite.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const OUT = join(process.cwd(), "experiments/intake-rewrite", process.env.RUN ?? "run");
const SECONDS = Number(process.env.SECONDS ?? 300);
mkdirSync(OUT, { recursive: true });
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const LINES = {
  learn: process.env.LEARN ?? "Hey Chalky, what about photosynthesis?",
  intake: process.env.INTAKE ?? "I already know the inputs and outputs. I want the light reactions and the Calvin cycle in detail, with ATP.",
};
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
const clips = { learn: await clip(`rw-${slug(LINES.learn)}`, LINES.learn), intake: await clip(`rw-${slug(LINES.intake)}`, LINES.intake) };
const t0 = Date.now();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
  window.__say = async (b64) => {
    await ac.resume();
    const buf = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return buf.duration;
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => /^\[(amend|board)\]/.test(m.text()) && /amend|scene \d+ \(camera/.test(m.text()) && console.log(`        ${m.text().slice(0, 260)}`));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    scene: Number(document.querySelector(".board")?.dataset.scene ?? 0),
  }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(150);
  }
  return null;
};
try {
  // FIXTURE=<slug>: a saved plan instead of the planner (the first turn and the intake still go to the models).
  await page.goto(`${BASE}/lesson${process.env.FIXTURE ? `?fixture=${process.env.FIXTURE}&beats=${process.env.BEATS ?? 15}&firstturn=1` : ""}`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.click("body", { position: { x: 5, y: 400 } });
  await page.evaluate((b) => window.__say(b), clips.learn);
  await waitFor((s) => s.status === "Your turn", 40000);
  await page.evaluate((b) => window.__say(b), clips.intake);
  let frame = 0;
  let lastScene = 0;
  const until = Date.now() + SECONDS * 1000;
  while (Date.now() < until) {
    const s = await st();
    if (s.scene && s.scene !== lastScene) {
      await page.waitForTimeout(1600);
      await page.screenshot({ path: join(OUT, `scene-${s.scene}-${s.beat}.png`) });
      console.log(`  scene ${s.scene} at ${s.beat}`);
      lastScene = s.scene;
    }
    if (frame++ % 20 === 0) await page.screenshot({ path: join(OUT, `f${String(frame).padStart(4, "0")}.png`) }).catch(() => {});
    if (s.status === "Your turn") await page.click('[data-testid="continue"]').catch(() => {});
    if (/^(Done|Ready)/.test(s.status)) break;
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: join(OUT, "end.png") });
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
const f = readdirSync(DIR).map((n) => ({ n, m: statSync(join(DIR, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
const t = f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
const decision = ev("intake-decision")[0];
check("the intake answer rewrote the plan", !!decision && decision.amend === true, decision?.note?.slice(0, 120) ?? "no decision");
const replan = ev("replan")[0];
// The plan as played: beats before the rewrite point, then the rewrite's.
const planned = ev("planned");
const from = replan?.from ?? 0;
const kept = planned.filter((e) => !e.by).slice(0, from);
const rewrite = planned.filter((e) => e.by === "intake" || e.by === "replan");
const all = [...kept, ...rewrite];
for (const s of [...new Set(all.map((e) => e.scene))].sort((a, b) => a - b)) {
  const draws = all.filter((e) => e.scene === s && e.mode === "draw").length;
  check(`scene ${s}: ${draws} drawing(s), at most 4`, draws <= 4, all.filter((e) => e.scene === s).map((e) => `${e.beatId}:${e.mode}`).join(" "));
}
const layout = ev("amend-done").map((e) => e.call?.layout).find(Boolean);
console.log(`        amend report: ${JSON.stringify(layout?.scenes ?? null)}; deduped ${JSON.stringify(layout?.deduped ?? [])}, replaced ${layout?.replaced ?? "-"}, moved on ${layout?.movedOn ?? "-"}`);
for (const n of layout?.notes ?? []) console.log(`        note: ${n}`);
check("the amend's scene report is in the transcript", !!layout);
const compiled = ev("board-compiled");
console.log(`        board: ${compiled.map((e) => `${e.beatId}@${e.scene}`).join(" ")}`);
const errors = ev("board-error").length + (t?.beats ?? []).filter((b) => b.draw === "failed").length;
check("no drawing failed or broke the board", errors === 0, `${errors}`);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; frames in ${OUT}; transcript ${t?.id}`);
