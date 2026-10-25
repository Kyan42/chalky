/**
 * "Teach me what's new": recent research papers on a topic, fetched through Apify (or arXiv's own
 * API as the fallback), cached per topic and window, and turned into plain-text material the
 * planner teaches from, with citation numbers. The contract is lib/research/CONTRACT.md; these
 * types are its source of truth. Shared by the server and the browser.
 */

/** One paper. `n` is its citation number: [1] in the material, `cite: 1` on a beat. */
export interface Paper {
  /** 1-based, newest first. */
  n: number;
  /** "2610.12345" (no version suffix). */
  arxivId: string;
  title: string;
  /** In paper order; at most 8, then "et al." is implied by `authorCount`. */
  authors: string[];
  authorCount: number;
  /** First submission date, "YYYY-MM-DD". */
  published: string;
  /** The abstract page, https://arxiv.org/abs/<id>. */
  url: string;
  pdfUrl: string;
  /** Primary arXiv category, e.g. "cs.RO"; "" when unknown. */
  category: string;
  /** The whole abstract, whitespace collapsed. */
  abstract: string;
  /** Two or three sentences from the abstract, in abstract order: the claim, the method, a number when there is one. */
  key: string[];
}

export type ResearchStatus = "running" | "ready" | "failed";

/** Where the papers came from. "arxiv-api" is the free fallback when Apify is unavailable. */
export type ResearchVia = "apify-arxiv" | "apify-rag" | "arxiv-api" | "fixture";

/** POST /api/research and GET /api/research/<id> both return this. */
export interface ResearchRecord {
  id: string;
  topic: string;
  /** The window asked for, in days. */
  days: number;
  /** The window actually searched (widened to 30, then 90 days when fewer than 3 papers came back). */
  searchedDays: number;
  /** Date range searched, "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
  status: ResearchStatus;
  /** 0 to 5, newest first. Empty with status "ready" means nothing recent was found. */
  papers: Paper[];
  /** Plain text for the planner (format in CONTRACT.md); "" until ready, and when no papers. */
  material: string;
  via: ResearchVia | null;
  /** Served from experiments/research-cache without touching the network. */
  cached: boolean;
  startedAt: string;
  fetchedAt?: string;
  /** Fetch latency (request to papers in hand). */
  ms?: number;
  error?: string;
}

/** Research events, in the lesson transcript's shape (logEv({ kind, ... })). */
export type ResearchEvent =
  | { kind: "research-started"; id: string; topic: string; days: number }
  | { kind: "research-cached"; id: string; papers: number; fetchedAt?: string }
  | { kind: "research-ready"; id: string; papers: number; ms?: number; via: ResearchVia | null; searchedDays: number }
  | { kind: "research-failed"; id: string | null; error: string; ms?: number };
