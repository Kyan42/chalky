/**
 * Recent papers on a topic (lib/research/CONTRACT.md). Server only; APIFY_TOKEN is read here.
 *
 * Paths, in order: the Apify path chosen in lib/research/README.md (an arXiv scraper actor, or
 * rag-web-browser scoped to arxiv.org), then arXiv's own free API as the fallback when there is no
 * token or the Apify path fails, so a demo never ends with no papers because of one service. Every
 * record says which path it came from (`via`).
 *
 * Papers are ranked by how well title and abstract match the topic, the best five kept, then sorted
 * newest first. The window widens to 30, then 90 days when fewer than 3 papers come back.
 * Results are cached per normalised topic and window under experiments/research-cache/.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApifyClient } from "apify-client";
import { sentences, words } from "@/lib/sources/match";
import type { Paper, ResearchEvent, ResearchRecord, ResearchVia } from "./types";

/** Which Apify path to try first (set from the measurements in README.md). */
export const APIFY_PATH: "apify-arxiv" | "apify-rag" = "apify-arxiv";
/** The arXiv scraper actor for "apify-arxiv": takes arXiv's own query syntax, so it searches exactly like the fallback (README.md). */
export const ARXIV_ACTOR = "dami_studio/arxiv-scraper";
const RAG_URL = "https://rag-web-browser.apify.actor/search";
const MAX_PAPERS = 5;
const MIN_PAPERS = 3;
const WIDEN = [30, 90];
const CACHE_DIR = () => join(process.cwd(), "experiments/research-cache");

export function apifyToken(): string | null {
  return process.env.APIFY_TOKEN?.trim() || null;
}

/** "teach me the latest on LLM agents this week" → "LLM agents". */
export function cleanTopic(raw: string): string {
  return raw
    .replace(/\b(teach me|tell me|show me|explain|what('s| is| are)|whats|give me|can you|please)\b/gi, " ")
    .replace(/\b(the )?(newest|latest|most recent|recent|new)( (research|papers?|work|results|developments|stuff|news))?( (on|about|in))?\b/gi, " ")
    .replace(/\b(this|last|past) (week|month|year|few days|couple of weeks)\b/gi, " ")
    .replace(/\b(papers?|research) (on|about|in)\b/gi, " ")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(on|about|in) /i, "");
}

export function cacheKey(topic: string, days: number): string {
  return `${cleanTopic(topic).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "empty"}-${days}d`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function windowOf(days: number, now = new Date()) {
  const from = new Date(now.getTime() - days * 86_400_000);
  return { from: iso(from), to: iso(now) };
}

// ---- runs in flight ----------------------------------------------------------------------

type Store = { runs: Map<string, ResearchRecord>; byKey: Map<string, string> };
const store: Store = ((globalThis as { __chalkyResearch?: Store }).__chalkyResearch ??= { runs: new Map(), byKey: new Map() });

export function getResearch(id: string): ResearchRecord | null {
  return store.runs.get(id) ?? null;
}

function log(e: ResearchEvent) {
  console.log(`[research] ${JSON.stringify(e)}`);
}

/** Starts (or reuses) a fetch and returns the record at once: ready from the cache, or running. */
export async function startResearch(rawTopic: string, days = 14, opts: { fresh?: boolean; fixture?: boolean; only?: ResearchVia } = {}): Promise<ResearchRecord> {
  const topic = cleanTopic(rawTopic) || rawTopic.trim();
  days = Math.min(90, Math.max(1, Math.round(days)));
  const key = opts.fixture ? "_fixture" : cacheKey(topic, days);
  // Forcing a path is a measurement: never served from (or written to) the cache.
  if ((!opts.fresh && !opts.only) || opts.fixture) {
    const cached = await readCache(key);
    if (cached) {
      const rec: ResearchRecord = { ...cached, id: `${key}-cache`, cached: true };
      store.runs.set(rec.id, rec);
      log({ kind: "research-cached", id: rec.id, papers: rec.papers.length, fetchedAt: rec.fetchedAt });
      return rec;
    }
    if (opts.fixture) throw new Error("experiments/research-cache/_fixture.json is missing");
  }
  const running = store.runs.get(store.byKey.get(key) ?? "");
  if (running?.status === "running" && !opts.only) return running;

  const id = `${key}-${Date.now().toString(36)}`;
  const rec: ResearchRecord = { id, topic, days, searchedDays: days, ...windowOf(days), status: "running", papers: [], material: "", via: null, cached: false, startedAt: new Date().toISOString() };
  store.runs.set(id, rec);
  store.byKey.set(key, id);
  log({ kind: "research-started", id, topic, days });
  const t0 = Date.now();
  void findPapers(topic, days, opts.only)
    .then(async ({ papers, via, searchedDays }) => {
      Object.assign(rec, { papers, via, searchedDays, ...windowOf(searchedDays), status: "ready", ms: Date.now() - t0, fetchedAt: new Date().toISOString() });
      rec.material = buildMaterial(rec);
      // Only a complete answer is cached; an empty one may just be a bad moment for the network.
      if (papers.length && !opts.only) await writeCache(key, rec).catch((e) => console.warn(`[research] cache write failed: ${(e as Error).message}`));
      log({ kind: "research-ready", id, papers: papers.length, ms: rec.ms, via, searchedDays });
    })
    .catch((e) => {
      Object.assign(rec, { status: "failed", ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 300) });
      log({ kind: "research-failed", id, error: rec.error!, ms: rec.ms });
    });
  return rec;
}

/** Tries each path in turn; widens the window when a path finds too few papers. */
async function findPapers(topic: string, days: number, only?: ResearchVia): Promise<{ papers: Paper[]; via: ResearchVia; searchedDays: number }> {
  const token = apifyToken();
  const paths: ResearchVia[] = only ? [only] : [...(token ? [APIFY_PATH] : []), "arxiv-api"];
  const errors: string[] = [];
  for (const via of paths) {
    try {
      let best: Raw[] = [];
      let searched = days;
      for (const d of [days, ...WIDEN.filter((w) => w > days)]) {
        const found = rank(topic, await fetchVia(via, topic, d, token));
        searched = d;
        best = found;
        if (found.length >= MIN_PAPERS) break;
      }
      if (best.length || via === paths[paths.length - 1]) return { papers: number(best), via, searchedDays: searched };
      errors.push(`${via}: no papers`);
    } catch (e) {
      errors.push(`${via}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      console.warn(`[research] ${errors[errors.length - 1]}`);
    }
  }
  throw new Error(errors.join("; "));
}

function fetchVia(via: ResearchVia, topic: string, days: number, token: string | null): Promise<Raw[]> {
  if (via === "arxiv-api") return viaArxivApi(topic, days);
  if (!token) throw new Error("no APIFY_TOKEN");
  if (via === "apify-rag") return viaRag(topic, days, token);
  if (via === "apify-arxiv") return viaArxivActor(topic, days, token);
  throw new Error(`no fetch for ${via}`);
}

/** A paper as fetched, before ranking. */
interface Raw {
  arxivId: string;
  title: string;
  authors: string[];
  published: string;
  category: string;
  abstract: string;
}

// ---- ranking -----------------------------------------------------------------------------

function rank(topic: string, raws: Raw[]): Raw[] {
  const want = [...new Set(words(topic))];
  // Short acronyms ("AI", "RL") are too short for words(); match them case-sensitively as whole words.
  const acronyms = (topic.match(/\b[A-Z][A-Z0-9]{1,2}\b/g) ?? []).map((a) => new RegExp(`\\b${a}s?\\b`));
  if (!want.length && !acronyms.length) return [];
  const phrase = topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  const scored = raws
    .filter((r) => r.arxivId && r.title && r.abstract.length > 200 && !seen.has(r.arxivId) && seen.add(r.arxivId))
    .map((r) => {
      const t = new Set(words(r.title));
      const a = new Set(words(r.abstract));
      const inTitle = want.filter((w) => t.has(w)).length + acronyms.filter((re) => re.test(r.title)).length;
      const inAbstract = want.filter((w) => a.has(w)).length + acronyms.filter((re) => re.test(r.abstract)).length;
      // The topic as a phrase ("voice ai", "llm agents") is the strongest signal.
      const flatText = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      const asPhrase = phrase.includes(" ") ? (flatText(r.title).includes(` ${phrase} `) ? 4 : flatText(r.abstract).includes(` ${phrase} `) ? 2 : 0) : 0;
      const all = want.every((w) => t.has(w) || a.has(w)) && acronyms.every((re) => re.test(r.title) || re.test(r.abstract));
      return { r, score: asPhrase + inTitle * 2 + inAbstract, all };
    })
    // Every topic word somewhere in the title or abstract; phrase and title hits rank first.
    .filter((x) => x.all)
    .sort((a, b) => b.score - a.score || b.r.published.localeCompare(a.r.published));
  return scored.slice(0, MAX_PAPERS).map((x) => x.r);
}

function number(raws: Raw[]): Paper[] {
  return [...raws]
    .sort((a, b) => b.published.localeCompare(a.published))
    .map((r, i) => ({
      n: i + 1,
      arxivId: r.arxivId,
      title: r.title,
      authors: r.authors.slice(0, 8),
      authorCount: r.authors.length,
      published: r.published,
      url: `https://arxiv.org/abs/${r.arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${r.arxivId}`,
      category: r.category,
      abstract: r.abstract,
      key: keySentences(r.abstract),
    }));
}

/** The claim, the method and a number, in abstract order; two or three sentences. */
export function keySentences(abstract: string): string[] {
  const ss = sentences(abstract).filter((s) => s.length > 30);
  if (ss.length <= 3) return ss;
  const pick = new Set<number>();
  const find = (re: RegExp, from = 0) => ss.findIndex((s, i) => i >= from && !pick.has(i) && re.test(s));
  const claim = find(/\b(we (propose|introduce|present|develop|show|study|investigate|build)|this (paper|work)|in this (paper|work)|here,? we)\b/i);
  pick.add(claim >= 0 ? claim : 0);
  const method = find(/\b(by|using|via|through|leverag|consist|combin|train|architecture|framework|pipeline|approach|method)\w*/i, [...pick][0] + 1);
  if (method >= 0) pick.add(method);
  const num = find(/\d+(\.\d+)?\s*(%|x\b|×|times|points|pp\b)|\b\d+(\.\d+)?\s*(percent|fold)|state[- ]of[- ]the[- ]art|outperform/i);
  if (num >= 0) pick.add(num);
  if (pick.size < 2) pick.add(ss.findIndex((_, i) => !pick.has(i)));
  return [...pick].sort((a, b) => a - b).slice(0, 3).map((i) => ss[i]);
}

/** The planner's material (format in CONTRACT.md). */
export function buildMaterial(rec: ResearchRecord): string {
  if (!rec.papers.length) return "";
  const widened = rec.searchedDays > rec.days ? `; nothing in the last ${rec.days} days, so the last ${rec.searchedDays}` : "";
  const head = `Recent papers on "${rec.topic}", submitted ${rec.from} to ${rec.to} (arXiv${widened}). Cite them as [1] to [${rec.papers.length}].`;
  const blocks = rec.papers.map((p) => {
    const by = p.authorCount > 2 ? `${surname(p.authors[0])} et al.` : p.authors.map(surname).join(" and ");
    return `[${p.n}] ${p.title} (${by}, ${p.published}, arXiv:${p.arxivId})\n${p.key.join(" ")}`;
  });
  // Five papers of three sentences is ~500 words; the cap only matters for freak abstracts.
  while (blocks.length > 1 && [head, ...blocks].join(" ").split(/\s+/).length > 1500) blocks.pop();
  return [head, ...blocks].join("\n\n");
}

function surname(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

// ---- arXiv's own API (the fallback) ------------------------------------------------------

/** arXiv query syntax: every topic word in the title or abstract, submitted inside the window. */
export function arxivQuery(topic: string, days: number): string {
  const { from, to } = windowOf(days);
  const terms = topic.replace(/["():]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^(and|or|not|the|of|for|in|on)$/i.test(w));
  return terms.map((w) => `(ti:${w} OR abs:${w})`).join(" AND ") + ` AND submittedDate:[${from.replace(/-/g, "")}0000 TO ${to.replace(/-/g, "")}2359]`;
}

async function viaArxivApi(topic: string, days: number): Promise<Raw[]> {
  const q = arxivQuery(topic, days);
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "chalky-hackathon/0.1 (teaching app)" } });
  if (!res.ok) throw new Error(`arXiv API ${res.status}`);
  return parseAtom(await res.text());
}

export function parseAtom(xml: string): Raw[] {
  const out: Raw[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const tag = (t: string) => decode(e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");
    const id = tag("id").match(/abs\/([^v\s]+?)(v\d+)?$/)?.[1] ?? "";
    out.push({
      arxivId: id,
      title: flat(tag("title")),
      authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => flat(decode(a[1]))),
      published: tag("published").slice(0, 10),
      category: e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? "",
      abstract: flat(tag("summary")),
    });
  }
  return out;
}

// ---- Apify: rag-web-browser scoped to arxiv.org ------------------------------------------

/** One result of rag-web-browser (only the fields used). */
interface RagItem {
  metadata?: { title?: string; url?: string; description?: string };
  searchResult?: { title?: string; url?: string; description?: string };
  markdown?: string;
}

async function viaRag(topic: string, days: number, token: string): Promise<Raw[]> {
  const { from } = windowOf(days);
  const params = new URLSearchParams({
    query: `site:arxiv.org/abs ${topic} after:${from}`,
    maxResults: "6",
    scrapingTool: "raw-http",
    outputFormats: "markdown",
    requestTimeoutSecs: "40",
    removeCookieWarnings: "false",
  });
  const res = await fetch(`${RAG_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(55_000) });
  if (!res.ok) throw new Error(`rag-web-browser ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const items = (await res.json()) as RagItem[];
  const cutoff = from;
  return items.map(fromAbsPage).filter((r): r is Raw => !!r && r.published >= cutoff);
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** An arxiv.org/abs page as markdown → a paper (title, authors, "Submitted on", "Abstract:"). */
export function fromAbsPage(it: RagItem): Raw | null {
  const url = it.metadata?.url || it.searchResult?.url || "";
  const arxivId = url.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})/)?.[1];
  const md = it.markdown ?? "";
  if (!arxivId || !md) return null;
  const sub = md.match(/Submitted on (\d{1,2}) (\w{3})\w* (\d{4})/i);
  const published = sub ? `${sub[3]}-${MONTHS[sub[2].toLowerCase()] ?? "01"}-${sub[1].padStart(2, "0")}` : "";
  const abs = md.match(/Abstract:\s*([\s\S]*?)(?:\n\s*\n(?:Comments|Subjects|Submission history|Cite as)|\n#|$)/i)?.[1] ?? "";
  const title = flat((it.metadata?.title || it.searchResult?.title || "").replace(/^\[[^\]]+\]\s*/, "").replace(/\s*-\s*arXiv.*$/i, ""));
  const authors = md.match(/Authors?:\s*([^\n]+)/i)?.[1]?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").split(/,\s*/).map(flat).filter(Boolean) ?? [];
  const category = md.match(/\(([a-z-]+\.[A-Z]{2})\)/)?.[1] ?? "";
  if (!published || !abs) return null;
  return { arxivId, title, authors, published, category, abstract: flat(abs.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")) };
}

// ---- Apify: an arXiv scraper actor -------------------------------------------------------

async function viaArxivActor(topic: string, days: number, token: string): Promise<Raw[]> {
  if (!ARXIV_ACTOR) throw new Error("no arXiv actor chosen (README.md)");
  const client = new ApifyClient({ token });
  const run = await client.actor(ARXIV_ACTOR).call({ query: arxivQuery(topic, days), sortBy: "submittedDate", maxItems: 25 }, { timeout: 60, waitSecs: 70, log: null });
  if (run.status !== "SUCCEEDED") throw new Error(`actor run ${run.id} ended ${run.status}`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true, limit: 40 });
  const { from } = windowOf(days);
  return (items as Record<string, unknown>[]).map(fromActorItem).filter((r) => r.published >= from);
}

/** Field names vary between arXiv actors; take the common spellings. */
function fromActorItem(it: Record<string, unknown>): Raw {
  const s = (...keys: string[]) => {
    for (const k of keys) if (typeof it[k] === "string" && it[k]) return it[k] as string;
    return "";
  };
  const url = s("url", "link", "id", "arxivUrl", "absUrl");
  const authors = Array.isArray(it.authors) ? (it.authors as unknown[]).map((a) => (typeof a === "string" ? a : String((a as { name?: string })?.name ?? ""))) : s("authors").split(/,\s*/);
  return {
    arxivId: s("arxivId", "arxiv_id", "paperId") || (url.match(/(\d{4}\.\d{4,5})/)?.[1] ?? ""),
    title: flat(s("title")),
    authors: authors.map(flat).filter(Boolean),
    published: s("publishedAt", "published", "publishedDate", "submittedDate", "firstSubmitted", "submitted", "date").slice(0, 10),
    category: s("primaryCategory", "primary_category", "category") || (Array.isArray(it.categories) ? String(it.categories[0] ?? "") : ""),
    abstract: flat(s("abstract", "summary")),
  };
}

// ---- text --------------------------------------------------------------------------------

function decode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Whitespace collapsed and simple LaTeX flattened: $\sim$40\% → ~40%. */
export function flat(s: string): string {
  return s
    .replace(/\$\\sim\$|\\sim/g, "~")
    .replace(/\$\\times\$|\\times/g, "×")
    .replace(/\$\\approx\$|\\approx/g, "≈")
    .replace(/\\%/g, "%")
    .replace(/\\(textbf|textit|emph|mathrm|mathbf|text)\{([^}]*)\}/g, "$2")
    .replace(/\$([^$]{1,40})\$/g, "$1")
    .replace(/\\[a-zA-Z]+\b ?/g, "") // a paper's own macros (\bench) and leftovers
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/(\d)--(\d)/g, "$1–$2")
    .replace(/ ,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- the cache ---------------------------------------------------------------------------

async function readCache(key: string): Promise<ResearchRecord | null> {
  try {
    const rec = JSON.parse(await readFile(join(CACHE_DIR(), `${key}.json`), "utf8")) as ResearchRecord;
    return rec.status === "ready" ? rec : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, rec: ResearchRecord) {
  await mkdir(CACHE_DIR(), { recursive: true });
  const path = join(CACHE_DIR(), `${key}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  const { id: _id, cached: _cached, ...keep } = rec;
  await writeFile(tmp, JSON.stringify(keep, null, 2));
  await rename(tmp, path);
}
