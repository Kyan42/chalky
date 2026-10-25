// Checks that a lesson's transcript is saved when the learner presses Stop and
// when the tab is closed mid-lesson (saved plan, no planner call).
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-transcript-save.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const newest = (since) => {
  const files = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= since).sort((a, b) => b.m - a.m);
  return files[0] ? JSON.parse(readFileSync(join(DIR, files[0].f), "utf8")) : null;
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const begin = async () => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=3&intake=0`);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  // Wait until beat 2 has started, so the transcript has a finished beat in it.
  await page.waitForFunction(() => document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId === "b2", null, { timeout: 120000 });
  return page;
};
let t = Date.now();
const a = await begin();
await a.click('[data-testid="stop"]');
await a.waitForTimeout(1500);
const stopped = newest(t);
console.log(`${stopped?.end === "stopped" ? "PASS" : "FAIL"}  Stop saves the final transcript: end=${stopped?.end}, ${stopped?.events.length} events, beats ${stopped?.beats.map((b) => b.beatId).join(",")}`);
t = Date.now();
const b = await begin();
await b.waitForTimeout(3000); // into beat 2
await b.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 2000));
const closed = newest(t - 1);
const lastEv = closed?.events.at(-1);
console.log(`${closed && closed.events.some((e) => e.kind === "beat" && e.beatId === "b1") ? "PASS" : "FAIL"}  closing the tab mid-lesson leaves a transcript: ${closed?.events.length} events, last "${lastEv?.kind}" at ${lastEv?.t} ms, end=${closed?.end}`);
await browser.close();
