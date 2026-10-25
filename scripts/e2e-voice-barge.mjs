// Voice barge-in (?voice=1 or NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN=1): how fast talking over Chalky pauses it,
// and how often Chalky's own voice does.
//
//   BASE_URL=http://localhost:3006 node scripts/e2e-voice-barge.mjs           # MODE=latency (default)
//   BASE_URL=http://localhost:3006 MODE=echo node scripts/e2e-voice-barge.mjs # Chalky's own words into the mic
//   BASE_URL=http://localhost:3006 MODE=room node scripts/e2e-voice-barge.mjs # real speakers + real mic
//
// MODE=latency: the page's mic is a stream the script plays Sonic clips into (no echo
// cancellation, no room). For each clip, one saved lesson (fixture, no planner) plays;
// once beat 2 is a few words in, the clip is played into the mic. It measures, on the
// page's clock, the clip's first audible sample -> Ink's first partial with two real words
// -> the status turning "Paused". Fillers ("um", "mm-hmm") must not pause it.
//
// MODE=echo: a stand-in for room echo. While beat 2 plays, a beat of Chalky's own
// words is played into the fake mic at full level, -20 dB and -30 dB (roughly what
// leaks past echo cancellation). No browser echo cancellation is on this path, so it
// says only whether Ink hears speech at that level, not what a real room does.
//
// MODE=room: Chromium opens the real default mic (echoCancellation, noiseSuppression,
// autoGainControl, as the app asks) and plays the lesson through the real speakers. Nobody
// talks. Every voice barge-in is a false one. A second, raw mic tap (no echo cancellation)
// shows how loud Chalky is at the mic, so a zero is told apart from "no sound reached it".
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const MODE = process.env.MODE ?? "latency";
const FIXTURE = process.env.FIXTURE ?? "why-is-the-sky-blue-paced";
const QUESTION = process.env.QUESTION ?? "Why is the sky blue?";
const ROOM_SECONDS = Number(process.env.ROOM_SECONDS ?? 60);
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");

const ECHO = "Each color is a wave with its own wavelength. Red light has long, lazy waves, about seven hundred nanometers, while blue and violet have short, choppy waves.";
const SAY = MODE === "echo" ? [1, 0.1, 0.03].map((gain) => ({ name: "vb-echo", text: `Chalky's beat at ${(20 * Math.log10(gain)).toFixed(0)} dB`, gain, barge: false })) : [
  { name: "vb-scatter", text: "Wait, what does scattering mean?", barge: true },
  { name: "vb-again", text: "Hold on, can you say that again?", barge: true },
  { name: "vb-violet", text: "Sorry, why not violet?", barge: true },
  { name: "vb-confused", text: "Wait, I'm confused.", barge: true },
  { name: "vb-slower", text: "Can you go slower?", barge: true },
  { name: "vb-mhm", text: "Mm-hmm.", barge: false },
  { name: "vb-um", text: "Um.", barge: false },
];
const clipText = (s) => (MODE === "echo" ? ECHO : s.text);

// Timestamps Ink's messages on the page's clock.
const inkTap = () => {
  window.__ink = [];
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      if (String(a[0]).includes("stt")) this.addEventListener("message", (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type?.startsWith("turn.")) window.__ink.push({ t: performance.now(), type: m.type, text: m.transcript ?? "" });
        } catch {}
      });
    }
  };
  // The first moment the status reads "Paused".
  window.__pausedAt = [];
  const watch = () => {
    const s = document.querySelector('[data-testid="status"]')?.textContent ?? "";
    const was = window.__wasPaused;
    window.__wasPaused = /^Paused/.test(s);
    if (window.__wasPaused && !was) window.__pausedAt.push(performance.now());
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
};

const status = (page) =>
  page.evaluate(() => {
    const words = [...document.querySelectorAll(".caption .word")];
    return {
      status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
      beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
      word: words.findIndex((w) => w.dataset.state === "now"),
      badge: !!document.querySelector('[data-testid="voice-barge-badge"]'),
      mic: document.querySelector(".board")?.dataset.mic,
      level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
    };
  });
const waitFor = async (page, pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await status(page);
    if (pred(s)) return s;
    await page.waitForTimeout(80);
  }
  return null;
};
const startLesson = async (page) => {
  await page.goto(`${BASE}/lesson?fixture=${FIXTURE}&beats=4&intake=0&voice=1`, { waitUntil: "load" });
  await page.click('[data-testid="start-talking"]');
  await waitFor(page, (s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', QUESTION);
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
};
const realWords = (t) => t.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z'-]/g, "")).filter((w) => w.length >= 2 && !["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "oh", "mm", "mhm", "hmm", "huh", "uh-huh"].includes(w)).length;

const args = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

if (MODE === "latency" || MODE === "echo") {
  const clips = Object.fromEntries(await Promise.all(SAY.map(async (s) => [s.name, await clip(s.name, clipText(s))])));
  const browser = await chromium.launch({ args });
  const rows = [];
  for (const s of SAY.filter((x) => !process.env.ONLY || x.name === process.env.ONLY)) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    await context.addInitScript(inkTap);
    await context.addInitScript(() => {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      navigator.mediaDevices.getUserMedia = async () => (await ac.resume(), dest.stream);
      // Plays a clip into the mic; returns the page time of its first audible sample.
      window.__say = async (b64, gain = 1) => {
        await ac.resume();
        const buf = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
        const d = buf.getChannelData(0);
        let i = 0;
        while (i < d.length && Math.abs(d[i]) < 0.02) i++;
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = gain;
        src.connect(g).connect(dest);
        const now = performance.now();
        src.start();
        return { onset: now + (i / buf.sampleRate) * 1000, seconds: buf.duration };
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    try {
      await startLesson(page);
      const ready = await waitFor(page, (x) => x.beat === "b2" && x.status === "Speaking" && x.word >= (MODE === "echo" ? 0 : 4), 90000);
      if (!ready) throw new Error("beat 2 never played");
      const before = await page.evaluate(() => window.__ink.length);
      const said = await page.evaluate((a) => window.__say(a.b64, a.gain), { b64: clips[s.name], gain: s.gain ?? 1 });
      await page.waitForTimeout(said.seconds * 1000 + 2500);
      const r = await page.evaluate(({ onset, before }) => {
        const ink = window.__ink.slice(before);
        return { ink, paused: window.__pausedAt.find((t) => t >= onset) ?? null, onset };
      }, { onset: said.onset, before });
      const two = r.ink.find((m) => m.type !== "turn.start" && realWords(m.text) >= 2);
      const first = r.ink.find((m) => m.type === "turn.update" && m.text.trim());
      const row = {
        say: s.text,
        expect: s.barge ? "pause" : "no pause",
        paused: r.paused != null,
        firstPartialMs: first ? Math.round(first.t - r.onset) : null,
        twoWordsMs: two ? Math.round(two.t - r.onset) : null,
        pauseMs: r.paused != null ? Math.round(r.paused - r.onset) : null,
        heard: r.ink.filter((m) => m.type === "turn.end").map((m) => m.text).join(" | "),
      };
      rows.push(row);
      console.log(`${row.paused === s.barge ? "PASS" : "FAIL"}  "${s.text}" -> ${row.paused ? `paused ${row.pauseMs} ms after the first word (first partial ${row.firstPartialMs} ms, two words ${row.twoWordsMs} ms)` : "no pause"}; Ink heard "${row.heard}"`);
      if (s === SAY[0] && MODE === "latency") {
        // Handled like a Space barge-in: a reply comes back on the ladder.
        const answered = await waitFor(page, (x) => /^Last turn: /.test(x.level ?? ""), 30000);
        console.log(`${answered ? "PASS" : "FAIL"}  the barge-in was answered on the ladder — ${answered?.level ?? "no reply"}`);
        const b = await status(page);
        console.log(`${b.badge ? "PASS" : "FAIL"}  badge shown`);
        // A second barge-in in the same lesson.
        let again = await waitFor(page, (x) => x.status === "Speaking" && x.word >= 2, 15000);
        if (!again) {
          await page.click('[data-testid="continue"]').catch(() => {});
          again = await waitFor(page, (x) => x.status === "Speaking" && x.word >= 2, 20000);
        }
        if (!again) console.log("FAIL  playback never came back for a second barge-in");
        else {
          const n = await page.evaluate(() => window.__pausedAt.length);
          const said2 = await page.evaluate((b64) => window.__say(b64), clips["vb-again"]);
          await page.waitForTimeout(said2.seconds * 1000 + 2500);
          const p2 = await page.evaluate((n) => window.__pausedAt.slice(n), n);
          console.log(`${p2.length ? "PASS" : "FAIL"}  a second voice barge-in in the same lesson pauses it${p2.length ? ` (${Math.round(p2[0] - said2.onset)} ms after the first word, at ${again.beat})` : ""}`);
        }
      }
    } catch (e) {
      console.log("ERROR", s.text, e.message);
    }
    await page.click('[data-testid="stop"]').catch(() => {});
    await context.close();
  }
  await browser.close();
  const hits = rows.filter((r) => r.expect === "pause" && r.paused).map((r) => r.pauseMs).sort((a, b) => a - b);
  if (hits.length) console.log(`first word -> paused: median ${hits[Math.floor(hits.length / 2)]} ms, range ${hits[0]}-${hits.at(-1)} ms over ${hits.length} barge-ins`);
  console.log(`${MODE === "echo" ? "echo levels that paused" : "fillers that paused"}: ${rows.filter((r) => r.expect === "no pause" && r.paused).length}/${rows.filter((r) => r.expect === "no pause").length}`);
} else {
  // The real mic, the real speakers. Headed so the audio device is the desktop's.
  const browser = await chromium.launch({ headless: false, args: [...args, "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, permissions: ["microphone"] });
  await context.addInitScript(inkTap);
  await context.addInitScript(() => {
    // A second, raw tap on the mic (no echo cancellation): Chalky's level as the mic hears it.
    window.__raw = [];
    window.__rawTap = async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ac = new AudioContext();
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      ac.createMediaStreamSource(s).connect(an);
      const d = new Float32Array(an.fftSize);
      setInterval(() => {
        an.getFloatTimeDomainData(d);
        let e = 0;
        for (const v of d) e += v * v;
        const st = document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "";
        window.__raw.push({ t: performance.now(), rms: Math.sqrt(e / d.length), speaking: st === "Speaking" });
      }, 100);
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await startLesson(page);
  await page.evaluate(() => window.__rawTap());
  const t0 = Date.now();
  let speakingMs = 0;
  let last = Date.now();
  while (Date.now() - t0 < ROOM_SECONDS * 1000) {
    const s = await status(page);
    const now = Date.now();
    if (s.status === "Speaking") speakingMs += now - last;
    last = now;
    if (/^Paused/.test(s.status)) {
      console.log(`  [${((now - t0) / 1000).toFixed(1)} s] paused at ${s.beat} word ${s.word}`);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(100);
  }
  const r = await page.evaluate(() => ({ ink: window.__ink, paused: window.__pausedAt.length, raw: window.__raw }));
  await page.click('[data-testid="stop"]').catch(() => {});
  await browser.close();
  const db = (x) => (20 * Math.log10(Math.max(x, 1e-6))).toFixed(0);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sp = r.raw.filter((x) => x.speaking).map((x) => x.rms);
  const quiet = r.raw.filter((x) => !x.speaking).map((x) => x.rms);
  console.log(`raw mic level: ${db(avg(sp))} dBFS while Chalky speaks, ${db(avg(quiet))} dBFS otherwise`);
  console.log(`Ink turns heard (after echo cancellation): ${r.ink.filter((m) => m.type === "turn.end").map((m) => `"${m.text}"`).join(", ") || "none"}`);
  console.log(`false barge-ins: ${r.paused} in ${(speakingMs / 1000).toFixed(0)} s of Chalky speaking`);
}
