// A cut-in that asks for a detour, on the scripted mic (Keyon's ATP run, 20261025044244): hold Space mid-beat,
// say you're confused and ask for more. The reply hands off to a detour ("Let me draw that for you"). Nothing
// may play before the detour's first beat lands; then the detour plays, right away, before the cut beat goes
// on. With SILENT=1 the question is one the reply answers with a wait: the lesson must stay put while the
// learner says nothing.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-cut-detour.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const SILENT = !!process.env.SILENT;
const ASK = process.env.ASK ?? (SILENT ? "Is the red one the longer wave?" : "I'm so confused about what a wavelength is. Can you go more into that?");
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const b64 = readFileSync((await speechWav(join(clipDir, `cut-detour-${SILENT ? "q" : "lost"}.wav`), [{ silence: 0.2 }, { say: ASK }, { silence: 0.4 }])).path).toString("base64");
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
page.on("console", (m) => m.text().startsWith("[dbg]") && console.log("   ", m.text().slice(0, 300)));
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
    await page.waitForTimeout(80);
  }
  return null;
};
/** What the page played after the reply, second by second: [ms since the reply, status, beat]. */
const timeline = [];
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=6&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 8, 120000);
  await page.keyboard.down("Space");
  const sec = await page.evaluate((b) => window.__say(b), b64);
  await page.waitForTimeout(sec * 1000 + 150);
  await page.keyboard.up("Space");
  const turn0 = (await st()).turn;
  await waitFor((s) => s.turn > turn0, 60000);
  const tReply = Date.now();
  const until = Date.now() + (SILENT ? 25000 : 60000);
  let last = "";
  while (Date.now() < until) {
    const s = await st();
    const key = `${s.status}|${s.beat}`;
    if (key !== last) timeline.push([Date.now() - tReply, s.status, s.beat, s.word]);
    last = key;
    if (!SILENT && /^d\d+-2$/.test(s.beat ?? "")) break;
    await page.waitForTimeout(150);
  }
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(1500);
await browser.close();
console.log(`        after the reply: ${timeline.map(([t, s, b, w]) => `${(t / 1000).toFixed(1)}s ${s}${b ? ` ${b}:${w}` : ""}`).join(" -> ")}`);
const f = readdirSync(DIR).map((n) => ({ n, m: statSync(join(DIR, n)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
const t = f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
const reply = ev("reply")[0];
console.log(`        reply: "${reply?.text}" [${(reply?.actions ?? []).map((a) => (a.type === "amend" ? `amend:${a.op}` : a.type === "resume" ? `resume:${a.how}` : a.type)).join(", ")}] level ${reply?.level}`);
const spoke = timeline.filter(([, s]) => s === "Speaking").map(([, , b]) => b);
if (!SILENT) {
  check("the reply handed off to a detour", reply?.level === "detour", reply?.level);
  const first = spoke[0];
  check("nothing plays before the detour's first beat; then the detour plays", /^d\d+-1$/.test(first ?? ""), `first spoken after the reply: ${first}`);
  check("the cut beat did not replay before the detour", !spoke.slice(0, spoke.findIndex((b) => /^d\d+-1$/.test(b ?? ""))).includes("b2"), spoke.join(","));
} else {
  check("the reply waits", reply?.resume === "wait", `${reply?.level} / ${reply?.resume}`);
  check("with the learner silent, nothing plays", !spoke.length, spoke.join(",") || "nothing");
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${t?.id}`);
