"use client";

/**
 * Real web sources for the lesson (lib/sources/README.md): a small stack of cards in the board's
 * corner, each with its site, title and the passage that goes with the beat being taught, the
 * matching sentence highlighted. Starts the fetch itself once the plan has a title, in the
 * background (POST /api/sources returns at once; cached questions come back ready), then polls.
 * Renders nothing, and fetches nothing, until there is a question and a title; renders nothing if
 * no sources come back (no token, the fetch failed, nothing found).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { bestPassage } from "@/lib/sources/match";
import type { SourcesEvent, SourcesRecord } from "@/lib/sources/types";
import s from "./SourceCards.module.css";

export interface SourceCardsProps {
  question: string;
  /** The plan's title; the fetch waits for it (pass "" or "Planning…" until the title event). */
  title: string;
  beats: { id: string; say: string }[];
  currentBeatId: string;
  /** Source events for the lesson transcript (pass logEv). */
  onEvent?: (e: SourcesEvent) => void;
  /** "overlay" (default): pinned in the corner of a positioned parent. "inline": in the flow (dev page). */
  layout?: "overlay" | "inline";
  /** Development: skip the cache, or load the hand-written test set. */
  fresh?: boolean;
  fixture?: boolean;
  /** Called with every record the server sends (dev page badges). */
  onRecord?: (rec: SourcesRecord) => void;
}

const POLL_MS = 2000;
const GIVE_UP_MS = 150_000;

export function SourceCards({ question, title, beats, currentBeatId, onEvent, layout = "overlay", fresh, fixture, onRecord }: SourceCardsProps) {
  const [rec, setRec] = useState<SourcesRecord | null>(null);
  const [open, setOpen] = useState(0);
  const cb = useRef({ onEvent, onRecord });
  cb.current = { onEvent, onRecord };
  const ready = !!question.trim() && !!title.trim() && title !== "Planning…";

  useEffect(() => {
    setRec(null);
    setOpen(0);
    if (!ready) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const emit = (e: SourcesEvent) => cb.current.onEvent?.(e);
    const show = (r: SourcesRecord) => {
      if (stop) return;
      setRec(r);
      cb.current.onRecord?.(r);
    };
    const poll = async (id: string) => {
      if (stop) return;
      if (Date.now() - t0 > GIVE_UP_MS) return emit({ kind: "sources-failed", id, error: "gave up waiting", ms: Date.now() - t0 });
      try {
        const r = (await fetch(`/api/sources/${encodeURIComponent(id)}`).then((x) => x.json())) as SourcesRecord & { error?: string };
        if (stop) return;
        if (!r.status) return emit({ kind: "sources-failed", id, error: r.error ?? "lost the run" });
        show(r);
        if (r.status === "ready") return emit({ kind: "sources-ready", id, cards: r.cards.length, ms: r.ms, mode: r.mode });
        if (r.status === "failed") return emit({ kind: "sources-failed", id, error: r.error ?? "failed", ms: r.ms });
      } catch {
        // A dropped poll is fine; try again.
      }
      timer = setTimeout(() => poll(id), POLL_MS);
    };
    (async () => {
      try {
        const res = await fetch("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, title, beats: beats.slice(0, 3).map((b) => ({ id: b.id, say: b.say })), fresh, fixture }),
        });
        const r = (await res.json()) as SourcesRecord & { error?: string };
        if (stop) return;
        if (!res.ok || !r.status) return emit({ kind: "sources-failed", id: null, error: r.error ?? `HTTP ${res.status}` });
        show(r);
        if (r.status === "no-token") return emit({ kind: "sources-no-token" });
        if (r.status === "ready") return emit(r.cached ? { kind: "sources-cached", id: r.id, cards: r.cards.length, fetchedAt: r.fetchedAt } : { kind: "sources-ready", id: r.id, cards: r.cards.length, ms: r.ms, mode: r.mode });
        emit({ kind: "sources-started", id: r.id, query: r.query });
        timer = setTimeout(() => poll(r.id), POLL_MS);
      } catch (e) {
        if (!stop) emit({ kind: "sources-failed", id: null, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // One fetch per question (and per dev switch); beats only seed the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, question, fresh, fixture]);

  const line = beats.find((b) => b.id === currentBeatId)?.say ?? "";
  const topic = `${question} ${title}`;
  const cards = rec?.status === "ready" ? rec.cards : [];
  const matches = useMemo(() => cards.map((c) => (line ? bestPassage(c, line, topic) : null)), [cards, line, topic]);
  // The card that matches the beat best opens by itself; a click overrides until the beat changes.
  const bestIdx = matches.reduce((bi, m, i) => ((m?.score ?? 0) > (matches[bi]?.score ?? 0) ? i : bi), 0);
  useEffect(() => setOpen(bestIdx), [bestIdx, currentBeatId]);

  if (!rec || rec.status === "no-token" || rec.status === "failed") return null;
  if (rec.status === "running")
    return (
      <div className={s.stack} data-layout={layout} data-testid="sources">
        <div className={s.finding} data-testid="sources-finding">finding sources…</div>
      </div>
    );
  if (!cards.length) return null;

  return (
    <div className={s.stack} data-layout={layout} data-testid="sources" data-via={rec.fetchedVia}>
      {cards.map((c, i) => {
        const m = matches[i];
        const isOpen = i === open;
        return (
          <article key={c.url} className={s.card} data-open={isOpen} data-testid="source-card">
            <button type="button" className={s.head} onClick={() => setOpen(i)} aria-expanded={isOpen}>
              <span className={s.site}>{c.site}</span>
              <span className={s.title}>{c.title}</span>
            </button>
            {isOpen && (
              <>
                <p className={s.passage} data-testid="source-passage">
                  {m && m.score > 0 ? (
                    <>
                      {m.before && <span className={s.dim}>{m.before} </span>}
                      <mark className={s.mark} data-testid="source-match">{m.sentence}</mark>
                      {m.after && <span className={s.dim}> {m.after}</span>}
                    </>
                  ) : (
                    c.excerpt
                  )}
                </p>
                <a className={s.link} href={c.url} target="_blank" rel="noreferrer noopener">
                  Read on {c.site} ↗
                </a>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
