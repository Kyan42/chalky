// Captures the lesson page's opening as an animated GIF and a still PNG, for the README: the start
// screen, then Start talking, the greeting and the scenery that rises with it (a silent fake mic).
//   BASE_URL=http://localhost:3000 node scripts/capture-opening.mjs
// Options (environment variables): SECONDS (9), FPS (12), WIDTH of the GIF (720), OUT (docs/media).
// Frames are page screenshots at up to FPS a second, each shown for as long as it took, so the GIF
// plays at real speed. Uses sharp, which is installed with @huggingface/transformers.
import { chromium } from "playwright";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECONDS = Number(process.env.SECONDS ?? 9);
const WIDTH = Number(process.env.WIDTH ?? 720);
const FRAME_MS = 1000 / Number(process.env.FPS ?? 12);
const OUT = process.env.OUT ?? join(process.cwd(), "docs/media");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  if (!navigator.mediaDevices) return;
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
});
const page = await context.newPage();
await page.goto(`${BASE}/lesson`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="start-talking"]');
await page.waitForTimeout(1200);
setTimeout(() => page.click('[data-testid="start-talking"]').catch(() => {}), 1200);
const frames = [];
const t0 = Date.now();
let last = t0;
while (Date.now() - t0 < SECONDS * 1000) {
  const png = await page.screenshot({ type: "png" });
  const now = Date.now();
  frames.push({ png, ms: now - last });
  last = now;
  const spare = FRAME_MS - (Date.now() - now);
  if (spare > 0) await page.waitForTimeout(spare);
}
await page.screenshot({ path: join(OUT, "opening.png") });
await browser.close();

const height = Math.round((WIDTH * 720) / 1280);
const raw = await Promise.all(frames.map((f) => sharp(f.png).resize(WIDTH, height).ensureAlpha().raw().toBuffer()));
// A frame's delay is how long it stayed on screen: the time until the next screenshot.
const delay = frames.map((_, i) => Math.max(20, frames[i + 1]?.ms ?? 1500));
await sharp(Buffer.concat(raw), { raw: { width: WIDTH, height: height * raw.length, channels: 4, pageHeight: height } })
  .gif({ delay, loop: 0, effort: 7 })
  .toFile(join(OUT, "opening.gif"));
console.log(`${frames.length} frames over ${SECONDS} s -> ${join(OUT, "opening.gif")} (${Math.round(statSync(join(OUT, "opening.gif")).size / 1024)} KB), opening.png`);
