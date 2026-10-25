/**
 * Real web sources for a lesson (lib/sources/README.md): fetched in the background by an Apify
 * actor, cached per question on disk, shown as cards next to the board. Shared by the server
 * (lib/sources/apify.ts, app/api/sources) and the browser (components/SourceCards.tsx).
 */

/** One web page, cut into the paragraphs a beat can be matched against. */
export interface SourceCard {
  title: string;
  url: string;
  /** The host without "www.", e.g. "en.wikipedia.org". */
  site: string;
  /** The page's own description, or its first paragraph, shortened. */
  excerpt: string;
  /** Plain-text paragraphs of the page, in order (markdown stripped, boilerplate dropped). */
  paragraphs: string[];
}

export type SourcesStatus = "running" | "ready" | "failed" | "no-token";

/** What GET /api/sources/<id> returns, and what the cache file holds (minus id). */
export interface SourcesRecord {
  id: string;
  question: string;
  /** The search sent to the actor. */
  query: string;
  status: SourcesStatus;
  cards: SourceCard[];
  /** "apify" for a real fetch; "fixture" for the hand-written test set (never a real question's cache). */
  fetchedVia: "apify" | "fixture";
  /** How the actor was reached: its Standby web server, or a normal run. */
  mode?: "standby" | "run";
  /** The actor that fetched the pages. */
  actor: string;
  startedAt: string;
  fetchedAt?: string;
  /** Actor latency, from the request to the last page's text. */
  ms?: number;
  /** Served from experiments/sources-cache without touching the network. */
  cached: boolean;
  error?: string;
}

/** Source events, in the shape the lesson transcript stores (logEv({ kind, ... }) in components/Lesson.tsx). */
export type SourcesEvent =
  | { kind: "sources-started"; id: string; query: string }
  | { kind: "sources-cached"; id: string; cards: number; fetchedAt?: string }
  | { kind: "sources-ready"; id: string; cards: number; ms?: number; mode?: string }
  | { kind: "sources-failed"; id: string | null; error: string; ms?: number }
  | { kind: "sources-no-token" };
