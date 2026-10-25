// "I'm done" by voice mid-lesson (a fixture lesson, scripted mic, barge-in always on): the lesson ends with one
// goodbye and the page is back at the start screen (Start talking, no beats playing).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "../scripts/fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
// A longer lead-in so the first word is heard.
const clip = async (name, text) => readFileSync((await speechWav(join(process.cwd(), `experiments/conversation-e2e/clips/${name}.wav`), [{ silence: 0.6 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const ask = await clip("end-lesson-ask-lead", "Why is the sky blue?");
const done = await clip("end-lesson-done-lead", "I'm done, let's end the lesson here.");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
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
const st = () => page.evaluate(() => ({ status: document.querySelector(".tutor-board")?.dataset.status, mic: document.querySelector(".tutor-board")?.dataset.mic, beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null, start: !!document.querySelector('[data-testid="start-talking"]'), stage: document.querySelector('[data-testid="chalk-title"]') ? "title" : "" }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(250);
  }
  return null;
};
// FLOW=full: the paced sky lesson end to end: the intake answered, beats drawing, the check-in at b4 answered,
// then "I'm done" in the next section. Otherwise "I'm done" at b2 of the quizzes fixture (no intake).
const FULL = process.env.FLOW === "full";
const say = async (b) => {
  const sec = await page.evaluate((x) => window.__say(x), b);
  await page.waitForTimeout(sec * 1000 + 300);
};
await page.goto(`${BASE}/lesson?fixture=${FULL ? "why-is-the-sky-blue-paced" : "why-is-the-sky-blue-quizzes&intake=0"}&debug=1`);
await page.click('[data-testid="start-talking"]');
await waitFor((s) => s.mic === "open", 30_000);
// The speech recognizer is still connecting the moment the mic opens.
await page.waitForTimeout(1500);
await say(ask);
let playing;
if (FULL) {
  const intake = await waitFor((s) => s.status === "waiting", 60_000);
  console.log("intake asked:", !!intake);
  await say(await clip("end-lesson-intake", "I know a little about light, but not why the sky is blue."));
  const drew = await waitFor((s) => s.beat === "b3" && s.status === "speaking", 120_000);
  console.log("drawing beats:", !!drew);
  const checkin = await waitFor((s) => s.beat === "b4" && s.status === "waiting", 120_000);
  console.log("check-in asked:", !!checkin);
  await say(await clip("end-lesson-checkin", "The short blue waves get bounced around the most."));
  playing = await waitFor((s) => s.beat === "b6" && s.status === "speaking", 120_000);
} else playing = await waitFor((s) => s.beat === "b2" && s.status === "speaking", 90_000);
console.log("playing:", JSON.stringify(playing));
await page.evaluate((x) => window.__say(x), done);
const seen = [];
const until = Date.now() + 40_000;
while (Date.now() < until) {
  const s = await st();
  const key = JSON.stringify(s);
  if (seen.at(-1) !== key) seen.push(key);
  if (s.status === "idle" && !s.beat) break;
  await page.waitForTimeout(300);
}
await page.waitForTimeout(2000);
const final = await st();
await page.screenshot({ path: "experiments/end-lesson-voice.png" });
console.log("seen:", seen.join(" -> "));
console.log("final:", JSON.stringify(final));
console.log(playing && final.status === "idle" && !final.beat && final.start ? "PASS  \"I'm done\" ends the lesson and returns to the start screen" : "FAIL");

// The recap (learning history): what was covered, the board, a reflection and how it felt.
const recap = page.locator(".lesson-ending-panel");
const shown = await recap.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
const covered = shown ? await recap.locator(".session-recap ul").first().locator("li").allInnerTexts() : [];
const board = shown ? await recap.locator("img.history-board").count() : 0;
console.log(`        recap: ${shown ? "shown" : "missing"}; covered ${covered.length}: ${JSON.stringify(covered.map((c) => c.slice(0, 80)))}; board image: ${board}`);
console.log(shown && covered.length ? "PASS  the recap appears with what was covered" : "FAIL  the recap appears with what was covered");
let reflected = "";
if (shown) {
  await recap.locator("textarea").fill("Blue light scatters more because its wavelength is shorter.");
  await recap.getByRole("button", { name: "Still unsure" }).click();
  await recap.getByRole("button", { name: "Save reflection" }).click();
  reflected = await recap.getByText("Reflection saved.").waitFor({ timeout: 10_000 }).then(() => "saved", () => "not saved");
  await page.screenshot({ path: "experiments/end-lesson-recap.png" });
}
// The record: the lesson's transcript gets the reflection lines (what Convex and the next lesson's memory read).
await page.waitForTimeout(3000);
const runs = join(process.cwd(), "experiments/live-runs");
const { readdirSync, statSync } = await import("node:fs");
const latest = readdirSync(runs).filter((n) => n.endsWith(".json")).map((n) => ({ n, m: statSync(join(runs, n)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
const t = latest ? JSON.parse(readFileSync(join(runs, latest.n), "utf8")) : null;
const lines = (t?.learner?.confusions ?? []).filter((c) => /^(reflection|felt):/.test(c));
console.log(`        reflection ${reflected}; record lines: ${JSON.stringify(lines)}; transcript ${t?.id}`);
console.log(reflected === "saved" && lines.length === 2 ? "PASS  a reflection can be saved, and goes on the learner record" : "FAIL  a reflection can be saved, and goes on the learner record");

// Learning history in Settings lists it; Continue learning starts a lesson from the continuation prompt.
if (shown) await recap.getByRole("button", { name: "Done for now" }).click();
await page.locator(".preferences-gear").click();
await page.locator('[data-testid="history-tab"]').click();
// The list loads from IndexedDB.
await page.locator(".history-list li, .history-empty").first().waitFor({ timeout: 10_000 }).catch(() => {});
const items =await page.locator(".history-list li").allInnerTexts().catch(() => []);
console.log(`        history: ${JSON.stringify(items.map((x) => x.replace(/\s+/g, " ").slice(0, 80)))}`);
console.log(items.length ? "PASS  History lists the lesson" : "FAIL  History lists the lesson");
let continued = null;
if (items.length) {
  await page.locator(".history-list li button").first().click();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Continue learning" }).click();
  // Stop as soon as the new lesson has its first turn (no planner run needed to check the prompt).
  for (let k = 0; k < 40 && !continued; k++) {
    await page.waitForTimeout(500);
    const f = readdirSync(runs).filter((n) => n.endsWith(".json")).map((n) => ({ n, m: statSync(join(runs, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
    const n = f ? JSON.parse(readFileSync(join(runs, f.n), "utf8")) : null;
    const first = n?.events?.find((e) => e.kind === "learner");
    if (first && n.id !== t?.id) continued = { id: n.id, question: n.question, said: first.text };
  }
}
console.log(`        continued: ${JSON.stringify(continued && { ...continued, said: continued.said.slice(0, 160) })}`);
console.log(continued && /^I'd like to continue learning about/.test(continued.said) ? "PASS  Continue learning starts a lesson with the continuation prompt" : "FAIL  Continue learning starts a lesson with the continuation prompt");
await page.goto("about:blank").catch(() => {});
await browser.close();
