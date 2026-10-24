// Asks /lesson a question by voice and watches the start of the lesson.
//
//   npm run dev
//   node scripts/e2e-voice-ask.mjs                 # BASE_URL=http://localhost:3004
//
// The fake microphone plays, once (no loop): silence while the greeting is
// spoken, then "Hey Chalky." a pause of GAP seconds (default 0.9, long enough
// that Ink-2 may end a turn there), "Why do leaves change color in the fall?",
// then silence. It checks that one opener and one plan are requested, that the
// question shown and planned is the whole question, and saves a frame every
// half second into experiments/voice-e2e/<run>/. The lesson is stopped after
// SECONDS (default 30) so it never runs to the end.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";
const GAP = Number(process.env.GAP ?? 0.9);
const SECONDS = Number(process.env.SECONDS ?? 30);
const LEAD = Number(process.env.LEAD ?? 6);
const A = process.env.SAY_A ?? "Hey Chalky.";
const B = process.env.SAY_B ?? "Why do leaves change color in the fall?";
const RUN = process.env.RUN ?? `gap-${GAP}`;
const OUT = join(process.cwd(), "experiments/voice-e2e", RUN);
mkdirSync(OUT, { recursive: true });

const wav = await speechWav(join(process.cwd(), "experiments/voice-e2e", `ask-gap-${GAP}.wav`), [{ silence: LEAD }, { say: A }, { silence: GAP }, { say: B }, { silence: 20 }]);
console.log(`fake mic: ${wav.seconds} s; ${wav.timeline.map((x) => `"${x.say}" at ${x.at} s for ${x.seconds} s`).join(", ")}`);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav.path}%noloop`],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 800 }, permissions: ["microphone"] });
const page = await context.newPage();
const requests = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (["/api/opener", "/api/plan", "/api/converse", "/api/reply"].includes(u.pathname)) requests.push({ path: u.pathname, body: r.postData(), t: Date.now() });
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
const turns = [];
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt/turns")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === "turn.end") {
        turns.push(m.transcript);
        console.log(`        [ink turn.end] "${m.transcript}"`);
      }
    } catch {}
  });
});

await page.goto(`${BASE_URL}/lesson`, { waitUntil: "load" });
const t0 = Date.now();
await page.click('[data-testid="start-talking"]');
let last = "";
let frame = 0;
const seen = { heard: new Set(), titles: new Set() };
// STOP_AFTER_PLAN=1: close ~1 s after the plan is requested (the route aborts the planner), so no lesson is spent.
const STOP_AFTER_PLAN = !!process.env.STOP_AFTER_PLAN;
while (Date.now() - t0 < SECONDS * 1000) {
  const planReq = requests.find((r) => r.path === "/api/plan");
  if (STOP_AFTER_PLAN && planReq && Date.now() - planReq.t > 1500) break;
  const s = await page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
    title: document.querySelector('[data-testid="title"]')?.textContent?.trim(),
    heard: document.querySelector('[data-testid="heard"]')?.textContent ?? document.querySelector('[data-testid="heard-note"]')?.textContent ?? null,
    mic: document.querySelector('.board')?.dataset.mic,
    caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 90),
    beats: document.querySelectorAll('[data-testid="beats"] li').length,
    error: document.querySelector('[data-testid="error"]')?.textContent ?? null,
  }));
  if (s.heard) seen.heard.add(s.heard);
  seen.titles.add(s.title);
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  const line = `${s.status} (mic ${s.mic}) | ${s.title} | beats ${s.beats} | ${s.heard ? `heard ${s.heard}` : `caption "${s.caption}"`}${s.error ? ` | ERROR ${s.error}` : ""}`;
  if (line !== last) console.log(`${t.padStart(5)} s  ${line}`);
  last = line;
  await page.screenshot({ path: join(OUT, `f${String(frame++).padStart(3, "0")}-${t}s.png`) });
  await page.waitForTimeout(500);
}
const stop = await page.$('[data-testid="stop"]');
if (stop) await stop.click();
await page.waitForTimeout(300);
await browser.close();

const opener = requests.filter((r) => r.path === "/api/opener");
const plan = requests.filter((r) => r.path === "/api/plan");
const asked = plan.map((r) => JSON.parse(r.body).question);
console.log(`\nink turns: ${JSON.stringify(turns)}`);
console.log(`transcripts shown while listening: ${JSON.stringify([...seen.heard])}`);
console.log(`/api/opener requests: ${opener.length}; /api/plan requests: ${plan.length}; questions planned: ${JSON.stringify(asked)}`);
const full = asked.length === 1 && /leaves/i.test(asked[0]);
console.log(`${opener.length === 1 && plan.length === 1 ? "PASS" : "FAIL"}  one opener and one plan`);
console.log(`${full ? "PASS" : "FAIL"}  the planned question contains the real question (${JSON.stringify(asked[0] ?? "")})`);
console.log(`frames in ${OUT}`);
