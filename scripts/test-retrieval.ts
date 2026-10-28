// npx tsx --env-file=.env.local scripts/test-retrieval.ts [--engine=local|moss]
// Beat briefs in the planner's words (biology, computing, chemistry), each with the block the
// drawer should get; the expected block must be in the engine's top 3. The keyword fallback
// (lib/blocks/catalog.ts, used while the engine loads) is scored on the same briefs at its live
// size, 5, for comparison. The local engine (default) needs lib/blocks/vectors.json
// (scripts/build-block-vectors.ts); --engine=moss needs the chalky-blocks index
// (scripts/moss-build-blocks.ts) and exits 2 (not 0) without Moss keys, so a missing key never
// reads as a pass.
import { keywordBlocks } from "../lib/blocks/catalog";
import { beatQuery, hasMossKeys, relevantBlocks } from "../lib/retrieval/blocks";

const engine = process.argv.find((a) => a.startsWith("--engine="))?.slice(9) === "moss" ? "moss" : "local";

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
  // Computing
  { visual: "Columns of nodes joined by weighted connections: an input layer, one hidden layer and an output.", adds: [{ id: "net", what: "a small neural network" }], want: "neural-net" },
  { visual: "The loss dropping as the model trains, step after step, flattening out.", want: "loss-curve" },
  { visual: "Each word looks back at the other words and weighs how much each one matters to it.", adds: [{ id: "focus", what: "words attending to each other" }], want: "attention" },
  { visual: "A row of numbered boxes in memory, index 0 on the left.", want: "array" },
  { visual: "Plates piled up: you push onto the top and pop from the top, last in first out.", want: "stack" },
  { visual: "The brain of the computer, a square chip with pins all round.", adds: [{ id: "processor", what: "the processor" }], want: "cpu" },
  { visual: "Information travels from your laptop to the box that sends it out to the internet.", adds: [{ id: "home-box", what: "the home router" }], want: "router" },
  // Chemistry
  { visual: "A carbon atom: six protons and six neutrons in the middle, electrons circling in two rings.", want: "atom" },
  { visual: "Two hydrogens bonded to one oxygen at an angle, the shape of a water molecule.", adds: [{ id: "h2o-model", what: "ball-and-stick water" }], want: "water-molecule" },
  { visual: "A glass beaker half full of a blue solution, bubbles rising.", want: "beaker" },
  { visual: "Heat the tube with a gas flame from below.", adds: [{ id: "burner", what: "the flame underneath" }], want: "bunsen-burner" },
  { visual: "The strip from 0 to 14, red acids on the left, purple alkalis on the right, a marker at 7.", want: "ph-scale" },
  { visual: "Reactants climb over a hump of activation energy and settle lower as products, giving out heat.", want: "energy-profile" },
  { visual: "Ice, water and steam: the particles packed tight, then sliding, then flying apart.", adds: [{ id: "states", what: "particles in a box" }], want: "particles" },
  { visual: "Sodium hands its outer electron to chlorine, making two charged ions that attract.", want: "ionic-bond" },
  { visual: "The grid of all the elements in rows and columns, with the noble gases on the far right.", want: "periodic-table" },
];

// The keyword fallback: no keys needed, so it always runs.
let keywordMisses = 0;
for (const c of cases) {
  const got = keywordBlocks(beatQuery({ visual: c.visual, adds: c.adds ?? [] }), 5).map((b) => b.id);
  if (!got.includes(c.want)) keywordMisses++;
  console.log(`${got.includes(c.want) ? "kw ok  " : "kw MISS"} want ${c.want.padEnd(15)} got ${got.join(", ")}`);
}
console.log(`keyword fallback: ${cases.length - keywordMisses} of ${cases.length} in its top 5\n`);

if (engine === "moss" && !hasMossKeys()) {
  console.error("SKIPPED: no MOSS_PROJECT_ID / MOSS_PROJECT_KEY (add both to .env.local and run with --env-file=.env.local).");
  process.exit(2);
}

async function main() {
  let failed = 0;
  const times: number[] = [];
  for (const c of cases) {
    const r = await relevantBlocks(beatQuery({ visual: c.visual, adds: c.adds ?? [] }), 3, { waitForLoad: true, force: true, engine });
    if (!r.hits) {
      console.error(`ERROR ${r.status}${r.error ? `: ${r.error}` : ""}`);
      process.exit(1);
    }
    times.push(r.ms);
    const ok = r.hits.some((h) => h.id === c.want);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  want ${c.want.padEnd(13)} got ${r.hits.map((h) => `${h.id} ${h.score.toFixed(3)}`).join(", ").padEnd(52)} ${r.ms} ms ${r.engineMs !== undefined ? `(moss says ${r.engineMs} ms)` : ""}  "${c.visual.slice(0, 60)}..."`);
  }
  times.sort((a, b) => a - b);
  console.log(`engine ${engine}`);
  console.log(`query latency: median ${times[Math.floor(times.length / 2)]} ms, max ${times[times.length - 1]} ms (each query, index already loaded)`);
  console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
