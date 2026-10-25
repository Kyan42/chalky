// npx tsx --env-file=.env.local scripts/moss-build-blocks.ts
// Creates the Moss block index (one document per catalog block), or brings an existing one up to
// date: upserts every block and deletes every document that isn't a catalog block, so the index holds
// the catalog and nothing else (slow mode's learned blocks stay local: lib/blocks/learned.ts). Then loads it
// and runs one query, so a green run means the live app can use it. Free plan: 3 indexes, so the
// name stays fixed (MOSS_BLOCK_INDEX, default "chalky-blocks").
import { MossClient } from "@moss-js/moss";
import { BLOCKS } from "../lib/blocks";
import { BLOCK_INDEX, BLOCK_MODEL, blockDocs, hasMossKeys } from "../lib/moss/blocks";

if (!hasMossKeys()) {
  console.error("No MOSS_PROJECT_ID / MOSS_PROJECT_KEY in the environment. Add both to .env.local (portal.usemoss.dev: project id, API Keys page) and run with --env-file=.env.local.");
  process.exit(2);
}

async function main() {
  const client = new MossClient(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!);
  const docs = blockDocs();
  const t0 = performance.now();
  const since = () => `${Math.round(performance.now() - t0)} ms`;

  const existing = (await client.listIndexes()).find((i) => i.name === BLOCK_INDEX);
  if (!existing) {
    console.log(`creating "${BLOCK_INDEX}" with ${docs.length} blocks (${BLOCK_MODEL})...`);
    const job = await client.createIndex(BLOCK_INDEX, docs, { modelId: BLOCK_MODEL, onProgress: (p) => console.log(`  ${JSON.stringify(p)}`) });
    console.log(`  created: job ${job.jobId}, ${job.docCount} docs, ${since()}`);
  } else {
    console.log(`updating "${BLOCK_INDEX}" (${existing.docCount} docs, model ${existing.model?.id}, ${existing.status})...`);
    const job = await client.addDocs(BLOCK_INDEX, docs, { upsert: true });
    console.log(`  upserted ${job.docCount} docs, ${since()}`);
    const ids = new Set(BLOCKS.map((b) => b.id));
    const stale = (await client.getDocs(BLOCK_INDEX)).map((d) => d.id).filter((id) => !ids.has(id));
    if (stale.length) {
      await client.deleteDocs(BLOCK_INDEX, stale);
      console.log(`  deleted ${stale.length} stale docs: ${stale.join(", ")}`);
    }
  }

  // Wait until the index is ready to load (a build is a cloud job).
  for (let i = 0; ; i++) {
    const info = await client.getIndex(BLOCK_INDEX);
    if (info.status === "Ready") {
      console.log(`ready: ${info.docCount} docs (catalog has ${BLOCKS.length}), ${since()}`);
      break;
    }
    if (info.status === "Failed" || i > 90) throw new Error(`index ${BLOCK_INDEX} is ${info.status}`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const l0 = performance.now();
  await client.loadIndex(BLOCK_INDEX);
  console.log(`loaded in ${Math.round(performance.now() - l0)} ms`);
  const q0 = performance.now();
  const result = await client.query(BLOCK_INDEX, "sunlight falls on a leaf", { topK: 4 });
  console.log(`query in ${(performance.now() - q0).toFixed(1)} ms (moss says ${result.timeTakenInMs} ms): ${result.docs.map((d) => `${d.id} ${d.score.toFixed(3)}`).join(", ")}`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
