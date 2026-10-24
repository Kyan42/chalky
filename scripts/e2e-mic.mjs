// Drives /experiments/mic headlessly with a fake microphone.
//
//   npm run dev                      # in another terminal
//   node scripts/e2e-mic.mjs         # BASE_URL=http://localhost:3004 by default
//
// The fake mic file is one short sentence from /api/tts followed by silence,
// converted to a 16-bit WAV (Chromium loops it). Checks:
//   1. open mic: with "Chalky is speaking" off, utterances arrive on their own;
//   2. barge-in: with it on, nothing is heard until Space is held; key down logs
//      barge-in at once, key up ends the turn and logs the utterance;
//   3. a short tap of Space is cancelled.
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";
const OUT = join(process.cwd(), "experiments/mic-e2e");
const WAV = join(OUT, "fake-mic.wav");
const SENTENCE = "Wait, why does the blue light scatter more than the red light?";
mkdirSync(OUT, { recursive: true });

/** One sentence of Sonic audio plus two seconds of silence, as 16-bit mono WAV at Sonic's rate. */
async function makeWav() {
  if (existsSync(WAV) && !process.env.REGENERATE) return;
  process.stdout.write("generating fake mic audio via /api/tts … ");
  const res = await fetch(`${BASE_URL}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: SENTENCE }) });
  if (!res.ok) throw new Error(`tts failed (${res.status})`);
  const text = await res.text();
  let rate = 44100;
  let encoding = "pcm_f32le";
  const chunks = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type === "start") ({ sampleRate: rate, encoding } = ev);
    else if (ev.type === "audio") chunks.push(Buffer.from(ev.data, "base64"));
    else if (ev.type === "error") throw new Error(ev.message);
  }
  const f32 = Buffer.concat(chunks);
  const width = encoding === "pcm_s16le" ? 2 : 4;
  const samples = Math.floor(f32.length / width);
  const lead = Math.floor(rate * 0.6), tailSilence = rate * 2;
  const pcm = Buffer.alloc((lead + samples + tailSilence) * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.max(-1, Math.min(1, width === 2 ? f32.readInt16LE(i * 2) / 32768 : f32.readFloatLE(i * 4)));
    pcm.writeInt16LE(Math.round(v * 32767), (lead + i) * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(WAV, Buffer.concat([header, pcm]));
  console.log(`${(samples / rate).toFixed(1)} s of speech → ${WAV}`);
}

await makeWav();

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
const inkEvents = [];
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt/turns")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      inkEvents.push(m.type);
      if (m.type === "turn.end") console.log(`        [ink turn.end] "${m.transcript}"`);
    } catch {}
  });
});

const entries = async () => page.$$eval('[data-testid="log"] li', (lis) => lis.map((li) => ({ kind: li.dataset.kind, text: li.textContent })));
const mode = async () => page.$eval('[data-testid="mode"]', (el) => el.dataset.mode);
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = await entries();
    if (pred(e)) return e;
    await page.waitForTimeout(200);
  }
  return null;
};
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(`${BASE_URL}/experiments/mic`, { waitUntil: "load" });
await page.click('[data-testid="start"]');
await page.waitForFunction(() => document.querySelector('[data-testid="mode"]')?.dataset.mode !== "off", null, { timeout: 15000 });
check("mic starts in open mode", (await mode()) === "open", `mode=${await mode()}`);

// 1. Open mic: the looping file should produce utterances by itself.
const open = await waitFor((e) => e.some((x) => x.kind === "utterance"), 20000);
const firstUtterance = open?.find((x) => x.kind === "utterance")?.text ?? "";
check("open mic hears an utterance", !!open, firstUtterance);
check("open-mic utterance is marked via open", /via open/.test(firstUtterance), "");

// 2. Mute: fake "Chalky is speaking" and make sure nothing new arrives for a while.
await page.click('[data-testid="speaking"]');
await page.waitForTimeout(300);
check("mode is muted while Chalky speaks", (await mode()) === "muted", `mode=${await mode()}`);
const before = (await entries()).length;
await page.waitForTimeout(6000);
const during = (await entries()).filter((x) => x.kind === "utterance").length - open.filter((x) => x.kind === "utterance").length;
check("muted mic hears nothing", (await entries()).length === before, `${(await entries()).length - before} new entries, ${during} new utterances`);

// 3. Barge in: hold Space. Key down must log barge-in at once; key up ends the turn.
await page.keyboard.down("Space");
await page.waitForTimeout(150);
const bargeNow = (await entries()).some((x) => x.kind === "barge-in");
check("barge-in fires on key down", bargeNow && (await mode()) === "held", `mode=${await mode()}`);
await page.screenshot({ path: join(OUT, "held.png") });
// Hold long enough for the looping sentence to be heard at least once (the file is about 4.5 s long).
await page.waitForTimeout(5500);
const partial = await page.$eval('[data-testid="partial"]', (el) => el.textContent);
console.log(`        partial while held: ${partial}`);
await page.keyboard.up("Space");
const barge = await waitFor((e) => e.some((x) => x.kind === "utterance" && /via barge/.test(x.text)), 4000);
const bargeText = barge?.find((x) => x.kind === "utterance" && /via barge/.test(x.text))?.text ?? "";
check("key up yields the barge-in utterance", !!barge, bargeText);
await page.waitForTimeout(500);
check("back to muted after the barge-in", (await mode()) === "muted", `mode=${await mode()}`);

// 3b. Release mid-sentence: Ink hasn't ended the turn yet, so the hook waits (tail) and then emits.
await page.keyboard.down("Space");
let midPartial = "";
for (let i = 0; i < 60 && !midPartial; i++) {
  await page.waitForTimeout(100);
  const p = await page.$eval('[data-testid="partial"]', (el) => el.textContent);
  if (p && p !== "…" && p.split(/\s+/).length >= 3) midPartial = p;
}
const countBefore = (await entries()).filter((x) => x.kind === "utterance").length;
const upAt = Date.now();
await page.keyboard.up("Space");
await page.waitForTimeout(100);
const tailMode = await mode();
const mid = await waitFor((e) => e.filter((x) => x.kind === "utterance").length > countBefore, 4000);
const midText = mid?.filter((x) => x.kind === "utterance")[0]?.text ?? "";
check("release mid-sentence still yields an utterance", !!mid && /via barge/.test(midText), `partial at release ${midPartial}; mode after release ${tailMode}; utterance ${Date.now() - upAt} ms after key up: ${midText}`);
await page.waitForTimeout(500);

// 4. A tap is ignored.
await page.keyboard.down("Space");
await page.waitForTimeout(120);
await page.keyboard.up("Space");
const cancelled = await waitFor((e) => e.some((x) => x.kind === "barge-in cancelled"), 3000);
check("a short tap is cancelled", !!cancelled, "");

// 5. Unmute: the open mic comes back.
await page.click('[data-testid="speaking"]');
await page.waitForTimeout(300);
check("open again once Chalky stops", (await mode()) === "open", `mode=${await mode()}`);
await page.screenshot({ path: join(OUT, "end.png") });

console.log(`\nink events: ${Object.entries(inkEvents.reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(", ")}`);
console.log(`event log:\n${(await entries()).reverse().map((x) => `  ${x.text}`).join("\n")}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; screenshots in ${OUT}`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
