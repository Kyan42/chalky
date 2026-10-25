// Quizzes on the scripted mic, in a saved lesson: (1) "quiz me, label the parts" -> numbered markers over the
// board's labelled parts, answered partly right by voice, graded with spoken feedback; (2) "give me a drawing
// quiz" -> drawn with scripted pen strokes, handed in with Done, graded from the board picture. Both scores
// must be on the learner record (and its summary lines in confusions, which reach Convex).
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-quiz.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const OUT = join(process.cwd(), "experiments/quiz", process.env.RUN ?? "run");
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
  const f = readdirSync(DIR).map((n) => ({ n, m: statSync(join(DIR, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
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
    word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
    marks: document.querySelectorAll('[data-testid^="quiz-mark-"]').length,
    done: !!document.querySelector('[data-testid="quiz-done"]'),
  }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(100);
  }
  return null;
};
const sayText = async (name, text, hold = false) => {
  const b = await clip(name, text);
  if (hold) await page.keyboard.down("Space");
  const sec = await page.evaluate((x) => window.__say(x), b);
  await page.waitForTimeout(sec * 1000 + 150);
  if (hold) await page.keyboard.up("Space");
  console.log(`  [said] "${text}"`);
};
const waitEvent = async (kind, after, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = (transcript()?.events ?? []).filter((x) => x.kind === kind && x.t > after);
    if (e.length) return e[0];
    await page.waitForTimeout(500);
  }
  return null;
};
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=6&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  await waitFor((s) => s.beat === "b3" && s.status === "Speaking" && s.word >= 3, 120000);

  // 1. A label quiz, answered partly right.
  await sayText("quiz-label", "Quiz me on this. Label the parts.", true);
  const marks = await waitFor((s) => s.marks >= 2 && s.status === "Your turn", 40000);
  check("a label quiz numbers the board's labelled parts", !!marks, `${marks?.marks ?? 0} markers`);
  await page.screenshot({ path: join(OUT, "1-label-quiz.png") });
  const start = await waitEvent("quiz-start", 0, 8000);
  const items = start?.items ?? [];
  console.log(`        items: ${items.map((x) => `${x.n}=${x.answer}`).join(", ")}`);
  // Right for the first, wrong for the second, nothing for the rest.
  const answer = items.length >= 2 ? `Number one is the ${items[0].answer}. Number two is the moon. I don't know the others.` : "I don't know.";
  await sayText("quiz-label-answer", answer);
  const label = await waitEvent("quiz-result", start?.t ?? 0, 40000);
  await waitFor((s) => s.marks === 0, 20000);
  await page.screenshot({ path: join(OUT, "2-label-graded.png") });
  console.log(`        label result: ${JSON.stringify(label && { score: label.score, right: label.right, missing: label.missing, feedback: label.feedback, ms: label.ms })}`);
  check("the label quiz is graded partly right, with feedback", !!label && label.quiz === "label" && label.score > 0 && label.score < 1 && !!label.feedback, `score ${label?.score}`);

  // 2. A sketch quiz, drawn with pen strokes.
  await waitFor((s) => s.status === "Speaking" || s.status === "Your turn", 30000);
  await page.waitForTimeout(1500);
  await sayText("quiz-sketch", "Give me a drawing quiz on this.", true);
  const ready = await waitFor((s) => s.done && s.status === "Your turn", 40000);
  check("a sketch quiz waits for a drawing, with Done", !!ready);
  const box = await page.locator("canvas.ink").boundingBox();
  // A sun with rays (circle + spokes), an arrow to a small air dot, and blue squiggles going out from it.
  const stroke = async (pts) => {
    await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
    await page.mouse.up();
  };
  const circle = (cx, cy, r) => Array.from({ length: 25 }, (_, k) => [cx + r * Math.cos((k / 24) * 2 * Math.PI), cy + r * 1.5 * Math.sin((k / 24) * 2 * Math.PI)]);
  await stroke(circle(0.15, 0.7, 0.05));
  await stroke([[0.21, 0.7], [0.45, 0.7], [0.42, 0.67], [0.45, 0.7], [0.42, 0.73]]);
  await stroke(circle(0.5, 0.7, 0.012));
  await stroke([[0.52, 0.68], [0.56, 0.6], [0.6, 0.66], [0.64, 0.56], [0.68, 0.62]]);
  await stroke([[0.52, 0.72], [0.56, 0.8], [0.6, 0.74], [0.64, 0.84], [0.68, 0.78]]);
  await page.screenshot({ path: join(OUT, "3-sketch-drawn.png") });
  const before = transcript()?.events.at(-1)?.t ?? 0;
  await page.click('[data-testid="quiz-done"]');
  const sketch = await waitEvent("quiz-result", before, 60000);
  await page.screenshot({ path: join(OUT, "4-sketch-graded.png") });
  console.log(`        sketch result: ${JSON.stringify(sketch && { score: sketch.score, right: sketch.right, missing: sketch.missing, feedback: sketch.feedback, ms: sketch.ms, model: sketch.model })}`);
  check("the sketch quiz is graded from the board, with feedback", !!sketch && sketch.quiz === "sketch" && typeof sketch.score === "number" && !!sketch.feedback, `score ${sketch?.score}`);
  await page.waitForTimeout(3000);
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(1500);
await browser.close();
const t = transcript();
const q = t?.learner?.quizzes ?? [];
console.log(`        learner.quizzes: ${JSON.stringify(q.map((x) => ({ kind: x.kind, score: x.score, missing: x.missing })))}`);
console.log(`        learner.confusions: ${JSON.stringify(t?.learner?.confusions ?? [])}`);
check("both scores are on the learner record", q.length >= 2 && q.some((x) => x.kind === "label") && q.some((x) => x.kind === "sketch"));
check("and their summary lines are in confusions (what Convex keeps)", (t?.learner?.confusions ?? []).filter((c) => c.startsWith("quiz ")).length >= 2);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; frames in ${OUT}; transcript ${t?.id}`);
