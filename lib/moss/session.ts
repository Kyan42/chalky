/**
 * Small Moss session indexes held in this server process: one per lesson (the board: one document per
 * element) and one per learner (their memory). A Moss session embeds and searches in process memory
 * with no cloud round trip; measured on this machine: creating one about 2 s (once), adding five
 * documents 15-30 ms, a query 5-8 ms. While a session is still being created, or without Moss keys,
 * the same documents are searched by plain word overlap, so a caller always gets an answer at once.
 *
 * Creating a session inside the dev server took 1-7 s (a live run logged "ready in 6826 ms"): the first
 * one loads the embedding model, and any compile or busy stretch of the event loop adds to it. So the
 * server keeps SPARE_SESSIONS made ahead (warmSessions(), called at startup), and a lesson's board or a
 * learner's memory takes one that is already ready; the name a session was made with doesn't matter,
 * sessions are found by the key in `sessions`.
 */
import type { SessionIndex } from "@moss-js/moss";
import { hasMossKeys } from "@/lib/retrieval/docs";
import { mossState } from "./blocks";

type Live = {
  index: SessionIndex | null;
  ready: Promise<void>;
  /** id -> the text indexed for it (an update re-adds only what changed), and its metadata. */
  docs: Map<string, { text: string; meta: Record<string, string> }>;
  createMs: number | null;
  used: number;
};
const g = globalThis as typeof globalThis & { __chalkySessions?: Map<string, Live>; __chalkySpareSessions?: Promise<SessionIndex>[] };
const sessions = (g.__chalkySessions ??= new Map());
const MAX_SESSIONS = 24;
/** One for a lesson's board and one for its learner's memory. */
const SPARE_SESSIONS = 2;
const spares = (g.__chalkySpareSessions ??= []);
let spareCount = 0;

/** Makes sessions ahead of need, up to SPARE_SESSIONS waiting. */
export function warmSessions(): void {
  const state = hasMossKeys() ? mossState() : null;
  if (!state) return;
  while (spares.length < SPARE_SESSIONS) {
    const t0 = performance.now();
    const made = state.client.session(`chalky-spare-${process.pid}-${++spareCount}`, "moss-minilm");
    made.then(
      () => console.info(`[moss] spare session ready in ${Math.round(performance.now() - t0)} ms`),
      (e) => {
        console.warn(`[moss] spare session failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
        const i = spares.indexOf(made);
        if (i >= 0) spares.splice(i, 1);
      },
    );
    spares.push(made);
  }
}

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
  s = { index: null, ready: Promise.resolve(), docs: new Map(), createMs: null, used: Date.now() };
  const state = hasMossKeys() ? mossState() : null;
  if (state) {
    const t0 = performance.now();
    const made = s;
    const spare = spares.shift();
    // Replace the one taken, in the background.
    if (spare) setTimeout(warmSessions, 0);
    made.ready = (spare ?? state.client.session(`chalky-${name}`.slice(0, 120), "moss-minilm"))
      .then(async (index) => {
        made.createMs = Math.round(performance.now() - t0);
        // Whatever arrived while it was being made goes in now.
        if (made.docs.size) await index.addDocs([...made.docs.entries()].map(([id, d]) => ({ id, text: d.text })));
        made.index = index;
        console.info(`[moss] session ${name}: ready in ${made.createMs} ms (${spare ? "a spare made ahead" : "made now"}, ${made.docs.size} docs)`);
      })
      .catch((e) => console.warn(`[moss] session ${name} failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
  }
  sessions.set(name, s);
  return s;
}

export type SessionUpdate = { added: number; ms: number; status: "moss" | "pending" | "words" };

/** Adds or replaces documents (by id); unchanged ones are skipped. */
export async function upsertDocs(name: string, docs: { id: string; text: string; meta?: Record<string, string> }[]): Promise<SessionUpdate> {
  const s = live(name);
  const t0 = performance.now();
  const changed = docs.filter((d) => s.docs.get(d.id)?.text !== d.text);
  for (const d of docs) s.docs.set(d.id, { text: d.text, meta: d.meta ?? {} });
  if (!changed.length) return { added: 0, ms: 0, status: s.index ? "moss" : hasMossKeys() ? "pending" : "words" };
  if (s.index) {
    // A session's addDocs replaces a document with the same id.
    await s.index.addDocs(changed.map((d) => ({ id: d.id, text: d.text })), { upsert: true });
    return { added: changed.length, ms: Math.round(performance.now() - t0), status: "moss" };
  }
  return { added: changed.length, ms: Math.round(performance.now() - t0), status: hasMossKeys() ? "pending" : "words" };
}

export type SessionHit = { id: string; score: number; meta: Record<string, string>; text: string };
export type SessionSearch = { hits: SessionHit[]; ms: number; status: "moss" | "words" | "empty" };

const WORD_STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "at", "it", "is", "was", "where", "what", "show", "me", "that", "this", "for", "with", "again", "you", "your", "drew", "draw"]);
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !WORD_STOP.has(w));

/** The k best documents for `query`: Moss when the session is ready, else word overlap. */
export async function searchDocs(name: string, query: string, k = 3): Promise<SessionSearch> {
  const s = sessions.get(name);
  const t0 = performance.now();
  if (!s || !s.docs.size || !query.trim()) return { hits: [], ms: 0, status: "empty" };
  s.used = Date.now();
  const hit = (id: string, score: number): SessionHit => ({ id, score: Math.round(score * 1000) / 1000, meta: s.docs.get(id)?.meta ?? {}, text: s.docs.get(id)?.text ?? "" });
  if (s.index) {
    try {
      const r = await s.index.query(query, { topK: k, alpha: 0.5 });
      return { hits: r.docs.filter((d: { id: string; score: number }) => s.docs.has(d.id) && d.score > 0.05).map((d: { id: string; score: number }) => hit(d.id, d.score)), ms: Math.round((performance.now() - t0) * 10) / 10, status: "moss" };
    } catch (e) {
      console.warn(`[moss] session ${name} query failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    }
  }
  const q = new Set(words(query));
  const scored = [...s.docs.entries()]
    .map(([id, d]) => {
      const w = words(d.text);
      const overlap = w.filter((x) => q.has(x) || q.has(x.replace(/s$/, "")) || q.has(`${x}s`)).length;
      return { id, score: overlap / Math.max(3, Math.sqrt(w.length)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { hits: scored.map((x) => hit(x.id, x.score)), ms: Math.round((performance.now() - t0) * 10) / 10, status: "words" };
}

/** Starts making a session ahead of its first documents (a lesson's board, a learner's memory). */
export function warmSession(name: string): void {
  live(name);
}
