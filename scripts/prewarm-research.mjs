// Measures /api/research and fills experiments/research-cache for the demo questions, through the
// running dev server (lib/research/README.md). One question at a time.
//   node scripts/prewarm-research.mjs [port] --measure   cache off, real 8 s budget: per-question latency, median and worst
//   node scripts/prewarm-research.mjs [port]             cache off, 40 s budget: every question cached for the demo
// Then commit experiments/research-cache/*.json and put the numbers in lib/research/README.md.
const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3011";
const measure = process.argv.includes("--measure");
const base = `http://localhost:${port}`;
const QUESTIONS = [
  "what's new in CRISPR this month",
  "what changed in Python 3.14",
  "who won the 2026 Nobel in physics and for what",
  "what's the latest on the James Webb telescope",
  "what's new in battery technology",
  "what's the latest with quantum computers",
];

const walls = [];
let none = 0;
for (const question of QUESTIONS) {
  const t0 = Date.now();
  const rec = await fetch(`${base}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, wait: true, fresh: true, ...(measure ? {} : { budgetMs: 40_000 }) }),
  }).then((r) => r.json());
  const wall = Date.now() - t0;
  walls.push(wall);
  if (rec.status !== "ready") none++;
  console.log(`${question.padEnd(48)} ${String(rec.status).padEnd(5)} wall ${(wall / 1000).toFixed(1)} s  actor ${((rec.ms ?? 0) / 1000).toFixed(1)} s  ${rec.items?.length ?? 0} pages  ${(rec.items ?? []).map((i) => `${i.site}${i.published ? ` ${i.published}` : ""}`).join(", ")}${rec.error ? `  (${rec.error})` : ""}`);
  console.log(`${"".padEnd(48)} search: ${rec.query}`);
}
const sorted = [...walls].sort((a, b) => a - b);
const median = (sorted[2] + sorted[3]) / 2;
console.log(`\nmedian ${(median / 1000).toFixed(1)} s, worst ${(sorted.at(-1) / 1000).toFixed(1)} s, ${QUESTIONS.length - none}/${QUESTIONS.length} ready`);
