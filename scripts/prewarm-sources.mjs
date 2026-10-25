// Fills experiments/sources-cache for the demo questions through the running dev server, so the
// lesson's source cards come from disk on stage. Needs APIFY_TOKEN in .env.local.
// Run (dev server up):  node scripts/prewarm-sources.mjs [port] [--fresh]
// Then commit experiments/sources-cache/*.json and put the latencies in lib/sources/README.md.
const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3011";
const fresh = process.argv.includes("--fresh");
const base = `http://localhost:${port}`;
const QUESTIONS = ["what is photosynthesis", "why is the sky blue", "how do plants breathe", "what is an oxygen molecule", "how do vaccines work"];

async function one(question) {
  const t0 = Date.now();
  let rec = await fetch(`${base}/api/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, fresh }) }).then((r) => r.json());
  if (rec.status === "no-token") throw new Error("APIFY_TOKEN is not set: add it to .env.local and restart the dev server");
  while (rec.status === "running" && Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 2000));
    rec = await fetch(`${base}/api/sources/${encodeURIComponent(rec.id)}`).then((r) => r.json());
  }
  const sites = (rec.cards ?? []).map((c) => c.site).join(", ");
  console.log(`${question.padEnd(28)} ${String(rec.status).padEnd(7)} ${rec.cached ? "cached" : `actor ${((rec.ms ?? 0) / 1000).toFixed(1)} s via ${rec.mode}`}  ${rec.cards?.length ?? 0} cards  ${sites}${rec.error ? `  ${rec.error}` : ""}`);
  return rec;
}

// One at a time: the latencies are then each question's own, not a contended batch.
let failed = 0;
for (const q of QUESTIONS) {
  try {
    if ((await one(q)).status !== "ready") failed++;
  } catch (e) {
    console.error(`${q}: ${e.message}`);
    process.exit(1);
  }
}
process.exit(failed ? 1 : 0);
