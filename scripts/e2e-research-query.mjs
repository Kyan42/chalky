// The lookup's query is search-shaped, never the learner's raw sentence: a long, chatty first question
// (Keyon's, from the live run 20261025084750) is typed; the transcript's research-started must carry a clean
// query (no greeting, no "could you check") next to what was heard, and the route's research event says what
// came back. Stops once the lookup settles (no lesson is played). This spends one real Apify fetch unless cached.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-research-query.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const ASK = process.env.ASK ?? "Hey Chalky, I'm learning, I'm doing some research on uh VLAs, vision language action models. Could you check l…";
const t0 = Date.now();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const transcript = () => {
  const f = readdirSync(DIR).filter((n) => n.endsWith(".json")).flatMap((n) => { try { return [{ n, m: statSync(join(DIR, n)).mtimeMs }]; } catch { return []; } }).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
  try {
    return f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
  } catch {
    return null;
  }
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const ev = (k) => transcript()?.events.filter((e) => e.kind === k) ?? [];
try {
  await page.goto(`${BASE}/lesson?debug=1`);
  await page.fill('[data-testid="question"]', ASK);
  await page.click('[data-testid="ask"]');
  const until = Date.now() + 60_000;
  while (Date.now() < until && !(ev("research-ready").length || ev("research-none").length)) await page.waitForTimeout(500);
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
const reply = ev("reply")[0];
const started = ev("research-started")[0];
const done = ev("research-ready")[0] ?? ev("research-none")[0];
console.log(`        reply: "${reply?.text}" ${JSON.stringify((reply?.actions ?? []).filter((a) => a.type === "research" || a.type === "start_lesson"))}`);
console.log(`        research-started: ${JSON.stringify(started)}`);
console.log(`        lookup: ${JSON.stringify(done && { kind: done.kind, question: done.question, items: done.items, ms: done.ms, cached: done.cached, query: done.query, fetchMs: done.fetchMs, titles: done.titles, error: done.error })}`);
check("research-started logs what was heard", started?.heard === ASK);
check("the query sent is search-shaped: no greeting, no 'could you check', one short sentence", !!started?.question && !/\b(hey|chalky|could you|i'?m learning|research on)\b/i.test(started.question) && started.question.split(/\s+/).length <= 14, started?.question);
check("the route got that query", done?.question === started?.question, done?.question);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${transcript()?.id}`);
