// Time to first beat of the planner, measured on three questions per setup.
//   node --conditions=react-server --import tsx scripts/planner-bench.ts <setup>
// setups: opus (today), opus-title-first, sonnet-off (Sonnet 5.5, thinking off)
// Writes experiments/planner-bench/<setup>.json with every plan, for comparing quality by eye.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const setup = process.argv[2] ?? "opus";
if (setup === "opus-title-first") process.env.PLANNER_TITLE_FIRST = "1";
if (setup === "sonnet-off") {
  process.env.PLANNER_MODEL = "claude-sonnet-5-5";
  process.env.PLANNER_THINKING = "off";
}
async function main() {
const { planLesson } = await import("../lib/lesson/planner");

const QUESTIONS = ["How does photosynthesis work?", "Why is the sky blue?", "What is compound interest?"];
const out: Record<string, unknown>[] = [];
for (const q of QUESTIONS) {
  const t0 = performance.now();
  let titleMs: number | null = null, firstBeatMs: number | null = null, title = "";
  const beats: { id: string; mode: string; say: string; check: boolean; bridge?: string; section?: string }[] = [];
  let call: unknown = null;
  try {
    for await (const ev of planLesson(q, new AbortController().signal)) {
      if (ev.type === "title") (title = ev.title), (titleMs ??= Math.round(performance.now() - t0));
      else if (ev.type === "beat") {
        firstBeatMs ??= Math.round(performance.now() - t0);
        beats.push({ id: ev.beat.id, mode: ev.beat.mode, say: ev.beat.say, check: ev.beat.check, bridge: ev.beat.bridge, section: ev.beat.section });
      } else if (ev.type === "done") call = ev.call;
    }
  } catch (e) {
    console.log(`  ${q}: ERROR ${(e as Error).message}`);
  }
  const totalMs = Math.round(performance.now() - t0);
  const c = call as { ttftMs?: number; retries?: number; model?: string } | null;
  const words = beats.map((b) => b.say.split(/\s+/).length).sort((a, b) => a - b);
  console.log(`${setup.padEnd(17)} ${q.padEnd(32)} first token ${String(c?.ttftMs).padStart(6)} ms  title ${String(titleMs).padStart(6)} ms  first beat ${String(firstBeatMs).padStart(6)} ms  total ${String(totalMs).padStart(6)} ms  ${beats.length} beats, median ${words[Math.floor(words.length / 2)]} words, ${beats.filter((b) => b.check).length} check-ins (${beats.filter((b) => b.check && b.bridge).length} with bridge), retries ${c?.retries}`);
  out.push({ question: q, title, titleMs, firstBeatMs, totalMs, call, beats });
}
mkdirSync(join(process.cwd(), "experiments/planner-bench"), { recursive: true });
writeFileSync(join(process.cwd(), "experiments/planner-bench", `${setup}.json`), JSON.stringify(out, null, 2));
}
void main();
