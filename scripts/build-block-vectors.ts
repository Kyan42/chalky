// npx tsx scripts/build-block-vectors.ts          (re)computes lib/blocks/vectors.json
// npx tsx scripts/build-block-vectors.ts --check  fails if any block's vector is missing or stale
//
// The local retrieval engine (lib/retrieval) searches the block catalog by these vectors: one per
// block, from its search text (lib/retrieval/docs.ts blockDoc) and the local model
// (lib/retrieval/embed.ts). Rerun after adding or editing blocks; only changed blocks are embedded.
// `npm run build` runs the check first, so a block without a current vector stops the build.
import { writeFileSync } from "node:fs";
import { BLOCKS } from "../lib/blocks";
import { blockDoc, docHash } from "../lib/retrieval/docs";
import { EMBED_STAMP, loadEmbedder, toBase64 } from "../lib/retrieval/embed";
import { readVectorFile, VECTORS_FILE, type VectorFile } from "../lib/retrieval/local-blocks";

async function main() {
  const check = process.argv.includes("--check");
  const file = readVectorFile();
  const sameModel = file?.model === EMBED_STAMP;
  const docs = BLOCKS.map(blockDoc);
  const todo = docs.filter((d) => !sameModel || file?.blocks[d.id]?.hash !== docHash(EMBED_STAMP, d.text));
  const ids = new Set(docs.map((d) => d.id));
  const extra = Object.keys(file?.blocks ?? {}).filter((id) => !ids.has(id));

  if (check) {
    if (!file) fail(`${VECTORS_FILE} is missing.`);
    if (!sameModel) fail(`${VECTORS_FILE} was built with ${file!.model}, the engine uses ${EMBED_STAMP}.`);
    if (todo.length) fail(`${todo.length} of ${docs.length} blocks have no current vector: ${todo.map((d) => d.id).join(", ")}.`);
    console.log(`block vectors ok: ${docs.length} blocks, ${EMBED_STAMP}${extra.length ? ` (${extra.length} vectors for removed blocks, harmless)` : ""}`);
    return;
  }

  const t0 = performance.now();
  const embed = await loadEmbedder();
  const loadMs = Math.round(performance.now() - t0);
  const out: VectorFile = { model: EMBED_STAMP, dim: 0, blocks: {} };
  for (const d of docs) if (sameModel && file!.blocks[d.id] && !todo.includes(d)) out.blocks[d.id] = file!.blocks[d.id];
  const t1 = performance.now();
  for (let i = 0; i < todo.length; i += 32) {
    const batch = todo.slice(i, i + 32);
    const vectors = await embed(batch.map((d) => d.text));
    batch.forEach((d, j) => (out.blocks[d.id] = { hash: docHash(EMBED_STAMP, d.text), v: toBase64(vectors[j]) }));
  }
  const embedMs = performance.now() - t1;
  out.dim = Buffer.from(Object.values(out.blocks)[0]?.v ?? "", "base64").length / 4;
  // Sorted by id, one block per line: a changed block is a one-line diff.
  const lines = Object.keys(out.blocks)
    .sort()
    .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(out.blocks[id])}`);
  writeFileSync(VECTORS_FILE, `{\n  "model": ${JSON.stringify(out.model)},\n  "dim": ${out.dim},\n  "blocks": {\n${lines.join(",\n")}\n  }\n}\n`);
  console.log(`model ${EMBED_STAMP} loaded in ${loadMs} ms; embedded ${todo.length} of ${docs.length} blocks in ${Math.round(embedMs)} ms${todo.length ? ` (${(embedMs / todo.length).toFixed(1)} ms a block)` : ""}; wrote ${VECTORS_FILE}`);
}

function fail(message: string): never {
  console.error(`\nBLOCK VECTORS OUT OF DATE: ${message}\nRun: npx tsx scripts/build-block-vectors.ts\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
