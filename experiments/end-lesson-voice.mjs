// "I'm done" by voice mid-lesson (a fixture lesson, scripted mic, barge-in always on): the lesson ends with one
// goodbye and the page is back at the start screen (Start talking, no beats playing).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "../scripts/fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const clip = async (name, text) => readFileSync((await speechWav(join(process.cwd(), `experiments/conversation-e2e/clips/${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const ask = await clip("cadence-ask-fixture", "Why is the sky blue?");
const done = await clip("end-lesson-done", "I'm done, let's end the lesson here.");
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
await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-quizzes&intake=0&debug=1`);
await page.click('[data-testid="start-talking"]');
await waitFor((s) => s.mic === "open", 30_000);
await page.evaluate((x) => window.__say(x), ask);
const playing = await waitFor((s) => s.beat === "b2" && s.status === "speaking", 90_000);
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
await browser.close();
console.log("seen:", seen.join(" -> "));
console.log("final:", JSON.stringify(final));
console.log(playing && final.status === "idle" && !final.beat && final.start ? "PASS  \"I'm done\" ends the lesson and returns to the start screen" : "FAIL");
