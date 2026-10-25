// Measures the research fetch paths and fills experiments/research-cache for the demo topics,
// through the running dev server (lib/research/README.md).
//   node scripts/prewarm-research.mjs [port] --measure   each topic once per path (no cache writes), a latency table
//   node scripts/prewarm-research.mjs [port]             fresh fetch per topic on the default path, written to the cache
// Then commit experiments/research-cache/*.json and put the numbers in lib/research/README.md.
const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3011";
const measure = process.argv.includes("--measure");
const base = `http://localhost:${port}`;
const TOPICS = ["vision-language-action models", "LLM agents", "voice AI", "retrieval-augmented generation", "photosynthesis"];
const PATHS = measure ? ["apify-arxiv", "apify-rag", "arxiv-api"] : [undefined];

async function one(topic, only) {
  const t0 = Date.now();
  let rec = await fetch(`${base}/api/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, days: 14, fresh: true, only }) }).then((r) => r.json());
  while (rec.status === "running" && Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 1000));
    rec = await fetch(`${base}/api/research/${encodeURIComponent(rec.id)}`).then((r) => r.json());
  }
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `${topic.padEnd(32)} ${String(only ?? "default").padEnd(12)} ${String(rec.status).padEnd(7)} via ${String(rec.via).padEnd(12)} fetch ${((rec.ms ?? 0) / 1000).toFixed(1)} s (wall ${wall} s)  ${rec.papers?.length ?? 0} papers  ${rec.searchedDays}d${rec.error ? `  ${rec.error}` : ""}`,
  );
  return rec;
}

let failed = 0;
for (const topic of TOPICS) for (const only of PATHS) if ((await one(topic, only)).status !== "ready") failed++;
process.exit(failed ? 1 : 0);
