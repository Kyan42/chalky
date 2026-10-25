// Space as a toggle, and a quick second utterance merging into the pending question (saved plan).
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-toggle.mjs
//   QUERY=&voice=1 runs it with voice barge-in on.
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const t0 = Date.now();
const st = () =>
  page.evaluate(() => {
    const words = [...document.querySelectorAll(".caption .word")];
    return {
      status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
      beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
      word: words.findIndex((w) => w.dataset.state === "now"),
      caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim(),
      level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
      cursorPhase: document.querySelector('[data-testid="chalky-cursor-glyph"]')?.dataset.phase ?? null,
    };
  });
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(100);
  }
  return null;
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const tap = async () => {
  await page.keyboard.down("Space");
  await page.waitForTimeout(120);
  await page.keyboard.up("Space");
};
const type = async (text) => {
  await page.fill('[data-testid="question"]', text);
  await page.click('[data-testid="ask"]');
};
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=6&intake=0${process.env.QUERY ?? ""}`);
  await type("Why is the sky blue?");
  await page.click("body", { position: { x: 5, y: 400 } }); // focus off the text box so Space reaches the page
  const b2 = await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 5, 120000);
  check("b2 is playing", !!b2, `word ${b2?.word}`);
  // 1. Tap: pause in place.
  await tap();
  await page.waitForTimeout(300);
  const p1 = await st();
  check("a Space tap pauses", /^Paused/.test(p1.status ?? ""), p1.status);
  check("while paused, typing is off (Start or Space goes on)", await page.isDisabled('[data-testid="question"]'));
  await page.waitForTimeout(2500);
  const p2 = await st();
  check("frozen while paused (same word, still paused)", p2.word === p1.word && /^Paused/.test(p2.status ?? ""), `word ${p1.word} -> ${p2.word}`);
  // 2. Tap again: resume from the same word.
  await tap();
  const r1 = await waitFor((s) => s.status === "Speaking" && s.word >= 0, 3000);
  check("a second tap resumes from the pause point (not word 0)", !!r1 && r1.beat === "b2" && r1.word >= p1.word && r1.word <= p1.word + 2, `paused at word ${p1.word}, resumed at ${r1?.word}`);
  // 3. Pause, then Continue resumes from the pause point too.
  await page.waitForTimeout(1200);
  await tap();
  await page.waitForTimeout(300);
  const p3 = await st();
  await page.click('[data-testid="continue"]');
  const r2 = await waitFor((s) => s.status === "Speaking" && s.word >= 0, 3000);
  check("Continue resumes from the pause point", !!r2 && r2.beat === p3.beat && r2.word >= p3.word && r2.word <= p3.word + 2, `paused at ${p3.beat} word ${p3.word}, resumed at ${r2?.beat} word ${r2?.word}`);
  // 4. Merge: ask while Chalky talks (a paused Chalky takes no input), and while the reply is in flight
  // say a two-word aside: the reply must answer the question.
  await waitFor((s) => s.status === "Speaking", 5000);
  await page.waitForTimeout(800);
  await type("wait, why are the red waves longer?");
  await page.waitForTimeout(250);
  await type("oh wait");
  const answered = await waitFor((s) => /^Last turn: /.test(s.level ?? ""), 40000);
  check("the reply finishes (the aside didn't replace the question)", !!answered, answered?.level ?? "");
  await page.click('[data-testid="stop"]').catch(() => {});
  await page.waitForTimeout(1500);
} catch (e) {
  console.log("ERROR", e.message);
}
await browser.close();
const files = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m);
const t = files[0] ? JSON.parse(readFileSync(join(DIR, files[0].f), "utf8")) : null;
if (t) {
  const merged = t.events.filter((e) => e.kind === "utterance-merged");
  check("the aside was merged into the pending question", merged.some((e) => e.action === "kept the reply"), JSON.stringify(merged.map((e) => `${e.text} -> ${e.into}`)));
  const reply = t.events.find((e) => e.kind === "reply");
  console.log(`        reply: "${reply?.text}"`);
  console.log(`        pause/resume events: ${t.events.filter((e) => e.kind === "pause" || e.kind === "resume").map((e) => `${e.kind}@${e.beatId}:${e.wordIndex}${e.pausedMs ? ` (${e.pausedMs} ms)` : ""}`).join(", ")}`);
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
