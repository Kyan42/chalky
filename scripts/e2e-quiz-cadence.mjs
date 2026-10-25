// Regular quizzes on the scripted mic, in a saved four-section lesson (why-is-the-sky-blue-quizzes): a label quiz
// after section 2, a predict quiz before section 4 and a sketch quiz after it, each played as it comes up.
// MODE=answer (default): the labels named, the prediction right ("about six times"), a drawing handed in with Done.
// MODE=skip: "I don't know" to the labels, a wrong prediction ("the same amount"), "skip" to the drawing; each skip
// is told the answer in one line. Either way the record (learner.quizzes and its lines in confusions) has all three.
// FIXTURE=<slug> plays another lesson; REAL="<question>" plays a real one (planner, intake off) instead.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> MODE=skip node scripts/e2e-quiz-cadence.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const MODE = process.env.MODE ?? "answer";
const REAL = process.env.REAL ?? "";
const FIXTURE = process.env.FIXTURE ?? "why-is-the-sky-blue-quizzes";
const OUT = join(process.cwd(), "experiments/quiz", `cadence-${REAL ? "real" : MODE}`);
mkdirSync(OUT, { recursive: true });
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const t0 = Date.now();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const transcript = () => {
  // Only finished files: the log route writes a temp file and renames it.
  const f = readdirSync(DIR).filter((n) => n.endsWith(".json")).flatMap((n) => { try { return [{ n, m: statSync(join(DIR, n)).mtimeMs }]; } catch { return []; } }).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
  try {
    return f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
  } catch {
    return null;
  }
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
  window.__say = async (b) => {
    await ac.resume();
    const buf = await ac.decodeAudioData(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return buf.duration;
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    marks: document.querySelectorAll('[data-testid^="quiz-mark-"]').length,
    done: !!document.querySelector('[data-testid="quiz-done"]'),
    learner: document.querySelector('[data-testid="learner"]')?.textContent?.trim() ?? "",
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
const sayText = async (name, text) => {
  const b = await clip(name, text);
  const sec = await page.evaluate((x) => window.__say(x), b);
  await page.waitForTimeout(sec * 1000 + 150);
  console.log(`  [said] "${text}"`);
};
const events = (kind, after = 0) => (transcript()?.events ?? []).filter((x) => x.kind === kind && x.t > after);
const waitEvent = async (kind, after, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = events(kind, after);
    if (e.length) return e[0];
    await page.waitForTimeout(400);
  }
  return null;
};
const stroke = async (box, pts) => {
  await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
  await page.mouse.up();
};
const circle = (cx, cy, r) => Array.from({ length: 25 }, (_, k) => [cx + r * Math.cos((k / 24) * 2 * Math.PI), cy + r * 1.5 * Math.sin((k / 24) * 2 * Math.PI)]);
const handled = [];
let lastLearner = "";
try {
  const q = REAL || "Why is the sky blue?";
  await page.goto(REAL ? `${BASE}/lesson?intake=0&debug=1` : `${BASE}/lesson?fixture=${FIXTURE}&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', q);
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  let after = 0;
  const until = Date.now() + (REAL ? 900_000 : 600_000);
  while (Date.now() < until) {
    const start = await waitEvent("quiz-start", after, 15_000);
    if (!start) {
      if (events("end").length || (await st()).status === "Done") break;
      // The lesson plays on; a check-in waits for an answer.
      const s = await st();
      if (s.status === "Your turn" && !s.done && !s.marks) await sayText("cadence-ok", "Yes, that makes sense, keep going.");
      continue;
    }
    after = start.t;
    const k = handled.length;
    console.log(`        quiz ${k + 1}: ${start.quiz} on ${start.beatId}: "${start.ask}"`);
    await waitFor((s) => s.status === "Your turn", 40_000);
    await page.screenshot({ path: join(OUT, `${k + 1}-${start.quiz}-asked.png`) });
    if (start.quiz === "label") {
      const items = start.items ?? [];
      await sayText(`cadence-label-${MODE}`, MODE === "skip" ? "I don't know." : items.map((x) => `Number ${x.n} is the ${x.answer}.`).join(" ") || "I don't know.");
    } else if (start.quiz === "predict") {
      const right = REAL ? "I think it will follow from what you just showed, because of the same idea." : "About six times more, because of the fourth power.";
      await sayText(`cadence-predict-${REAL ? "real" : MODE}`, MODE === "skip" ? "I think they scatter the same amount." : right);
    } else {
      if (MODE === "skip") await sayText("cadence-sketch-skip", "Skip.");
      else {
        await waitFor((s) => s.done, 20_000);
        const box = await page.locator("canvas.ink").boundingBox();
        await stroke(box, circle(0.15, 0.7, 0.05));
        await stroke(box, [[0.21, 0.7], [0.45, 0.7], [0.42, 0.67], [0.45, 0.7], [0.42, 0.73]]);
        await stroke(box, circle(0.5, 0.7, 0.012));
        await stroke(box, [[0.52, 0.68], [0.56, 0.6], [0.6, 0.66], [0.64, 0.56], [0.68, 0.62]]);
        await page.click('[data-testid="quiz-done"]');
      }
    }
    const res = await waitEvent("quiz-result", after, 60_000);
    handled.push({ start, res });
    console.log(`        result: ${JSON.stringify(res && { quiz: res.quiz, score: res.score, verdict: res.verdict, skipped: res.skipped, feedback: res.feedback, ms: res.ms, model: res.model })}`);
    await page.screenshot({ path: join(OUT, `${k + 1}-${start.quiz}-graded.png`) });
    lastLearner = (await st()).learner;
    // The fixture's third quiz is its last beat.
    if (!REAL && handled.length >= 3) break;
  }
  await page.waitForTimeout(2000);
  lastLearner = (await st()).learner || lastLearner;
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
const t = transcript();
const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
const kinds = ev("quiz-start").map((e) => e.quiz);
const planned = ev("planned");
const quizBeats = planned.filter((e) => e.quiz).map((e) => `${e.beatId}:${e.quiz}`);
console.log(`        planned quizzes: ${quizBeats.join(" ") || "none"}; sections: ${planned.filter((e) => e.section).length}`);
console.log(`        asked: ${kinds.join(", ")}; skipped: ${ev("quiz-skipped").map((e) => e.quiz).join(", ") || "none"}`);
console.log(`        page record: ${lastLearner}`);
console.log(`        record quizzes: ${JSON.stringify((t?.learner?.quizzes ?? []).map((z) => ({ kind: z.kind, score: z.score, verdict: z.verdict, skipped: z.skipped })))}`);
console.log(`        confusions: ${JSON.stringify(t?.learner?.confusions ?? [])}`);
check("label, predict and sketch each came up once", ["label", "predict", "sketch"].every((k) => kinds.filter((x) => x === k).length === 1), kinds.join(", "));
check("never the same kind twice in a row", kinds.every((k, i) => i === 0 || k !== kinds[i - 1]));
if (!REAL) {
  if (MODE === "skip") {
    const p = ev("quiz-result").find((e) => e.quiz === "predict");
    check("the wrong prediction is graded wrong, in one line", p?.verdict === "wrong" && !!p.feedback && p.feedback.split(/(?<=[.!?])\s+/).length <= 2, `${p?.verdict}: ${p?.feedback}`);
    const skips = ev("quiz-skipped").map((e) => e.quiz);
    const lines = ev("quiz-result").filter((e) => e.skipped).map((e) => e.feedback);
    check("skip and \"I don't know\" move on, the answer told in one line", skips.includes("label") && skips.includes("sketch") && lines.length === 2, lines.join(" | "));
  } else {
    const p = ev("quiz-result").find((e) => e.quiz === "predict");
    check("the right prediction is graded right, in one line", p?.verdict === "right" && !!p.feedback, `${p?.verdict}: ${p?.feedback}`);
    check("label and sketch are graded", ev("quiz-result").filter((e) => (e.quiz === "label" || e.quiz === "sketch") && !e.skipped).length === 2);
  }
}
check("the record has every quiz, and its lines in confusions", (t?.learner?.quizzes ?? []).length === kinds.length && (t?.learner?.confusions ?? []).filter((c) => c.startsWith("quiz (")).length >= Math.min(kinds.length, 3), `${(t?.learner?.quizzes ?? []).length} on the record`);
check("the page's record shows the quizzes", /quizzes: /.test(lastLearner), lastLearner);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${t?.id}`);
