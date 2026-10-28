// Per-role model timings from lesson transcripts: every call log in them (converse, plan, amend, draw, layout,
// intake, quiz, delegate…), grouped by role and provider, with the median time to first token and total time.
// Prints a markdown table (the one in docs/openai.md).
//   node scripts/call-timings.mjs experiments/live-runs/<a>.json experiments/live-runs/<b>.json …
//   node scripts/call-timings.mjs --since 2026-10-28T06:00 [--dir experiments/live-runs]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "experiments/live-runs";
const since = args.includes("--since") ? Date.parse(args[args.indexOf("--since") + 1]) : null;
const files = since !== null
  ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)).filter((f) => statSync(f).mtimeMs >= since)
  : args.filter((a) => a.endsWith(".json"));

/** Every object in the transcript that looks like a call log ({name, model, ttftMs, totalMs, attempts}). */
function* callsIn(x) {
  if (!x || typeof x !== "object") return;
  if (Array.isArray(x)) {
    for (const y of x) yield* callsIn(y);
    return;
  }
  if (typeof x.name === "string" && typeof x.model === "string" && "totalMs" in x && Array.isArray(x.attempts)) {
    yield x;
    return;
  }
  for (const v of Object.values(x)) yield* callsIn(v);
}

const role = (name) => name.replace(/:.*$/, "").replace(/^quiz-.*/, (q) => q).replace(/^socratic-.*/, "socratic");
const provider = (model) => (/^(gpt-|o\d|chatgpt-)/i.test(model) ? "openai" : "anthropic");
const median = (xs) => {
  const v = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

const groups = new Map();
const seen = new Set();
for (const f of files) {
  let t;
  try {
    t = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    continue;
  }
  for (const c of callsIn(t)) {
    // The same call can be logged twice (an event and the beat timing): count it once.
    const id = `${f}|${c.attempts?.[0]?.requestId ?? ""}|${c.name}|${c.totalMs}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = `${role(c.name)}|${provider(c.model)}`;
    if (!groups.has(key)) groups.set(key, { role: role(c.name), provider: provider(c.model), models: new Set(), ttft: [], total: [], errors: 0, retries: 0, queued: [] });
    const g = groups.get(key);
    g.models.add(c.model);
    g.ttft.push(c.ttftMs);
    g.total.push(c.totalMs);
    if (c.error) g.errors++;
    g.retries += c.retries ?? 0;
    if (c.queuedMs) g.queued.push(c.queuedMs);
  }
}

const roles = [...new Set([...groups.values()].map((g) => g.role))].sort();
const cell = (g, k) => (g ? `${median(g[k]) ?? "–"}` : "–");
console.log(`From ${files.length} transcript(s).\n`);
console.log("| role | Anthropic model | first token (ms) | total (ms) | n | OpenAI model | first token (ms) | total (ms) | n |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of roles) {
  const a = groups.get(`${r}|anthropic`);
  const o = groups.get(`${r}|openai`);
  console.log(`| ${r} | ${a ? [...a.models].join(", ") : "–"} | ${cell(a, "ttft")} | ${cell(a, "total")} | ${a?.total.length ?? 0} | ${o ? [...o.models].join(", ") : "–"} | ${cell(o, "ttft")} | ${cell(o, "total")} | ${o?.total.length ?? 0} |`);
}
const notes = [...groups.values()].filter((g) => g.errors || g.retries || g.queued.length);
if (notes.length) {
  console.log("");
  for (const g of notes) console.log(`- ${g.role} (${g.provider}): ${g.errors} error(s), ${g.retries} retr${g.retries === 1 ? "y" : "ies"}${g.queued.length ? `, ${g.queued.length} held by the draw cap (median ${median(g.queued)} ms)` : ""}`);
}
