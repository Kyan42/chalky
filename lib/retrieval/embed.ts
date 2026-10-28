/**
 * The local embedding model: a small sentence model (all-MiniLM-L6-v2, 384 dimensions, 8-bit
 * quantized ONNX) run on the CPU inside this Node process by transformers.js. No vendor and no key:
 * the model files (about 23 MB) are downloaded from the Hugging Face hub on first use into
 * `.cache/transformers` under the project root (RETRIEVAL_CACHE_DIR to move it) and read from there
 * afterwards. Timings are in docs/retrieval.md.
 *
 * One model per server process (kept on globalThis so dev hot reloads don't load it again). Callers
 * that can't wait use `embedderNow()`, which is null until the model is ready.
 */
import os from "node:os";
import path from "node:path";

export const EMBED_MODEL = process.env.RETRIEVAL_MODEL || "Xenova/all-MiniLM-L6-v2";
export const EMBED_DTYPE = "q8";
/** Stamped into lib/blocks/vectors.json: vectors from another model or dtype don't mix. */
export const EMBED_STAMP = `${EMBED_MODEL}:${EMBED_DTYPE}`;
// On Vercel the project folder is read-only: the temp folder (refilled on each cold start).
export const CACHE_DIR = process.env.RETRIEVAL_CACHE_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "transformers") : path.join(process.cwd(), ".cache", "transformers"));

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;
type ModelState = { ready: Promise<Embedder>; embed: Embedder | null; loadMs: number | null; error: string | null };
const g = globalThis as typeof globalThis & { __chalkyEmbedder?: ModelState };

/** Loads the model once, and runs one throwaway sentence: the first call is the slow one. */
export function loadEmbedder(): Promise<Embedder> {
  if (g.__chalkyEmbedder && !g.__chalkyEmbedder.error) return g.__chalkyEmbedder.ready;
  const t0 = performance.now();
  const state: ModelState = { ready: null!, embed: null, loadMs: null, error: null };
  state.ready = (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = CACHE_DIR;
    const extract = await pipeline("feature-extraction", EMBED_MODEL, { dtype: EMBED_DTYPE, device: "cpu" });
    const embed: Embedder = async (texts) => {
      if (!texts.length) return [];
      const out = await extract(texts, { pooling: "mean", normalize: true });
      const [n, dim] = out.dims as [number, number];
      const data = out.data as Float32Array;
      return Array.from({ length: n }, (_, i) => data.slice(i * dim, (i + 1) * dim));
    };
    await embed(["warm up"]);
    state.embed = embed;
    state.loadMs = Math.round(performance.now() - t0);
    console.log(`[retrieval] model ${EMBED_STAMP} ready in ${state.loadMs} ms (cache ${CACHE_DIR})`);
    return embed;
  })();
  state.ready.catch((e) => {
    state.error = String((e as Error)?.message ?? e).slice(0, 300);
    console.warn(`[retrieval] model ${EMBED_MODEL} failed to load: ${state.error}`);
  });
  g.__chalkyEmbedder = state;
  return state.ready;
}

/** The model if it is loaded, else null (and starts loading it). */
export function embedderNow(): Embedder | null {
  const s = g.__chalkyEmbedder;
  if (!s || s.error) {
    loadEmbedder().catch(() => {});
    return null;
  }
  return s.embed;
}

export const modelLoadMs = () => g.__chalkyEmbedder?.loadMs ?? null;
export const modelError = () => g.__chalkyEmbedder?.error ?? null;

export const toBase64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
export function fromBase64(s: string): Float32Array {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
