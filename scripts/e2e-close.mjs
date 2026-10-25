// Closing the tab mid-lesson still ends the transcript (end "closed"), by a full beacon or, for a long
// lesson, a small end marker merged into the saved file.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-close.mjs
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

// 1. The tab closes while beat 2 plays.
for (const how of ["close", "navigate"]) {
  const t0 = Date.now();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=4&intake=0`);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId === "b2", null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  if (how === "close") await page.close({ runBeforeUnload: true });
  else await page.goto("about:blank");
  // The beacon's write lands a moment after the page is gone.
  let t = null;
  for (let k = 0; k < 20 && t?.end !== "closed"; k++) {
    await new Promise((r) => setTimeout(r, 250));
    t = latest(t0);
  }
  check(`tab ${how === "close" ? "closed" : "navigated away"} mid-beat: the transcript ends "closed"`, t?.end === "closed" && !!t?.endedAt, `end ${t?.end}, last event ${JSON.stringify(t?.events?.at(-1))}`);
}

// 2. The end marker on its own (what a long transcript sends): merged into the saved file.
const id = `20990101000000-close-marker-test`;
const post = (body) => fetch(`${BASE}/api/live-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
await post({ id, end: null, endedAt: null, events: [{ t: 1, kind: "learner" }, { t: 2, kind: "beat" }] });
await post({ id, endMarker: true, end: "closed", endedAt: "2099-01-01T00:00:05Z", fromEvent: 2, events: [{ t: 3, kind: "pause" }, { t: 4, kind: "end", end: "closed" }] });
const m = JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
check("an end marker closes a saved transcript and adds the events since", m.end === "closed" && m.events.map((e) => e.kind).join(",") === "learner,beat,pause,end", m.events.map((e) => e.kind).join(","));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
