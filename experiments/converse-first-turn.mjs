// The first turn on the conversation route, several times: the actions line the model wrote, what it said and
// the trailer's actions after cleaning. For checking format adherence on a provider (docs/openai.md).
//   BASE_URL=http://localhost:3006 N=3 node experiments/converse-first-turn.mjs "What's new in CRISPR this month?"
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const N = Number(process.env.N ?? 3);
const utterance = process.argv[2] ?? "What's new in CRISPR this month?";
let ok = 0;
for (let k = 0; k < N; k++) {
  const r = await fetch(`${BASE}/api/converse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ utterance, question: "", beats: [], beatIndex: -1, wordIndex: -1, board: [], history: [], escalation: 0 }) });
  const ev = (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const header = ev.find((e) => e.type === "actions")?.names ?? null;
  const said = ev.filter((e) => e.type === "sentence").map((e) => e.text).join(" ");
  const t = ev.find((e) => e.type === "trailer")?.trailer;
  const kinds = t?.actions?.map((a) => a.type) ?? [];
  const good = kinds.includes("start_lesson") && (!/new|latest|this (week|month)|20\d\d/i.test(utterance) || kinds.includes("research"));
  if (good) ok++;
  console.log(`${good ? "ok  " : "MISS"} actions line ${JSON.stringify(header)} | trailer ${JSON.stringify(kinds)} | ${JSON.stringify(said)}`);
}
console.log(`${ok}/${N} first turns started a lesson${/new|latest|this (week|month)|20\d\d/i.test(utterance) ? " with a lookup" : ""}`);
