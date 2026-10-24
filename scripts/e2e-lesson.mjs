// Drives /lesson like a user: types a question, clicks Ask, and watches the whole lesson.
//
//   npm run dev        # in another terminal
//   node scripts/e2e-lesson.mjs "Why is the sky blue?"
//
// Every 0.5 s it records the status, title, beat being spoken, caption word and
// whether the board has drawn anything; it screenshots each beat mid-sentence
// into experiments/lesson-e2e/ and prints a timeline.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const question = process.argv[2] ?? "Why is the sky blue?";
const OUT = join(process.cwd(), "experiments/lesson-e2e", question.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const tts = [];
page.on("response", (r) => r.url().includes("/api/tts") && tts.push(r.status()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
await page.goto(`${BASE_URL}/lesson`, { waitUntil: "load" });
await page.fill('[data-testid="question"]', question);
const t0 = Date.now();
await page.click('[data-testid="ask"]');

const shot = new Set();
const stalls = new Map();
let last = "";
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
      beats: beats.length,
      current: beats.findIndex((li) => li.dataset.state === "now"),
      word: now?.textContent?.trim() ?? "",
      inked,
      error: document.querySelector('[data-testid="error"]')?.textContent ?? null,
      firstSound: document.querySelector('[data-testid="first-sound"]')?.textContent ?? null,
      meta: beats.map((li) => li.querySelector(".beat-meta")?.textContent),
    };
  });
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  const line = `${s.status} | beat ${s.current + 1}/${s.beats} | word "${s.word}" | board ink ${s.inked}px`;
  // "Drawing" after the first beat started speaking means playback is waiting on a visual.
  if (s.status === "Drawing…" && s.current > 0) stalls.set(s.current, (stalls.get(s.current) ?? 0) + 0.5);
  if (line !== last) console.log(`${t.padStart(5)} s  ${line}`);
  last = line;
  if (s.status === "Speaking" && s.current >= 0 && s.inked > 40 && !shot.has(s.current)) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `beat-${s.current + 1}.png`) });
    shot.add(s.current);
  }
  // EVERY_FRAME=1 also saves a screenshot every poll, to catch short-lived marks like highlights.
  if (process.env.EVERY_FRAME && s.status === "Speaking") await page.screenshot({ path: join(OUT, `t-${t.padStart(5, "0")}-beat${s.current + 1}.png`) });
  if (["Done", "Error", "Stopped"].includes(s.status) || Date.now() - t0 > 180_000) {
    console.log(`\ntitle: ${s.title}\n${s.firstSound}\nerror: ${s.error}\nTTS responses: ${tts.join(",")}`);
    console.log(`waits for a visual mid-lesson: ${[...stalls].map(([b, sec]) => `before beat ${b + 1} about ${sec} s`).join(", ") || "none"}`);
    s.meta.forEach((m, i) => console.log(`beat ${i + 1}: ${m}`));
    break;
  }
  await page.waitForTimeout(500);
}
await page.screenshot({ path: join(OUT, "end.png") });
await browser.close();
console.log(`screenshots in ${OUT}`);
