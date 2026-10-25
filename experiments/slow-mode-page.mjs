// With the Drawing preference on Slow (the preferences cookie), a fixture lesson's drawings go to /api/draw with
// mode "slow"; with it on Fast (or unset), mode "fast". Spoken first question on the scripted mic; stops after
// a few draw requests. DRAW=fast checks the other side.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "../scripts/fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DRAW = process.env.DRAW ?? "slow";
const b64 = readFileSync((await speechWav(join(process.cwd(), "experiments/conversation-e2e/clips/cadence-ask-fixture.wav"), [{ silence: 0.2 }, { say: "Why is the sky blue?" }, { silence: 0.4 }])).path).toString("base64");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addCookies([{ name: "chalky-preferences", value: encodeURIComponent(JSON.stringify({ draw: DRAW })), url: BASE }]);
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
const draws = [];
page.on("request", (r) => {
  if (r.url().endsWith("/api/draw") && r.method() === "POST") draws.push(JSON.parse(r.postData() ?? "{}"));
});
await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-quizzes&intake=0&debug=1`);
await page.click('[data-testid="start-talking"]');
const until = Date.now() + 30_000;
while (Date.now() < until && (await page.evaluate(() => document.querySelector(".tutor-board")?.dataset.mic)) !== "open") await page.waitForTimeout(300);
await page.evaluate((x) => window.__say(x), b64);
const end = Date.now() + 60_000;
while (Date.now() < end && draws.length < 3) await page.waitForTimeout(500);
await browser.close();
console.log(`Drawing preference ${DRAW}: ${draws.length} draw request(s), modes ${JSON.stringify(draws.map((d) => `${d.beat?.id}:${d.mode}`))}`);
console.log(draws.length && draws.every((d) => d.mode === DRAW) ? "PASS" : "FAIL");
