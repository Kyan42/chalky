/**
 * Learner memory: what a learner said in earlier lessons, from their Convex record (convex/learners.ts),
 * as one Moss session document per line: each confusion, what they already knew, what they wanted, and
 * each earlier lesson with what it got stuck on. Queried with the utterance (and the lesson's question)
 * before every reply; the best lines go into the fast model's prompt as "what this learner has said
 * before". Records are fetched at a lesson's first reply and then once a minute at most, never on a
 * reply's critical path for longer than MEMORY_BUDGET_MS: a slow fetch just means no memory this turn.
 */
import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { searchDocs, upsertDocs, warmSession } from "./session";

const MEMORY_BUDGET_MS = 600;
const TTL_MS = 60_000;
let client: ConvexHttpClient | null = null;
const fetched = new Map<string, { at: number; pending: Promise<number> | null }>();

/** Fetches the learner's record into their memory session; resolves to the number of lines. */
function refresh(learnerId: string, lessonId: string | null): Promise<number> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Promise.resolve(0);
  client ??= new ConvexHttpClient(url);
  const name = `learner-${learnerId}`;
  warmSession(name);
  return Promise.all([client.query(api.learners.get, { learnerId }), client.query(api.learners.learnerMemory, { learnerId, ...(lessonId ? { before: lessonId } : {}) })])
    .then(async ([row, summary]) => {
      const docs: { id: string; text: string; meta: Record<string, string> }[] = [];
      const date = row?.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : "";
      (row?.confusions ?? []).forEach((c, k) => docs.push({ id: `confusion-${k}`, text: `got stuck on: ${c}`, meta: { kind: "confusion", date } }));
      if (row?.prior) docs.push({ id: "prior", text: `already knew: ${row.prior}`, meta: { kind: "prior", date } });
      if (row?.focus) docs.push({ id: "focus", text: `wanted: ${row.focus}`, meta: { kind: "focus", date } });
      // The summary's lesson lines carry the lesson titles and what each got stuck on.
      String(summary ?? "")
        .split("\n")
        .filter((l) => l.startsWith("- earlier lesson"))
        .forEach((l, k) => docs.push({ id: `lesson-${k}`, text: l.slice(2), meta: { kind: "lesson", date } }));
      await upsertDocs(name, docs);
      return docs.length;
    })
    .catch((e) => {
      console.warn(`[memory] Convex fetch for ${learnerId} failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      return 0;
    });
}

export type MemoryLookup = { lines: string[]; ms: number; status: string; docs?: number };

/** The learner's earlier lines that best match `query` (at most k), within a small time budget. */
export async function learnerMemory(learnerId: string | null, query: string, lessonId: string | null, k = 3): Promise<MemoryLookup> {
  if (!learnerId || !process.env.NEXT_PUBLIC_CONVEX_URL) return { lines: [], ms: 0, status: learnerId ? "no-convex" : "no-learner" };
  const t0 = performance.now();
  // A new lesson fetches afresh: the last one's record may have landed since.
  const key = `${learnerId}:${lessonId ?? ""}`;
  let f = fetched.get(key);
  if (!f || (Date.now() - f.at > TTL_MS && !f.pending)) {
    const entry = { at: Date.now(), pending: null as Promise<number> | null };
    entry.pending = refresh(learnerId, lessonId).finally(() => (entry.pending = null));
    fetched.set(key, entry);
    f = entry;
  }
  let docs: number | undefined;
  if (f.pending) docs = (await Promise.race([f.pending, new Promise<undefined>((r) => setTimeout(() => r(undefined), MEMORY_BUDGET_MS))])) ?? undefined;
  const found = await searchDocs(`learner-${learnerId}`, query, k);
  return { lines: found.hits.map((h) => (h.meta.date ? `${h.text} (${h.meta.date})` : h.text)), ms: Math.round(performance.now() - t0), status: found.status, ...(docs !== undefined ? { docs } : {}) };
}
