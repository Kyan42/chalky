// One scripted lesson through the interactive pieces: a pen circle on the board and "what is this?",
// then follow-up questions that each need one new small thing (a sketch, placed where it belongs), until
// the board runs out of room and zooms out. Saves a frame every second and one after each reply.
//   BASE_URL=http://localhost:3006 node scripts/e2e-ink-sketch-zoom.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const RUN = process.env.RUN ?? `run-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
const OUT = join(process.cwd(), "experiments/ink-sketch-zoom", RUN);
mkdirSync(OUT, { recursive: true });
const QUESTIONS = (process.env.QUESTIONS ?? "Where would violet light fit next to these waves?|How big is an air molecule compared to the blue wave?|Where does the scattered blue light go after it bounces?|Where would the ocean be in this picture?|And where would the clouds be?|Where is your eye looking up from?").split("|");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (/^\[(ink|sketch|board|converse|detour)\]/.test(t)) {
    logs.push(t);
    console.log(`        ${t.slice(0, 200)}`);
  }
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const converse = [];
let repliesDone = 0;
page.on("requestfinished", (r) => new URL(r.url()).pathname === "/api/converse" && repliesDone++);
page.on("request", (r) => {
  if (new URL(r.url()).pathname !== "/api/converse") return;
  try {
    const b = JSON.parse(r.postData() ?? "{}");
    converse.push({ utterance: b.utterance, ink: b.ink ? { marks: b.ink.marks, loose: b.ink.loose, image: !!b.ink.image } : null });
  } catch {}
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const st = () =>
  page.evaluate(() => ({
    status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? "",
    beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
    word: [...document.querySelectorAll(".caption .word")].findIndex((w) => w.dataset.state === "now"),
    level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
    turn: Number(document.querySelector('[data-testid="last-level"]')?.dataset.turn ?? 0),
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
let frame = 0;
const frames = setInterval(() => void page.screenshot({ path: join(OUT, `f${String(frame++).padStart(4, "0")}.png`) }).catch(() => {}), 1000);
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const ask = async (text) => {
  await page.fill('[data-testid="question"]', text);
  await page.click('[data-testid="ask"]');
};
/** The next turn has settled: the reply was spoken and the lesson waits or goes on. */
const replyDone = async () => {
  const n = (await st()).turn;
  return waitFor((s) => s.turn > n && !/Thinking/i.test(s.status), 90000);
};

try {
  await page.goto(`${BASE}/lesson?fixture=why-is-the-sky-blue-paced&beats=12&intake=0`);
  await ask("Why is the sky blue?");
  await page.click("body", { position: { x: 5, y: 400 } });
  await waitFor((s) => s.beat === "b2" && s.status === "Speaking" && s.word >= 6, 90000);
  await shot("01-before-ink");
  // 1. A pen circle around the middle of the drawing, then "what is this?".
  const box = await page.locator("canvas.ink").boundingBox();
  check("the pen is offered once something is drawn", !!box && (await page.locator('[data-testid="pen"]').count()) > 0);
  const cx = box.x + box.width * 0.42, cy = box.y + box.height * 0.45, r = box.height * 0.16;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let a = 0; a <= 2 * Math.PI + 0.3; a += 0.2) await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.8, { steps: 2 });
  await page.mouse.up();
  const afterPen = await st();
  check("drawing while Chalky talks pauses it (listening)", /^Paused/.test(afterPen.status), afterPen.status);
  await shot("02-pen-circle");
  let prev = null;
  await ask("What is this?");
  let done = await replyDone(prev);
  prev = done?.level ?? prev;
  await shot("03-ink-answer");
  const inkAsk = converse.find((c) => c.utterance === "What is this?");
  check("the reply was told what the ink marks, with a picture", !!inkAsk?.ink && (inkAsk.ink.marks.length > 0 || inkAsk.ink.loose > 0) && inkAsk.ink.image, JSON.stringify(inkAsk?.ink));
  // 2. Follow-ups that need one new thing each: answers with sketches, and in the end a zoom-out.
  for (const [k, q] of QUESTIONS.entries()) {
    await waitFor((s) => /Your turn|Speaking/.test(s.status), 30000);
    await ask(q);
    done = await replyDone(prev);
    prev = done?.level ?? prev;
    await page.waitForTimeout(2500);
    await shot(`${String(k + 4).padStart(2, "0")}-after-${q.replace(/\W+/g, "-").slice(0, 30)}`);
    console.log(`  [${q}] -> ${done?.level ?? "no reply"}`);
    if (k === 0) check("the pen's ink is gone once the lesson moves on", (await page.locator('[data-testid="ink-clear"]').count()) === 0 || (await page.locator('[data-testid="ink-clear"]').isDisabled()));
  }
  const sketches = logs.filter((l) => /^\[sketch\] \d+ element/.test(l)).length;
  const zooms = logs.filter((l) => /zoomed out/.test(l));
  check("follow-ups were answered with sketches", sketches >= 2, `${sketches} sketches`);
  check("the board zoomed out when it ran out of room", zooms.length > 0, zooms.join(" | ") || "no zoom");
  const detours = logs.filter((l) => /escalated/.test(l));
  console.log(`        escalations: ${detours.length ? detours.join(" | ") : "none"}`);
} catch (e) {
  console.log("ERROR", e.message);
  await shot("error");
}
clearInterval(frames);
writeFileSync(join(OUT, "log.json"), JSON.stringify({ logs, converse }, null, 2));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; frames in ${OUT}`);
