/**
 * Fetches two or three real web pages for a lesson with Apify's RAG Web Browser actor
 * (apify/rag-web-browser: one Google search plus each top result's text as markdown), keeps them
 * on disk per question, and tracks runs in flight. Server only; APIFY_TOKEN is read here.
 *
 * The actor is reached through its Standby web server first (no actor start, the fastest path),
 * and through a normal run (apify-client .call) if Standby fails. Nothing here is on the lesson's
 * critical path: the route starts a fetch and returns at once, and the page polls.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApifyClient } from "apify-client";
import type { SourceCard, SourcesEvent, SourcesRecord } from "./types";

export const ACTOR = "apify/rag-web-browser";
const STANDBY_URL = "https://rag-web-browser.apify.actor/search";
const MAX_RESULTS = 3;
/** The actor's own budget for search plus pages; Standby gets a little longer on the socket. */
const REQUEST_TIMEOUT_SECS = 45;
const CACHE_DIR = () => join(process.cwd(), "experiments/sources-cache");
const FIXTURE = "_fixture";

export function apifyToken(): string | null {
  return process.env.APIFY_TOKEN?.trim() || null;
}

/** "What is photosynthesis?" → "what-is-photosynthesis": the cache file's name. Never starts with "_". */
export function cacheKey(question: string): string {
  return (
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "empty"
  );
}

/** The search sent to Google: the learner's question as asked, minus video sites. */
export function searchQuery(question: string, title?: string): string {
  const q = question.trim().replace(/[?!.]+$/, "") || (title ?? "").trim();
  return `${q} -site:youtube.com -site:tiktok.com`;
}

// ---- runs in flight ----------------------------------------------------------------------

type Store = { runs: Map<string, SourcesRecord>; byKey: Map<string, string> };
// On globalThis so a hot reload in `next dev` does not forget runs that are still going.
const store: Store = ((globalThis as { __chalkySources?: Store }).__chalkySources ??= { runs: new Map(), byKey: new Map() });

export function getRun(id: string): SourcesRecord | null {
  return store.runs.get(id) ?? null;
}

function log(e: SourcesEvent & { question?: string }) {
  console.log(`[sources] ${JSON.stringify(e)}`);
}

/**
 * Starts (or reuses) a fetch for a question and returns its record at once: ready from the cache,
 * running (poll getRun), or no-token. Never throws for network trouble; a failed fetch is a record.
 */
export async function startSources(question: string, title?: string, opts: { fixture?: boolean; fresh?: boolean } = {}): Promise<SourcesRecord> {
  const key = opts.fixture ? FIXTURE : cacheKey(question);
  const query = searchQuery(question, title);
  if (!opts.fresh) {
    const cached = await readCache(key);
    if (cached) {
      const rec: SourcesRecord = { ...cached, id: `${key}-cache`, cached: true };
      store.runs.set(rec.id, rec);
      log({ kind: "sources-cached", id: rec.id, cards: rec.cards.length, fetchedAt: rec.fetchedAt, question });
      return rec;
    }
  }
  if (opts.fixture) throw new Error("fixture file experiments/sources-cache/_fixture.json is missing");
  // A second request for the same question while the first is still out shares it.
  const inFlight = store.byKey.get(key);
  const running = inFlight ? store.runs.get(inFlight) : undefined;
  if (running?.status === "running") return running;

  const startedAt = new Date().toISOString();
  const base = { question, query, cards: [], fetchedVia: "apify" as const, actor: ACTOR, startedAt, cached: false };
  const token = apifyToken();
  if (!token) {
    log({ kind: "sources-no-token" });
    return { ...base, id: "no-token", status: "no-token", error: "APIFY_TOKEN is not set (lib/sources/README.md)" };
  }
  const id = `${key}-${Date.now().toString(36)}`;
  const rec: SourcesRecord = { ...base, id, status: "running" };
  store.runs.set(id, rec);
  store.byKey.set(key, id);
  log({ kind: "sources-started", id, query, question });
  const t0 = Date.now();
  void fetchPages(query, token)
    .then(async ({ cards, mode }) => {
      if (!cards.length) throw new Error("the actor returned no pages with text");
      Object.assign(rec, { status: "ready", cards, mode, ms: Date.now() - t0, fetchedAt: new Date().toISOString() });
      await writeCache(key, rec);
      log({ kind: "sources-ready", id, cards: cards.length, ms: rec.ms, mode, question });
    })
    .catch((e) => {
      Object.assign(rec, { status: "failed", ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 300) });
      log({ kind: "sources-failed", id, error: rec.error!, ms: rec.ms, question });
    });
  return rec;
}

// ---- the actor ---------------------------------------------------------------------------

/** One dataset item of apify/rag-web-browser (only the fields used here). */
interface RagItem {
  crawl?: { httpStatusCode?: number; requestStatus?: string };
  searchResult?: { title?: string; description?: string; url?: string };
  metadata?: { title?: string; description?: string; url?: string };
  markdown?: string;
  text?: string;
}

async function fetchPages(query: string, token: string): Promise<{ cards: SourceCard[]; mode: "standby" | "run" }> {
  try {
    return { cards: toCards(await viaStandby(query, token)), mode: "standby" };
  } catch (e) {
    console.warn(`[sources] standby failed, starting a normal run: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    return { cards: toCards(await viaRun(query, token)), mode: "run" };
  }
}

async function viaStandby(query: string, token: string): Promise<RagItem[]> {
  const params = new URLSearchParams({
    query,
    maxResults: String(MAX_RESULTS),
    scrapingTool: "raw-http",
    outputFormats: "markdown",
    requestTimeoutSecs: String(REQUEST_TIMEOUT_SECS),
    removeCookieWarnings: "false",
  });
  // The token goes in the header, not the URL, so it never lands in a log line.
  const res = await fetch(`${STANDBY_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout((REQUEST_TIMEOUT_SECS + 15) * 1000),
  });
  if (!res.ok) throw new Error(`standby ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = (await res.json()) as RagItem[];
  if (!Array.isArray(items)) throw new Error("standby returned something other than a list");
  return items;
}

async function viaRun(query: string, token: string): Promise<RagItem[]> {
  const client = new ApifyClient({ token });
  const run = await client.actor(ACTOR).call(
    { query, maxResults: MAX_RESULTS, scrapingTool: "raw-http", outputFormats: ["markdown"], requestTimeoutSecs: REQUEST_TIMEOUT_SECS, removeCookieWarnings: false },
    // 4 GB starts cheaper than the actor's 8 GB default; raw-http needs no browser.
    { memory: 4096, timeout: 120, waitSecs: 150, log: null },
  );
  if (run.status !== "SUCCEEDED") throw new Error(`actor run ${run.id} ended ${run.status}`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true, limit: 10 });
  return items as RagItem[];
}

function toCards(items: RagItem[]): SourceCard[] {
  const cards: SourceCard[] = [];
  for (const it of items) {
    const url = it.metadata?.url || it.searchResult?.url || "";
    const paragraphs = toParagraphs(it.markdown || it.text || "");
    if (!url || paragraphs.length < 2) continue;
    let site = "";
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const description = clean(it.searchResult?.description || it.metadata?.description || "");
    cards.push({
      title: clean(it.metadata?.title || it.searchResult?.title || site).slice(0, 140),
      url,
      site,
      excerpt: shorten(description.length > 40 ? description : paragraphs[0], 220),
      paragraphs,
    });
  }
  return cards.slice(0, MAX_RESULTS);
}

/** Markdown → plain paragraphs of real prose: no headings, lists of links, tables, code or cookie text. */
export function toParagraphs(md: string): string[] {
  const out: string[] = [];
  let total = 0;
  for (const block of md.replace(/\r/g, "").split(/\n\s*\n/)) {
    const raw = block.trim();
    if (!raw || /^(#|\||```|>?\s*!\[)/.test(raw)) continue;
    const text = clean(raw);
    const words = text.split(/\s+/).length;
    if (words < 12 || text.length < 80) continue;
    if (!/[.!?]["')\]]?$/.test(text)) continue; // menus and captions rarely end a sentence
    if (/cookie|privacy policy|subscribe|sign up|log in|javascript|all rights reserved/i.test(text) && words < 60) continue;
    out.push(text.length > 900 ? shorten(text, 900) : text);
    total += text.length;
    if (out.length >= 40 || total > 20000) break;
  }
  return out;
}

function clean(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their words
    .replace(/\[\d+\]|\[citation needed\]|\[edit\]/gi, "") // wiki footnotes
    .replace(/[*_`~]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

// ---- the cache ---------------------------------------------------------------------------

async function readCache(key: string): Promise<SourcesRecord | null> {
  try {
    const rec = JSON.parse(await readFile(join(CACHE_DIR(), `${key}.json`), "utf8")) as SourcesRecord;
    return rec.status === "ready" && rec.cards?.length ? rec : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, rec: SourcesRecord) {
  await mkdir(CACHE_DIR(), { recursive: true });
  const path = join(CACHE_DIR(), `${key}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  const { id: _id, cached: _cached, ...keep } = rec;
  await writeFile(tmp, JSON.stringify(keep, null, 2));
  await rename(tmp, path);
}
