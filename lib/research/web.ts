/**
 * Time-sensitive questions from the open web (lib/research/CONTRACT.md). Server only; APIFY_TOKEN
 * is read here. One call to Apify's rag-web-browser (Google search plus page extraction) through
 * its Standby web server; up to 3 pages kept, each with 2 or 3 verbatim key sentences.
 *
 * The lesson waits at most BUDGET_MS: past that, or on any actor error, the record settles as
 * "none" and the lesson says it found nothing recent. The fetch itself keeps going (up to
 * FETCH_TIMEOUT_SECS) and caches a late answer, so the same question asked again is instant.
 * Cached per normalised question under experiments/research-cache/.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toParagraphs } from "@/lib/sources/apify";
import { sentences, words } from "@/lib/sources/match";
import type { ResearchEvent, ResearchItem, ResearchRecord } from "./types";

const RAG_URL = "https://rag-web-browser.apify.actor/search";
export const BUDGET_MS = 8000;
const FETCH_TIMEOUT_SECS = 35;
const MAX_ITEMS = 3;
/** One spare page: a page often fails, sits behind a cookie wall, or is a video. */
const FETCH_PAGES = MAX_ITEMS + 1;
const RECENT_DAYS = 90;
const MAX_WORDS = 500;
const CACHE_DIR = () => join(process.cwd(), "experiments/research-cache");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com)$/;

export function apifyToken(): string | null {
  return process.env.APIFY_TOKEN?.trim() || null;
}

export function cacheKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "empty";
}

// ---- recency -----------------------------------------------------------------------------

/** The question asks for something recent: new / latest / this month / a year / a version number. */
export function asksRecent(question: string): boolean {
  return /\b(new|newest|latest|recent|recently|this (week|month|year)|today|right now|currently|current|update[sd]?|changed?|announced?)\b/i.test(question) || /\b20\d\d\b/.test(question) || /\b\d+\.\d+\b/.test(question);
}

/**
 * The search for Google. Only an explicit window gets a hint: "this week/month" → "… October 2026",
 * "this year" → "… 2026". "new" and "latest" go as asked: Google already favours fresh pages for
 * those, and an appended month pulled older pages in (README.md, measured 2026-10-25). Every
 * recent question still ranks pages dated in the last 90 days first.
 */
export function searchQuery(question: string, now = new Date()): { query: string; recent: boolean } {
  const q = question.trim().replace(/[?!.]+$/, "");
  const recent = asksRecent(q);
  if (/\b20\d\d\b/.test(q)) return { query: q, recent };
  if (/\bthis (week|month)\b/i.test(q)) return { query: `${q} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`, recent };
  if (/\bthis year\b/i.test(q)) return { query: `${q} ${now.getUTCFullYear()}`, recent };
  return { query: q, recent };
}

// ---- runs --------------------------------------------------------------------------------

interface Fetched {
  items: ResearchItem[];
  ms: number;
}
type Store = { runs: Map<string, ResearchRecord>; inflight: Map<string, Promise<Fetched>>; settled: Map<string, Promise<ResearchRecord>> };
const store: Store = ((globalThis as { __chalkyWeb?: Store }).__chalkyWeb ??= { runs: new Map(), inflight: new Map(), settled: new Map() });

export function getResearch(id: string): ResearchRecord | null {
  return store.runs.get(id) ?? null;
}

/** Resolves when the record is no longer "running" (at most the budget after it started). */
export function settled(id: string): Promise<ResearchRecord | null> {
  return store.settled.get(id) ?? Promise.resolve(getResearch(id));
}

function log(e: ResearchEvent & Record<string, unknown>) {
  console.log(`[research] ${JSON.stringify(e)}`);
}

/**
 * Starts (or joins) a fetch and returns the record at once: "ready" from the cache, else
 * "running" until the pages arrive or the budget runs out. Never throws for network trouble.
 * `budgetMs` (development) lets a pre-warm wait for slow fetches.
 */
export async function startResearch(question: string, opts: { fresh?: boolean; budgetMs?: number } = {}): Promise<ResearchRecord> {
  const key = cacheKey(question);
  const { query, recent } = searchQuery(question);
  const startedAt = new Date().toISOString();
  if (!opts.fresh) {
    const cached = await readCache(key);
    if (cached) {
      const rec: ResearchRecord = { ...cached, id: `${key}-cache`, cached: true };
      store.runs.set(rec.id, rec);
      log({ kind: "research-cached", id: rec.id, items: rec.items.length, fetchedAt: rec.fetchedAt, question });
      return rec;
    }
  }
  const id = `${key}-${Date.now().toString(36)}`;
  const rec: ResearchRecord = { id, question, query, recent, status: "running", items: [], material: "", cached: false, startedAt };
  store.runs.set(id, rec);
  const token = apifyToken();
  if (!token) {
    Object.assign(rec, { status: "none", error: "APIFY_TOKEN is not set", ms: 0 });
    log({ kind: "research-none", id, error: rec.error!, ms: 0, question });
    return rec;
  }
  log({ kind: "research-started", id, query, question });
  const t0 = Date.now();
  // One fetch per question at a time; a second ask while it is out joins it (with its own budget).
  let fetch = store.inflight.get(key);
  if (!fetch) {
    fetch = fetchPages(query, recent, token).finally(() => store.inflight.delete(key));
    store.inflight.set(key, fetch);
    // Whatever the lesson's budget did, a good answer goes in the cache.
    fetch
      .then((f) => (f.items.length ? writeCache(key, { question, query, recent, status: "ready", items: f.items, material: buildMaterial(question, f.items), cached: false, startedAt, fetchedAt: new Date().toISOString(), ms: f.ms }) : undefined))
      .catch(() => undefined);
  }
  const budget = opts.budgetMs ?? BUDGET_MS;
  const done = new Promise<ResearchRecord>((resolve) => {
    const timer = setTimeout(() => {
      if (rec.status !== "running") return;
      Object.assign(rec, { status: "none", ms: Date.now() - t0, error: `over the ${Math.round(budget / 1000)} s budget` });
      log({ kind: "research-none", id, error: rec.error!, ms: rec.ms, question });
      resolve(rec);
    }, budget);
    fetch!
      .then((f) => {
        if (rec.status !== "running") return log({ kind: "research-ready", id, items: f.items.length, ms: f.ms, question, late: true, cachedForNextTime: f.items.length > 0 });
        if (!f.items.length) Object.assign(rec, { status: "none", ms: f.ms, error: "no usable pages" });
        else Object.assign(rec, { status: "ready", items: f.items, material: buildMaterial(question, f.items), ms: f.ms, fetchedAt: new Date().toISOString() });
        log(f.items.length ? { kind: "research-ready", id, items: rec.items.length, ms: rec.ms, question } : { kind: "research-none", id, error: rec.error!, ms: rec.ms, question });
      })
      .catch((e) => {
        if (rec.status !== "running") return;
        Object.assign(rec, { status: "none", ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 200) });
        log({ kind: "research-none", id, error: rec.error!, ms: rec.ms, question });
      })
      .finally(() => {
        if (rec.status !== "running") {
          clearTimeout(timer);
          resolve(rec);
        }
      });
  });
  store.settled.set(id, done);
  return rec;
}

// ---- the actor ---------------------------------------------------------------------------

/** One dataset item of apify/rag-web-browser (only the fields used here). */
interface RagItem {
  crawl?: { httpStatusCode?: number };
  searchResult?: { title?: string; description?: string; url?: string };
  metadata?: { title?: string; url?: string; openGraph?: { property?: string; content?: string }[] | null; jsonLd?: unknown };
  markdown?: string;
}

async function fetchPages(query: string, recent: boolean, token: string): Promise<Fetched> {
  const t0 = Date.now();
  const params = new URLSearchParams({
    query,
    maxResults: String(FETCH_PAGES),
    scrapingTool: "raw-http",
    outputFormats: "markdown",
    requestTimeoutSecs: String(FETCH_TIMEOUT_SECS),
    maxRequestRetries: "0", // a page that fails is skipped, not retried: there is a spare
    removeCookieWarnings: "false",
  });
  const res = await fetch(`${RAG_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout((FETCH_TIMEOUT_SECS + 10) * 1000) });
  if (!res.ok) throw new Error(`rag-web-browser ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const raw = (await res.json()) as RagItem[];
  if (!Array.isArray(raw)) throw new Error("rag-web-browser returned something other than a list");
  return { items: toItems(query, raw, recent), ms: Date.now() - t0 };
}

export function toItems(query: string, raw: RagItem[], recent: boolean, now = new Date()): ResearchItem[] {
  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const pages: (Omit<ResearchItem, "n"> & { rank: number })[] = [];
  raw.forEach((it, rank) => {
    const url = it.metadata?.url || it.searchResult?.url || "";
    let site = "";
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }
    if (VIDEO_SITES.test(site)) return;
    // The page's own summary is often the best sentence (a press release's "awarded to … for …").
    const description = (it.metadata?.openGraph?.find((o) => o.property === "og:description")?.content || it.searchResult?.description || "").replace(/\s+/g, " ").trim();
    const summary = description.length > 60 && !/…$|\.\.\.$/.test(description) ? (/[.!?]["'”’)]?$/.test(description) ? description : `${description}.`) : "";
    const paragraphs = [...(summary ? [summary] : []), ...toParagraphs(it.markdown ?? "")];
    const key = keySentences(query, paragraphs);
    if (key.length < 2) return;
    const title = (it.metadata?.title || it.searchResult?.title || site).replace(/\s+/g, " ").trim().slice(0, 140);
    if (!onTopic(query, `${title} ${key.join(" ")}`)) return;
    pages.push({ title, url, site, published: pageDate(it, now), key, rank });
  });
  // For a recent question, pages dated in the last 90 days first (newest first), then the rest in
  // Google's order (an undated page is not ranked above an older dated one: the docs for a release
  // are often both the best page and a year old). Otherwise Google's order.
  const tier = (p: { published: string | null }) => (recent && p.published && p.published >= cutoff ? 0 : 1);
  pages.sort((a, b) => tier(a) - tier(b) || (recent && tier(a) === 0 ? (b.published ?? "").localeCompare(a.published ?? "") : 0) || a.rank - b.rank);
  return pages.slice(0, MAX_ITEMS).map(({ rank: _rank, ...p }, i) => ({ n: i + 1, ...p }));
}

// ---- key sentences -----------------------------------------------------------------------

const FILLER = new Set(words("new newest latest recent recently week month year today current currently update updated change changed what whats who won happen happening going on news technology technologies tech science field world industry " + MONTHS.join(" ")));

/** Banner, navigation and contact text: never a key sentence. */
export const BANNER = /cookie|consent|subscribe|newsletter|sign (up|in)|log in|javascript|privacy|all rights reserved|press contact|\+\d{1,3} \d{2}|www\.|@[a-z0-9-]+\.[a-z]/i;

/** The question's content words (minus "new", "latest", years…), for matching. */
function contentWords(query: string): Set<string> {
  return new Set(words(query).filter((w) => !FILLER.has(w) && !/^20\d\d$/.test(w)));
}

/**
 * The page is about the question: its title and key sentences carry every content word (two or
 * fewer), or two thirds of them. Keeps "Physics - Wikipedia" out of a Nobel question.
 */
export function onTopic(query: string, text: string): boolean {
  const want = contentWords(query);
  if (!want.size) return true;
  const got = new Set(words(text));
  const hits = [...want].filter((w) => got.has(w)).length;
  return want.size <= 2 ? hits === want.size : hits >= Math.ceil((want.size * 2) / 3);
}

/** Two or three sentences in page order: the two that share most words with the question, plus one with a number. */
export function keySentences(query: string, paragraphs: string[]): string[] {
  const want = contentWords(query);
  // No banner or navigation text, and each sentence once (a page's description often repeats its first paragraph).
  const seen = new Set<string>();
  const all = paragraphs
    .flatMap((p) => sentences(p))
    .filter((s) => s.length >= 40 && s.length <= 320 && !/\|/.test(s) && !BANNER.test(s))
    .filter((s) => {
      const k = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return !seen.has(k) && !!seen.add(k);
    });
  if (!all.length) return [];
  const scored = all.map((s, i) => {
    const got = new Set(words(s));
    let score = 0;
    for (const w of got) if (want.has(w)) score += 1;
    return { i, s, score, num: /\d/.test(s.replace(/\b(19|20)\d\d\b/g, "")) || /\b(19|20)\d\d\b/.test(s) };
  });
  const byScore = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const pick = new Map<number, string>();
  for (const x of byScore) {
    if (pick.size >= 2) break;
    if (x.score > 0 || !pick.size) pick.set(x.i, x.s);
  }
  const withNumber = byScore.find((x) => x.num && x.score > 0 && !pick.has(x.i));
  if (withNumber) pick.set(withNumber.i, withNumber.s);
  else if (pick.size < 2) {
    const next = byScore.find((x) => !pick.has(x.i));
    if (next) pick.set(next.i, next.s);
  }
  return [...pick.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

// ---- dates -------------------------------------------------------------------------------

const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const monthIndex = (m: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m.slice(0, 3).toLowerCase());

/** When the page says it was published (or modified): JSON-LD, then Open Graph, then a date near the top of the text. */
export function pageDate(it: RagItem, now = new Date()): string | null {
  const today = now.toISOString().slice(0, 10);
  const ok = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today && d >= "1995-01-01" ? d : null);
  const ld = { published: [] as string[], modified: [] as string[] };
  const walk = (v: unknown, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "string" && /^datePublished$|^uploadDate$/.test(k)) ld.published.push(x.slice(0, 10));
      else if (typeof x === "string" && k === "dateModified") ld.modified.push(x.slice(0, 10));
      else walk(x, depth + 1);
    }
  };
  walk(it.metadata?.jsonLd);
  const og = (p: string) => it.metadata?.openGraph?.find((o) => o.property === p)?.content?.slice(0, 10);
  const published = [...ld.published, og("article:published_time")].find(ok);
  const modified = [...ld.modified, og("article:modified_time")].find(ok);
  // A reference page (Wikipedia) was "published" years ago and kept current: show when it was updated.
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  if (published && modified && published < yearAgo && modified > published) return modified;
  if (published || modified) return (published ?? modified)!;
  // A date written near the top of the page: "October 22, 2026", "22 Oct 2026", "2026-10-22".
  const top = (it.markdown ?? "").slice(0, 3000);
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const m of top.matchAll(new RegExp(`\\b(${MON})[a-z]*\\.? (\\d{1,2}),? (20\\d\\d)\\b|\\b(\\d{1,2}) (${MON})[a-z]*\\.? (20\\d\\d)\\b|\\b(20\\d\\d)-(\\d{2})-(\\d{2})\\b`, "gi"))) {
    const d = m[1] ? `${m[3]}-${pad(monthIndex(m[1]) + 1)}-${pad(+m[2])}` : m[5] ? `${m[6]}-${pad(monthIndex(m[5]) + 1)}-${pad(+m[4])}` : `${m[7]}-${m[8]}-${m[9]}`;
    if (ok(d)) return d;
  }
  return null;
}

// ---- material ----------------------------------------------------------------------------

/** The planner's material (format in CONTRACT.md), under MAX_WORDS. */
export function buildMaterial(question: string, items: ResearchItem[], now = new Date()): string {
  if (!items.length) return "";
  const head = `Recent web pages for "${question}" (searched ${now.toISOString().slice(0, 10)}). ${items.length > 1 ? `Cite them as [1] to [${items.length}].` : "Cite it as [1]."}`;
  let keys = items.map((it) => [...it.key]);
  const text = () => [head, ...items.slice(0, keys.length).map((it, i) => `[${it.n}] ${it.title} (${it.site}, ${it.published ?? "undated"})\n${keys[i].join(" ")}`)].join("\n\n");
  const count = () => text().split(/\s+/).length;
  // Over budget: drop third sentences, then second ones, then the last page.
  for (const keep of [2, 1]) if (count() > MAX_WORDS) keys = keys.map((k) => k.slice(0, keep));
  while (count() > MAX_WORDS && keys.length > 1) keys = keys.slice(0, -1);
  return text();
}

// ---- the cache ---------------------------------------------------------------------------

async function readCache(key: string): Promise<ResearchRecord | null> {
  try {
    const rec = JSON.parse(await readFile(join(CACHE_DIR(), `${key}.json`), "utf8")) as ResearchRecord;
    return rec.status === "ready" && rec.items?.length ? rec : null;
  } catch {
    return null;
  }
}

/** How good an answer is for the demo: pages dated in the last 90 days, then pages. */
function quality(items: ResearchItem[], now = new Date()): number {
  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return items.filter((i) => i.published && i.published >= cutoff).length * 10 + items.length;
}

async function writeCache(key: string, rec: Omit<ResearchRecord, "id">) {
  try {
    // Google's results vary from run to run: a fresh fetch replaces the cached answer only when it is at least as good.
    const old = await readCache(key);
    if (old && quality(old.items) > quality(rec.items)) return console.log(`[research] kept the cached answer for "${rec.question}" (better than this fetch)`);
    await mkdir(CACHE_DIR(), { recursive: true });
    const path = join(CACHE_DIR(), `${key}.json`);
    const tmp = `${path}.${process.pid}.tmp`;
    const { cached: _cached, ...keep } = rec;
    await writeFile(tmp, JSON.stringify(keep, null, 2));
    await rename(tmp, path);
  } catch (e) {
    console.warn(`[research] cache write failed: ${(e as Error).message}`);
  }
}
