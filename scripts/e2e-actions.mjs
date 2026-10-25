// The conversation layer's actions, on the scripted mic (every line is spoken into the page's mic).
//   SCRIPT=a  a full lesson with an intake: "I want to learn photosynthesis" -> ask + start_lesson (real planner),
//             the intake answered by voice, the first beats play.
//   SCRIPT=b  a quick question first: a short spoken answer and no lesson; then "okay, teach me properly"
//             starts one (a saved plan, ?firstturn=1).
//   SCRIPT=c  a remark mid-lesson ("huh, that's cool", Space held): a one-liner, and the lesson goes on.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> SCRIPT=b node scripts/e2e-actions.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const SCRIPT = process.env.SCRIPT ?? "b";
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const LINES = {
  a: { learn: "I want to learn photosynthesis.", intake: "I know plants need sunlight, but not much else." },
  b: { quick: "Is the sky blue because it reflects the ocean?", more: "Okay, teach me properly." },
  c: { remark: "Huh, that's cool." },
}[SCRIPT];
const clips = Object.fromEntries(await Promise.all(Object.entries(LINES).map(async ([k, v]) => [k, await clip(`act-${SCRIPT}-${k}`, v)])));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const t0 = Date.now();
const transcript = () => {
  const f = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
  return f ? JSON.parse(readFileSync(join(DIR, f.f), "utf8")) : null;
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
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const plans = [];
page.on("request", (r) => ["/api/plan", "/api/fixture"].includes(new URL(r.url()).pathname) && plans.push(Date.now()));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    beats: document.querySelectorAll('[data-testid="beats"] li').length,
    word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
    turn: Number(document.querySelector('[data-testid="last-level"]')?.dataset.turn ?? 0),
    level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
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
const say = async (k) => {
  const seconds = await page.evaluate((b64) => window.__say(b64), clips[k]);
  console.log(`  [said] "${LINES[k]}"`);
  return seconds;
};
const replies = () => (transcript()?.events ?? []).filter((e) => e.kind === "reply");
const waitReplies = async (n, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (replies().length >= n) return replies();
    await page.waitForTimeout(500);
  }
  return replies();
};
const names = (r) => (r?.actions ?? []).map((a) => (a.type === "amend" ? `amend:${a.op}` : a.type)).join(", ");

try {
  const url = SCRIPT === "a" ? `${BASE}/lesson` : SCRIPT === "b" ? `${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=4&firstturn=1` : `${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=5&intake=0`;
  await page.goto(url);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.click("body", { position: { x: 5, y: 400 } });

  if (SCRIPT === "a") {
    await say("learn");
    const [r1] = await waitReplies(1, 30000);
    console.log(`        reply: "${r1?.text}" [${names(r1)}]`);
    check("first words: ask + start_lesson", /ask/.test(names(r1)) && /start_lesson/.test(names(r1)), names(r1));
    check("the planner started from the reply's actions", plans.length === 1, `${plans.length} plan request(s)`);
    await waitFor((s) => s.status === "Your turn", 20000);
    await say("intake");
    await waitFor((s) => s.beat === "b1" && s.status === "Speaking", 60000);
    await page.waitForTimeout(8000);
    const t = transcript();
    const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
    check("the intake was the model's ask, then answered and decided", ev("intake-asked").length === 1 && ev("intake-decision").length === 1, `${JSON.stringify(ev("intake-asked")[0]?.text)}; decision ${JSON.stringify(ev("intake-decision")[0] && { amend: ev("intake-decision")[0].amend, note: ev("intake-decision")[0].note })}`);
    check("the lesson plays", ev("planned").length > 3 && !!(await st()).beat, `${ev("planned").length} beats planned; now ${(await st()).beat}`);
  } else if (SCRIPT === "b") {
    await say("quick");
    const [r1] = await waitReplies(1, 30000);
    console.log(`        reply: "${r1?.text}" [${names(r1)}]`);
    check("a quick question gets a short spoken answer", !!r1 && r1.text.split(/(?<=[.!?])\s+/).length <= 3 && !/start_lesson|amend/.test(names(r1)), names(r1));
    await page.waitForTimeout(3000);
    check("and no lesson is planned", plans.length === 0 && (await st()).beats === 0, `${plans.length} plan request(s)`);
    await say("more");
    const rs = await waitReplies(2, 30000);
    const r2 = rs[1];
    console.log(`        reply: "${r2?.text}" [${names(r2)}]`);
    check('"okay, teach me properly" starts the lesson', /start_lesson/.test(names(r2)) && plans.length === 1, `${names(r2)}; ${plans.length} plan request(s)`);
    // The intake, if the model asked one: let silence skip it.
    const b1 = await waitFor((s) => s.beat === "b1" && s.status === "Speaking", 40000);
    check("the lesson's first beat plays", !!b1);
  } else {
    await page.fill('[data-testid="question"]', "Why is the sky blue?");
    await page.click('[data-testid="ask"]');
    await page.click("body", { position: { x: 5, y: 400 } });
    await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 5, 90000);
    await page.keyboard.down("Space");
    const sec = await say("remark");
    await page.waitForTimeout(sec * 1000 + 150);
    await page.keyboard.up("Space");
    const [r1] = await waitReplies(1, 30000);
    console.log(`        reply: "${r1?.text}" [${names(r1)}]`);
    check("a remark gets a one-liner and nothing else", !!r1 && r1.text.split(/(?<=[.!?])\s+/).length <= 2 && /^say(, resume)?$/.test(names(r1)), names(r1));
    const on = await waitFor((s) => s.beat === "b3" && s.status === "Speaking", 60000);
    check("the lesson goes on", !!on, on ? `now ${on.beat}` : (await st()).status);
  }
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(1500);
await browser.close();
const t = transcript();
if (t) console.log(`        transcript: ${t.id} (${t.events.length} events; replies ${t.events.filter((e) => e.kind === "reply").map((e) => `[${names(e)}]`).join(" ")})`);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
