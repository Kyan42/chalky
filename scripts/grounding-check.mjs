// Checks how /api/converse handles a few learner turns on a saved plan, no audio:
// the level it chooses (and announces first), how many sentences it speaks, and
// whether an answer is grounded in board elements with cursor cues.
//   BASE_URL=http://localhost:3006 node scripts/grounding-check.mjs
import { readFileSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const f = JSON.parse(readFileSync("experiments/converse/fixtures/why-is-the-sky-blue-paced.json", "utf8"));
const beatsUpTo = (i) => f.beats.slice(0, i + 1).map((b) => ({ id: b.id, say: b.say, mode: b.mode }));
// The scene-1 board up to beat i, from the planner's own ids (the drawer's real ids may differ).
const boardUpTo = (i) => f.board.filter((e) => e.scene === f.beats[i].scene && f.beats.findIndex((b) => b.id === e.beat) <= i).map(({ id, label }) => ({ id, kind: "shape", label }));

const CASES = [
  { name: "question answerable from the board", beat: 1, word: 10, utterance: "wait, which one is the long wave again?", expect: "answer" },
  { name: "question needing a visual not on the board", beat: 1, word: 10, utterance: "hang on, what does an air molecule actually look like?", expect: "detour" },
  { name: "follow-up in the same spot", beat: 1, word: 10, utterance: "but why are they different lengths?", escalation: 1, expect: "detour" },
  { name: "correct summary at a check-in", beat: 3, word: -1, utterance: "so sunlight is all the colours mixed, red has long waves, blue has short ones, and the air molecules are tiny", expect: "confirm" },
  { name: "summary with a slip at a check-in", beat: 3, word: -1, utterance: "okay so red light has the short waves and blue the long ones, and air is made of tiny molecules", expect: "confirm|answer" },
];

const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
let pass = 0;
for (const c of CASES) {
  const body = { utterance: c.utterance, question: f.question, beats: beatsUpTo(c.beat), beatIndex: c.beat, wordIndex: c.word, board: boardUpTo(c.beat), history: [], escalation: c.escalation ?? 0 };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/converse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let level = null, levelMs = null, said = [], trailer = null, modelCues = null;
  for (const line of (await res.text()).trim().split("\n")) {
    const ev = JSON.parse(line);
    if (ev.type === "level") (level = ev.level), (levelMs = ev.tMs);
    else if (ev.type === "sentence") said.push(ev.text);
    else if (ev.type === "trailer") (trailer = ev.trailer), (modelCues = ev.modelCues);
  }
  const text = said.join(" ");
  const ok = new RegExp(`^(${c.expect})$`).test(trailer?.level) && sentences(text) <= 2 && (trailer?.level !== "answer" || trailer.cursor.length > 0);
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: "${c.utterance}"`);
  console.log(`      announced ${level} at ${levelMs} ms; final ${trailer?.level}/${trailer?.resume}; ${sentences(text)} sentence(s); cues kept ${JSON.stringify(trailer?.cursor.map((x) => `${x.gesture} ${x.target}@${x.word}`))} (model gave ${modelCues?.length ?? 0}); ${Date.now() - t0} ms in all`);
  console.log(`      "${text}"`);
}
console.log(`\n${pass}/${CASES.length} passed`);
