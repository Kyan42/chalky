// One call per role through the app's own routes, on whichever provider the dev server runs (MODEL_PROVIDER):
// the converse reply (actions line, speech, trailer), the intake question, a draw against its schema, a quiz
// grade. Prints what came back and whether it parsed, plus each call log's model and timings.
//   BASE_URL=http://localhost:3006 node experiments/provider-smoke.mjs
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const post = (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ndjson = async (r) => (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const callLine = (c) => (c ? `${c.model} first ${c.ttftMs ?? "–"} ms, total ${c.totalMs} ms, attempts ${c.attempts?.map((a) => a.status).join("/")}${c.error ? `, error ${c.error}` : ""}` : "(no call log)");

// 1. The first turn: a lesson to start, with its intake question.
{
  const ev = await ndjson(await post("/api/converse", { utterance: "Can you teach me how photosynthesis works?", question: "", beats: [], beatIndex: -1, wordIndex: -1, board: [], history: [], escalation: 0 }));
  const sentences = ev.filter((e) => e.type === "sentence").map((e) => e.text);
  const actions = ev.find((e) => e.type === "actions");
  const trailer = ev.find((e) => e.type === "trailer");
  const done = ev.find((e) => e.type === "done");
  console.log(`converse: actions line ${JSON.stringify(actions?.names ?? null)}; said ${JSON.stringify(sentences)}`);
  console.log(`  trailer actions ${JSON.stringify(trailer?.trailer?.actions?.map((a) => a.type))}; lesson ${JSON.stringify(trailer?.trailer?.lesson?.question ?? null)}; fell back ${done?.fellBack}; ${callLine(done?.calls?.at(-1))}`);
  console.log(`  ${actions && trailer?.trailer?.lesson ? "OK" : "PROBLEM"}: ${actions ? "actions line read" : "no actions line"}, ${trailer?.trailer?.lesson ? "start_lesson in the trailer" : "no lesson in the trailer"}`);
}

// 2. The intake question.
{
  const r = await (await post("/api/converse", { intent: "intake_ask", question: "Why is the sky blue?" })).json();
  console.log(`intake ask: ${JSON.stringify(r.say)} (${r.kind}, ${r.model}); ${callLine(r.call)}`);
}

// 3. A draw, against its schema (a beat from the sky fixture).
{
  const f = JSON.parse(readFileSync("experiments/converse/fixtures/why-is-the-sky-blue-paced.json", "utf8"));
  for (const id of ["b1", "b6"]) {
    const beat = f.beats.find((b) => b.id === id);
    const r = await (await post("/api/draw", { question: "Why is the sky blue?", beat, earlier: f.beats.slice(0, f.beats.indexOf(beat)) })).json();
    console.log(`draw ${id}: ${r.error ?? "ok"}, ${r.elements?.length ?? 0} elements (${(r.elements ?? []).map((e) => e.kind).join(" ")}); ${callLine(r.calls?.[0])}`);
  }
}

// 4. A quiz grade (predict) and a label grade.
{
  const after = [{ say: "Seven hundred divided by four hundred fifty is about one and a half, and to the fourth power that is about six." }];
  const p = await (await post("/api/quiz", { kind: "predict", question: "Why is the sky blue?", ask: "How many times more does blue scatter than red?", answer: "About six times, because of the fourth power.", after })).json();
  console.log(`quiz predict: ${p.verdict} "${p.feedback}"; ${callLine(p.call)}`);
  const l = await (await post("/api/quiz", { kind: "label", question: "Why is the sky blue?", items: [{ n: 1, id: "sun", answer: "sun" }, { n: 2, id: "wave", answer: "light wave" }], answer: "Number one is the sun, two is the wave of light." })).json();
  console.log(`quiz label: score ${l.score} "${l.feedback}"; ${callLine(l.call)}`);
}
