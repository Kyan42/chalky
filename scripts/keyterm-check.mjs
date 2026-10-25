// Does Ink-2 use keyterms? Streams the same Sonic-spoken sentences to the
// turns socket with no keyterms, with the hard words as keyterms, and with a
// long list, and prints what Ink heard each time.
//   BASE_URL=http://localhost:3006 node scripts/keyterm-check.mjs
import { join } from "node:path";
import { speechWav } from "./fake-mic.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3006";
const SENTENCES = [
  { say: "Hey Chalky, how do chloroplasts and stomata help with photosynthesis?", terms: ["Chalky", "chloroplasts", "stomata", "photosynthesis"] },
  { say: "Can you explain Rayleigh scattering and why the xylem carries water?", terms: ["Rayleigh", "scattering", "xylem"] },
  { say: "Walk me through how plants eat, like photosynthesis.", terms: ["photosynthesis", "plants"] },
];
const LONG = Array.from({ length: 300 }, (_, i) => `term${i}`);

/** 16 kHz s16le PCM for a sentence (Sonic speech from the fake-mic cache, resampled). */
async function pcm16k(text) {
  const wav = await speechWav(join(process.cwd(), "experiments/conversation-e2e/clips", `kt-${text.length}.wav`), [{ silence: 0.3 }, { say: text }, { silence: 0.3 }]);
  const buf = readFileSync(wav.path);
  const rate = buf.readUInt32LE(24);
  const samples = (buf.length - 44) / 2;
  const n = Math.floor((samples * 16000) / rate);
  const out = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) out.writeInt16LE(buf.readInt16LE(44 + Math.min(samples - 1, Math.floor((i * rate) / 16000)) * 2), i * 2);
  return out;
}

async function hear(pcm, keyterms) {
  const { token, version } = await fetch(`${BASE}/api/cartesia/token`, { method: "POST" }).then((r) => r.json());
  const params = new URLSearchParams({ model: "ink-2", encoding: "pcm_s16le", sample_rate: "16000", cartesia_version: version, access_token: token });
  for (const k of keyterms) params.append("keyterm", k);
  const ws = new WebSocket(`wss://api.cartesia.ai/stt/turns/websocket?${params}`);
  ws.binaryType = "arraybuffer";
  const heard = [];
  let error = null;
  const opened = await new Promise((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = (e) => resolve(false) || (error ??= `closed ${e.code} ${e.reason}`);
  });
  if (!opened) return { opened, heard, error: error ?? "did not open" };
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.type === "turn.end") heard.push(m.transcript);
    if (m.type === "error") error = m.message;
  };
  ws.onclose = (e) => (error ??= e.code !== 1000 && e.code !== 1005 ? `closed ${e.code} ${e.reason}` : null);
  // Real time: 100 ms chunks every 100 ms, then 2 s of silence for the turn to end.
  const chunk = 3200;
  const silence = Buffer.alloc(chunk);
  for (let o = 0; o < pcm.length; o += chunk) {
    ws.send(pcm.subarray(o, o + chunk));
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let k = 0; k < 25; k++) {
    ws.send(silence);
    await new Promise((r) => setTimeout(r, 100));
  }
  ws.close();
  return { opened, heard, error };
}

for (const s of SENTENCES) {
  const pcm = await pcm16k(s.say);
  console.log(`\nsaid:          "${s.say}"`);
  for (const [label, terms] of [["no keyterms", []], ["its keyterms", s.terms], ["300 keyterms", [...s.terms, ...LONG]]]) {
    const r = await hear(pcm, terms);
    console.log(`${label.padEnd(13)} ${r.opened ? `heard "${r.heard.join(" | ")}"` : "did not connect"}${r.error ? `  (${r.error})` : ""}`);
  }
}
