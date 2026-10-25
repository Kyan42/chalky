// Regular quizzes on the scripted mic, in a saved four-section lesson (why-is-the-sky-blue-quizzes): a label quiz
// after section 2, a predict quiz before section 4 and a sketch quiz after it, each played as it comes up.
// MODE=answer (default): the labels named, the prediction right ("about six times"), a drawing handed in with Done.
// MODE=skip: "I don't know" to the labels, a wrong prediction ("the same amount"), "skip" to the drawing; each skip
// is told the answer in one line. Either way the record (learner.quizzes and its lines in confusions) has all three.
// FIXTURE=<slug> plays another lesson; REAL="<question>" plays a real one (planner, intake off) instead.
// SOCRATIC=1 (with REAL="Why is the sky blue?"): sections open with a question ("Ask me first"); the first is
// answered right (the section's own next sentence), the second wrong, the third "just explain"; checks that a right
// answer cuts beats, a wrong one plays the section as planned, and no question comes after "just explain".
//   BASE_URL=http://localhost:3006 LIVE_RUNS=<that server's experiments/live-runs> MODE=skip node scripts/e2e-quiz-cadence.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { speechWav } from "./fake-mic.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const DIR = process.env.LIVE_RUNS ?? join(process.cwd(), "experiments/live-runs");
const MODE = process.env.MODE ?? "answer";
const REAL = process.env.REAL ?? "";
const SOCRATIC = process.env.SOCRATIC === "1";
let openers = 0;
/** Socratic: per section's question, the answers to give, one per try. */
const SOCRATIC_PLAN = REAL
  ? [["I think it's because the sky reflects the blue of the ocean.", "@next"], ["Just explain it, stop asking me."]]
  : [["~Could you clarify the question?", "It's just plain white light, one single color.", "I still think white light is one color."], ["Just tell me."], ["About six times more, because of the fourth power."]];
const FIXTURE = process.env.FIXTURE ?? "why-is-the-sky-blue-quizzes";
const OUT = join(process.cwd(), "experiments/quiz", `cadence-${REAL ? "real" : MODE}`);
mkdirSync(OUT, { recursive: true });
const clipDir = join(process.cwd(), "experiments/conversation-e2e/clips");
// Named by the words too, so a cached clip never says something else; a longer lead-in so the first word is heard.
const clip = async (name, text) => readFileSync((await speechWav(join(clipDir, `${name}-${createHash("sha1").update(text).digest("hex").slice(0, 8)}.wav`), [{ silence: 0.6 }, { say: text }, { silence: 0.4 }])).path).toString("base64");
const t0 = Date.now();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const transcript = () => {
  // Only finished files: the log route writes a temp file and renames it.
  const f = readdirSync(DIR).filter((n) => n.endsWith(".json")).flatMap((n) => { try { return [{ n, m: statSync(join(DIR, n)).mtimeMs }]; } catch { return []; } }).filter((x) => x.m >= t0).sort((a, b) => b.m - a.m)[0];
  try {
    return f ? JSON.parse(readFileSync(join(DIR, f.n), "utf8")) : null;
  } catch {
    return null;
  }
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
// CONSOLE=1: the page's own log lines, to see why a lesson stopped.
if (process.env.CONSOLE === "1") page.on("console", (m) => console.log(`  [console.${m.type()}]`, m.text().slice(0, 240)));
const st = () =>
  page.evaluate(() => ({
    // No status line on the page any more: the board's data-status, named as the old status line was.
    status: ({ idle: "Listening", listening: "Listening", speaking: "Speaking", waiting: "Your turn", replying: "Thinking…", planning: "Planning…", done: "Done", paused: "Paused" })[document.querySelector(".tutor-board")?.dataset.status ?? ""] ?? "",
    mic: document.querySelector(".tutor-board")?.dataset.mic ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    marks: document.querySelectorAll('[data-testid^="quiz-mark-"]').length,
    done: !!document.querySelector('[data-testid="quiz-done"]'),
    learner: document.querySelector('[data-testid="learner"]')?.textContent?.trim() ?? "",
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
const sayText = async (name, text) => {
  const b = await clip(name, text);
  const sec = await page.evaluate((x) => window.__say(x), b);
  await page.waitForTimeout(sec * 1000 + 150);
  console.log(`  [said] "${text}"`);
};
const events = (kind, after = 0) => (transcript()?.events ?? []).filter((x) => x.kind === kind && x.t > after);
const waitEvent = async (kind, after, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = events(kind, after);
    if (e.length) return e[0];
    await page.waitForTimeout(400);
  }
  return null;
};
/** The first of several event kinds after `after`. */
const waitAny = async (kinds, after, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = (transcript()?.events ?? []).filter((x) => kinds.includes(x.kind) && x.t > after);
    if (e.length) return e[0];
    await page.waitForTimeout(400);
  }
  return null;
};
const stroke = async (box, pts) => {
  await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
  await page.mouse.up();
};
const circle = (cx, cy, r) => Array.from({ length: 25 }, (_, k) => [cx + r * Math.cos((k / 24) * 2 * Math.PI), cy + r * 1.5 * Math.sin((k / 24) * 2 * Math.PI)]);
const handled = [];
let lastLearner = "";
try {
  const q = REAL || "Why is the sky blue?";
  await page.goto(REAL ? `${BASE}/lesson?intake=0&debug=1` : `${BASE}/lesson?fixture=${FIXTURE}&intake=0&debug=1`);
  await page.click('[data-testid="start-talking"]');
  // The greeting plays first; the mic opens after it.
  await waitFor((s) => s.mic === "open", 30000);
  // No typing box any more: the question by voice.
  await page.waitForTimeout(1500);
  await sayText(`cadence-ask-${REAL ? "real" : "fixture"}`, q);
  let after = 0;
  const until = Date.now() + (REAL ? 900_000 : 600_000);
  while (Date.now() < until) {
    const start = await waitEvent("quiz-start", after, 15_000);
    if (!start) {
      if (events("end").length || (await st()).status === "Done") break;
      // The lesson plays on; a check-in waits for an answer.
      const s = await st();
      if (s.status === "Your turn" && !s.done && !s.marks) await sayText("cadence-ok", "Yes, that makes sense, keep going.");
      continue;
    }
    after = start.t;
    const k = handled.length;
    console.log(`        quiz ${k + 1}: ${start.quiz} on ${start.beatId}: "${start.ask}"`);
    await waitFor((s) => s.status === "Your turn", 40_000);
    await page.screenshot({ path: join(OUT, `${k + 1}-${start.quiz}-asked.png`) });
    if (start.quiz === "label") {
      const items = start.items ?? [];
      // REPEAT=1: first ask for the question again (no grade, it is asked again), then answer.
      if (process.env.REPEAT === "1") {
        await sayText("cadence-repeat", "Sorry, I totally missed the question. Could you repeat it?");
        const rep = await waitEvent("quiz-repeat", after, 30_000);
        console.log(`        repeat: ${JSON.stringify(rep && { said: rep.said })}`);
        await waitFor((s) => s.status === "Your turn", 40_000);
      }
      await sayText(`cadence-label-${MODE}`, MODE === "skip" ? "I don't know." : items.map((x) => `Number ${x.n} is the ${x.answer}.`).join(" ") || "I don't know.");
    } else if (start.socratic) {
      // The answers to give this question, one per try (a reframe asks again); "@next" is the section's own
      // next sentences from the beat list (?debug=1), a clearly right answer.
      const plan = SOCRATIC_PLAN[openers] ?? ["Just explain it, stop asking me."];
      openers++;
      let at = after;
      // "~..." asks for the question again (not a try): it is asked again, and the next answer follows.
      let graded = false;
      for (const [n, a] of plan.entries()) {
        if (graded) {
          const rf = await waitEvent("socratic-reframe", at, 60_000);
          console.log(`        reframe: ${JSON.stringify(rf && { verdict: rf.verdict, line: rf.line, ms: rf.ms })}`);
          if (!rf?.line) break;
          at = rf.t;
          await waitFor((s) => s.status === "Your turn", 40_000);
        }
        if (a.startsWith("~")) {
          await sayText(`socratic-${openers}-${n}`, a.slice(1));
          const rep = await waitEvent("quiz-repeat", at, 30_000);
          console.log(`        repeat: ${JSON.stringify(rep && { said: rep.said })}`);
          if (rep) at = rep.t;
          await waitFor((s) => s.status === "Your turn", 40_000);
          graded = false;
          continue;
        }
        graded = true;
        const next = await page.evaluate((id) => {
          const out = [];
          for (let li = document.querySelector(`[data-testid="beats"] li[data-beat-id="${id}"]`)?.nextElementSibling; li && out.length < 2; li = li.nextElementSibling) out.push((li.innerText ?? "").split("\n")[0]);
          return out.join(" ");
        }, start.beatId);
        await sayText(`socratic-${openers}-${n}`, a === "@next" ? `I think ${next.replace(/^[A-Z]/, (c) => c.toLowerCase())}` : a);
      }
      const out = await waitAny(["socratic-adjust", "socratic-off", "quiz-skipped"], after, 90_000);
      console.log(`        outcome: ${JSON.stringify(out && { kind: out.kind, verdict: out.verdict, try: out.try, cut: out.cut, how: out.how, said: out.said })}`);
      handled.push({ start, res: null });
      if (out) after = out.t;
      continue;
    } else if (start.quiz === "predict") {
      const right = REAL ? "I think it will follow from what you just showed, because of the same idea." : "About six times more, because of the fourth power.";
      await sayText(`cadence-predict-${REAL ? "real" : MODE}`, MODE === "skip" ? "I think they scatter the same amount." : right);
    } else {
      if (MODE === "skip") await sayText("cadence-sketch-skip", "Skip.");
      else {
        await waitFor((s) => s.done, 20_000);
        const box = await page.locator("canvas.ink").boundingBox();
        await stroke(box, circle(0.15, 0.7, 0.05));
        await stroke(box, [[0.21, 0.7], [0.45, 0.7], [0.42, 0.67], [0.45, 0.7], [0.42, 0.73]]);
        await stroke(box, circle(0.5, 0.7, 0.012));
        await stroke(box, [[0.52, 0.68], [0.56, 0.6], [0.6, 0.66], [0.64, 0.56], [0.68, 0.62]]);
        await page.click('[data-testid="quiz-done"]');
      }
    }
    const res = await waitEvent("quiz-result", after, 60_000);
    handled.push({ start, res });
    console.log(`        result: ${JSON.stringify(res && { quiz: res.quiz, score: res.score, verdict: res.verdict, skipped: res.skipped, feedback: res.feedback, ms: res.ms, model: res.model })}`);
    if (start.socratic) console.log(`        adjust: ${JSON.stringify(events("socratic-adjust", after).map((e) => ({ verdict: e.verdict, covered: e.covered, cut: e.cut, how: e.how })))}`);
    await page.screenshot({ path: join(OUT, `${k + 1}-${start.quiz}-graded.png`) });
    lastLearner = (await st()).learner;
    // The fixture's third quiz is its last beat.
    if (!REAL && handled.length >= 3) break;
  }
  await page.waitForTimeout(2000);
  lastLearner = (await st()).learner || lastLearner;
} catch (e) {
  console.log("ERROR", e.message);
}
await page.goto("about:blank").catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
const t = transcript();
const ev = (k) => t?.events.filter((e) => e.kind === k) ?? [];
const kinds = ev("quiz-start").map((e) => e.quiz);
const planned = ev("planned");
const quizBeats = planned.filter((e) => e.quiz).map((e) => `${e.beatId}:${e.quiz}`);
console.log(`        planned quizzes: ${quizBeats.join(" ") || "none"}; sections: ${planned.filter((e) => e.section).length}`);
console.log(`        asked: ${kinds.join(", ")}; skipped: ${ev("quiz-skipped").map((e) => e.quiz).join(", ") || "none"}`);
console.log(`        page record: ${lastLearner}`);
console.log(`        record quizzes: ${JSON.stringify((t?.learner?.quizzes ?? []).map((z) => ({ kind: z.kind, score: z.score, verdict: z.verdict, skipped: z.skipped })))}`);
console.log(`        confusions: ${JSON.stringify(t?.learner?.confusions ?? [])}`);
if (SOCRATIC) {
  const asked = ev("quiz-start").filter((e) => e.socratic);
  const adjust = ev("socratic-adjust");
  const off = ev("socratic-off")[0];
  const sections = planned.filter((e) => e.section).map((e) => e.beatId);
  console.log(`        openers asked: ${asked.map((e) => e.beatId).join(", ")}; skipped: ${JSON.stringify(ev("socratic-skipped").map((e) => `${e.beatId}: ${e.why}`))}; section starts: ${sections.join(", ")}`);
  const reframes = ev("socratic-reframe");
  const gap = ev("socratic-gap")[0];
  const reactions = ev("quiz-feedback").filter((e) => e.quiz === "predict").map((e) => e.text);
  const rec = (t?.learner?.quizzes ?? []).filter((z) => z.socratic);
  console.log(`        reactions: ${JSON.stringify(reactions)}`);
  console.log(`        reframes: ${JSON.stringify(reframes.map((e) => e.line))}; gap: ${JSON.stringify(gap?.line ?? null)}`);
  console.log(`        record: ${JSON.stringify(rec.map((z) => ({ verdict: z.verdict, skipped: z.skipped, tries: z.tries })))}`);
  console.log(`        confusions: ${JSON.stringify((t?.learner?.confusions ?? []).filter((c) => /quiz \(predict\)/.test(c)))}`);
  check("sections open with a setup and a question", asked.length >= 2 && asked.every((e) => /\?/.test(e.ask)), asked.map((e) => e.ask).join(" | "));
  check("a miss gets a reframe that ends with a question", reframes.length >= 1 && reframes.every((e) => /\?$/.test(e.line ?? "")), reframes.map((e) => e.line).join(" | "));
  check("no reaction or reframe names a verdict", [...reactions, ...reframes.map((e) => e.line ?? "")].every((x) => !/\b(you'?re right|that'?s right|right answer|wrong|correct|incorrect|exactly right)\b/i.test(x)));
  if (REAL) {
    check("a right answer on the second try shortens the section", adjust[0]?.verdict === "right" && adjust[0].try === 2 && adjust[0].cut.length > 0, JSON.stringify(adjust[0]));
    check("\"just explain\" stops the questions", !!off && !asked.some((e) => e.t > off.t), off ? `off at ${off.t}; later openers skipped: ${ev("socratic-skipped").filter((e) => e.t > off.t).length}` : "no socratic-off");
  } else {
    check("a clarify request is asked again, not graded", ev("quiz-repeat").some((e) => e.beatId === asked[0]?.beatId) && !ev("learner").some((e) => e.role === "socratic answer" && /clarify/i.test(e.text ?? "")));
    check("two misses: one reframe, then the gap named and the section taught", reframes.filter((e) => e.beatId === asked[0]?.beatId).length === 1 && !!gap?.line && adjust[0]?.try === 2 && adjust[0]?.how?.startsWith("the section teaches"), JSON.stringify({ gap: gap?.line, adjust: adjust[0] }));
    check("\"just tell me\" goes straight to teaching", ev("quiz-skipped").some((e) => e.socratic && e.beatId === asked[1]?.beatId) && !off && asked.length === 3);
    check("a right answer shortens the section", adjust.at(-1)?.verdict === "right" && adjust.at(-1).cut.length > 0, JSON.stringify(adjust.at(-1)));
  }
  check("the record has every try", rec.some((z) => (z.tries?.length ?? 0) >= 2) && rec.every((z) => (z.tries ?? []).every((x) => x.ask && x.answer && x.verdict)), JSON.stringify(rec.map((z) => z.tries?.length)));
} else {
  check("label, predict and sketch each came up once", ["label", "predict", "sketch"].every((k) => kinds.filter((x) => x === k).length === 1), kinds.join(", "));
  check("never the same kind twice in a row", kinds.every((k, i) => i === 0 || k !== kinds[i - 1]));
}
if (!REAL && !SOCRATIC) {
  if (MODE === "skip") {
    const p = ev("quiz-result").find((e) => e.quiz === "predict");
    check("the wrong prediction is graded wrong, in one line", p?.verdict === "wrong" && !!p.feedback && p.feedback.split(/(?<=[.!?])\s+/).length <= 2, `${p?.verdict}: ${p?.feedback}`);
    const skips = ev("quiz-skipped").map((e) => e.quiz);
    const lines = ev("quiz-result").filter((e) => e.skipped).map((e) => e.feedback);
    check("skip and \"I don't know\" move on, the answer told in one line", skips.includes("label") && skips.includes("sketch") && lines.length === 2, lines.join(" | "));
  } else {
    const p = ev("quiz-result").find((e) => e.quiz === "predict");
    check("the right prediction is graded right, in one line", p?.verdict === "right" && !!p.feedback, `${p?.verdict}: ${p?.feedback}`);
    check("label and sketch are graded", ev("quiz-result").filter((e) => (e.quiz === "label" || e.quiz === "sketch") && !e.skipped).length === 2);
  }
}
if (!SOCRATIC) check("the record has every quiz, and its lines in confusions", (t?.learner?.quizzes ?? []).length === kinds.length && (t?.learner?.confusions ?? []).filter((c) => c.startsWith("quiz (")).length >= Math.min(kinds.length, 3), `${(t?.learner?.quizzes ?? []).length} on the record`);
check("the page's record shows the quizzes", /quizzes: /.test(lastLearner), lastLearner);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; transcript ${t?.id}`);
