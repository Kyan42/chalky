// Drives the whiteboard in Chromium the way a user would: Play, wait, Space
// mid-sentence, Space again. Saves screenshots to docs/screenshots/ and the
// measured telemetry to docs/e2e-results.json.
// Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const shots = "docs/screenshots";
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

const state = () => page.evaluate(() => window.__chalky?.());
const until = async (label, predicate, timeout = 20_000) => {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (s && predicate(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(s)?.slice(0, 400)}`);
    await page.waitForTimeout(10);
  }
};
const waveStart = (s) => s.telemetry.log.findLast((l) => l.event === "action-resolved")?.wordStart;
const shot = async (name, extra = {}) => {
  const s = await state();
  await page.screenshot({ path: `${shots}/${name}.png` });
  const row = { name, status: s.status, speechSeconds: s.speechSeconds, playerTick: s.playerTick, ctx: s.audioContext, bytes: s.bytesReceived ?? s.lastBytesReceived, outputLevel: s.outputLevel, ...extra };
  console.log("shot", JSON.stringify(row));
  return row;
};

const report = { shots: [] };
await page.goto(base);
await until("player ready", (s) => s.status === "ready", 60_000);
report.shots.push(await shot("01-ready"));

// Play.
await page.getByTestId("play").click();
// Just before "wave": the word is known and the audio is ~0.1 s short of it.
await until("just before wave", (s) => waveStart(s) !== undefined && s.speechSeconds >= waveStart(s) - 0.12);
report.shots.push(await shot("02-before-wave", { waveWordStart: waveStart(await state()) }));
// Just after "wave": the wave has started drawing.
await until("wave moving", (s) => s.telemetry.waveCue && s.speechSeconds >= waveStart(s) + 0.35);
report.shots.push(await shot("03-after-wave"));

// Interrupt mid-sentence, on "pressure".
await until("mid-sentence", (s) => s.speechSeconds >= 1.6);
// Peak output level over the 300 ms before Space: non-zero means samples reach the destination.
let peakLevel = 0;
for (let i = 0; i < 15; i++) {
  peakLevel = Math.max(peakLevel, (await state()).outputLevel ?? 0);
  await page.waitForTimeout(20);
}
const beforeSpace = await state();
await page.keyboard.press("Space");
await page.waitForTimeout(60);
const levelAfterSpace = (await state()).outputLevel;
const paused = await until("paused", (s) => s.status === "paused");
report.shots.push(await shot("04-paused", { resumePoint: paused.resumePoint }));
// Prove it stays paused: wave tick frozen, no audio clock running for the beat, stage dimmed.
await page.waitForTimeout(800);
const stillPaused = await state();
report.pauseCheck = {
  tickAtPause: paused.playerTick,
  tickAfter800ms: stillPaused.playerTick,
  playerPlaying: stillPaused.playerPlaying,
  speechSecondsAfter: stillPaused.speechSeconds, // null: the run and its audio are gone
  stageDimmed: await page.getByTestId("stage").getAttribute("data-dimmed"),
  peakOutputLevelBeforeSpace: +peakLevel.toFixed(4),
  outputLevel60msAfterSpace: levelAfterSpace,
  outputLevel800msAfterSpace: stillPaused.outputLevel,
  wordsSpokenBeforeSpace: beforeSpace.speechSeconds,
  interruptLog: stillPaused.telemetry.log.find((l) => l.event === "interrupt"),
};
console.log("pauseCheck", JSON.stringify(report.pauseCheck));

// Resume: rewinds the wave and replays the sentence from the start.
await page.keyboard.press("Space");
await until("resumed and speaking", (s) => s.status === "speaking" && s.speechSeconds > 0.3);
report.shots.push(await shot("05-resumed-start"));
await until("resumed wave", (s) => s.telemetry.waveCue && s.speechSeconds >= waveStart(s) + 0.8);
report.shots.push(await shot("06-resumed-drawing"));
const done = await until("beat done", (s) => s.status === "done", 30_000);
report.shots.push(await shot("07-done"));

report.telemetry = done.telemetry;

// Scenario B: interrupt while Sonic is still streaming, to prove late audio is discarded.
await page.getByTestId("play").click();
await until("first audio (B)", (s) => s.status === "speaking" && s.speechSeconds > 0.05);
await page.keyboard.press("Space");
const early = await until("paused (B)", (s) => s.status === "paused");
const bytesAtInterrupt = early.lastBytesReceived;
await page.waitForTimeout(2500); // longer than the rest of the stream takes
const later = await state();
report.earlyInterrupt = {
  speechAtInterrupt: early.resumePoint.speechSeconds,
  wordAtInterrupt: early.resumePoint.word,
  bytesAtInterrupt,
  bytesAfter2500ms: later.lastBytesReceived,
  streamDoneEventsForThisRun: later.telemetry.log.filter((l) => l.event === "stream-done").length, // telemetry resets on Play
  outputLevelAfter: later.outputLevel,
  fullBeatBytes: done.telemetry.serverStats?.bytes,
};
console.log("earlyInterrupt", JSON.stringify(report.earlyInterrupt));
await page.screenshot({ path: `${shots}/08-early-interrupt.png` });
const drift = [...done.telemetry.drift].sort((a, b) => a - b);
report.driftMs = drift.length
  ? { samples: drift.length, min: drift[0], median: drift[Math.floor(drift.length / 2)], p95: drift[Math.floor(drift.length * 0.95)], max: drift.at(-1) }
  : null;
writeFileSync("docs/e2e-results.json", JSON.stringify(report, null, 2));
console.log("waveCue", JSON.stringify(done.telemetry.waveCue));
console.log("driftMs", JSON.stringify(report.driftMs));
console.log("firstAudioMs", done.telemetry.firstAudioMs, "server", JSON.stringify(done.telemetry.serverStats));
await browser.close();
