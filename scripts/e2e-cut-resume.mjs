// Where a beat goes on after a cut-in, on the scripted mic: hold Space and ask something at word CUT of
// beat 2 (a ~30-word beat of a saved lesson), then Continue. Early (word 5): the beat goes on from the word
// they cut in at, not from its start. Late (word 25): the lesson goes on with the next beat.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> CUT=5 node scripts/e2e-cut-resume.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const CUT = Number(process.env.CUT ?? 5);
const ASK = process.env.ASK ?? "Wait, what is a wavelength exactly?";
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const b64 = readFileSync((await speechWav(join(clipDir, "cut-ask.wav"), [{ silence: 0.2 }, { say: ASK }, { silence: 0.4 }])).path).toString("base64");
const t0 = Date.now();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
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
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
    turn: Number(document.querySelector('[data-testid="last-level"]')?.dataset.turn ?? 0),
  }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(60);
  }
  return null;
};
let after = null;
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=5&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  const at = await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= CUT, 120000);
  check(`b2 reached word ${CUT}`, !!at, `word ${at?.word}`);
  await page.keyboard.down("Space");
  const sec = await page.evaluate((b) => window.__say(b), b64);
  await page.waitForTimeout(sec * 1000 + 150);
  await page.keyboard.up("Space");
  const turn0 = (await st()).turn;
  // The reply, then Continue if it waits.
  await waitFor((s) => s.turn > turn0 && !/Thinking/i.test(s.status), 60000);
  await page.waitForTimeout(500);
  if ((await st()).status === "Your turn") await page.click('[data-testid="continue"]');
  after = await waitFor((s) => s.status === "Speaking" && s.beat && s.word >= 0, 30000);
  await page.waitForTimeout(400);
  after = { ...after, firstWord: after?.word };
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(1500);
await browser.close();
const f = readdirSync(DIR).map((n) => ({ n, m: statSync(join(DIR, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
const t = f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
const reply = ev("reply")[0];
const settle = ev("resume-after-cut")[0];
const beats = ev("beat");
const cutBeat = beats.find((b) => b.beatId === "b2" && b.interrupted);
const nextBeat = beats[beats.indexOf(cutBeat) + 1];
console.log(`        cut at word ${cutBeat?.atWord}; reply "${reply?.text}" [${(reply?.actions ?? []).map((a) => (a.type === "resume" ? `resume:${a.how}${a.why ? ` (${a.why})` : ""}` : a.type)).join(", ")}]`);
console.log(`        settled: ${JSON.stringify(settle)}; next beat played: ${nextBeat?.beatId}${nextBeat?.fromWord !== undefined ? ` from word ${nextBeat.fromWord} (${nextBeat.fromSec} s)` : " from its start"}; page then on ${after?.beat} word ${after?.firstWord}`);
if (CUT <= 10) {
  check("an early cut goes on from the word, not the start", settle?.how === "from the word" && nextBeat?.beatId === "b2" && Math.abs((nextBeat?.fromWord ?? -99) - (cutBeat?.atWord ?? 0) + 1) <= 1, `${settle?.how}`);
  check("the page shows b2 from there (not word 0)", after?.beat === "b2" && (after?.firstWord ?? 0) >= CUT - 2, `${after?.beat} word ${after?.firstWord}`);
} else {
  check("a late cut goes on with the next beat", settle?.how === "next beat" && nextBeat?.beatId === "b3", `${settle?.how}, then ${nextBeat?.beatId}`);
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${t?.id}`);
