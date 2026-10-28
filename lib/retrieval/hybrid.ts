/**
 * A small in-memory hybrid index: cosine similarity between sentence vectors (lib/retrieval/embed.ts)
 * blended with MiniSearch's BM25, the same shape as Moss's hybrid search. Each half is put on a 0..1
 * scale before blending: the cosine is clipped to 0..1 as it is (MiniLM puts related text around
 * 0.3-0.9 and unrelated near 0), and BM25 is divided by this query's best BM25. Min-max on the cosine
 * would make the better of two unrelated board docs look like a perfect match.
 *
 * A doc without a vector yet (it arrived before the model loaded) is matched on its words alone
 * until it is embedded.
 */
import MiniSearch from "minisearch";

/** `title` and `tags` (block docs) are also matched on their own, weighted above the body text. */
export type HybridDoc = { id: string; text: string; title?: string; tags?: string; vector?: Float32Array };
export type HybridHit = { id: string; score: number; dense: number; lexical: number };

// Common English words carry no topic: left in, "each", "other" and "how much" made a brief about
// attention match the chemistry blocks that happen to say them.
const STOP = new Set(
  ("a about above after again against all also am an and any are as at back be because been before being below between both but by can could did do does doing down during each few for from " +
    "further had has have having he her here hers him his how i if in into is it its itself just like look looks me more most much my no nor not now of off on once one only or other our out over own " +
    "same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your")
    .split(" "),
);

/** Lower case, stop words dropped, plurals folded ("molecules" -> "molecule", "batteries" -> "battery"). */
export function term(t: string): string | null {
  let w = t.toLowerCase();
  if (w.length < 2 || STOP.has(w)) return null;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  return w;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export class HybridIndex {
  private docs = new Map<string, HybridDoc>();
  private lexical = new MiniSearch<{ id: string; text: string; title: string; tags: string }>({
    fields: ["title", "tags", "text"],
    storeFields: [],
    processTerm: term,
    // Prefix matching on longer words only ("photosynth" finds "photosynthesis"); no fuzzy matching,
    // which matched unrelated words of similar spelling.
    searchOptions: { prefix: (t) => t.length > 5, boost: { title: 3, tags: 2 } },
  });

  get size() {
    return this.docs.size;
  }

  has(id: string) {
    return this.docs.has(id);
  }

  get(id: string) {
    return this.docs.get(id);
  }

  /** Adds or replaces a doc (by id). */
  upsert(doc: HybridDoc): void {
    if (this.docs.has(doc.id)) this.lexical.discard(doc.id);
    this.docs.set(doc.id, doc);
    this.lexical.add({ id: doc.id, text: doc.text, title: doc.title ?? "", tags: doc.tags ?? "" });
  }

  /** Docs still waiting for a vector. */
  missingVectors(): HybridDoc[] {
    return [...this.docs.values()].filter((d) => !d.vector);
  }

  /**
   * The k best docs for the query: alpha * cosine + (1 - alpha) * BM25 share. Without a query vector
   * (the model isn't loaded yet) it ranks on words alone. Hits at or under `minScore` are dropped.
   */
  search(query: string, queryVector: Float32Array | null, k: number, alpha = 0.5, minScore = 0): HybridHit[] {
    const bm25 = new Map<string, number>();
    for (const r of this.lexical.search(query)) bm25.set(String(r.id), r.score);
    const best = Math.max(0, ...bm25.values());
    const out: HybridHit[] = [];
    for (const d of this.docs.values()) {
      const lexical = best > 0 ? (bm25.get(d.id) ?? 0) / best : 0;
      const dense = queryVector && d.vector ? Math.max(0, cosine(queryVector, d.vector)) : 0;
      const score = queryVector ? alpha * dense + (1 - alpha) * lexical : lexical;
      if (score > minScore) out.push({ id: d.id, score, dense, lexical });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
