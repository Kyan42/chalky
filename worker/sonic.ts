// Narration for animations: Cartesia Sonic over SSE, with word timestamps.
// SSE and WebSocket only return raw PCM, so we wrap it in a WAV header for Clayzo.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pcm16Seconds, pcm16ToWav } from "../lib/wav";
import type { Beat, VoicedBeat } from "../lib/types";
import { env } from "./env";

const CARTESIA_VERSION = "2026-08-14";
const SAMPLE_RATE = 24000;
/** Silence before the first beat and between beats, in seconds. */
const LEAD_IN = 0.5;
const GAP = 0.45;

type Spoken = { pcm: Uint8Array; words: { word: string; start: number; end: number }[] };

export async function speak(transcript: string): Promise<Spoken> {
  const response = await fetch("https://api.cartesia.ai/tts/sse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.cartesiaKey()}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript,
      voice: env.voiceId(),
      language: "en",
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
      add_timestamps: true,
    }),
  });
  if (!response.ok || !response.body) throw new Error(`Sonic failed: ${response.status} ${await response.text()}`);

  const chunks: Buffer[] = [];
  const words: Spoken["words"] = [];
  const decoder = new TextDecoder();
  let buffered = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const event = JSON.parse(line.slice(5).trim());
    if (event.type === "chunk" && event.data) chunks.push(Buffer.from(event.data, "base64"));
    else if (event.type === "timestamps" && event.word_timestamps) {
      const { words: w, start, end } = event.word_timestamps as { words: string[]; start: number[]; end: number[] };
      w.forEach((word, i) => words.push({ word, start: start[i], end: end[i] }));
    } else if (event.type === "error") throw new Error(`Sonic error: ${event.error ?? event.message ?? JSON.stringify(event)}`);
  };
  for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(part, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      handle(buffered.slice(0, newline).trim());
      buffered = buffered.slice(newline + 1);
    }
  }
  handle(buffered.trim());
  return { pcm: new Uint8Array(Buffer.concat(chunks)), words };
}

/**
 * Voices every beat into `<dir>/audio/<prefix>-<n>.wav` and returns their timings on one shared clock.
 * Beats are voiced in parallel; the clock lays them end to end with short gaps.
 */
export async function voiceBeats(beats: Beat[], dir: string, prefix = "beat") {
  mkdirSync(path.join(dir, "audio"), { recursive: true });
  const spoken = await mapLimit(beats, 3, (beat) => speak(beat.narration));
  let clock = LEAD_IN;
  const voiced: VoicedBeat[] = spoken.map(({ pcm, words }, index) => {
    const audioUri = `audio/${prefix}-${index}.wav`;
    writeFileSync(path.join(dir, audioUri), pcm16ToWav(pcm, SAMPLE_RATE));
    const duration = pcm16Seconds(pcm.length, SAMPLE_RATE);
    const start = clock;
    clock += duration + GAP;
    return {
      index,
      narration: beats[index].narration,
      visual: beats[index].visual,
      audioUri,
      start,
      duration,
      words: words.map((w) => ({ word: w.word, start: start + w.start, end: start + w.end })),
    };
  });
  return { beats: voiced, totalSeconds: clock };
}

/** Like Promise.all over `items`, with at most `limit` running at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
