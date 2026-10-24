// Drives /lesson like a user and watches the whole lesson.
//
//   npm run dev        # in another terminal
//   node scripts/e2e-lesson.mjs "Why is the sky blue?"
//
// Options (environment variables):
//   FAKE_MIC=<wav>           ask by voice instead of typing: Chromium's fake microphone plays the
//                            file, and the script clicks "Start talking" (the question argument is
//                            only used to name the output folder)
//   INTERRUPT_BEAT=<n>       press Space while beat n is being spoken...
//   INTERRUPT_TEXT=<text>    ...and type this question when Chalky starts listening
//   CHECKIN_TEXT=<text>      type this at the first check-in (later ones just Continue)
//   EVERY_FRAME=1            also save a screenshot every poll (to catch short-lived highlights)
//
// Every 0.5 s it records the status, title, beat being spoken, caption word and
// whether the board has drawn anything; it screenshots each beat mid-sentence
// into experiments/lesson-e2e/ and prints a timeline.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const question = process.argv[2] ?? "Why is the sky blue?";
const { FAKE_MIC, INTERRUPT_TEXT, CHECKIN_TEXT } = process.env;
const INTERRUPT_BEAT = process.env.INTERRUPT_BEAT ? Number(process.env.INTERRUPT_BEAT) : null;
const OUT = join(process.cwd(), "experiments/lesson-e2e", question.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40));
mkdirSync(OUT, { recursive: true });

const args = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
if (FAKE_MIC) args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_MIC}`);
const browser = await chromium.launch({ args });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: FAKE_MIC ? ["microphone"] : [] });
const page = await context.newPage();
const tts = [];
page.on("response", (r) => r.url().includes("/api/tts") && tts.push(r.status()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt/turns")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === "turn.end") console.log(`        [heard] "${m.transcript}"`);
    } catch {}
  });
});
await page.goto(`${BASE_URL}/lesson`, { waitUntil: "load" });
const t0 = Date.now();
if (FAKE_MIC) await page.click('[data-testid="start-talking"]');
else {
  await page.fill('[data-testid="question"]', question);
  await page.click('[data-testid="ask"]');
}

const type = async (text) => {
  await page.fill('[data-testid="question"]', text);
  await page.click('[data-testid="ask"]');
};

const shot = new Set();
const stalls = new Map();
let checkins = 0;
let interrupted = false;
let last = "";
let lastStatus = "";
for (;;) {
  const s = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    // Read back a downscaled copy of the canvas and count non-paper pixels.
    let inked = 0;
    try {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const g = c.getContext("2d");
      g.drawImage(canvas, 0, 0, 120, 80);
      const d = g.getImageData(0, 0, 120, 80).data;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 247) + Math.abs(d[i + 1] - 245) + Math.abs(d[i + 2] - 239) > 60) inked++;
    } catch {}
    const now = document.querySelector('.caption .word[data-state="now"]');
    const beats = [...document.querySelectorAll('[data-testid="beats"] li')];
    return {
      status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
      title: document.querySelector('[data-testid="title"]')?.textContent?.trim(),
      caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim(),
      beats: beats.length,
      current: beats.findIndex((li) => li.dataset.state === "now"),
      word: now?.textContent?.trim() ?? "",
      inked,
      error: document.querySelector('[data-testid="error"]')?.textContent ?? null,
      firstSound: document.querySelector('[data-testid="first-sound"]')?.textContent ?? null,
      replyMs: document.querySelector('[data-testid="reply-ms"]')?.textContent ?? null,
      meta: beats.map((li) => li.querySelector(".beat-meta")?.textContent),
    };
  });
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  const line = `${s.status} | beat ${s.current + 1}/${s.beats} | word "${s.word}" | board ink ${s.inked}px`;
  // "Drawing" after the first beat started speaking means playback is waiting on a visual.
  if (s.status === "Drawing…" && s.current > 0) stalls.set(s.current, (stalls.get(s.current) ?? 0) + 0.5);
  if (line !== last) console.log(`${t.padStart(5)} s  ${line}`);
  // Show what Chalky says outside the lesson's beats (greeting, replies).
  if (lastStatus === "Thinking…" && s.status === "Speaking") {
    await page.waitForTimeout(2500);
    const said = await page.$eval('[data-testid="caption"]', (el) => el.textContent.replace(/\s+/g, " ").trim());
    console.log(`        [chalky replies] ${said}`);
  }
  last = line;
  lastStatus = s.status;
  if (s.status === "Speaking" && s.current >= 0 && s.inked > 40 && !shot.has(s.current)) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `beat-${s.current + 1}.png`) });
    shot.add(s.current);
  }
  // Cut in mid-beat with Space, then type a question when Chalky listens.
  if (INTERRUPT_BEAT !== null && !interrupted && s.status === "Speaking" && s.current + 1 === INTERRUPT_BEAT && s.word) {
    interrupted = true;
    await page.waitForTimeout(1200);
    await page.keyboard.press("Space");
    console.log(`        [cut in with Space during beat ${INTERRUPT_BEAT}]`);
  }
  if (s.status === "Listening" && s.beats > 0 && interrupted && INTERRUPT_TEXT) {
    await page.screenshot({ path: join(OUT, "interrupted.png") });
    await page.waitForTimeout(800);
    console.log(`        [typed] "${INTERRUPT_TEXT}"`);
    await type(INTERRUPT_TEXT);
  }
  // At a check-in: the first gets CHECKIN_TEXT if given, the rest just Continue.
  if (s.status === "Your turn") {
    checkins++;
    await page.screenshot({ path: join(OUT, `checkin-${checkins}.png`) });
    await page.waitForTimeout(800);
    if (checkins === 1 && CHECKIN_TEXT) {
      console.log(`        [typed] "${CHECKIN_TEXT}"`);
      await type(CHECKIN_TEXT);
    } else await page.click('[data-testid="continue"]');
  }
  if (process.env.EVERY_FRAME && s.status === "Speaking") await page.screenshot({ path: join(OUT, `t-${t.padStart(5, "0")}-beat${s.current + 1}.png`) });
  if (/^(Done|Error|Stopped)/.test(s.status) || Date.now() - t0 > 480_000) {
    console.log(`\ntitle: ${s.title}\n${s.firstSound}\n${s.replyMs ?? ""}\nerror: ${s.error}\nTTS responses: ${tts.join(",")}`);
    console.log(`check-ins: ${checkins}`);
    console.log(`waits for a visual mid-lesson: ${[...stalls].map(([b, sec]) => `before beat ${b + 1} about ${sec} s`).join(", ") || "none"}`);
    s.meta.forEach((m, i) => console.log(`beat ${i + 1}: ${m}`));
    break;
  }
  await page.waitForTimeout(500);
}
await page.screenshot({ path: join(OUT, "end.png") });
await browser.close();
console.log(`screenshots in ${OUT}`);
