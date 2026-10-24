"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InkLayer } from "@/components/InkLayer";
import { Stage, type StageClip, type StageHandle } from "@/components/Stage";
import { unlockAudio } from "@/lib/voice/audio";
import type { StrokeData, StrokePoint } from "@/lib/types";

/** Pauses longer than this are sped up in the replay, matching the MP4 export. */
const MAX_INK_MS = 20_000;

export default function ReplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const id = sessionId as Id<"sessions">;
  const session = useQuery(api.sessions.get, { sessionId: id });
  const timeline = useQuery(api.timeline.list, { sessionId: id });
  const strokes = useQuery(api.strokes.listBySession, { sessionId: id });
  const entries = useMemo(() => (timeline ?? []).filter((e) => e.toTick !== undefined), [timeline]);
  const segments = useQuery(api.segments.getMany, entries.length ? { segmentIds: entries.map((e) => e.segmentId) } : "skip");

  const requestExport = useMutation(api.jobs.requestExport);
  const [exportJob, setExportJob] = useState<Id<"jobs"> | null>(null);
  const job = useQuery(api.jobs.get, exportJob ? { jobId: exportJob } : "skip");

  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [inkElapsed, setInkElapsed] = useState(0);
  const stage = useRef<StageHandle>(null);

  const entry = entries[index];
  const segment = segments?.find((s) => s._id === entry?.segmentId);

  const clip: StageClip | null = useMemo(() => {
    if (!entry || !segment || !started) return null;
    return {
      key: entry._id,
      segment,
      startTick: entry.fromTick,
      autoplay: entry.kind === "play",
      stopAtTick: entry.kind === "play" ? entry.toTick : undefined,
    };
  }, [entry, segment, started]);

  // Ink periods: redraw the student's strokes at the pace they drew them.
  const inkMs = entry?.kind === "ink" ? Math.max(1, (entry.endedAt ?? entry.startedAt) - entry.startedAt) : 0;
  const speed = inkMs > MAX_INK_MS ? MAX_INK_MS / inkMs : 1;
  useEffect(() => {
    if (!started || entry?.kind !== "ink" || !segment) return;
    const begin = performance.now();
    let frame = 0;
    const loop = () => {
      const elapsed = (performance.now() - begin) / speed;
      setInkElapsed(elapsed);
      if (elapsed > inkMs + 800) setIndex((i) => i + 1);
      else frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [started, entry, segment, inkMs, speed]);

  const visibleInk: StrokeData[] = useMemo(() => {
    if (entry?.kind !== "ink" || !strokes) return [];
    return strokes
      .filter((s) => s.inkId === entry._id && s.offsetMs <= inkElapsed)
      .map((s) => ({
        points: (s.points as StrokePoint[]).filter((p) => s.offsetMs + p[3] <= inkElapsed),
        color: s.color,
        size: s.size,
        tick: s.tick,
        offsetMs: s.offsetMs,
      }))
      .filter((s) => s.points.length > 1);
  }, [entry, strokes, inkElapsed]);

  const finished = started && index >= entries.length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-5 px-6 py-5">
      <header className="flex items-center gap-4">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          chalky
        </Link>
        <span className="truncate text-sm text-[var(--muted)]">{session?.topic ?? "Lesson"} · replay</span>
        <Link href={`/s/${id}`} className="ml-auto rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-white/5">
          Back to lesson
        </Link>
      </header>

      {entries.length === 0 ? (
        <p className="py-24 text-center text-[var(--muted)]">{timeline === undefined ? "Loading…" : "Nothing to replay yet. Watch a chapter first."}</p>
      ) : (
        <>
          <div className="relative">
            <Stage ref={stage} clip={finished ? null : clip} onStop={() => setIndex((i) => i + 1)} onEnded={() => setIndex((i) => i + 1)}>
              <InkLayer enabled={false} strokes={visibleInk} color="#FFD84D" size={8} onStroke={() => {}} />
              {!started && (
                <button
                  className="absolute inset-0 z-20 grid place-items-center bg-black/50 text-xl font-semibold"
                  onClick={async () => {
                    await unlockAudio();
                    setStarted(true);
                  }}
                >
                  ▶ Play your lesson
                </button>
              )}
              {finished && (
                <button className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-xl font-semibold" onClick={() => setIndex(0)}>
                  ↻ Watch again
                </button>
              )}
            </Stage>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-full bg-white/10 px-4 py-2 text-sm" onClick={() => (stage.current?.playing() ? stage.current.pause() : stage.current?.play())}>
              Play / pause
            </button>
            <button className="rounded-full bg-white/10 px-4 py-2 text-sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              ← Previous
            </button>
            <button className="rounded-full bg-white/10 px-4 py-2 text-sm" disabled={index >= entries.length - 1} onClick={() => setIndex((i) => i + 1)}>
              Next →
            </button>
            <span className="text-sm text-[var(--muted)]">
              Clip {Math.min(index + 1, entries.length)} of {entries.length}
              {entry?.kind === "ink" ? " · your drawing" : ""}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {job?.status === "done" && job.resultUrl ? (
                <a href={job.resultUrl} download="chalky-lesson.mp4" className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-black">
                  Download MP4
                </a>
              ) : job && job.status !== "failed" ? (
                <span className="text-sm text-[var(--muted)]">Rendering video… {job.progress ?? ""}</span>
              ) : (
                <button className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-black" onClick={async () => setExportJob(await requestExport({ sessionId: id }))}>
                  {job?.status === "failed" ? "Export failed, try again" : "Export MP4"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
