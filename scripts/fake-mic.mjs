// Builds fake-microphone WAV files from Sonic speech, for headless Chrome's
// --use-file-for-fake-audio-capture. Shared by the voice e2e scripts.
//
//   await speechWav(path, [{ silence: 5 }, { say: "Hey Chalky." }, { silence: 0.9 }, { say: "Why is the sky blue?" }, { silence: 3 }])
//
// Speech is fetched from /api/tts once and cached next to the WAV (by text), so
// re-running a test doesn't spend Cartesia credits.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";

/** Mono f32 samples (and their rate) for one sentence, cached on disk. */
async function speech(text, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${createHash("sha1").update(text).digest("hex").slice(0, 12)}.f32`);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    return { rate: buf.readUInt32LE(0), samples: new Float32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + buf.length)) };
  }
  const res = await fetch(`${BASE_URL}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`tts failed (${res.status})`);
  let rate = 44100;
  let encoding = "pcm_f32le";
  const chunks = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type === "start") ({ sampleRate: rate, encoding } = ev);
    else if (ev.type === "audio") chunks.push(Buffer.from(ev.data, "base64"));
    else if (ev.type === "error") throw new Error(ev.message);
  }
  let raw = Buffer.concat(chunks);
  // The cache always holds float32; 16-bit speech is widened once here.
  if (encoding === "pcm_s16le") {
    const f = Buffer.alloc((raw.length >> 1) * 4);
    for (let i = 0; i < raw.length >> 1; i++) f.writeFloatLE(raw.readInt16LE(i * 2) / 32768, i * 4);
    raw = f;
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(rate, 0);
  writeFileSync(file, Buffer.concat([head, raw.subarray(0, raw.length - (raw.length % 4))]));
  return { rate, samples: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 4))) };
}

/** Writes a 16-bit mono WAV made of spoken sentences and silences; returns the path and a timeline. */
export async function speechWav(path, parts) {
  const cacheDir = join(dirname(path), ".tts-cache");
  const pieces = [];
  let rate = 44100;
  for (const p of parts) if (p.say) ({ rate } = await speech(p.say, cacheDir));
  const timeline = [];
  let t = 0;
  for (const p of parts) {
    if (p.say) {
      const clip = await speech(p.say, cacheDir);
      // Older cached clips may be 44.1 kHz and newer ones 24 kHz: resample to the WAV's rate (linear is fine for a test mic).
      const samples = clip.rate === rate ? clip.samples : Float32Array.from({ length: Math.round((clip.samples.length * rate) / clip.rate) }, (_, i) => clip.samples[Math.min(clip.samples.length - 1, Math.floor((i * clip.rate) / rate))]);
      pieces.push(samples);
      timeline.push({ at: +t.toFixed(2), say: p.say, seconds: +(samples.length / rate).toFixed(2) });
      t += samples.length / rate;
    } else {
      pieces.push(new Float32Array(Math.round((p.silence ?? 0) * rate)));
      t += p.silence ?? 0;
    }
  }
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const pcm = Buffer.alloc(total * 2);
  let o = 0;
  for (const p of pieces) for (const v of p) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 2 * o++);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([h, pcm]));
  return { path, seconds: +t.toFixed(2), timeline };
}
