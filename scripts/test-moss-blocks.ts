// npx tsx --env-file=.env.local scripts/test-moss-blocks.ts
// Ten beat briefs in the planner's words, each with the block the drawer should get; the
// expected block must be in Moss's top 3. Exits 2 (not 0) when there are no Moss keys, so a
// missing key never reads as a pass. Build the index first: scripts/moss-build-blocks.ts.
import { beatQuery, hasMossKeys, relevantBlocks } from "../lib/moss/blocks";

type Case = { visual: string; adds?: { id: string; what: string }[]; want: string };

// Briefs written from the beats of the recorded "how do plants eat" run
// (experiments/live-runs/20261025000621-*.json) and the other lessons the catalog serves.
const cases: Case[] = [
  { visual: "A plant as a food factory: the sun in the corner shining on a plant, arrows of light, water and air going in, sugar coming out.", adds: [{ id: "factory", what: "the plant as a food factory" }], want: "plant" },
  { visual: "Sunlight lands on the leaves: rays from the sun down to the leaf surface.", adds: [{ id: "light", what: "sunlight shining down" }], want: "sun" },
  { visual: "Side view of a leaf; carbon dioxide molecules drift in through tiny holes on the underside.", adds: [{ id: "gas-in", what: "carbon dioxide drifting in" }], want: "co2" },
  { visual: "Root hairs soak water up from the soil and it climbs the stem to the leaves; a few water molecules travel up.", want: "h2o" },
  { visual: "The leftover oxygen floats out of the leaf into the air we breathe.", adds: [{ id: "out", what: "oxygen leaving the leaf" }], want: "o2" },
  { visual: "The plant joins the pieces into a sugar ring, its stored food.", adds: [{ id: "sugar", what: "the sugar the plant builds" }], want: "glucose" },
  { visual: "Zoom into one animal cell: the outer membrane, the nucleus in the middle holding the instructions.", want: "cell" },
  { visual: "The powerhouse organelle that burns sugar with oxygen to release usable energy, with its folded inner membrane.", want: "mitochondrion" },
  { visual: "The twisted ladder that carries genes, with base pairs as its rungs.", want: "dna" },
  { visual: "A nerve cell passing a signal: dendrites on the left, a long axon, terminals on the right.", want: "neuron" },
];

if (!hasMossKeys()) {
  console.error("SKIPPED: no MOSS_PROJECT_ID / MOSS_PROJECT_KEY (add both to .env.local and run with --env-file=.env.local).");
  process.exit(2);
}

let failed = 0;
const times: number[] = [];
for (const c of cases) {
  const r = await relevantBlocks(beatQuery({ visual: c.visual, adds: c.adds ?? [] }), 3, { waitForLoad: true, force: true });
  if (!r.hits) {
    console.error(`ERROR ${r.status}${r.error ? `: ${r.error}` : ""}`);
    process.exit(1);
  }
  times.push(r.ms);
  const ok = r.hits.some((h) => h.id === c.want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  want ${c.want.padEnd(13)} got ${r.hits.map((h) => `${h.id} ${h.score.toFixed(3)}`).join(", ").padEnd(52)} ${r.ms} ms (moss ${r.mossMs ?? "?"} ms)  "${c.visual.slice(0, 60)}..."`);
}
times.sort((a, b) => a - b);
console.log(`query latency: median ${times[Math.floor(times.length / 2)]} ms, max ${times[times.length - 1]} ms (first query included)`);
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
