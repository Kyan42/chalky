/**
 * Server-side cache for Chalky's fixed lines (lib/lesson/stock-lines.ts): their whole Sonic stream (audio and
 * word timestamps), per voice, speed and language, kept in memory. /api/tts answers a cached line at once and
 * records a stock line it had to fetch; warmStock fills the default voice's lines at server start. Everything
 * else streams from Sonic as before.
 */
import "server-only";
import { STOCK_LINES } from "./lesson/stock-lines";
import { sonicStream, type BeatAudioEvent } from "./sonic";

const STOCK = new Set(STOCK_LINES);
// On globalThis: instrumentation (which warms it) and the route can load separate copies of this module.
const shared = globalThis as typeof globalThis & { __chalkyStockSpeech?: Map<string, BeatAudioEvent[]> };
const cache = (shared.__chalkyStockSpeech ??= new Map<string, BeatAudioEvent[]>());

export const isStock = (text: string) => STOCK.has(text);
/** The cache key: the same line in another voice, speed or language is another recording. */
export const stockKey = (text: string, voice: string, speed: string, language: string) => `${voice || "default"}|${speed || "default"}|${language}|${text}`;
export const cachedSpeech = (key: string) => cache.get(key);

/** Passes a stock line's stream through, keeping it once it finished cleanly. */
export async function* recordStock(key: string, events: AsyncGenerator<BeatAudioEvent>): AsyncGenerator<BeatAudioEvent> {
  const got: BeatAudioEvent[] = [];
  for await (const e of events) {
    got.push(e);
    yield e;
  }
  if (got.some((e) => e.type === "done") && !got.some((e) => e.type === "error")) cache.set(key, got);
}

/** At server start: the default voice's fixed lines (no request, so the default preferences), one at a time. */
export async function warmStock() {
  const t0 = performance.now();
  let n = 0;
  for (const text of STOCK_LINES) {
    const key = stockKey(text, "", "", "en");
    if (cache.has(key)) continue;
    try {
      for await (const _ of recordStock(key, sonicStream(text, new AbortController().signal))) void _;
      n++;
    } catch (e) {
      console.warn(`[tts-cache] couldn't warm "${text}": ${String((e as Error).message ?? e)}`);
    }
  }
  console.info(`[tts-cache] warmed ${n} fixed line(s) in ${Math.round(performance.now() - t0)} ms`);
}
