/**
 * Time-sensitive questions answered from the open web ("what's new in CRISPR this month"): one
 * Apify rag-web-browser call searches Google and extracts the top pages; the route returns up to 3
 * pages with verbatim key sentences and plain-text material the planner teaches from, with
 * citation numbers. The contract is lib/research/CONTRACT.md; these types are its source of truth.
 * Shared by the server and the browser.
 */

/** One web page. `n` is its citation number: [1] in the material, `cite: 1` on a beat. */
export interface ResearchItem {
  /** 1-based, in the order shown. */
  n: number;
  title: string;
  url: string;
  /** The host without "www.", e.g. "nobelprize.org". */
  site: string;
  /** When the page says it was published (or last updated), "YYYY-MM-DD"; null when it does not say. */
  published: string | null;
  /** Two or three sentences from the page, verbatim, in page order: the claim, a detail, a number when there is one. */
  key: string[];
}

/** "running" while the fetch is out; "ready" with items; "none" when nothing came back in the 8 s budget, the actor failed, or nothing usable was found. */
export type ResearchStatus = "running" | "ready" | "none";

/** POST /api/research and GET /api/research/<id> both return this. */
export interface ResearchRecord {
  id: string;
  /** The learner's question as sent. */
  question: string;
  /** The search sent to Google (the question, plus a recency hint when it asks for something recent). */
  query: string;
  /** The question asked for something recent (new, latest, this month, a year, a version), so the query got a hint and dated pages were preferred. */
  recent: boolean;
  status: ResearchStatus;
  /** 0 to 3. */
  items: ResearchItem[];
  /** Plain text for the planner (format in CONTRACT.md); "" unless status is "ready". */
  material: string;
  /** Served from experiments/research-cache without touching the network. */
  cached: boolean;
  startedAt: string;
  /** When the pages were fetched (for a cached record, the original fetch). */
  fetchedAt?: string;
  /** Fetch latency in ms (request to pages in hand), or the time until the budget ran out. */
  ms?: number;
  /** Why status is "none". */
  error?: string;
}

/** Research events, in the lesson transcript's shape (logEv({ kind, ... })). */
export type ResearchEvent =
  | { kind: "research-started"; id: string; query: string }
  | { kind: "research-cached"; id: string; items: number; fetchedAt?: string }
  | { kind: "research-ready"; id: string; items: number; ms?: number }
  | { kind: "research-none"; id: string | null; error: string; ms?: number };
