"use client";

/**
 * Web pages for a time-sensitive question (lib/research/CONTRACT.md): a stack of cards in the
 * board's corner, each with site, date, title and a link; the page the current beat cites
 * (`currentCite`) opens, with the key sentence that best matches the beat's line highlighted.
 * Shows a `record` the lesson already fetched, or fetches itself from POST /api/research when given
 * a `question`. Renders nothing until there are pages, except a quiet "looking it up…" while a
 * fetch is out (8 s at most). Shares SourceCards' look.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { words } from "@/lib/sources/match";
import type { ResearchEvent, ResearchItem, ResearchRecord } from "@/lib/research/types";
import s from "./SourceCards.module.css";

export interface ResearchCardsProps {
  /** Fetch pages for this question (ignored when `record` is given). */
  question?: string;
  /** A record the lesson already has (from its own POST /api/research); no fetch then. */
  record?: ResearchRecord | null;
  /** The current beat's `cite` (an item's `n`); undefined leaves the open card as it was. */
  currentCite?: number;
  /** The current beat's `say`, to pick the sentence to highlight. */
  currentLine?: string;
  onEvent?: (e: ResearchEvent) => void;
  onRecord?: (rec: ResearchRecord) => void;
  layout?: "overlay" | "inline";
  /** Development: skip the cache. */
  fresh?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ResearchCards({ question = "", record, currentCite, currentLine = "", onEvent, onRecord, layout = "overlay", fresh }: ResearchCardsProps) {
  const [fetched, setFetched] = useState<ResearchRecord | null>(null);
  const [open, setOpen] = useState(1);
  const cb = useRef({ onEvent, onRecord });
  cb.current = { onEvent, onRecord };
  const own = record === undefined && !!question.trim();

  useEffect(() => {
    setFetched(null);
    if (!own) return;
    let stop = false;
    const emit = (e: ResearchEvent) => cb.current.onEvent?.(e);
    const show = (r: ResearchRecord) => {
      if (stop) return;
      setFetched(r);
      cb.current.onRecord?.(r);
    };
    (async () => {
      try {
        // Shown while the request is out; the route answers within its 8 s budget.
        show({ id: "", question, query: "", recent: false, status: "running", items: [], material: "", cached: false, startedAt: new Date().toISOString() });
        const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, wait: true, fresh }) });
        const r = (await res.json()) as ResearchRecord & { error?: string };
        if (stop) return;
        if (!res.ok || !r.status) return emit({ kind: "research-none", id: null, error: r.error ?? `HTTP ${res.status}` });
        show(r);
        if (r.status === "ready") emit(r.cached ? { kind: "research-cached", id: r.id, items: r.items.length, fetchedAt: r.fetchedAt } : { kind: "research-ready", id: r.id, items: r.items.length, ms: r.ms });
        else emit({ kind: "research-none", id: r.id, error: r.error ?? "nothing found", ms: r.ms });
      } catch (e) {
        if (!stop) emit({ kind: "research-none", id: null, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      stop = true;
    };
    // One fetch per question (and per dev switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, question, fresh]);

  const rec = record ?? fetched;
  const items = rec?.status === "ready" ? rec.items : [];
  // The cited page opens; a beat without a citation leaves the open card alone.
  useEffect(() => {
    if (currentCite && items.some((p) => p.n === currentCite)) setOpen(currentCite);
  }, [currentCite, items]);
  const highlight = useMemo(() => {
    const it = items.find((x) => x.n === open);
    return it ? bestKey(it, currentLine) : -1;
  }, [items, open, currentLine]);

  if (!rec || rec.status === "none") return null;
  if (rec.status === "running")
    return (
      <div className={s.stack} data-layout={layout} data-testid="research">
        <div className={s.finding} data-testid="research-finding">looking it up…</div>
      </div>
    );
  if (!items.length) return null;

  return (
    <div className={s.stack} data-layout={layout} data-testid="research">
      {items.map((it) => {
        const isOpen = it.n === open;
        return (
          <article key={it.url} className={s.card} data-open={isOpen} data-testid="research-card" data-n={it.n}>
            <button type="button" className={s.head} onClick={() => setOpen(it.n)} aria-expanded={isOpen}>
              <span className={s.site}>
                [{it.n}] {it.site}
                {it.published ? ` · ${day(it.published)}` : ""}
              </span>
              <span className={s.title}>{it.title}</span>
            </button>
            {isOpen && (
              <>
                <p className={s.passage} data-testid="research-key">
                  {it.key.map((k, i) =>
                    i === highlight ? (
                      <mark key={i} className={s.mark} data-testid="research-match">
                        {k}{" "}
                      </mark>
                    ) : (
                      <span key={i} className={s.dim}>
                        {k}{" "}
                      </span>
                    ),
                  )}
                </p>
                <a className={s.link} href={it.url} target="_blank" rel="noreferrer noopener">
                  Read on {it.site} ↗
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
function bestKey(it: ResearchItem, line: string): number {
  const want = new Set(words(line));
  let best = 0;
  let bestScore = 0;
  it.key.forEach((k, i) => {
    const score = new Set(words(k).filter((w) => want.has(w))).size;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best;
}

function day(iso: string): string {
  const [y, m, d] = iso.split("-");
  return m && d ? `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}` : iso;
}
