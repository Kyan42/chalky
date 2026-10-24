// Measures the fast reply route, /api/converse, against real lesson plans.
//
//   npm run dev                                   # in another terminal
//   node scripts/converse-bench.mjs capture       # once: plan three lessons via /api/plan, save fixtures
//   node scripts/converse-bench.mjs               # run the canned interruptions, print the table
//   node scripts/converse-bench.mjs abort         # check that a second request aborting the first works
//
// Options: BASE_URL (default http://localhost:3004), ROUNDS (repeat the whole set, default 1),
// NO_TTS=1 (skip the Sonic leg). Fixtures live in experiments/converse/fixtures/; a plan's board
// elements are derived from each draw beat's `adds` (id + what), since the drawer isn't run here.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";
const FIXTURES = join(process.cwd(), "experiments/converse/fixtures");
const QUESTIONS = ["Why is the sky blue?", "How does a bicycle stay upright?", "What is compound interest?"];

const slug = (q) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function* ndjson(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (pending.trim()) yield JSON.parse(pending);
}

const post = (path, body, signal) =>
  fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

async function capture() {
  mkdirSync(FIXTURES, { recursive: true });
  for (const question of QUESTIONS) {
    process.stdout.write(`planning "${question}" … `);
    const t0 = Date.now();
    const res = await post("/api/plan", { question });
    if (!res.ok) throw new Error(`plan failed (${res.status})`);
    let title = "";
    const beats = [];
    for await (const ev of ndjson(res)) {
      if (ev.type === "title") title = ev.title;
      else if (ev.type === "beat") beats.push(ev.beat);
      else if (ev.type === "error") throw new Error(ev.message);
    }
    // The board as the planner laid it out: every id a draw beat adds, labelled by what it is.
    const board = beats.flatMap((b) => b.adds.map((a) => ({ id: a.id, kind: "element", label: a.what, scene: b.scene, beat: b.id })));
    const fixture = { question, title, capturedAt: new Date().toISOString(), planMs: Date.now() - t0, beats, board };
    writeFileSync(join(FIXTURES, `${slug(question)}.json`), JSON.stringify(fixture, null, 2));
    console.log(`${beats.length} beats, ${board.length} elements, ${((Date.now() - t0) / 1000).toFixed(1)} s → ${slug(question)}.json`);
  }
}

function loadFixtures() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error(`no fixtures in ${FIXTURES}; run: node scripts/converse-bench.mjs capture`);
  return Object.fromEntries(files.map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(FIXTURES, f), "utf8"))]));
}

/** The lesson context the browser would send: beats so far, the board of the current scene, where Chalky stopped. */
function contextFor(fixture, beatIndex, wordIndex) {
  const beats = fixture.beats.slice(0, Math.max(beatIndex + 1, 1)).map((b) => ({ id: b.id, say: b.say, mode: b.mode }));
  const scene = fixture.beats[beatIndex]?.scene ?? 1;
  const board = fixture.board.filter((e) => e.scene === scene && fixture.beats.findIndex((b) => b.id === e.beat) <= beatIndex).map(({ id, kind, label }) => ({ id, kind, label }));
  return { question: fixture.question, beats, beatIndex, wordIndex, board };
}

/** Canned interruptions: [fixture slug index, utterance, beat index, word index (-1: at a check-in), escalation, history]. */
const INTERRUPTIONS = [
  [0, "yeah ok keep going", 1, -1, 0, []],
  [0, "wait, why does blue scatter more than red?", 1, 6, 0, []],
  [0, "I still don't really get it", 1, -1, 1, [{ who: "learner", text: "wait, why does blue scatter more than red?" }, { who: "chalky", text: "Shorter waves bounce off tiny molecules more easily, so blue gets flung across the sky while red mostly passes through." }]],
  [0, "no, I'm still lost, sorry", 1, -1, 2, [{ who: "learner", text: "I still don't really get it" }, { who: "chalky", text: "Picture ripples in a pond: little pebbles bounce small quick ripples but barely disturb a long slow swell." }]],
  [0, "so is that why sunsets look red?", 3, -1, 0, []],
  [1, "can you draw what you mean?", 2, 5, 0, []],
  [1, "what does gyroscopic mean?", 2, -1, 0, []],
  [1, "hang on, say that again more slowly", 4, 8, 0, []],
  [2, "can you give me an example with real numbers?", 1, -1, 0, []],
  [2, "I don't understand the percent part", 2, 4, 0, []],
  [2, "ok got it, next", 3, -1, 0, []],
];

const median = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** One interruption: converse, and send the first sentence to /api/tts the moment it lands. */
async function run(fixture, utterance, beatIndex, wordIndex, escalation, history, { tts = true } = {}) {
  const body = { utterance, ...contextFor(fixture, beatIndex, wordIndex), history, escalation };
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const out = { utterance, firstSentenceMs: null, trailerMs: null, doneMs: null, firstAudioMs: null, sonicFirstAudioMs: null, model: null, local: false, level: null, resume: null, cursor: 0, check: null, sentences: [], error: null };
  let audio = null;
  const res = await post("/api/converse", body);
  if (!res.ok) throw new Error(`converse failed (${res.status}): ${await res.text()}`);
  for await (const ev of ndjson(res)) {
    if (ev.type === "start") {
      out.model = ev.model;
      out.local = ev.local;
    } else if (ev.type === "sentence") {
      out.sentences.push(ev.text);
      if (out.firstSentenceMs === null) {
        out.firstSentenceMs = since();
        if (tts) {
          const abort = new AbortController();
          audio = (async () => {
            const r = await post("/api/tts", { text: ev.text }, abort.signal);
            for await (const a of ndjson(r)) {
              if (a.type === "audio") {
                out.firstAudioMs = since();
                out.sonicFirstAudioMs = a.tMs;
                abort.abort(); // one chunk is enough to time it; don't spend credits on the rest
                return;
              }
              if (a.type === "error") throw new Error(`tts: ${a.message}`);
            }
          })().catch((e) => {
            if (e.name !== "AbortError") out.error = String(e.message ?? e);
          });
        }
      }
    } else if (ev.type === "trailer") {
      out.trailerMs = since();
      out.level = ev.trailer.level;
      out.resume = ev.trailer.resume;
      out.cursor = ev.trailer.cursor.length;
      out.check = ev.trailer.check;
      out.trailer = ev.trailer;
    } else if (ev.type === "done") {
      out.doneMs = since();
      out.tokens = `${ev.inputTokens}/${ev.outputTokens}`;
      if (ev.fellBack) out.model += " (fallback)";
    } else if (ev.type === "error") out.error = ev.message;
  }
  if (audio) await audio;
  return out;
}

async function bench() {
  const fixtures = loadFixtures();
  const slugs = QUESTIONS.map(slug).filter((s) => fixtures[s]);
  if (slugs.length < QUESTIONS.length) console.log(`note: ${QUESTIONS.length - slugs.length} fixture(s) missing; using ${slugs.join(", ")}`);
  const tts = !process.env.NO_TTS;
  const rounds = Number(process.env.ROUNDS ?? 1);

  // Warm-up: compiles the route and writes the prompt cache; excluded from the table.
  process.stdout.write("warm-up … ");
  const warm = await run(fixtures[slugs[0]], "wait, what did you say?", 0, 3, 0, [], { tts });
  console.log(`first sentence ${warm.firstSentenceMs} ms, trailer ${warm.trailerMs} ms${warm.error ? `, error: ${warm.error}` : ""}`);

  const rows = [];
  for (let round = 0; round < rounds; round++) {
    for (const [fi, utterance, beatIndex, wordIndex, escalation, history] of INTERRUPTIONS) {
      const fixture = fixtures[slugs[fi % slugs.length]];
      const beat = Math.min(beatIndex, fixture.beats.length - 1);
      const r = await run(fixture, utterance, beat, wordIndex, escalation, history, { tts });
      r.fixture = slugs[fi % slugs.length].split("-").slice(0, 3).join("-");
      r.escalation = escalation;
      rows.push(r);
      console.log(`  ${r.fixture.padEnd(18)} ${JSON.stringify(utterance).slice(0, 44).padEnd(46)} ${r.local ? "local" : r.model.replace("claude-", "")}`);
      console.log(`      ${r.sentences.join(" ")}`);
      if (r.trailer) console.log(`      → ${r.level}/${r.resume}, cursor ${JSON.stringify(r.trailer.cursor)}, check ${JSON.stringify(r.check)}`);
      if (r.error) console.log(`      ERROR ${r.error}`);
    }
  }

  const pad = (v, n, right = false) => (right ? String(v ?? "–").padStart(n) : String(v ?? "–").padEnd(n));
  console.log("\n" + ["fixture".padEnd(18), "utterance".padEnd(34), "esc", "level/resume".padEnd(18), "cur", pad("1st sent", 9, true), pad("trailer", 8, true), pad("1st audio", 10, true), pad("sonic", 6, true), "model"].join("  "));
  for (const r of rows) {
    console.log([pad(r.fixture, 18), pad(r.utterance.slice(0, 34), 34), pad(r.escalation, 3), pad(r.local ? "– / continue" : `${r.level}/${r.resume}`, 18), pad(r.cursor, 3), pad(r.firstSentenceMs, 9, true), pad(r.trailerMs, 8, true), pad(r.firstAudioMs, 10, true), pad(r.sonicFirstAudioMs, 6, true), r.local ? "local" : r.model.replace("claude-", "")].join("  "));
  }
  const model = rows.filter((r) => !r.local);
  console.log(`\nmedians over ${model.length} model replies: first sentence ${median(model.map((r) => r.firstSentenceMs))} ms, trailer ${median(model.map((r) => r.trailerMs))} ms, first audio ${median(model.map((r) => r.firstAudioMs))} ms (Sonic's own first chunk: ${median(model.map((r) => r.sonicFirstAudioMs))} ms after the TTS request).`);
  console.log(`max first audio ${Math.max(...model.map((r) => r.firstAudioMs ?? 0))} ms; local fast path: ${rows.filter((r) => r.local).length} of ${rows.length} (trailer in ${median(rows.filter((r) => r.local).map((r) => r.trailerMs))} ms).`);
  const target = 1500;
  console.log(`target: first audio under ${target} ms at the median → ${median(model.map((r) => r.firstAudioMs)) < target ? "MET" : "MISSED"}.`);
}

/** Start one reply, abort it part-way, start another: the first must end early and the second must complete. */
async function abortTest() {
  const fixtures = loadFixtures();
  const fixture = fixtures[slug(QUESTIONS[0])];
  const ctx = contextFor(fixture, 1, 6);
  const a = new AbortController();
  const t0 = performance.now();
  let aEvents = 0;
  let aEnded = null;
  const first = (async () => {
    try {
      const res = await post("/api/converse", { utterance: "wait, why does blue scatter more than red?", ...ctx, history: [], escalation: 0 }, a.signal);
      for await (const ev of ndjson(res)) aEvents++;
      aEnded = "completed";
    } catch (e) {
      aEnded = e.name === "AbortError" ? "aborted" : `error: ${e.message}`;
    }
  })();
  await new Promise((r) => setTimeout(r, 400));
  a.abort();
  const abortedAt = Math.round(performance.now() - t0);
  const second = await run(fixture, "actually, is that also why the sun looks yellow?", 1, 6, 0, []);
  await first;
  console.log(`request A: ${aEvents} event(s) received, then ${aEnded} at ${abortedAt} ms`);
  console.log(`request B: ${second.sentences.length} sentence(s), first at ${second.firstSentenceMs} ms, trailer at ${second.trailerMs} ms, ${second.level}/${second.resume}`);
  console.log(`  "${second.sentences.join(" ")}"`);
  console.log(aEnded === "aborted" && second.trailerMs ? "PASS (check the dev server log for \"[converse] browser disconnected\")" : "FAIL");
}

const cmd = process.argv[2];
if (cmd === "capture") await capture();
else if (cmd === "abort") await abortTest();
else await bench();
