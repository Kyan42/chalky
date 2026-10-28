// Barge-in hygiene, intake patience and the cached greeting, on the scripted mic (fixture lessons, no planner).
//   MODE=greeting   Start talking → the greeting's first sound (cached on the server: well under a second).
//   MODE=bystander  a first turn goes to the conversation model; 2 s later a bystander's fragment is heard:
//                   the reply still speaks once, nothing merges, voice-ignored is logged.
//   MODE=replace    the same, but "wait, teach me how rainbows form instead" 2 s in: it replaces the question.
//   MODE=intake     the intake waits 12 s of silence, the lesson starts, then the answer comes 2 s later: it is
//                   taken as the intake answer (decision and replan), not a cut-in.
//   BASE_URL=http://localhost:3006 MODE=bystander node experiments/barge-intake.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "../scripts/fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const MODE = process.env.MODE ?? "bystander";
const runs = join(process.cwd(), "experiments/live-runs");
const clip = async (name, text) => readFileSync((await speechWav(join(process.cwd(), `experiments/conversation-e2e/clips/${name}.wav`), [{ silence: 0.6 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
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
const st = () => page.evaluate(() => ({ status: document.querySelector(".tutor-board")?.dataset.status, mic: document.querySelector(".tutor-board")?.dataset.mic, beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null, tree: !!document.querySelector('[data-testid="welcome-tree"]') }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(50);
  }
  return null;
};
const say = async (b) => page.evaluate((x) => window.__say(x), b);
const transcript = () => {
  const f = readdirSync(runs).filter((x) => x.endsWith(".json")).map((x) => ({ x, m: statSync(join(runs, x)).mtimeMs })).filter((y) => y.m >= t0).sort((a, b) => b.m - a.m)[0];
  try {
    return f ? JSON.parse(readFileSync(join(runs, f.x), "utf8")) : null;
  } catch {
    return null;
  }
};
const fixture = MODE === "intake" ? "why-is-the-sky-blue-paced" : "why-is-the-sky-blue-quizzes&firstturn=1&intake=0";
await page.goto(`${BASE}/lesson?fixture=${fixture}&debug=1`);
const tClick = Date.now();
await page.click('[data-testid="start-talking"]');
const greeted = await waitFor((s) => s.tree, 10_000);
const greetMs = greeted ? Date.now() - tClick : null;
console.log(`greeting: first sound ${greetMs} ms after Start talking`);
let ok = MODE === "greeting" ? greetMs !== null && greetMs < 1000 : false;
if (MODE !== "greeting") {
  await waitFor((s) => s.mic === "open", 30_000);
  await page.waitForTimeout(1500);
  if (MODE === "intake") {
    await say(await clip("bi-ask", "Why is the sky blue?"));
    const asked = await waitFor((s) => s.status === "waiting", 60_000);
    const tAsked = Date.now();
    console.log(`intake asked: ${!!asked}; staying silent`);
    const started = await waitFor((s) => s.status === "speaking" && s.beat === "b1", 30_000);
    console.log(`lesson started on silence after ${((Date.now() - tAsked) / 1000).toFixed(1)} s`);
    await page.waitForTimeout(1000);
    await say(await clip("bi-late", "I know light is made of colors, but not why blue wins."));
    await page.waitForTimeout(25_000);
    const t = transcript();
    const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
    const decisions = ev("intake-decision");
    console.log(`decisions: ${JSON.stringify(decisions.map((d) => ({ skipped: d.skipped, reason: d.reason, amend: d.amend, intakeMs: d.intakeMs })))}; late: ${JSON.stringify(ev("intake-late-answer").map((e) => ({ text: e.text, msAfterStart: e.msAfterStart })))}; cut-ins: ${ev("learner").filter((e) => e.role === "cut-in").length}`);
    const silence = decisions.find((d) => d.skipped && d.reason === "silence");
    ok = !!started && !!silence && silence.intakeMs >= 11_500 && ev("intake-late-answer").length === 1 && decisions.some((d) => !d.skipped);
  } else {
    await say(await clip(MODE === "replace" ? "bi-ask-vm" : "bi-ask-vm", "Can you teach me what a virtual machine is?"));
    // 2 s after they finished: someone nearby, or the learner changing their mind.
    await waitFor((s) => s.status === "replying", 15_000);
    await page.waitForTimeout(2000);
    await say(await clip(MODE === "replace" ? "bi-replace" : "bi-bystander", MODE === "replace" ? "Wait, teach me how rainbows form instead." : "Electron line this."));
    await page.waitForTimeout(25_000);
    const t = transcript();
    const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
    const replies = ev("reply");
    console.log(`learner: ${JSON.stringify(ev("learner").map((e) => e.text))}`);
    console.log(`replies: ${JSON.stringify(replies.map((e) => e.text?.slice(0, 90)))}; failed: ${ev("reply-failed").length}; merged: ${ev("utterance-merged").length}; ignored: ${JSON.stringify(ev("voice-ignored").map((e) => e.text))}; replaced: ${JSON.stringify(ev("question-replaced").map((e) => e.text))}`);
    if (MODE === "replace") ok = ev("question-replaced").length === 1 && replies.some((r) => /rainbow/i.test(r.text ?? ""));
    else ok = replies.length === 1 && ev("utterance-merged").length === 0 && !ev("reply-failed").some((e) => e.aborted) && ev("voice-ignored").length >= 1;
    console.log(`transcript ${t?.id}`);
  }
}
await page.goto("about:blank").catch(() => {});
await browser.close();
console.log(`${ok ? "PASS" : "FAIL"}  ${MODE}`);
