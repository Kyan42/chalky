// Keyon's run, replayed on a saved plan: cut in during a check-in beat, ask
// something that needs a drawing, then say "yeah, that makes sense" at the
// detour's check-in. The detour must take the cut check-in's place (no replay,
// no second check-in), the reply must be one hand-off sentence, the detour must
// not open with "good question" or restate the question, and the lesson must
// go on to the next beat.
//   BASE_URL=http://localhost:3006 LIVE_RUNS=../<checkout>/experiments/live-runs node scripts/e2e-checkin-detour.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const ASK = process.env.ASK ?? "wait, how do the molecules actually get into the air up there?";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1);
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    beats: [...document.querySelectorAll('[data-testid="beats"] li')].map((li) => li.dataset.beatId),
    caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim(),
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
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const type = async (text) => {
  await page.fill('[data-testid="question"]', text);
  await page.click('[data-testid="ask"]');
  console.log(`${since().padStart(5)} s  [typed] "${text}"`);
};
try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=6&intake=0`);
  await type("Why is the sky blue?");
  // b4 is a talk beat that ends in a check-in: cut in while it is spoken.
  const b4 = await waitFor((s) => s.beat === "b4" && s.status === "Speaking" && s.caption.split(" ").length > 4, 180000);
  check("reached the check-in beat b4", !!b4);
  await page.keyboard.down("Space");
  await page.waitForTimeout(350);
  await page.keyboard.up("Space");
  await waitFor((s) => s.status === "Your turn", 3000);
  await type(ASK);
  const detour = await waitFor((s) => s.beat && /^d\d+-1$/.test(s.beat) && s.status === "Speaking", 60000);
  check("a detour starts", !!detour, detour ? `beats ${detour.beats.join(",")}` : "");
  check("the cut check-in b4 is gone from the plan (the detour replaces it)", !!detour && !detour.beats.includes("b4"), detour?.beats.join(","));
  const detourCheck = await waitFor((s) => s.status === "Your turn" && s.beat && /^d\d+-/.test(s.beat), 180000);
  check("the detour ends at its own check-in", !!detourCheck, detourCheck?.beat ?? "");
  await type("yeah, that makes sense");
  const next = await waitFor((s) => s.beat && !/^d\d+-/.test(s.beat) && s.status === "Speaking", 30000);
  check("the lesson goes on to b5 (no replay of b4)", next?.beat === "b5", `${next?.beat} ${next?.level ?? ""}`);
  await page.waitForTimeout(2500);
  await page.click('[data-testid="stop"]').catch(() => {});
  await page.waitForTimeout(1500);
} catch (e) {
  console.log("ERROR", e.message);
}
await browser.close();
// The transcript: the hand-off, the detour's first beat, the bridge, the check-ins asked.
const files = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m);
const t = files[0] ? JSON.parse(readFileSync(join(DIR, files[0].f), "utf8")) : null;
if (t) {
  const reply = t.events.find((e) => e.kind === "reply");
  const sentences = (reply?.text ?? "").split(/(?<=[.!?])\s+/).filter(Boolean).length;
  check("the detour's reply is one hand-off sentence", reply?.level === "detour" && sentences === 1, `"${reply?.text}"`);
  const d1 = t.events.find((e) => e.kind === "beat" && /^d\d+-1$/.test(e.beatId));
  check("the detour's first beat doesn't open with 'good question' or restate the question", !!d1 && !/^(good|great|nice) (question|one)/i.test(d1.say) && !/^[^.!]*\?/.test(d1.say), `"${d1?.say.slice(0, 90)}"`);
  const b4Plays = t.events.filter((e) => e.kind === "beat" && e.beatId === "b4").length;
  check("b4 played once (cut), never replayed", b4Plays === 1, `${b4Plays} play(s); ${t.events.filter((e) => e.kind === "replaced-by-detour").map((e) => `${e.beatId} replaced (${e.why})`).join("; ")}`);
  const after = t.events.filter((e) => e.t > (t.events.find((x) => x.kind === "learner" && /makes sense/.test(x.text))?.t ?? Infinity));
  console.log(`        after "yeah, that makes sense": ${after.slice(0, 4).map((e) => `${e.kind}${e.role ? "/" + e.role : ""}${e.text ? ` "${e.text}"` : e.beatId ? ` ${e.beatId}` : ""}`).join(" -> ")}`);
  const calls = t.events.filter((e) => e.calls || e.call || e.drawCalls);
  console.log(`        events with call logs: ${calls.length}; e.g. ${JSON.stringify(reply?.calls?.[0] ?? null)}`);
  console.log(`        reply Sonic per sentence: ${JSON.stringify(reply?.sonic ?? null)}`);
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
