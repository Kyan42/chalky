// Saying you're done mid-lesson ends it: Chalky says goodbye, the home screen comes back, the transcript
// ends "ended by learner", and a new question starts a new lesson.
//   BASE_URL=http://localhost:3100 node scripts/e2e-end-lesson.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const latest = (since) => {
  const f = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= since).sort((a, b) => b.m - a.m)[0];
  return f ? JSON.parse(readFileSync(join(DIR, f.f), "utf8")) : null;
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

for (const said of ["I'm done", "Can we end the lesson here?"]) {
  const t0 = Date.now();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=4&intake=0`);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId === "b2", null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  // Typed while Chalky talks: a cut-in.
  await page.fill('[data-testid="question"]', said);
  await page.click('[data-testid="ask"]');
  const home = await page.waitForSelector('[data-testid="welcome"]', { timeout: 30000 }).then(() => true, () => false);
  const state = await page.getAttribute('[data-testid="status"]', "data-state");
  check(`"${said}" mid-lesson: back on the home screen`, home && state === "idle", `welcome ${home}, status ${state}`);
  let t = null;
  for (let k = 0; k < 20 && t?.end !== "ended by learner"; k++) {
    await new Promise((r) => setTimeout(r, 250));
    t = latest(t0);
  }
  const ended = t?.events?.find((e) => e.kind === "lesson-ended");
  const bye = t?.events?.filter((e) => e.kind === "say" && e.who === "chalky").at(-1);
  check(`"${said}": the transcript ends "ended by learner" after a goodbye`, t?.end === "ended by learner" && !!ended, `end ${t?.end}, ended by ${ended?.by}, last line ${JSON.stringify(bye?.text ?? null)}`);
  // The home screen takes a new question.
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  const again = await page.waitForFunction(() => !document.querySelector('[data-testid="welcome"]'), null, { timeout: 15000 }).then(() => true, () => false);
  check(`"${said}": a new question starts again from home`, again);
  await page.close();
}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
