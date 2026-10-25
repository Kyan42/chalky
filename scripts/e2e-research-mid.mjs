// A question mid-lesson that needs something recent, on the scripted mic, in a saved lesson. MODE=ready (default):
// a cached question -> the reply says one covering line, the lookup is ready, and the answer comes as a short
// detour whose beats cite what was found, with the source card open. MODE=none: a question nothing is found
// for -> one honest line, no detour, no card.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> MODE=none node scripts/e2e-research-mid.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const MODE = process.env.MODE ?? "ready";
const ASK = process.env.ASK ?? (MODE === "none" ? "Wait, what's new in zorblaxian quantum knitting this week?" : "Wait, who won the 2026 Nobel in physics and for what?");
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const b64 = readFileSync((await speechWav(join(clipDir, `mid-research-${MODE}.wav`), [{ silence: 0.2 }, { say: ASK }, { silence: 0.4 }])).path).toString("base64");
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
    cards: document.querySelectorAll('[data-testid="research-card"]').length,
    open: document.querySelector('[data-testid="research-card"][data-open="true"]')?.getAttribute("data-n") ?? null,
  }));
const waitFor = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await st();
    if (pred(s)) return s;
    await page.waitForTimeout(150);
  }
  return null;
};
const seen = [];
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=6&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.fill('[data-testid="question"]', "Why is the sky blue?");
  await page.click('[data-testid="ask"]');
  await page.click("body", { position: { x: 5, y: 400 } });
  await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 6, 120000);
  await page.keyboard.down("Space");
  const sec = await page.evaluate((b) => window.__say(b), b64);
  await page.waitForTimeout(sec * 1000 + 150);
  await page.keyboard.up("Space");
  const until = Date.now() + 70000;
  let last = "";
  while (Date.now() < until) {
    const s = await st();
    const key = `${s.status}|${s.beat}|${s.open}`;
    if (key !== last) seen.push(`${s.status} ${s.beat ?? ""}${s.open ? ` card ${s.open}` : ""}`);
    last = key;
    if (MODE === "ready" && /^d\d+-2$/.test(s.beat ?? "")) break;
    if (MODE === "none" && s.status === "Your turn" && seen.length > 3) break;
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: join(process.cwd(), `experiments/research/mid-${MODE}.png`) });
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
const look = ev("research-ready")[0] ?? ev("research-none")[0];
const planned = ev("planned").filter((e) => e.by);
console.log(`        reply: "${reply?.text}" [${(reply?.actions ?? []).map((a) => a.type).join(", ")}]`);
console.log(`        lookup: ${JSON.stringify(look && { kind: look.kind, items: look.items, ms: look.ms, cached: look.cached, titles: look.titles, error: look.error })}`);
console.log(`        detour: ${ev("detour").map((d) => d.beats.map((b) => b.beatId).join(",")).join(" ")}; cites: ${JSON.stringify(ev("planned").filter((e) => /^d/.test(e.beatId)).map((e) => `${e.beatId}:${e.cite ?? "-"}`))}`);
console.log(`        page: ${seen.join(" -> ")}`);
check("the reply chose a lookup", (reply?.actions ?? []).some((a) => a.type === "research"));
if (MODE === "ready") {
  check("the lookup was ready", look?.kind === "research-ready" && look.items > 0, `${look?.items} items, ${look?.ms} ms`);
  const dBeats = ev("planned").filter((e) => /^d\d+-/.test(e.beatId));
  check("the answer came as a detour whose beats cite what was found", dBeats.length >= 2 && dBeats.some((e) => e.cite), dBeats.map((e) => `${e.beatId}:${e.cite ?? "-"}`).join(" "));
  check("the source card opened during the detour", seen.some((x) => /d\d+-\d.*card \d/.test(x)), seen.join(" | "));
} else {
  check("nothing was found", look?.kind === "research-none", look?.error ?? "");
  check("one honest line, no detour, no card", ev("say").some((e) => e.role === "research-empty") && !ev("detour").length && !seen.some((x) => /card/.test(x)));
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${t?.id}`);
