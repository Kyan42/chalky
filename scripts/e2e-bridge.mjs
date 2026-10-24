// Plays a saved plan to its first check-in, answers "got it", and checks the bridge line is spoken
// (no model call) before the next beat. Frames every half second in experiments/conversation-e2e/<RUN>/.
//   FIXTURE=why-is-the-sky-blue-paced BEATS=5 node scripts/e2e-bridge.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const FIXTURE = process.env.FIXTURE ?? "why-is-the-sky-blue-paced";
const OUT = join(process.cwd(), "experiments/conversation-e2e", process.env.RUN ?? "bridge");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const calls = [];
page.on("request", (r) => /\/api\/(converse|amend|plan)/.test(r.url()) && calls.push(new URL(r.url()).pathname));
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1);
const st = () => page.evaluate(() => ({
  status: document.querySelector('[data-testid="status"]')?.textContent?.trim(),
  beat: document.querySelector('[data-testid="beats"] li[data-state="now"]')?.dataset.beatId ?? null,
  caption: document.querySelector('[data-testid="caption"]')?.textContent?.replace(/\s+/g, " ").trim(),
  level: document.querySelector('[data-testid="last-level"]')?.textContent ?? null,
}));
let frame = 0, last = "", on = true;
const film = (async () => { while (on) { const s = await st().catch(() => null); await page.screenshot({ path: join(OUT, `f${String(frame++).padStart(3, "0")}-${since()}s.png`) }).catch(() => {}); if (s) { const l = `${s.status} | ${s.beat} | ${s.caption?.slice(0, 90)}`; if (l !== last) console.log(`${since().padStart(5)} s  ${l}`); last = l; } await page.waitForTimeout(500); } })();
const waitFor = async (pred, ms) => { const until = Date.now() + ms; while (Date.now() < until) { const s = await st(); if (pred(s)) return s; await page.waitForTimeout(150); } return null; };
await page.goto(`${BASE}/lesson?fixture=${FIXTURE}&beats=${process.env.BEATS ?? 5}`);
await page.fill('[data-testid="question"]', "Why is the sky blue?");
await page.click('[data-testid="ask"]');
const check = await waitFor((s) => s.status === "Your turn", 240000);
console.log(`${since()} s  check-in reached at ${check?.beat}`);
await page.fill('[data-testid="question"]', "yeah got it");
await page.click('[data-testid="ask"]');
const tAns = Date.now();
const bridge = await waitFor((s) => /next|zoom|let's/i.test(s.caption ?? "") && s.status === "Speaking", 15000);
console.log(`${bridge ? "PASS" : "FAIL"}  bridge spoken ${bridge ? `${Date.now() - tAns} ms after answering: "${bridge.caption}"` : ""}`);
const next = await waitFor((s) => s.beat && s.beat !== check?.beat && s.status === "Speaking", 60000);
console.log(`${next ? "PASS" : "FAIL"}  next beat ${next?.beat} starts after the bridge; ${next?.level}`);
await page.waitForTimeout(2000);
on = false; await film; await browser.close();
console.log(`model calls: ${calls.filter((c) => c !== "/api/plan").length} (${calls.join(", ") || "none"}); ${frame} frames in ${OUT}`);
