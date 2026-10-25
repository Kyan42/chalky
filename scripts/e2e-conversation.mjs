// Drives a lesson conversation end to end and saves a frame every half second.
//
//   npm run dev
//   node scripts/e2e-conversation.mjs                                 # a real lesson, asked by voice
//   FIXTURE=why-is-the-sky-blue BEATS=3 node scripts/e2e-conversation.mjs   # a saved plan, no planner call
//
// The page's microphone is replaced by a stream the script feeds Sonic clips
// into on cue (getUserMedia is stubbed before the app loads), so every spoken
// line lands exactly when the script wants it. The run:
//   1. Start talking; ask QUESTION by voice (or, with a fixture, type it).
//   2. While beat BARGE_BEAT is being spoken, hold Space: Chalky must pause at once.
//   3. Type "wait, I don't get this part": a brief answer, the cursor on a named element.
//   4. Say "I still don't get it": a detour (new beats) plays and ends in a check-in.
//   5. Say "got it": the interrupted beat replays from its start.
// Options: BASE_URL, QUESTION, FIXTURE, BEATS, BARGE_BEAT (default 2), LEVEL3=1 (at the
// detour's check-in, say "no, I'm still lost" instead of "got it" to force a replan).
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";
const FIXTURE = process.env.FIXTURE ?? "";
const QUESTION = process.env.QUESTION ?? "Why is the sky blue?";
const BARGE_BEAT = Number(process.env.BARGE_BEAT ?? 2);
const LEVEL3 = !!process.env.LEVEL3;
const RUN = process.env.RUN ?? `${FIXTURE || "voice"}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
const OUT = join(process.cwd(), "experiments/conversation-e2e", RUN);
mkdirSync(OUT, { recursive: true });

const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.3 }])).path).toString("base64");
const clips = {
  question: await clip("question", QUESTION),
  still: await clip("still", "I still don't get it."),
  gotit: await clip("gotit", "Got it, thanks."),
  lost: await clip("lost", "No, I'm still lost, sorry."),
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
await context.addInitScript(() => {
  // A microphone the test controls: silence until window.__say(base64 wav) plays a clip into it.
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => {
    await ac.resume();
    return dest.stream;
  };
  window.__say = async (b64) => {
    await ac.resume();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await ac.decodeAudioData(bytes.buffer);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return buf.duration;
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => (m.type() === "error" || /\[(converse|detour|replan)\]/.test(m.text())) && console.log(`[console.${m.type()}]`, m.text().slice(0, 300)));
const calls = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (["/api/converse", "/api/amend", "/api/plan", "/api/opener", "/api/draw", "/api/layout", "/api/fixture"].includes(u.pathname)) calls.push({ path: u.pathname, t: Date.now() });
});
// What the conversation layer was given and what it answered.
page.on("response", async (r) => {
  if (!r.url().includes("/api/converse")) return;
  try {
    const body = JSON.parse(r.request().postData() ?? "{}");
    log(`[converse] utterance "${body.utterance}", beat ${body.beatIndex} word ${body.wordIndex}, escalation ${body.escalation}, board: ${body.board.map((e) => `${e.id} (${e.label})`).join(", ") || "(empty)"}`);
    const text = await r.text();
    for (const line of text.split(/\n/)) if (line.includes('"trailer"')) log(`[converse] trailer ${JSON.stringify(JSON.parse(line).trailer)}`);
  } catch (e) {
    log(`[converse] (couldn't read: ${e.message})`);
  }
});
page.on("websocket", (ws) => {
  if (!ws.url().includes("stt/turns")) return;
  ws.on("framereceived", (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === "turn.end") log(`[ink turn.end] "${m.transcript}"`);
    } catch {}
  });
});

const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1);
const events = [];
function log(msg) {
  events.push(`${since()} s  ${msg}`);
  console.log(`${since().padStart(5)} s  ${msg}`);
}
const state = () =>
  page.evaluate(() => {
    const g = document.querySelector('[data-testid="chalky-cursor-glyph"]');
    const now = document.querySelector('[data-testid="beats"] li[data-state="now"]');
    return {
      status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
      mic: document.querySelector(".board")?.dataset.mic,
      beat: now?.dataset.beatId ?? null,
      beatSay: now?.querySelector(".beat-say")?.textContent ?? "",
      beats: [...document.querySelectorAll('[data-testid="beats"] li')].map((li) => li.dataset.beatId),
      word: document.querySelector('.caption .word[data-state="now"]')?.textContent?.trim() ?? "",
      caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 140),
      level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
      paused: document.querySelector('[data-testid="paused-at"]')?.textContent ?? null,
      reply: document.querySelector('[data-testid="reply-ms"]')?.textContent ?? null,
      error: document.querySelector('[data-testid="error"]')?.textContent ?? null,
      prefetch: document.querySelector('[data-testid="prefetch"]')?.textContent ?? null,
      cursor: g ? { opacity: +g.getAttribute("opacity"), target: g.dataset.target, phase: g.dataset.phase } : null,
    };
  });

// Frames every half second, in the background.
let frame = 0;
let lastPrefetch = null;
let filming = true;
const film = (async () => {
  while (filming) {
    const s = await state().catch(() => null);
    await page.screenshot({ path: join(OUT, `f${String(frame++).padStart(3, "0")}-${since()}s.png`) }).catch(() => {});
    if (s?.prefetch) lastPrefetch = s.prefetch;
    if (s) {
      const line = `${s.status} (mic ${s.mic}) | beat ${s.beat ?? "-"} | word "${s.word}" | cursor ${s.cursor && s.cursor.opacity > 0.05 ? `${s.cursor.phase} ${s.cursor.target}` : "hidden"}${s.error ? ` | ERROR ${s.error}` : ""}`;
      if (line !== film.last) console.log(`${since().padStart(5)} s    ${line}`);
      film.last = line;
    }
    await page.waitForTimeout(500);
  }
})();

const waitFor = async (what, pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await state();
    if (pred(s)) return s;
    await page.waitForTimeout(150);
  }
  const s = await state();
  log(`TIMEOUT waiting for ${what}: ${JSON.stringify(s)}`);
  return null;
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const type = async (text) => {
  await page.fill('[data-testid="question"]', text);
  await page.click('[data-testid="ask"]');
  log(`[typed] "${text}"`);
};
const say = async (name) => {
  const seconds = await page.evaluate((b64) => window.__say(b64), clips[name]);
  log(`[said] ${name} (${seconds.toFixed(1)} s)`);
  return seconds;
};

try {
  await page.goto(`${BASE_URL}/lesson${FIXTURE ? `?fixture=${FIXTURE}&beats=${process.env.BEATS ?? 4}&intake=0` : ""}`, { waitUntil: "load" });
  await page.click('[data-testid="start-talking"]');
  await waitFor("greeting to end", (s) => s.status === "Listening", 20000);
  // 1. Ask (by voice, or typed with a fixture so the question matches the saved plan).
  if (FIXTURE) await type(QUESTION);
  else await say("question");
  const asked = await waitFor("the lesson to start", (s) => s.beat !== null, 90000);
  check("asking starts a lesson", !!asked, asked ? `first beat ${asked.beat}` : "");

  // 2. Barge in mid-beat with Space.
  const target = await waitFor(`beat ${BARGE_BEAT} mid-sentence`, (s) => s.beats.indexOf(s.beat) + 1 >= BARGE_BEAT && s.status === "Speaking" && s.word && s.caption.split(" ").length > 6, 150000);
  const interrupted = target?.beat;
  const interruptedSay = target?.beatSay;
  await page.keyboard.down("Space");
  const tDown = Date.now();
  const paused = await waitFor("the pause", (s) => /^(Your turn|Listening|Paused)/.test(s.status ?? ""), 3000);
  check("Space pauses at once", !!paused, `${Date.now() - tDown} ms after key down; ${paused?.paused ?? ""}`);
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await page.waitForTimeout(600);
  const still = await state();
  check("stays paused after a wordless press (nothing resumes on silence)", /^(Your turn|Paused)/.test(still.status ?? ""), still.status);

  // 3. Type the question: a brief answer, cursor on a named element.
  // ASK1 + EXPECT_FIRST=detour: a first question that needs a picture not on the board must draw it at once.
  if (process.env.ASK1) {
    await type(process.env.ASK1);
    const first = await waitFor("the first reply's decision", (s) => /^Last turn: /.test(s.level ?? ""), 60000);
    check(`a first question needing a missing visual gets a ${process.env.EXPECT_FIRST ?? "detour"}`, new RegExp(`^Last turn: ${process.env.EXPECT_FIRST ?? "detour"}`).test(first?.level ?? ""), first?.level ?? "");
    const drawn = await waitFor("the detour's first beat", (s) => s.beat && /^d\d+-/.test(s.beat) && s.status === "Speaking", 90000);
    check("the detour plays a drawing beat right away", !!drawn, drawn ? `${drawn.beat}; beats ${drawn.beats.join(",")}` : "");
    await page.waitForTimeout(6000);
    throw new Error("stopping after the first ask (ASK1)");
  }
  await type("wait, I don't get this part");
  let cursorSeen = null;
  const answered = await (async () => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      const s = await state();
      if (s.cursor && s.cursor.opacity > 0.3 && s.cursor.target && s.status === "Speaking") cursorSeen ??= s.cursor.target;
      if (s.level && s.status === "Your turn") return s;
      await page.waitForTimeout(150);
    }
    return null;
  })();
  check("a brief answer, then wait", !!answered && /^Last turn: answer/.test(answered.level ?? ""), answered?.level ?? "");
  check("the cursor pointed at a named element while answering", !!cursorSeen, cursorSeen ?? "none");
  log(`reply: ${answered?.reply ?? ""}`);
  if (process.env.STOP_AFTER === "answer") throw new Error("stopping after the answer (STOP_AFTER=answer)");

  // 4. Still lost: a detour.
  await say("still");
  const detour = await waitFor("detour beats to play", (s) => s.beat && /^d\d+-/.test(s.beat), 60000);
  check("'I still don't get it' starts a detour", !!detour, detour ? `${detour.level}; beats now ${detour.beats.join(",")}` : "");
  const detourCheck = await waitFor("the detour's check-in", (s) => s.status === "Your turn" && s.beat && /^d\d+-/.test(s.beat), 360000);
  check("the detour ends in a check-in and waits", !!detourCheck, detourCheck?.beat ?? "");

  if (LEVEL3) {
    // 5b. Still lost after the detour: a new ending, then the lesson goes on.
    await say("lost");
    const replanned = await waitFor("new beats", (s) => s.beat && /^r\d+-/.test(s.beat), 240000);
    check("still lost after a detour replans and continues", !!replanned, replanned ? `${replanned.level}; beats ${replanned.beats.join(",")}` : "");
  } else {
    // 5. Got it: the interrupted beat replays from its start.
    await say("gotit");
    const replay = await waitFor("the interrupted beat to replay", (s) => s.beat === interrupted && s.status === "Speaking", 30000);
    check("'got it' resumes with no model call and replays the interrupted beat", !!replay && /continue \(local/.test(replay.level ?? ""), `${replay?.beat ?? ""} ${replay?.level ?? ""}`);
    if (replay) {
      await page.waitForTimeout(1500);
      const s = await state();
      check("the replay starts from the beat's first words", interruptedSay.startsWith(s.caption.split(" ").slice(0, 3).join(" ").replace(/[“”]/g, "")), `caption "${s.caption.slice(0, 60)}"`);
    }
  }
  await page.waitForTimeout(3000);
} catch (e) {
  log(`ERROR ${e.message}`);
} finally {
  filming = false;
  await film;
  const stop = await page.$('[data-testid="stop"]');
  if (stop) await stop.click().catch(() => {});
  await page.screenshot({ path: join(OUT, "end.png") }).catch(() => {});
  await browser.close();
  const count = (p) => calls.filter((c) => c.path === p).length;
  console.log(`prefetch: ${lastPrefetch ?? "(no prefetch line)"}`);
  console.log(`\ncalls: plan ${count("/api/plan")}, fixture ${count("/api/fixture")}, opener ${count("/api/opener")}, draw ${count("/api/draw")}, layout ${count("/api/layout")}, converse ${count("/api/converse")}, amend ${count("/api/amend")}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed; ${frame} frames in ${OUT}`);
}
