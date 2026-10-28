// npx tsx --env-file=.env.local scripts/bench-retrieval.ts
// Timings for docs/retrieval.md: the local engine's model load, embedding time per doc, memory, and
// query medians for blocks, a board and a learner's memory, next to Moss's on the same queries when
// both MOSS_* keys are set. Engines run interleaved (local, moss, local, moss…) so background load on
// the machine hits both alike. For a cold load, point RETRIEVAL_CACHE_DIR at an empty folder.
import { BLOCKS } from "../lib/blocks";
import { beatQuery, relevantBlocks } from "../lib/retrieval/blocks";
import { blockDoc, hasMossKeys } from "../lib/retrieval/docs";
import { CACHE_DIR, loadEmbedder } from "../lib/retrieval/embed";
import { searchDocs, upsertDocs } from "../lib/retrieval/session";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
const fmt = (a: number[]) => `median ${median(a).toFixed(1)} ms, p95 ${p95(a).toFixed(1)} ms (n=${a.length})`;
const mb = () => Math.round(process.memoryUsage().rss / 1e6);

const BRIEFS = [
  "Sunlight lands on the leaves: rays from the sun down to the leaf surface.",
  "Side view of a leaf; carbon dioxide molecules drift in through tiny holes on the underside.",
  "Zoom into one animal cell: the outer membrane, the nucleus in the middle.",
  "Columns of nodes joined by weighted connections: an input layer, one hidden layer and an output.",
  "A row of numbered boxes in memory, index 0 on the left.",
  "A carbon atom: six protons and six neutrons in the middle, electrons circling in two rings.",
  "A glass beaker half full of a blue solution, bubbles rising.",
  "The strip from 0 to 14, red acids on the left, purple alkalis on the right.",
].map((visual) => beatQuery({ visual, adds: [] }));

const BOARD = [
  ["sun", "Sun", "The sun gives the light that powers it all."],
  ["leaf", "Leaf", "The leaf catches the light and takes in carbon dioxide."],
  ["co2-in", "CO2", "Carbon dioxide drifts in through the stomata."],
  ["roots", "Roots", "Water comes up from the roots."],
  ["chloroplast", "Chloroplast", "Inside the leaf cells, chloroplasts hold the chlorophyll."],
  ["glucose", "Glucose", "The plant builds sugar, its food."],
  ["o2-out", "Oxygen", "The leftover oxygen floats out of the leaf."],
  ["equation", "Equation", "Six carbon dioxide plus six water make glucose and oxygen."],
].map(([id, label, said]) => ({ id, text: `${label} (${id.replace(/[-_.]/g, " ")}). Scene 1. ${said}`, meta: { label, scene: "1", said } }));
const BOARD_ASKS = ["what is the sugar for?", "why does it need sunlight", "where does the oxygen go", "what are the holes in the leaf", "can you explain the equation again", "what do the roots do"];

const MEMORY = [
  "got stuck on: why plants need light if they don't eat it",
  "already knew: plants are green",
  "wanted: how plants make food",
  "quiz (photosynthesis) 2026-10-27: 50%, got the inputs, missed where oxygen comes from",
  "earlier lesson 'How Plants Make Their Food': got stuck on chlorophyll",
  "got stuck on: the difference between respiration and photosynthesis",
].map((text, i) => ({ id: `m${i}`, text, meta: { kind: "line" } }));
const MEMORY_ASKS = ["why does the plant need light", "is this like breathing", "what is chlorophyll again", "where does the oxygen come from"];

async function sessionTimes(engine: "local" | "moss", name: string, docs: typeof BOARD, asks: string[], rounds: number) {
  process.env.RETRIEVAL_ENGINE = engine;
  const t0 = performance.now();
  await upsertDocs(name, docs);
  // A Moss session is made in the background; wait for it before timing queries.
  for (let i = 0; i < 100 && (await searchDocs(name, asks[0])).status !== engine; i++) await new Promise((r) => setTimeout(r, 100));
  const upsertMs = performance.now() - t0;
  const times: number[] = [];
  const statuses = new Set<string>();
  for (let r = 0; r < rounds; r++)
    for (const q of asks) {
      const s = await searchDocs(name, q);
      times.push(s.ms);
      statuses.add(s.status);
    }
  return { upsertMs, times, statuses: [...statuses].join(",") };
}

async function main() {
  const moss = hasMossKeys();
  console.log(`cache ${CACHE_DIR}; Moss comparison: ${moss ? "yes" : "no (no MOSS_* keys)"}\n`);

  const rss0 = mb();
  let t = performance.now();
  const embed = await loadEmbedder();
  console.log(`model load (load + first sentence): ${Math.round(performance.now() - t)} ms; rss ${rss0} -> ${mb()} MB`);

  const singles: number[] = [];
  for (const d of [...BOARD, ...MEMORY]) {
    t = performance.now();
    await embed([d.text]);
    singles.push(performance.now() - t);
  }
  console.log(`embed one board/memory line: ${fmt(singles)}`);
  const blockTexts = BLOCKS.slice(0, 64).map((b) => blockDoc(b).text);
  t = performance.now();
  await embed(blockTexts);
  console.log(`embed block docs in a batch of 64: ${((performance.now() - t) / 64).toFixed(1)} ms a block`);

  // Blocks: each brief through relevantBlocks, engines interleaved.
  const blocks: Record<string, number[]> = { local: [], moss: [] };
  for (let r = 0; r < 4; r++)
    for (const q of BRIEFS)
      for (const engine of moss ? (["local", "moss"] as const) : (["local"] as const)) {
        const res = await relevantBlocks(q, 5, { waitForLoad: true, force: true, engine });
        if (res.status === "ok") blocks[engine].push(res.ms);
      }
  console.log(`\nblocks, local: ${fmt(blocks.local)}`);
  if (moss) console.log(`blocks, moss:  ${fmt(blocks.moss)}`);

  for (const engine of moss ? (["local", "moss"] as const) : (["local"] as const)) {
    const b = await sessionTimes(engine, `board-bench-${engine}-${Date.now()}`, BOARD, BOARD_ASKS, 4);
    console.log(`board (${BOARD.length} docs), ${engine}: index ${Math.round(b.upsertMs)} ms; query ${fmt(b.times)}; status ${b.statuses}`);
    const m = await sessionTimes(engine, `learner-bench-${engine}-${Date.now()}`, MEMORY, MEMORY_ASKS, 5);
    console.log(`memory (${MEMORY.length} lines), ${engine}: index ${Math.round(m.upsertMs)} ms; query ${fmt(m.times)}; status ${m.statuses}`);
  }
  console.log(`\nrss at the end: ${mb()} MB`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
