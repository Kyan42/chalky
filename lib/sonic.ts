/**
 * Server-only: Cartesia Sonic TTS over SSE with word timestamps.
 *
 * Request and event shapes follow Cartesia's official SDK
 * (@cartesia/cartesia-js 4.2.0, `tts.generateSSE`): POST /tts/sse with
 * `add_timestamps: true`; events are `chunk` (base64 audio), `timestamps`
 * (`word_timestamps: { words, start, end }` in seconds), `done` and `error`.
 */
import "server-only";
import { cookies } from "next/headers";
import { parsePreferences } from "./preferences";

/**
 * 16-bit PCM at 24 kHz: 48 KB/s of audio, against 176 KB/s for the float32
 * 44.1 kHz we started with. On a busy venue network the heavier stream couldn't
 * keep up with real time and every beat stuttered. Speech loses nothing audible.
 */
export const SONIC_SAMPLE_RATE = 24000;
export const SONIC_ENCODING = "pcm_s16le" as const;
const BYTES_PER_SAMPLE = 2;
const CARTESIA_URL = "https://api.cartesia.ai/tts/sse";
const CARTESIA_VERSION = "2026-08-14";
const DEFAULT_VOICE = "e07c00bc-4134-4eae-9ea4-1a55fb45746b"; // the SDK README's example voice
const DEFAULT_MODEL = "sonic-3";

/** What the route streams to the browser, one JSON object per line. */
export type BeatAudioEvent =
  | { type: "start"; source: "sonic"; sampleRate: number; encoding: "pcm_f32le" | "pcm_s16le" }
  | { type: "audio"; seq: number; data: string; bytes: number; tMs: number }
  | { type: "timestamps"; words: string[]; start: number[]; end: number[]; tMs: number }
  | { type: "done"; tMs: number; stats: SonicStats }
  | { type: "error"; message: string; tMs: number };

export interface SonicStats {
  firstAudioMs: number | null;
  firstTimestampsMs: number | null;
  chunks: number;
  bytes: number;
  audioSeconds: number;
  /** Order in which the first audio chunk and the first timestamps arrived. */
  order: ("audio" | "timestamps")[];
}

/** Splits an SSE byte stream into the JSON payloads of its `data:` lines. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
  if (buffer.trim().startsWith("data:")) yield buffer.trim().slice(5).trimStart();
}

function sonicSpeed(): number {
  const v = Number(process.env.SONIC_SPEED ?? 0.92);
  return Number.isFinite(v) && v >= 0.6 && v <= 1.5 ? v : 1;
}

export async function* sonicStream(text: string, signal: AbortSignal, speedOverride?: number): AsyncGenerator<BeatAudioEvent> {
  // Locally the key comes from .env.local. In the cloud environment it is a
  // network secret: the egress proxy adds the Authorization header itself.
  const key = process.env.CARTESIA_API_KEY;
  let raw: string | undefined;
  try { raw = (await cookies()).get("chalky-preferences")?.value; } catch {}
  const preferences = parsePreferences(raw);

  const speed = speedOverride !== undefined && Number.isFinite(speedOverride) && speedOverride >= 0.6 && speedOverride <= 1.5 ? speedOverride : sonicSpeed();
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const stats: SonicStats = { firstAudioMs: null, firstTimestampsMs: null, chunks: 0, bytes: 0, audioSeconds: 0, order: [] };

  const response = await fetch(CARTESIA_URL, {
    method: "POST",
    signal,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model_id: process.env.CARTESIA_MODEL_ID || DEFAULT_MODEL,
      transcript: text,
      voice: { id: preferences.voice || process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE },
      output_format: { container: "raw", encoding: SONIC_ENCODING, sample_rate: SONIC_SAMPLE_RATE },
      language: preferences.language,
      add_timestamps: true,
      // A touch slower than normal for teaching (Sonic 3 models: 0.6 to 1.5). SONIC_SPEED overrides; 1 turns it off.
      ...(speed !== 1 ? { generation_config: { speed } } : {}),
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cartesia responded ${response.status}: ${detail.slice(0, 500)}`);
  }

  yield { type: "start", source: "sonic", sampleRate: SONIC_SAMPLE_RATE, encoding: SONIC_ENCODING };
  for await (const raw of sseData(response.body)) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type === "chunk" && typeof event.data === "string") {
      const bytes = Math.floor((event.data.length * 3) / 4) - (event.data.endsWith("==") ? 2 : event.data.endsWith("=") ? 1 : 0);
      if (stats.firstAudioMs === null) {
        stats.firstAudioMs = ms();
        stats.order.push("audio");
      }
      stats.bytes += bytes;
      stats.audioSeconds = stats.bytes / BYTES_PER_SAMPLE / SONIC_SAMPLE_RATE;
      yield { type: "audio", seq: stats.chunks++, data: event.data, bytes, tMs: ms() };
    } else if (event.type === "timestamps" && event.word_timestamps) {
      const wt = event.word_timestamps as { words: string[]; start: number[]; end: number[] };
      if (stats.firstTimestampsMs === null) {
        stats.firstTimestampsMs = ms();
        stats.order.push("timestamps");
      }
      yield { type: "timestamps", words: wt.words, start: wt.start, end: wt.end, tMs: ms() };
    } else if (event.type === "error") {
      yield { type: "error", message: String(event.message ?? event.title ?? "Cartesia error"), tMs: ms() };
      return;
    } else if (event.type === "done") {
      break;
    }
  }
  yield { type: "done", tMs: ms(), stats };
}
