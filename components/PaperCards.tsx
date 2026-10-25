"use client";

/**
 * Recent papers for a "teach me what's new" lesson (lib/research/CONTRACT.md): a stack of cards in
 * the board's corner, each with the date, authors, title and arXiv link; the paper the current beat
 * cites (`currentCite`) opens, with the key sentence that best matches the beat's line highlighted.
 * Fetches itself from POST /api/research when given a topic, or shows a `record` the lesson already
 * fetched (then it does not fetch). Renders nothing until there are papers, except a quiet
 * "finding papers…" while a fetch is out. Shares SourceCards' look.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { words } from "@/lib/sources/match";
import type { Paper, ResearchEvent, ResearchRecord } from "@/lib/research/types";
import s from "./SourceCards.module.css";

export interface PaperCardsProps {
  /** Fetch papers on this topic (ignored when `record` is given). */
  topic?: string;
  days?: number;
  /** A record the lesson already has (from its own POST /api/research); no fetch then. */
  record?: ResearchRecord | null;
  /** The current beat's `cite` (a paper's `n`); undefined leaves the open card as it was. */
  currentCite?: number;
  /** The current beat's `say`, to pick the sentence to highlight. */
  currentLine?: string;
  onEvent?: (e: ResearchEvent) => void;
  onRecord?: (rec: ResearchRecord) => void;
  layout?: "overlay" | "inline";
  /** Development: skip the cache, load the hand-written set, or force one fetch path. */
  fresh?: boolean;
  fixture?: boolean;
  only?: string;
}

const POLL_MS = 1500;
const GIVE_UP_MS = 120_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PaperCards({ topic = "", days = 14, record, currentCite, currentLine = "", onEvent, onRecord, layout = "overlay", fresh, fixture, only }: PaperCardsProps) {
  const [fetched, setFetched] = useState<ResearchRecord | null>(null);
  const [open, setOpen] = useState(1);
  const cb = useRef({ onEvent, onRecord });
  cb.current = { onEvent, onRecord };
  const own = record === undefined && !!topic.trim();

  useEffect(() => {
    setFetched(null);
    if (!own) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const emit = (e: ResearchEvent) => cb.current.onEvent?.(e);
    const show = (r: ResearchRecord) => {
      if (stop) return;
      setFetched(r);
      cb.current.onRecord?.(r);
    };
    const settle = (r: ResearchRecord) =>
      r.status === "failed"
        ? emit({ kind: "research-failed", id: r.id, error: r.error ?? "failed", ms: r.ms })
        : r.cached
          ? emit({ kind: "research-cached", id: r.id, papers: r.papers.length, fetchedAt: r.fetchedAt })
          : emit({ kind: "research-ready", id: r.id, papers: r.papers.length, ms: r.ms, via: r.via, searchedDays: r.searchedDays });
    const poll = async (id: string) => {
      if (stop) return;
      if (Date.now() - t0 > GIVE_UP_MS) return emit({ kind: "research-failed", id, error: "gave up waiting", ms: Date.now() - t0 });
      try {
        const r = (await fetch(`/api/research/${encodeURIComponent(id)}`).then((x) => x.json())) as ResearchRecord & { error?: string };
        if (stop) return;
        if (!r.status) return emit({ kind: "research-failed", id, error: r.error ?? "lost the run" });
        show(r);
        if (r.status !== "running") return settle(r);
      } catch {
        // A dropped poll is fine; try again.
      }
      timer = setTimeout(() => poll(id), POLL_MS);
    };
    (async () => {
      try {
        const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, days, fresh, fixture, only }) });
        const r = (await res.json()) as ResearchRecord & { error?: string };
        if (stop) return;
        if (!res.ok || !r.status) return emit({ kind: "research-failed", id: null, error: r.error ?? `HTTP ${res.status}` });
        show(r);
        if (r.status !== "running") return settle(r);
        emit({ kind: "research-started", id: r.id, topic: r.topic, days: r.days });
        timer = setTimeout(() => poll(r.id), POLL_MS);
      } catch (e) {
        if (!stop) emit({ kind: "research-failed", id: null, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // One fetch per topic and window (and per dev switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, topic, days, fresh, fixture, only]);

  const rec = record ?? fetched;
  const papers = rec?.status === "ready" ? rec.papers : [];
  // The cited paper opens; a beat without a citation leaves the open card alone.
  useEffect(() => {
    if (currentCite && papers.some((p) => p.n === currentCite)) setOpen(currentCite);
  }, [currentCite, papers]);
  const highlight = useMemo(() => {
    const p = papers.find((x) => x.n === open);
    return p ? bestKey(p, currentLine) : -1;
  }, [papers, open, currentLine]);

  if (!rec || rec.status === "failed") return null;
  if (rec.status === "running")
    return (
      <div className={s.stack} data-layout={layout} data-testid="papers">
        <div className={s.finding} data-testid="papers-finding">finding papers…</div>
      </div>
    );
  if (!papers.length) return null;

  return (
    <div className={s.stack} data-layout={layout} data-testid="papers" data-via={rec.via ?? ""}>
      {papers.map((p) => {
        const isOpen = p.n === open;
        return (
          <article key={p.arxivId} className={s.card} data-open={isOpen} data-testid="paper-card" data-n={p.n}>
            <button type="button" className={s.head} onClick={() => setOpen(p.n)} aria-expanded={isOpen}>
              <span className={s.site}>
                [{p.n}] {day(p.published)} · {byline(p)}
              </span>
              <span className={s.title}>{p.title}</span>
            </button>
            {isOpen && (
              <>
                <p className={s.passage} data-testid="paper-key">
                  {p.key.map((k, i) =>
                    i === highlight ? (
                      <mark key={i} className={s.mark} data-testid="paper-match">
                        {k}{" "}
                      </mark>
                    ) : (
                      <span key={i} className={s.dim}>
                        {k}{" "}
                      </span>
                    ),
                  )}
                </p>
                <a className={s.link} href={p.url} target="_blank" rel="noreferrer noopener">
                  arXiv:{p.arxivId}
                  {p.category ? ` · ${p.category}` : ""} ↗
                </a>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** The key sentence sharing the most words with the beat's line; the first when nothing matches. */
function bestKey(p: Paper, line: string): number {
  const want = new Set(words(line));
  if (!want.size) return 0;
  let best = 0;
  let bestScore = 0;
  p.key.forEach((k, i) => {
    const score = new Set(words(k).filter((w) => want.has(w))).size;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best;
}

function day(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${MONTHS[Number(m) - 1]} ${Number(d)}` : iso;
}

function byline(p: Paper): string {
  const last = (n: string) => n.trim().split(/\s+/).pop() ?? n;
  if (!p.authors.length) return "";
  return p.authorCount > 2 ? `${last(p.authors[0])} et al.` : p.authors.map(last).join(" & ");
}
