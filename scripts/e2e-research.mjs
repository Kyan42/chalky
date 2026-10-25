// "What's new in ...": the ask -> research -> intake -> lesson flow on the scripted mic. The first reply must
// carry a research action; the page shows "Finding papers", polls /api/research until ready, the intake is
// asked meanwhile, and the planner teaches from the papers: beats carry cite (a paper number, never a tag in
// the speech) and the paper list lights the cited paper as each beat plays.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> node scripts/e2e-research.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const OUT = join(process.cwd(), "experiments/research", process.env.RUN ?? "run");
const ASK = process.env.ASK ?? "What's new in vision-language-action models this month?";
const INTAKE = process.env.INTAKE ?? "I know what a robot arm policy is, but not these new models.";
mkdirSync(OUT, { recursive: true });
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}.wav`), [{ silence: 0.2 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const clips = { ask: await clip("research-ask", ASK), intake: await clip("research-intake", INTAKE) };
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
const polls = [];
page.on("request", (r) => /\/api\/research/.test(r.url()) && polls.push(`${r.method()} ${new URL(r.url()).pathname}`));
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    badge: !!document.querySelector('[data-testid="research-badge"]'),
    cards: document.querySelectorAll('[data-testid="paper-card"]').length,
    // PaperCards opens the cited paper's card (data-open) and marks its matching key sentence.
    lit: (() => {
      const open = document.querySelector('[data-testid="paper-card"][data-open="true"]');
      return open ? `paper-${open.getAttribute("data-n")}` : null;
    })(),
    match: !!document.querySelector('[data-testid="paper-card"][data-open="true"] [data-testid="paper-match"]'),
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
let sawBadge = false;
let sawMatch = false;
const litByBeat = {};
try {
  await page.goto(`${BASE}/lesson?debug=1`);
  await page.click('[data-testid="start-talking"]');
  await waitFor((s) => s.status === "Listening", 20000);
  await page.click("body", { position: { x: 5, y: 400 } });
  await page.evaluate((b) => window.__say(b), clips.ask);
  // The research badge while papers are found; then the intake waits for the learner.
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    const s = await st();
    if (s.badge) sawBadge = true;
    if (s.status === "Your turn") break;
    await page.waitForTimeout(150);
  }
  await page.evaluate((b) => window.__say(b), clips.intake);
  // Play the lesson for a while, noting which paper is lit on each beat.
  const end = Date.now() + 150000;
  let shot = 0;
  while (Date.now() < end) {
    const s = await st();
    if (s.badge) sawBadge = true;
    if (s.beat && s.status === "Speaking") litByBeat[s.beat] = s.lit;
    if (s.match) sawMatch = true;
    if (s.status === "Your turn" && s.beat) await page.click('[data-testid="continue"]').catch(() => {});
    if (s.lit && shot < 3 && Object.keys(litByBeat).length > shot * 3) await page.screenshot({ path: join(OUT, `cards-${++shot}.png`) });
    if (Object.keys(litByBeat).length >= 9) break;
    await page.waitForTimeout(250);
  }
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
const research = ev("research")[0];
const planned = ev("planned");
console.log(`        first reply: "${reply?.text}" [${(reply?.actions ?? []).map((a) => (a.type === "research" ? `research(${a.topic}, ${a.days}d)` : a.type)).join(", ")}]`);
console.log(`        research: ${JSON.stringify(research)}; requests: ${polls.join(", ")}`);
console.log(`        planned: ${planned.map((e) => `${e.beatId}${e.cite ? `[${e.cite}]` : ""}`).join(" ")}`);
console.log(`        lit while speaking: ${JSON.stringify(litByBeat)}`);
check("the first reply asks for recent papers", (reply?.actions ?? []).some((a) => a.type === "research"));
// A cached topic is ready at once (no badge to see, no polling); a fresh one shows the badge and polls.
check("the research came back ready (cached at once, or polled until ready with Finding papers shown)", research?.papers > 0 && (research.cached || (sawBadge && polls.some((p) => p.startsWith("GET")))), `${research?.papers} papers via ${research?.via}${research?.cached ? ", cached" : ""}`);
check("the intake was asked and answered meanwhile", ev("intake-asked").length === 1 && ev("intake-decision").length === 1);
const cited = planned.filter((e) => e.cite);
check("the planner taught from the papers: beats carry cite", cited.length >= 3 && new Set(cited.map((e) => e.cite)).size >= 2, `${cited.length} cited beats`);
check("no citation tag is spoken", !planned.some((e) => /\[\d+\]/.test(e.say)));
const followed = Object.entries(litByBeat).filter(([b]) => planned.find((e) => e.beatId === b)?.cite);
check("the paper list lights the cited paper as each cited beat plays", followed.length >= 2 && followed.every(([b, lit]) => lit === `paper-${planned.find((e) => e.beatId === b).cite}`), JSON.stringify(followed));
check("the open card highlights a key sentence matching the line", sawMatch);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; frames in ${OUT}; transcript ${t?.id}`);
