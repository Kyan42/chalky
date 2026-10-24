// Renders the visual flexibility experiment to an mp4 with Sonic voice.
//
//   npm run dev                                   # in another terminal
//   node scripts/render-flex-video.mjs            # → experiments/visual-flex/out/visual-flex.mp4
//
// 1. Fetches each beat's Sonic audio + word timestamps through /api/tts (cached).
// 2. Opens /experiments/visual-flex in headless Chromium, records checkCoverage
//    results into results.json, then steps through every frame at 30 fps with
//    window.renderFrame(segment, seconds) and screenshots it.
// 3. Builds one audio track aligned to the segments and muxes it with ffmpeg.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = process.cwd();
const PUB = join(ROOT, "public/experiments/visual-flex");
const OUT = join(ROOT, "experiments/visual-flex/out");
const AUDIO_JSON = join(PUB, "audio");
const AUDIO_PCM = join(OUT, "audio");
const FRAMES = join(OUT, "frames");
const FPS = 30;
const RATE = 44100;
const ONLY_SEGMENTS = process.env.SEGMENTS ? process.env.SEGMENTS.split(",").map(Number) : null;

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchAudio(beat) {
  const jsonFile = join(AUDIO_JSON, `${beat.id}.json`);
  const pcmFile = join(AUDIO_PCM, `${beat.id}.f32`);
  if (existsSync(jsonFile) && existsSync(pcmFile)) return;
  const res = await fetch(`${BASE_URL}/api/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: beat.say }) });
  if (!res.ok) throw new Error(`/api/tts ${res.status}: ${await res.text()}`);
  const chunks = [];
  const ts = { words: [], start: [], end: [] };
  let pending = "";
  let firstAudioMs = null;
  for await (const part of res.body) {
    pending += Buffer.from(part).toString("utf8");
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.type === "audio") {
        chunks.push(Buffer.from(e.data, "base64"));
        firstAudioMs ??= e.tMs;
      } else if (e.type === "timestamps") {
        ts.words.push(...e.words);
        ts.start.push(...e.start);
        ts.end.push(...e.end);
      } else if (e.type === "error") throw new Error(`Sonic: ${e.message}`);
    }
  }
  const pcm = Buffer.concat(chunks);
  const duration = pcm.length / 4 / RATE;
  const i = ts.words.findIndex((w) => norm(w) === norm(beat.at));
  if (i < 0) throw new Error(`anchor "${beat.at}" not found in Sonic timestamps for ${beat.id}`);
  writeFileSync(pcmFile, pcm);
  writeFileSync(jsonFile, JSON.stringify({ ...ts, duration: +duration.toFixed(3), anchorStart: ts.start[i], firstAudioMs }, null, 2));
  console.log(`audio ${beat.id}: ${duration.toFixed(2)} s, "${beat.at}" at ${ts.start[i].toFixed(2)} s, first audio ${firstAudioMs} ms`);
}

async function main() {
  mkdirSync(AUDIO_JSON, { recursive: true });
  mkdirSync(AUDIO_PCM, { recursive: true });
  const resultsFile = join(PUB, "results.json");
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  for (const beat of results.beats) await fetchAudio(beat);

  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on("console", (m) => m.type() === "error" && console.log("[page]", m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${BASE_URL}/experiments/visual-flex`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForFunction(() => window.flexReady === true, null, { timeout: 180_000 });

  const coverage = await page.evaluate(() => window.flexCoverage);
  for (const g of results.generations) g.coverage = g.docFile ? coverage[g.docFile] ?? null : null;
  writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  const unsupported = results.generations.filter((g) => g.coverage && !g.coverage.supported);
  console.log(`coverage: ${Object.keys(coverage).length} documents checked, ${unsupported.length} unsupported`);
  for (const g of unsupported) console.log(`  ${g.docFile}: ${g.coverage.reasons.join("; ")}`);

  const { segments } = await page.evaluate(() => window.flexInfo);
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  // One audio track: each beat's speech starts `lead` seconds into its segment.
  const frameCounts = segments.map((s) => Math.round(s.duration * FPS));
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0);
  const track = new Float32Array(Math.ceil((totalFrames / FPS) * RATE));
  let frame = 0;
  const t0 = Date.now();
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const startSample = Math.round((frame / FPS) * RATE);
    if (seg.kind === "beat") {
      const buf = readFileSync(join(AUDIO_PCM, `${seg.id}.f32`));
      const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      track.set(pcm.subarray(0, Math.max(0, track.length - startSample - Math.round(seg.lead * RATE))), startSample + Math.round(seg.lead * RATE));
    }
    for (let f = 0; f < frameCounts[si]; f++, frame++) {
      if (ONLY_SEGMENTS && !ONLY_SEGMENTS.includes(si)) continue;
      await page.evaluate(([s, t]) => window.renderFrame(s, t), [si, f / FPS]);
      await page.screenshot({ path: join(FRAMES, `${String(frame).padStart(5, "0")}.png`) });
    }
    console.log(`segment ${si} (${seg.kind}${seg.id ? ` ${seg.id}` : ""}): ${frameCounts[si]} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed`);
  }
  await browser.close();
  if (ONLY_SEGMENTS) return console.log("SEGMENTS set: frames only, no video");

  const trackFile = join(OUT, "track.f32");
  writeFileSync(trackFile, Buffer.from(track.buffer));
  const mp4 = join(OUT, "visual-flex.mp4");
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-framerate", String(FPS), "-i", join(FRAMES, "%05d.png"),
    "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", trackFile,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", mp4,
  ], { stdio: "inherit" });
  console.log(`wrote ${mp4} (${totalFrames} frames, ${(totalFrames / FPS).toFixed(1)} s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
