// A demo rehearsal on the scripted mic, against a live server (no fixture, so it works on `next start`):
// ask a question by voice, answer the intake, cut in twice while Chalky is speaking (Space held),
// ask for a quiz, answer it, then say "I'm done". Prints a timeline (status, beat, what was heard,
// what Chalky said, reply times) and saves screenshots to experiments/demo-rehearsal/<run>/.
//
//   BASE_URL=http://localhost:3000 node scripts/rehearse-demo.mjs
//
// Options (environment variables):
//   QUESTION, INTAKE, CUT1, CUT2, QUIZ   what is said at each step (defaults below)
//   CUT1_BEAT, CUT2_BEAT, QUIZ_BEAT      the n-th beat spoken at which each one is said (2, 5, 7)
//   RUN                                  output folder name (default: a timestamp)
//   MAX_MIN                              give up after this many minutes (default 10)
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const env = (k, d) => process.env[k] ?? d;
const SAY = {
  question: env("QUESTION", "How does attention work in large language models?"),
  intake: env("INTAKE", "I know the words get turned into vectors, but not much else."),
  cut1: env("CUT1", "Wait, what do query, key and value actually mean?"),
  cut2: env("CUT2", "Hold on. Can you point at where the attention weights are on the board?"),
  quiz: env("QUIZ", "Quiz me on this. Label the parts."),
  checkin: "Yes, that makes sense. Keep going.",
  done: "I'm done.",
};
const AT = { cut1: Number(env("CUT1_BEAT", 2)), cut2: Number(env("CUT2_BEAT", 5)), quiz: Number(env("QUIZ_BEAT", 7)) };
const MAX_MS = Number(env("MAX_MIN", 10)) * 60000;
const OUT = join(process.cwd(), "experiments/demo-rehearsal", env("RUN", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)));
mkdirSync(OUT, { recursive: true });
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
const clip = async (text) => readFileSync((await speechWav(join(clipDir, `rehearse-${slug(text)}.wav`), [{ silence: 0.5 }, { say: text }, { silence: 0.4 }])).path).toString("base64");

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const log = (...a) => console.log(at(), ...a);
const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, ok, detail]);
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript(() => {
  if (!navigator.mediaDevices) return;
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
const apiErrors = [];
const apiCalls = {};
page.on("pageerror", (e) => log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && log("[console]", m.text().slice(0, 200)));
page.on("response", (r) => {
  const m = r.url().match(/\/api\/([a-z-/]+)/);
  if (!m) return;
  apiCalls[m[1]] = (apiCalls[m[1]] ?? 0) + 1;
  if (r.status() >= 400) (apiErrors.push(`${m[1]} ${r.status()}`), log(`[api] ${m[1]} -> ${r.status()}`));
});
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === "turn.end") log(`   [heard] "${m.transcript}"`);
    } catch {}
  });
});

const st = () =>
  page.evaluate(() => {
    const board = document.querySelector(".tutor-board");
    return {
      status: board?.dataset.status ?? "",
      mic: board?.dataset.mic ?? "",
      scene: board?.dataset.scene ?? "",
      beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
      beats: document.querySelectorAll('[data-testid="beats"] li').length,
      word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
      caption: (document.querySelector(".caption")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      title: document.querySelector('[data-testid="title"]')?.textContent ?? "",
      turn: Number(document.querySelector('[data-testid="last-level"]')?.dataset.turn ?? 0),
      level: document.querySelector('[data-testid="last-level"]')?.textContent ?? "",
      replyMs: document.querySelector('[data-testid="reply-ms"]')?.textContent ?? "",
      intake: document.querySelector('[data-testid="intake"]')?.textContent ?? "",
      marks: document.querySelectorAll('[data-testid^="quiz-mark-"]').length,
      quizDone: !!document.querySelector('[data-testid="quiz-done"]'),
      error: document.querySelector('[data-testid="error"]')?.textContent ?? "",
    };
  });
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});

// One poll loop records the timeline; the steps below wait on its latest state.
let cur = await st().catch(() => ({}));
const seenBeats = [];
const captions = []; // what Chalky said, one entry per stretch of speech
let stop = false;
let lastKey = "";
(async () => {
  let lastCaption = "";
  while (!stop) {
    try {
      cur = await st();
    } catch {
      break;
    }
    const key = `${cur.status}|${cur.mic}|${cur.beat}|${cur.marks}`;
    if (key !== lastKey) {
      log(`status ${cur.status || "-"}  mic ${cur.mic || "-"}  beat ${cur.beat ?? "-"}${cur.marks ? `  quiz marks ${cur.marks}` : ""}${cur.error ? `  ERROR ${cur.error}` : ""}`);
      lastKey = key;
    }
    if (cur.beat && !seenBeats.includes(cur.beat)) {
      seenBeats.push(cur.beat);
      const n = seenBeats.length;
      setTimeout(() => shot(`beat-${String(n).padStart(2, "0")}-${cur.beat}`), 3500);
    }
    if (cur.caption && cur.caption !== lastCaption) {
      // A caption that grows is the same line; a different one is a new line.
      if (lastCaption && !cur.caption.startsWith(lastCaption.slice(0, 20))) captions.push({ t: Date.now() - t0, text: lastCaption });
      lastCaption = cur.caption;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (lastCaption) captions.push({ t: Date.now() - t0, text: lastCaption });
})();
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until && Date.now() - t0 < MAX_MS) {
    if (pred(cur)) return cur;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};
const say = async (text, hold = false) => {
  const b = await clip(text);
  if (hold) await page.keyboard.down("Space");
  const sec = await page.evaluate((x) => window.__say(x), b);
  await page.waitForTimeout(sec * 1000 + 200);
  if (hold) await page.keyboard.up("Space");
  log(`   [said${hold ? ", Space held" : ""}] "${text}"`);
};
/** Says something while Chalky is speaking (Space held), and reports how the reply came back. */
const cutIn = async (name, text) => {
  const before = cur;
  const captionsBefore = captions.length;
  await say(text, true);
  const released = Date.now();
  // Key up -> replying -> speaking (the reply). The turn counter moves when the reply has been taken in.
  const speaking = await waitFor((s) => s.status === "speaking", 20000);
  const ms = Date.now() - released;
  const replied = speaking && (await waitFor((s) => s.turn > before.turn, 60000));
  await page.waitForTimeout(2500);
  await shot(`${name}-reply`);
  const reply = captions.slice(captionsBefore + 1).map((c) => c.text).concat(cur.caption).filter(Boolean).join(" ");
  check(`${name}: Chalky stopped and answered`, !!speaking && !!replied, speaking ? `cut at ${before.beat} word ${before.word}; speaking again ${(ms / 1000).toFixed(1)} s after the key came up; ${cur.level}; "${reply.slice(0, 260)}"` : "no reply in 20 s");
};

try {
  await page.goto(`${BASE}/lesson?debug=1`, { waitUntil: "load" });
  await shot("00-start");
  await page.click('[data-testid="start-talking"]');
  const open = await waitFor((s) => s.mic === "open", 30000);
  check("the greeting plays and the mic opens", !!open);
  await page.waitForTimeout(1500);

  // 1. The question, then the intake.
  const asked = Date.now();
  await say(SAY.question);
  const first = await waitFor((s) => s.status === "speaking" || s.status === "replying" || s.status === "planning", 20000);
  check("Chalky reacts to the question", !!first, first ? `${((Date.now() - asked) / 1000).toFixed(1)} s after the clip started; status ${first.status}` : "nothing in 20 s");
  const intake = await waitFor((s) => (s.status === "waiting" || s.status === "listening") && s.mic === "open" && !s.beat, 25000);
  if (intake) {
    await shot("01-intake");
    log(`   intake line: "${cur.caption.slice(0, 200)}"`);
    await page.waitForTimeout(800);
    await say(SAY.intake);
  }
  check("an intake question is asked before the lesson", !!intake, intake ? "" : "no waiting state before the first beat");
  const b1 = await waitFor((s) => !!s.beat && s.status === "speaking", 90000);
  check("the lesson starts", !!b1, b1 ? `first beat ${((Date.now() - asked) / 1000).toFixed(1)} s after the question; title "${cur.title}"; ${cur.intake}` : "no beat in 90 s");
  if (!b1) throw new Error("the lesson never started");

  // 2. Cut-ins and the quiz, each at its n-th beat. Check-ins in between get a short "keep going".
  const steps = [
    { n: AT.cut1, name: "cut-in-1", text: SAY.cut1 },
    { n: AT.cut2, name: "cut-in-2", text: SAY.cut2 },
    { n: AT.quiz, name: "quiz", text: SAY.quiz },
  ];
  let waitingSince = 0;
  let quizAsked = false;
  while (steps.length && Date.now() - t0 < MAX_MS) {
    const s = cur;
    if (s.status === "done" || s.status === "stopped" || s.status === "error" || s.status === "idle") {
      log(`the lesson ended (${s.status}) with ${steps.length} step(s) not reached: ${steps.map((x) => x.name).join(", ")}`);
      break;
    }
    if (s.status === "speaking" && s.beat && seenBeats.length >= steps[0].n && s.word >= 4) {
      const step = steps.shift();
      log(`${step.name}: beat ${s.beat} (the ${seenBeats.length}th spoken), word ${s.word}`);
      if (step.name !== "quiz") {
        await cutIn(step.name, step.text);
      } else {
        quizAsked = true;
        await shot("quiz-0-board-before");
        await say(step.text, true);
        const q = await waitFor((x) => (x.marks >= 1 || x.quizDone) && (x.status === "waiting" || x.status === "listening"), 45000);
        await shot("quiz-1-asked");
        check("asking for a quiz gives one", !!q, q ? `${q.marks ? `label quiz, ${q.marks} numbered parts` : "sketch quiz (Done button)"}; "${cur.caption.slice(0, 160)}"` : `no quiz in 45 s; status ${cur.status}; "${cur.caption.slice(0, 160)}"`);
        if (q) {
          const c0 = captions.length;
          if (q.marks) await say("Number one is the query. I'm not sure about the others.");
          else await page.click('[data-testid="quiz-done"]');
          const graded = await waitFor((x) => x.marks === 0 && !x.quizDone && x.status === "speaking", 60000);
          await page.waitForTimeout(5000);
          await shot("quiz-2-graded");
          check("the quiz is graded with spoken feedback", !!graded, `"${captions.slice(c0).map((c) => c.text).concat(cur.caption).join(" / ").slice(0, 300)}"`);
        }
      }
      waitingSince = 0;
      continue;
    }
    // A check-in: Chalky asked something and is waiting. Give it a moment, then answer.
    if ((s.status === "waiting" || s.status === "listening") && s.mic === "open" && !s.marks && !s.quizDone) {
      waitingSince ||= Date.now();
      if (Date.now() - waitingSince > 2500) {
        log(`   check-in: "${s.caption.slice(-160)}"`);
        await say(SAY.checkin);
        waitingSince = 0;
        await waitFor((x) => x.status !== "waiting" && x.status !== "listening", 20000);
      }
    } else waitingSince = 0;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!quizAsked) check("asking for a quiz gives one", false, `only ${seenBeats.length} beats were spoken; the quiz was set for beat ${AT.quiz}`);

  // 3. End by voice.
  if (cur.status !== "done" && cur.status !== "idle" && cur.status !== "error") {
    await waitFor((s) => s.status === "speaking", 30000);
    await page.waitForTimeout(3000);
    await say(SAY.done, true);
    const home = await waitFor((s) => s.status === "idle" || s.status === "done" || s.status === "stopped", 30000);
    await page.waitForTimeout(2500);
    await shot("99-end");
    check('"I\'m done" ends the lesson', !!home, `status ${cur.status}`);
  }
} catch (e) {
  log("ERROR", e.message);
  await shot("error");
}
stop = true;
await page.waitForTimeout(400);
// Leaving the page saves the transcript.
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(3000);
await browser.close();

console.log("\n=== what Chalky said (captions) ===");
for (const c of captions) console.log(`${(c.t / 1000).toFixed(1).padStart(6)}s  ${c.text.slice(0, 260)}`);
console.log("\n=== summary ===");
console.log(`beats spoken: ${seenBeats.length} (${seenBeats.join(", ")})`);
console.log(`api calls: ${Object.entries(apiCalls).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`api errors: ${apiErrors.length ? apiErrors.join(", ") : "none"}`);
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
console.log(`screenshots: ${OUT}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
