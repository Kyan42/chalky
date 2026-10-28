/**
 * Small search indexes held in this server process: one per lesson (the board: one document per
 * element) and one per learner (their memory). Same functions on both engines (lib/retrieval/docs.ts):
 * - local (default): a HybridIndex per session; each document is embedded by the local model as it
 *   arrives (a few ms each) and searched by cosine plus BM25, status "local".
 * - moss: Moss session indexes (lib/moss/session.ts), status "moss".
 * Before the local model has loaded (or without Moss), the same documents are searched by plain word
 * overlap, status "words", so a caller always gets an answer at once.
 */
import * as moss from "@/lib/moss/session";
import { retrievalEngine } from "./docs";
import { embedderNow, loadEmbedder } from "./embed";
import { HybridIndex } from "./hybrid";

export type SessionUpdate = { added: number; ms: number; status: "local" | "moss" | "pending" | "words" };
export type SessionHit = { id: string; score: number; meta: Record<string, string>; text: string };
export type SessionSearch = { hits: SessionHit[]; ms: number; status: "local" | "moss" | "words" | "empty" };

/** Hybrid score a board element or memory line needs to count as a hit (0..1, alpha 0.5). */
const MIN_SCORE = Number(process.env.RETRIEVAL_MIN_SCORE) || 0.2;
const ALPHA = 0.5;
const MAX_SESSIONS = 24;

type Live = { index: HybridIndex; meta: Map<string, Record<string, string>>; used: number };
const g = globalThis as typeof globalThis & { __chalkyLocalSessions?: Map<string, Live> };
const sessions: Map<string, Live> = (g.__chalkyLocalSessions ??= new Map());

function live(name: string): Live {
  let s = sessions.get(name);
  if (s) {
    s.used = Date.now();
    return s;
  }
  // Keep the most recently used few.
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  s = { index: new HybridIndex(), meta: new Map(), used: Date.now() };
  sessions.set(name, s);
  return s;
}

/** Embeds a session's documents that arrived before the model loaded. */
async function fillVectors(s: Live): Promise<void> {
  const embed = await loadEmbedder();
  const docs = s.index.missingVectors();
  if (!docs.length) return;
  const vectors = await embed(docs.map((d) => d.text));
  docs.forEach((d, i) => s.index.get(d.id)?.text === d.text && s.index.upsert({ ...d, vector: vectors[i] }));
}

/** Adds or replaces documents (by id); unchanged ones are skipped. */
export async function upsertDocs(name: string, docs: { id: string; text: string; meta?: Record<string, string> }[]): Promise<SessionUpdate> {
  if (retrievalEngine() === "moss") return moss.upsertDocs(name, docs);
  const s = live(name);
  const t0 = performance.now();
  const changed = docs.filter((d) => s.index.get(d.id)?.text !== d.text);
  for (const d of docs) s.meta.set(d.id, d.meta ?? {});
  if (!changed.length) return { added: 0, ms: 0, status: embedderNow() ? "local" : "pending" };
  const embed = embedderNow();
  const vectors = embed ? await embed(changed.map((d) => d.text)) : [];
  changed.forEach((d, i) => s.index.upsert({ id: d.id, text: d.text, vector: vectors[i] }));
  if (!embed) fillVectors(s).catch(() => {});
  return { added: changed.length, ms: Math.round(performance.now() - t0), status: embed ? "local" : "pending" };
}

const WORD_STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "at", "it", "is", "was", "where", "what", "show", "me", "that", "this", "for", "with", "again", "you", "your", "drew", "draw"]);
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !WORD_STOP.has(w));

/** The k best documents for `query`: the engine when it is ready, else word overlap. */
export async function searchDocs(name: string, query: string, k = 3): Promise<SessionSearch> {
  if (retrievalEngine() === "moss") return moss.searchDocs(name, query, k);
  const s = sessions.get(name);
  const t0 = performance.now();
  if (!s || !s.index.size || !query.trim()) return { hits: [], ms: 0, status: "empty" };
  s.used = Date.now();
  const hit = (id: string, score: number): SessionHit => ({ id, score: Math.round(score * 1000) / 1000, meta: s.meta.get(id) ?? {}, text: s.index.get(id)?.text ?? "" });
  const embed = embedderNow();
  if (embed && !s.index.missingVectors().length) {
    try {
      const [vector] = await embed([query]);
      const hits = s.index.search(query, vector, k, ALPHA, MIN_SCORE);
      return { hits: hits.map((h) => hit(h.id, h.score)), ms: Math.round((performance.now() - t0) * 10) / 10, status: "local" };
    } catch (e) {
      console.warn(`[retrieval] session ${name} query failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    }
  }
  const q = new Set(words(query));
  const ids = [...s.meta.keys()].filter((id) => s.index.has(id));
  const scored = ids
    .map((id) => {
      const w = words(s.index.get(id)!.text);
      const overlap = w.filter((x) => q.has(x) || q.has(x.replace(/s$/, "")) || q.has(`${x}s`)).length;
      return { id, score: overlap / Math.max(3, Math.sqrt(w.length)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { hits: scored.map((x) => hit(x.id, x.score)), ms: Math.round((performance.now() - t0) * 10) / 10, status: "words" };
}

/** Starts a session ahead of its first documents (a lesson's board, a learner's memory). */
export function warmSession(name: string): void {
  if (retrievalEngine() === "moss") moss.warmSession(name);
  else live(name);
}

/** At server start: the local model (shared by blocks, boards and memory), or Moss's spare sessions. */
export function warmSessions(): void {
  if (retrievalEngine() === "moss") moss.warmSessions();
  else loadEmbedder().catch(() => {});
}
