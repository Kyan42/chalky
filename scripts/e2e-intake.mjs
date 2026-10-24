// The intake question at the start of a lesson, driven headlessly.
//
//   npm run dev
//   ANSWER="I know it's about scattering, but why isn't it violet?" node scripts/e2e-intake.mjs     # real plan, asked by voice
//   FIXTURE=why-is-the-sky-blue-paced ANSWER="..." node scripts/e2e-intake.mjs                      # saved plan, typed question
//   FIXTURE=why-is-the-sky-blue-paced node scripts/e2e-intake.mjs                                   # no answer: silence goes on
//
// Asks the question (by voice through a scripted microphone, or typed with a
// fixture), waits for Chalky's intake question, types ANSWER (or stays silent),
// then follows the lesson until the second beat starts and reports: first sound,
// the intake line, the learner record, and whether beat 2 came from the
// rewritten plan (r…) or the speculative one (b2). Stops there: no full lesson.
// EXPECT=amend|keep checks the decision. Frames every half second.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const FIXTURE = process.env.FIXTURE ?? "";
const QUESTION = process.env.QUESTION ?? "Why is the sky blue?";
const ANSWER = process.env.ANSWER ?? "";
// VOICE_ANSWER="first half|second half": the answer is spoken, with PAUSE seconds (default 1.2) of silence between the halves.
const VOICE_ANSWER = process.env.VOICE_ANSWER ?? "";
const PAUSE = Number(process.env.PAUSE ?? 1.2);
const EXPECT = process.env.EXPECT ?? (ANSWER ? "" : "keep");
const RUN = process.env.RUN ?? `intake-${FIXTURE ? "fixture" : "voice"}-${ANSWER ? "answer" : "silent"}`;
const OUT = join(process.cwd(), "experiments/conversation-e2e", RUN);
mkdirSync(OUT, { recursive: true });
const voiceAnswer = VOICE_ANSWER
  ? readFileSync((await speechWav(join(process.cwd(), `experiments/conversation-e2e/clips/answer-${PAUSE}.wav`), [{ silence: 0.2 }, { say: VOICE_ANSWER.split("|")[0] }, { silence: PAUSE }, { say: VOICE_ANSWER.split("|")[1] }, { silence: 0.3 }])).path).toString("base64")
  : null;
const question = readFileSync((await speechWav(join(process.cwd(), "experiments/conversation-e2e/clips/question.wav"), [{ silence: 0.2 }, { say: QUESTION }, { silence: 0.3 }])).path).toString("base64");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => {
    await ac.resume();
    return dest.stream;
  };
  window.__say = async (b64) => {
    await ac.resume();
    const buf = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return buf.duration;
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const calls = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/api/") && !["/api/tts", "/api/cartesia/token"].includes(u.pathname)) calls.push(`${u.pathname}${u.pathname === "/api/converse" ? `:${JSON.parse(r.postData() ?? "{}").intent ?? "reply"}` : ""}`);
});
let tTurnEnd = null;
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt/turns")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === "turn.end") {
        tTurnEnd ??= Date.now();
        console.log(`        [ink turn.end] "${m.transcript}"`);
      }
    } catch {}
  });
});
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1);
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    beats: [...document.querySelectorAll('[data-testid="beats"] li')].map((li) => li.dataset.beatId),
    caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
    intake: document.querySelector('[data-testid="intake"]')?.textContent ?? null,
    learner: document.querySelector('[data-testid="learner"]')?.textContent ?? null,
    firstSound: document.querySelector('[data-testid="first-sound"]')?.textContent ?? null,
  }));
let frame = 0, on = true, last = "";
const film = (async () => {
  while (on) {
    const s = await st().catch(() => null);
    await page.screenshot({ path: join(OUT, `f${String(frame++).padStart(3, "0")}-${since()}s.png`) }).catch(() => {});
    if (s) {
      const l = `${s.status} | ${s.beat ?? "-"} | ${s.caption}`;
      if (l !== last) console.log(`${since().padStart(5)} s  ${l}`);
      last = l;
    }
    await page.waitForTimeout(500);
  }
})();
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(100);
  }
  return null;
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  await page.goto(`${BASE}/lesson${FIXTURE ? `?fixture=${FIXTURE}&beats=${process.env.BEATS ?? 6}` : ""}`, { waitUntil: "load" });
  let tAsked;
  if (FIXTURE) {
    // A spoken answer needs the mic on: start talking (greeting), then type the question.
    if (VOICE_ANSWER) {
      await page.click('[data-testid="start-talking"]');
      await waitFor((s) => s.status === "Listening", 20000);
    }
    await page.fill('[data-testid="question"]', QUESTION);
    tAsked = Date.now();
    await page.click('[data-testid="ask"]');
  } else {
    await page.click('[data-testid="start-talking"]');
    await waitFor((s) => s.status === "Listening", 20000);
    await page.evaluate((b64) => window.__say(b64), question);
    await waitFor(() => tTurnEnd !== null, 15000);
    tAsked = tTurnEnd;
  }
  // The intake question is spoken, then Chalky waits.
  const asking = await waitFor((s) => s.status === "Your turn" && !s.beat, 20000);
  check("Chalky asks one intake question and waits", !!asking, asking?.caption ?? "");
  const firstSound = await waitFor((s) => s.firstSound, 1000);
  const fsMs = Number(firstSound?.firstSound?.match(/First sound ([\d.]+) s/)?.[1] ?? NaN) * 1000;
  check("first sound under about 2 s after the question", fsMs < 2200, `${firstSound?.firstSound ?? "no first-sound line"} (Ink turn end to ask: ${FIXTURE ? "typed" : "~0.7 s merge window, not included"})`);
  const tQuestionAsked = Date.now();
  if (voiceAnswer) {
    await page.waitForTimeout(800);
    const secs = await page.evaluate((b64) => window.__say(b64), voiceAnswer);
    console.log(`${since().padStart(5)} s  [said] "${VOICE_ANSWER.replace("|", ` (${PAUSE} s pause) `)}" (${secs.toFixed(1)} s)`);
  } else if (ANSWER) {
    await page.waitForTimeout(800);
    await page.fill('[data-testid="question"]', ANSWER);
    await page.click('[data-testid="ask"]');
    console.log(`${since().padStart(5)} s  [typed] "${ANSWER}"`);
  } else console.log(`${since().padStart(5)} s  [silent]`);
  if (voiceAnswer) {
    // The whole answer, both halves, must reach the intake decision as one utterance.
    const decided = await waitFor((s) => /answer “/.test(s.intake ?? ""), 30000);
    const heard = decided?.intake?.match(/answer “([^”]*)”/)?.[1] ?? "";
    const [a, b] = VOICE_ANSWER.split("|").map((x) => x.toLowerCase().replace(/[^a-z ]/g, "").trim().split(" ").slice(-2).join(" "));
    const norm = heard.toLowerCase().replace(/[^a-z ]/g, "");
    check(`a ${PAUSE} s pause mid-answer doesn't cut the answer`, norm.includes(a) && norm.includes(b), `heard “${heard}”`);
  }
  const b1 = await waitFor((s) => s.beat === "b1" && s.status === "Speaking", 30000);
  check("beat 1 starts after the intake", !!b1, b1 ? `${((Date.now() - tQuestionAsked) / 1000).toFixed(1)} s after the intake question finished${ANSWER || VOICE_ANSWER ? "" : " (silence)"}` : "");
  const s1 = await st();
  console.log(`        intake: ${s1.intake}\n        learner: ${s1.learner ?? "(nothing known)"}`);
  const second = await waitFor((s) => s.beat && s.beat !== "b1", 240000);
  const amended = !!second && /^r\d+-/.test(second.beat);
  check("the second beat plays", !!second, `${second?.beat} — ${amended ? "from the rewritten plan" : "from the speculative plan"}; beats ${second?.beats.join(",")}`);
  if (EXPECT) check(`the plan was ${EXPECT === "amend" ? "rewritten from beat 2" : "kept"}`, EXPECT === "amend" ? amended : !amended && /stays|went on|skipped/.test(s1.intake ?? ""), s1.intake ?? "");
  console.log(`time the intake adds before beat 1: ${b1 ? ((Date.now() - t0) / 1000).toFixed(1) : "?"} s into the run; first beat at ${s1.firstSound}`);
  await page.waitForTimeout(1500);
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  on = false;
  await film;
  const stop = await page.$('[data-testid="stop"]');
  if (stop) await stop.click().catch(() => {});
  await browser.close();
  console.log(`\napi calls: ${calls.join(", ")}`);
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed; ${frame} frames in ${OUT}`);
}
