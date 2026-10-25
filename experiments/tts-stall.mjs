// The Sonic stall guard: a fixture lesson where the browser holds back speech requests (as on bad wifi).
// STALL=1: the 4th /api/tts request hangs; the beat asks again after 6 s and plays. STALL=2: the 4th and 5th
// hang; the beat goes on without audio (its drawing shown) and the lesson moves on. Reads tts-stall events and
// beat timings from the transcript.
//   BASE_URL=http://localhost:3006 STALL=2 node experiments/tts-stall.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "../scripts/fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const STALL = Number(process.env.STALL ?? 1);
const AT = Number(process.env.AT ?? 4);
const runs = join(process.cwd(), "experiments/live-runs");
const ask = readFileSync((await speechWav(join(process.cwd(), "experiments/conversation-e2e/clips/end-lesson-ask-lead.wav"), [{ silence: 0.6 }, { say: "Why is the sky blue?" }, { silence: 0.4 }])).path).toString("base64");
const t0 = Date.now();
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
// Speech requests are numbered; from the AT-th on, STALL of them hang (never answered while the page waits).
let n = 0;
const held = [];
await page.route("**/api/tts", async (route) => {
  n++;
  if (n >= AT && n < AT + STALL) {
    held.push({ n, text: JSON.parse(route.request().postData() ?? "{}").text?.slice(0, 50) });
    await new Promise((r) => setTimeout(r, 45_000));
    return route.abort().catch(() => {});
  }
  return route.continue();
});
const st = () => page.evaluate(() => ({ status: document.querySelector(".tutor-board")?.dataset.status, mic: document.querySelector(".tutor-board")?.dataset.mic, beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null }));
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
await page.waitForTimeout(1500);
await page.evaluate((x) => window.__say(x), ask);
const reached = await waitFor((s) => s.beat === "b5", 150_000);
await page.waitForTimeout(2000);
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
const f = readdirSync(runs).filter((x) => x.endsWith(".json")).map((x) => ({ x, m: statSync(join(runs, x)).mtimeMs })).filter((y) => y.m >= t0).sort((a, b) => b.m - a.m)[0];
const t = f ? JSON.parse(readFileSync(join(runs, f.x), "utf8")) : null;
const stalls = (t?.events ?? []).filter((e) => e.kind === "tts-stall");
console.log(`held requests: ${JSON.stringify(held)}`);
console.log(`tts-stall: ${JSON.stringify(stalls.map((e) => ({ t: e.t, beatId: e.beatId, where: e.where, attempt: e.attempt, from: e.from })))}`);
console.log(`beats: ${(t?.beats ?? []).map((b) => `${b.beatId} ${(b.playedMs / 1000).toFixed(1)}s`).join(", ")}`);
const longest = Math.max(0, ...(t?.beats ?? []).map((b) => b.playedMs ?? 0));
const ok = !!reached && stalls.length >= 1 && (STALL === 1 ? !stalls.some((e) => e.where === "gave up") : stalls.some((e) => e.where === "gave up")) && longest < 30_000;
console.log(`${ok ? "PASS" : "FAIL"}  ${STALL === 1 ? "one stall: asked again and played" : "two stalls: went on without audio"}; lesson reached b5: ${!!reached}; longest beat ${(longest / 1000).toFixed(1)} s; transcript ${t?.id}`);
