// The conversation layer's actions, on the scripted mic (every line is spoken into the page's mic).
//   SCRIPT=a  a full lesson with an intake: "I want to learn photosynthesis" -> ask + start_lesson (real planner),
//             the intake answered by voice, the first beats play.
//   SCRIPT=b  a quick question first: a short spoken answer and no lesson; then "okay, teach me properly"
//             starts one (a saved plan, ?firstturn=1).
//   SCRIPT=c  a remark mid-lesson ("huh, that's cool", Space held): a one-liner, and the lesson goes on.
//   SCRIPT=d  three scenes in, "show me where the diagram of the two waves was": the camera goes back to
//             scene 1 (go_to, maybe by way of delegate) and the cursor circles it.
//   SCRIPT=e  two lessons for one learner (one browser, one learner cookie): the first gets stuck on violet
//             light; the second's first reply (the intake) brings that up, from the Convex memory.
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
  d: { back: "Wait, show me where the diagram of the two waves was." },
  e: { learn: "I want to learn why the sky is blue.", intake: "I always get confused about why it isn't violet.", lost: "I still don't get why the sky isn't violet.", next: "Can you teach me how rainbows work?" },
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
  const url =
    SCRIPT === "a" ? `${BASE}/lesson`
    : SCRIPT === "b" || SCRIPT === "e" ? `${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=${SCRIPT === "e" ? 6 : 4}&firstturn=1`
    : `${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=${SCRIPT === "d" ? 10 : 5}&intake=0`;
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
  } else if (SCRIPT === "d") {
    await page.fill('[data-testid="question"]', "Why is the sky blue?");
    await page.click('[data-testid="ask"]');
    await page.click("body", { position: { x: 5, y: 400 } });
    // Through the check-ins to scene 3.
    const until = Date.now() + 240000;
    let s3 = null;
    while (Date.now() < until && !s3) {
      const s = await st();
      if (s.status === "Your turn") await page.click('[data-testid="continue"]').catch(() => {});
      const scene = await page.evaluate(() => Number(document.querySelector(".board")?.dataset.scene ?? 0));
      if (scene >= 3 && s.status === "Speaking" && s.word >= 3) s3 = s;
      await page.waitForTimeout(250);
    }
    check("the lesson reached scene 3", !!s3, s3?.beat ?? "");
    await page.keyboard.down("Space");
    const sec = await say("back");
    await page.waitForTimeout(sec * 1000 + 150);
    await page.keyboard.up("Space");
    const [r1] = await waitReplies(1, 40000);
    console.log(`        reply: "${r1?.text}" [${names(r1)}]`);
    // A delegate's actions arrive after the reply.
    const back = await (async () => {
      const until2 = Date.now() + 25000;
      while (Date.now() < until2) {
        const b = await page.evaluate(() => ({ scene: Number(document.querySelector(".board")?.dataset.scene ?? 0), view: document.querySelector(".board")?.dataset.view }));
        if (b.scene === 1) return b;
        await page.waitForTimeout(250);
      }
      return null;
    })();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(process.cwd(), "experiments/conversation-e2e/clips/../d-went-back.png") });
    const t = transcript();
    const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
    console.log(`        retrieval: ${JSON.stringify(ev("retrieval").at(-1))}`);
    console.log(`        go-to: ${JSON.stringify(ev("go-to").at(-1))}; delegated: ${JSON.stringify(ev("delegated").at(-1) ?? null)}; highlight: ${JSON.stringify(ev("highlight").at(-1) ?? null)}`);
    check("the camera went back to scene 1", !!back, back ? `view ${back.view}` : "still elsewhere");
    check("and the cursor circled it", ev("highlight").length > 0 || /point/.test(names(r1)), JSON.stringify(ev("highlight").at(-1)?.targets ?? null));
    const idx = ev("board-index");
    if (idx.length) console.log(`        board index updates: ${idx.map((e) => `${e.added} doc(s) ${e.ms} ms (${e.status})`).join(", ")}`);
  } else if (SCRIPT === "e") {
    // Lesson 1: stuck on violet.
    await say("learn");
    // The page, not the transcript file (saved every 2 s): the intake's silence window is 4 s.
    await waitFor((s) => s.status === "Your turn", 40000);
    await say("intake");
    await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 3, 90000);
    await page.waitForTimeout(1500); // key-term changes reconnect Ink between turns; let that settle
    await page.keyboard.down("Space");
    const sec = await say("lost");
    await page.waitForTimeout(sec * 1000 + 150);
    await page.keyboard.up("Space");
    const rs = await waitReplies(2, 40000);
    console.log(`        lesson 1 reply to "${LINES.lost}": "${rs[1]?.text}" [${names(rs[1])}]`);
    await page.waitForTimeout(4000); // the transcript (with the learner record) reaches Convex
    const first = transcript();
    console.log(`        lesson 1 learner record: ${JSON.stringify(first?.learner ? { level: first.learner.level, prior: first.learner.prior, focus: first.learner.focus, confusions: first.learner.confusions } : null)}`);
    // Lesson 2, same browser (same learner cookie).
    await page.goto(url);
    await page.click('[data-testid="start-talking"]');
    await waitFor((s) => s.status === "Listening", 20000);
    await page.waitForTimeout(3000); // lesson 1's closing save reaches Convex
    const t2 = Date.now();
    await say("next");
    let r2 = null;
    const until = Date.now() + 40000;
    while (Date.now() < until && !r2) {
      const f = readdirSync(DIR).map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs })).filter((x) => x.m >= t2).sort((a, b) => b.m - a.m)[0];
      const t = f ? JSON.parse(readFileSync(join(DIR, f.f), "utf8")) : null;
      if (t && t.question !== first?.question) {
        r2 = { reply: t.events.find((e) => e.kind === "reply"), retrieval: t.events.find((e) => e.kind === "retrieval") };
        if (!r2.reply) r2 = null;
      }
      await page.waitForTimeout(500);
    }
    console.log(`        lesson 2 first reply: "${r2?.reply?.text}" [${names(r2?.reply)}]`);
    console.log(`        lesson 2 memory: ${JSON.stringify(r2?.retrieval?.memory ?? null)}`);
    check("lesson 2 had the learner's earlier lines in its prompt", (r2?.retrieval?.memory?.lines?.length ?? 0) > 0, r2?.retrieval?.memory?.status ?? "no retrieval");
    check("and its intake reply brings up what lesson 1 got stuck on", /violet|last time|earlier lesson|you (said|got stuck|mentioned)/i.test(r2?.reply?.text ?? ""), r2?.reply?.text ?? "");
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
