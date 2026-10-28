// Retrieval in a real lesson, on the scripted mic: two lessons for one learner (one browser, so one
// learner cookie). Lesson 1 cuts in mid-beat with a question about what is on the board; lesson 2,
// after lesson 1 has been saved to Convex, cuts in with one its memory should answer. Reads each
// lesson's transcript and prints its `retrieval` events: the board search's status and hits, and the
// memory lines, before each reply. Needs CHALKY_LIVE_LOG=1 and NEXT_PUBLIC_CONVEX_URL on the server.
//   BASE_URL=http://localhost:3012 node scripts/e2e-retrieval.mjs
import { chromium } from "playwright";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.6 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const ASKS = [
  ["retrieval-board", process.env.ASK1 ?? "Wait, is the red one the longer wave?"],
  ["retrieval-memory", process.env.ASK2 ?? "Hold on, I got stuck on this last time. Why does the blue light scatter more?"],
];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  if (!navigator.mediaDevices) return; // about:blank
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

async function lesson(n, [clipName, ask], warm = false) {
  const t0 = Date.now();
  const b64 = await clip(clipName, ask);
  const question = await clip("retrieval-question", "Why is the sky blue?");
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  // The board's data-status and data-mic, as scripts/e2e-quiz-cadence.mjs reads them.
  const st = () =>
    page.evaluate(() => ({
      status: document.querySelector(".tutor-board")?.dataset.status ?? "",
      mic: document.querySelector(".tutor-board")?.dataset.mic ?? "",
      beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
      word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
      turn: Number(document.querySelector('[data-testid="last-level"]')?.dataset.turn ?? 0),
    }));
  const say = async (b) => {
    const sec = await page.evaluate((x) => window.__say(x), b);
    await page.waitForTimeout(sec * 1000 + 150);
    return sec;
  };
  const waitFor = async (pred, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const s = await st();
      if (pred(s)) return s;
      await page.waitForTimeout(100);
    }
    return null;
  };
  try {
    await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=4&intake=0&debug=1`);
    await page.click('[data-testid="start-talking"]');
    // The greeting plays first; the mic opens after it. No typing box: the question by voice.
    await waitFor((s) => s.mic === "open", 30000);
    await page.waitForTimeout(1500);
    await say(question);
    if (warm) {
      // A first reply starts the learner's memory fetch (lib/retrieval/memory.ts gives it 600 ms on the
      // reply's path; a cold fetch misses that turn), as the intake's reply does in a normal lesson.
      const early = await waitFor((s) => s.beat === "b1" && s.status === "speaking" && s.word >= 6, 240000);
      console.log(`lesson ${n}: early cut in at ${early ? `${early.beat} word ${early.word}` : "timeout"}: "Is that the sun?"`);
      await page.keyboard.down("Space");
      await say(await clip("retrieval-sun", "Wait, is that the sun?"));
      await page.keyboard.up("Space");
      const t1 = (await st()).turn;
      await waitFor((s) => s.turn > t1, 60000);
    }
    const at = await waitFor((s) => s.beat === "b3" && s.status === "speaking" && s.word >= 6, 240000);
    console.log(`lesson ${n}: cut in at ${at ? `${at.beat} word ${at.word}` : "timeout"}: "${ask}"`);
    await page.keyboard.down("Space");
    await say(b64);
    await page.keyboard.up("Space");
    const turn0 = (await st()).turn;
    await waitFor((s) => s.turn > turn0, 60000);
    await page.waitForTimeout(6000);
  } catch (e) {
    console.log("ERROR", e.message);
  }
  // Leaving the page saves the transcript (and mirrors it to Convex).
  await page.goto("about:blank").catch(() => {});
  await page.waitForTimeout(4000);
  await page.close();
  const f = (existsSync(DIR) ? readdirSync(DIR) : []).map((name) => ({ name, m: statSync(join(DIR, name)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
  const t = f ? JSON.parse(readFileSync(join(DIR, f.name), "utf8")) : null;
  console.log(`lesson ${n}: transcript ${t?.id ?? "(none)"}`);
  for (const e of t?.events.filter((e) => e.kind === "retrieval" || e.kind === "board-index" || e.kind === "reply") ?? []) {
    if (e.kind === "board-index") console.log(`   board-index scene ${e.scene}: ${e.added} added, ${e.ms} ms, status ${e.status}`);
    else if (e.kind === "retrieval") console.log(`   retrieval: board ${JSON.stringify(e.board)}\n              memory ${JSON.stringify(e.memory)}`);
    else console.log(`   reply: "${String(e.text).slice(0, 160)}"`);
  }
  return t;
}

const first = await lesson(1, ASKS[0]);
// Give the Convex mirror a moment, so lesson 2's memory fetch finds lesson 1.
await new Promise((r) => setTimeout(r, 5000));
const learner = (await context.cookies()).find((c) => c.name === "chalky_learner")?.value;
console.log(`learner ${learner ?? "(no cookie)"}`);
const second = await lesson(2, ASKS[1], true);
await browser.close();
const r1 = first?.events.find((e) => e.kind === "retrieval");
const r2 = second?.events.filter((e) => e.kind === "retrieval").at(-1);
const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
ok("lesson 1: board searched on the local engine", r1?.board?.status === "local", JSON.stringify(r1?.board));
ok("lesson 1: the board search found something", (r1?.board?.hits ?? []).length > 0, (r1?.board?.hits ?? []).join(", "));
ok("lesson 2: memory searched on the local engine", r2?.memory?.status === "local", JSON.stringify({ status: r2?.memory?.status, docs: r2?.memory?.docs }));
ok("lesson 2: memory lines found", (r2?.memory?.lines ?? []).length > 0, (r2?.memory?.lines ?? []).join(" | "));
