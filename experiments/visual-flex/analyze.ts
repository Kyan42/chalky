// Prints markdown tables from public/experiments/visual-flex/results.json.
//   npx tsx experiments/visual-flex/analyze.ts
import { readFileSync } from "node:fs";
import type { Generation } from "./generate";

const results = JSON.parse(readFileSync("public/experiments/visual-flex/results.json", "utf8")) as {
  generations: (Generation & { coverage?: { supported: boolean } | null })[];
};
const models = ["claude-opus-5-5", "claude-haiku-5-5"];
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const med = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const s = (ms: number) => (Number.isNaN(ms) ? "–" : (ms / 1000).toFixed(1));

console.log("| Level | Model | Median s to valid doc | p95 s | Max s | Median s to first token | Valid first try | Valid after repair | Median output tokens | Median input tokens | Coverage OK |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const level of [1, 2, 3, 4]) {
  for (const model of models) {
    const gs = results.generations.filter((g) => g.level === level && g.model === model);
    const ms = gs.filter((g) => g.msToValid != null).map((g) => g.msToValid!);
    const ttft = gs.map((g) => g.attempts[0]?.ttftMs).filter((x): x is number => x != null);
    const out = gs.map((g) => g.attempts.reduce((a, b) => a + b.outputTokens, 0));
    const inp = gs.map((g) => g.attempts.reduce((a, b) => a + b.inputTokens, 0));
    const cov = gs.filter((g) => g.coverage?.supported).length;
    const covKnown = gs.filter((g) => g.coverage != null).length;
    console.log(
      `| L${level} | ${model} | ${s(med(ms))} | ${s(quantile(ms, 0.95))} | ${s(Math.max(...ms))} | ${s(med(ttft))} | ${gs.filter((g) => g.firstTryValid).length}/${gs.length} | ${gs.filter((g) => g.finalValid).length}/${gs.length} | ${med(out)} | ${med(inp)} | ${covKnown ? `${cov}/${covKnown}` : "not run"} |`,
    );
  }
}

console.log("\nPer generation (seconds to valid doc; * = needed a repair; x = never valid):\n");
const beats = [...new Set(results.generations.map((g) => g.beat))];
console.log(`| Beat | ${[1, 2, 3, 4].flatMap((l) => models.map((m) => `L${l} ${m.includes("opus") ? "Opus" : "Haiku"}`)).join(" | ")} |`);
console.log(`|---|${"---|".repeat(8)}`);
for (const beat of beats) {
  const cells = [1, 2, 3, 4].flatMap((l) => models.map((m) => {
    const g = results.generations.find((x) => x.beat === beat && x.level === l && x.model === m);
    if (!g) return "–";
    if (!g.finalValid) return "x";
    return `${s(g.msToValid!)}${g.firstTryValid ? "" : "*"}`;
  }));
  console.log(`| ${beat} | ${cells.join(" | ")} |`);
}

console.log("\nErrors:\n");
for (const g of results.generations) {
  for (const [i, a] of g.attempts.entries()) if (a.error) console.log(`- ${g.beat} L${g.level} ${g.model} attempt ${i + 1} (${a.stopReason}): ${a.error.split("\n")[0].slice(0, 200)}`);
}
