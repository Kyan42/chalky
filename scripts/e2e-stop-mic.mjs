// Stop's mic side, on the scripted mic: while Chalky is stopped, nothing the learner says is heard or
// sent to Ink, typing is off, and Start goes on from the same word; the mic works again after Start.
//   BASE_URL=http://localhost:3006 node scripts/e2e-stop-mic.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const ask = await clip("stop-ask", "Wait, why does blue scatter more?");

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
  window.__say = async (b64) => {
    await ac.resume();
    const buf = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return buf.duration;
  };
  // Count audio sent to Ink, and what it heard.
  window.__sent = 0;
  window.__heard = [];
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      if (!String(a[0]).includes("stt")) return;
      const send = this.send.bind(this);
      this.send = (d) => {
        if (typeof d !== "string") window.__sent++;
        return send(d);
      };
      this.addEventListener("message", (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "turn.end") window.__heard.push(m.transcript);
        } catch {}
      });
    }
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
    mic: document.querySelector(".board")?.dataset.mic,
    level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
  }));
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
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 4, 90000);
  await page.click('[data-testid="stop"]');
  await page.waitForTimeout(300);
  const p = await st();
  check("Stop pauses", /^Paused/.test(p.status), `${p.status}; mic ${p.mic}`);
  const sent0 = await page.evaluate(() => window.__sent);
  const seconds = await page.evaluate((b64) => window.__say(b64), ask);
  await page.waitForTimeout(seconds * 1000 + 3000);
  const after = await st();
  const r = await page.evaluate(() => ({ sent: window.__sent, heard: window.__heard }));
  check("while stopped, no audio goes to Ink", r.sent === sent0, `${r.sent - sent0} chunks sent`);
  check("while stopped, nothing is heard or answered", !r.heard.length && /^Paused/.test(after.status) && after.word === p.word, `heard ${JSON.stringify(r.heard)}; ${after.status} at word ${after.word}`);
  check("while stopped, typing is off", await page.isDisabled('[data-testid="question"]'));
  await page.click('[data-testid="start"]');
  const go = await waitFor((s) => s.status === "Speaking" && s.word >= 0, 3000);
  check("Start goes on from the same word", !!go && go.beat === p.beat && go.word >= p.word && go.word <= p.word + 2, `stopped at ${p.beat}:${p.word}, went on at ${go?.beat}:${go?.word}`);
  // The mic works again: talking over Chalky with Space held is heard.
  await page.waitForTimeout(800);
  await page.keyboard.down("Space");
  const s2 = await page.evaluate((b64) => window.__say(b64), ask);
  await page.waitForTimeout(s2 * 1000 + 200);
  await page.keyboard.up("Space");
  const answered = await waitFor((s) => /^Last turn: /.test(s.level ?? ""), 30000);
  const heard = await page.evaluate(() => window.__heard);
  check("after Start, the mic hears the learner again (Space held)", heard.length > 0 && !!answered, `heard ${JSON.stringify(heard)}; ${answered?.level ?? "no reply"}`);
} catch (e) {
  console.log("ERROR", e.message);
}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
