// Measures /api/tts on one sentence: bytes streamed, first audio and whole-clip time
// at the client, audio seconds, and the word timestamps (for checking an anchor).
//   node scripts/speech-format-check.mjs [runs]
const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const TEXT = process.env.TEXT ?? "Each color is a wave with its own wavelength, and red light has long lazy waves.";
const RUNS = Number(process.argv[2] ?? 3);
const rows = [];
for (let k = 0; k < RUNS; k++) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: TEXT }) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let pending = "", wire = 0, audioBytes = 0, first = null, start = null, words = [], startTimes = [], error = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    wire += value.byteLength;
    pending += dec.decode(value, { stream: true });
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "start") start = ev;
      else if (ev.type === "audio") {
        audioBytes += Buffer.from(ev.data, "base64").length;
        first ??= performance.now() - t0;
      } else if (ev.type === "timestamps") {
        words.push(...ev.words);
        startTimes.push(...ev.start);
      } else if (ev.type === "error") error = ev.message;
    }
  }
  const whole = performance.now() - t0;
  const bytesPerSample = start?.encoding === "pcm_s16le" ? 2 : 4;
  const seconds = audioBytes / bytesPerSample / (start?.sampleRate ?? 44100);
  rows.push({ run: k + 1, format: `${start?.encoding}@${start?.sampleRate}`, audioKB: +(audioBytes / 1024).toFixed(0), wireKB: +(wire / 1024).toFixed(0), firstMs: Math.round(first ?? -1), wholeMs: Math.round(whole), audioS: +seconds.toFixed(2), realtime: +(seconds / (whole / 1000)).toFixed(2), error });
  if (k === 0) {
    const i = words.findIndex((w) => /^wavelength/i.test(w));
    console.log(`words ${words.length}; "wavelength" (word ${i + 1}) starts at ${startTimes[i]?.toFixed(2)} s; last word "${words.at(-1)}" at ${startTimes.at(-1)?.toFixed(2)} s of ${seconds.toFixed(2)} s audio`);
  }
}
console.table(rows);
const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`median: wire ${med("wireKB")} KB, first audio ${med("firstMs")} ms, whole clip ${med("wholeMs")} ms, ${med("realtime")}x real time`);
