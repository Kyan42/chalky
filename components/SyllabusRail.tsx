"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

const STATUS: Record<Doc<"chapters">["status"], { label: string; dot: string }> = {
  planned: { label: "Planned", dot: "bg-white/25" },
  queued: { label: "Queued", dot: "bg-white/40" },
  voicing: { label: "Recording", dot: "bg-[var(--warn)] animate-pulse" },
  animating: { label: "Animating", dot: "bg-[var(--accent)] animate-pulse" },
  ready: { label: "Ready", dot: "bg-[var(--accent-2)]" },
  failed: { label: "Failed", dot: "bg-[var(--danger)]" },
};

type Props = {
  chapters: Doc<"chapters">[];
  current: number;
  /** All of the session's jobs; detours are shown under the chapter they were asked in. */
  jobs?: Doc<"jobs">[];
  onPlayDetour?: (segmentId: Id<"segments">) => void;
  compact?: boolean;
};

export function SyllabusRail({ chapters, current, jobs = [], onPlayDetour, compact }: Props) {
  const retry = useMutation(api.chapters.retry);
  if (chapters.length === 0) return null;
  return (
    <ol className={compact ? "flex gap-2 overflow-x-auto" : "space-y-2"}>
      {chapters.map((chapter) => {
        const status = STATUS[chapter.status];
        const isCurrent = chapter.index === current;
        const done = chapter.index < current;
        const detours = jobs.filter((j) => j.kind === "detour" && j.payload.chapterId === chapter._id);
        return (
          <li
            key={chapter._id}
            className={`fade-up rounded-xl border px-3 py-2 ${compact ? "min-w-48 shrink-0" : ""} ${
              isCurrent ? "border-[var(--accent)]/60 bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <div className={done ? "opacity-50" : ""}>
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span className={`h-2 w-2 rounded-full ${done ? "bg-[var(--accent-2)]" : status.dot}`} />
                <span>Chapter {chapter.index + 1}</span>
                <span className="ml-auto">{done ? "Done" : status.label}</span>
              </div>
              <div className="mt-0.5 text-sm font-semibold leading-snug">{chapter.title}</div>
              {!compact && !done && chapter.status !== "ready" && chapter.status !== "planned" && chapter.progress && (
                <div className="mt-1 truncate text-xs text-[var(--muted)]">{chapter.progress}</div>
              )}
            </div>
            {chapter.status === "failed" && (
              <button className="mt-1 text-xs text-[var(--accent)] underline" onClick={() => void retry({ chapterId: chapter._id })}>
                Try again
              </button>
            )}
            {!compact && detours.length > 0 && (
              <ul className="mt-2 space-y-1 border-l border-white/10 pl-2.5">
                {detours.map((job) => (
                  <DetourItem key={job._id} job={job} onPlay={onPlayDetour} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One question the student asked during a chapter, and the explanation animation made for it. */
function DetourItem({ job, onPlay }: { job: Doc<"jobs">; onPlay?: (segmentId: Id<"segments">) => void }) {
  const title = (job.payload.title as string) || (job.payload.question as string) || "Your question";
  const ready = job.status === "done" && job.resultSegmentId;
  const building = job.status === "queued" || job.status === "running";
  return (
    <li className="fade-up">
      <button
        disabled={!ready}
        onClick={() => ready && onPlay?.(job.resultSegmentId!)}
        title={(job.payload.question as string) || title}
        className="group flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs enabled:hover:bg-white/5 disabled:cursor-default disabled:opacity-100"
      >
        <span className="mt-0.5 shrink-0 text-[var(--muted)]">{ready ? "▶" : building ? "◌" : "!"}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${ready ? "text-[var(--foreground)] group-hover:underline" : "text-[var(--muted)]"}`}>{title}</span>
          {building && <span className="block truncate text-[var(--muted)]/80">{job.status === "queued" ? "Waiting for the builder" : (job.progress ?? "Animating")}</span>}
          {job.status === "failed" && <span className="block text-[var(--danger)]">Couldn&apos;t build this one</span>}
        </span>
      </button>
    </li>
  );
}
