import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureChaptersQueued } from "./lib/pipeline";
import { assertWorker } from "./lib/worker";
import { chapterStatus, segmentKind } from "./schema";

/** A running job whose worker has not checked in for this long is handed to another worker. */
const STALE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 2;

// ---- Read by the app ---------------------------------------------------------------------------

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const resultUrl = job.resultStorageId ? await ctx.storage.getUrl(job.resultStorageId) : null;
    return { ...job, resultUrl };
  },
});

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("jobs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const requestExport = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.insert("jobs", {
      sessionId,
      kind: "export",
      payload: {},
      status: "queued",
      attempts: 0,
      log: [],
      createdAt: Date.now(),
    });
  },
});

// ---- Called by the builder worker --------------------------------------------------------------

/** Changes whenever there is work, so the worker can subscribe instead of polling. */
export const pending = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    const queued = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(50);
    return queued.map((job) => job._id);
  },
});

export const claim = mutation({
  args: { secret: v.string(), workerId: v.string() },
  handler: async (ctx, { secret, workerId }) => {
    assertWorker(secret);
    // Oldest first, but work a student is waiting on beats background feedback and exports.
    const queued = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(100);
    const urgency = (j: Doc<"jobs">) => (j.kind === "chapter" || j.kind === "detour" || j.kind === "feedback" ? 0 : 1);
    let job: Doc<"jobs"> | null = [...queued].sort((a, b) => urgency(a) - urgency(b))[0] ?? null;
    if (!job) {
      const running = await ctx.db
        .query("jobs")
        .withIndex("by_status", (q) => q.eq("status", "running"))
        .collect();
      job = running.find((j) => (j.heartbeatAt ?? 0) < Date.now() - STALE_MS && j.attempts < MAX_ATTEMPTS) ?? null;
    }
    if (!job) return null;
    await ctx.db.patch(job._id, {
      status: "running",
      workerId,
      attempts: job.attempts + 1,
      heartbeatAt: Date.now(),
      progress: "Starting",
    });
    return { ...job, attempts: job.attempts + 1 };
  },
});

async function chapterOf(ctx: MutationCtx, job: Doc<"jobs">) {
  if (job.kind !== "chapter") return null;
  return await ctx.db.get(job.payload.chapterId as Id<"chapters">);
}

export const progress = mutation({
  args: {
    secret: v.string(),
    jobId: v.id("jobs"),
    progress: v.string(),
    chapterStatus: v.optional(chapterStatus),
  },
  handler: async (ctx, { secret, jobId, progress, chapterStatus }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) return;
    await ctx.db.patch(jobId, { progress, heartbeatAt: Date.now(), log: [...job.log, progress].slice(-40) });
    const chapter = await chapterOf(ctx, job);
    if (chapter) await ctx.db.patch(chapter._id, { progress, ...(chapterStatus ? { status: chapterStatus } : {}) });
  },
});

export const uploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    return await ctx.storage.generateUploadUrl();
  },
});

const segmentInput = v.object({
  kind: segmentKind,
  documentStorageId: v.id("_storage"),
  assets: v.array(v.object({ uri: v.string(), storageId: v.id("_storage") })),
  manifest: v.any(),
  durationTicks: v.number(),
  ticksPerSecond: v.number(),
  from: v.optional(v.object({ segmentId: v.id("segments"), tick: v.number() })),
});

export const completeChapter = mutation({
  args: { secret: v.string(), jobId: v.id("jobs"), segments: v.array(segmentInput) },
  handler: async (ctx, { secret, jobId, segments }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("No such job");
    const chapter = await chapterOf(ctx, job);
    if (!chapter) throw new Error("Not a chapter job");
    const ids: Partial<Record<Doc<"segments">["kind"], Id<"segments">>> = {};
    for (const segment of segments) {
      ids[segment.kind] = await ctx.db.insert("segments", {
        ...segment,
        sessionId: job.sessionId,
        chapterId: chapter._id,
        createdAt: Date.now(),
      });
    }
    if (!ids.chapter) throw new Error("A chapter job must produce a chapter segment");
    // Feedback on answers is spoken, so there are no feedback animations to build; questions get detours.
    await ctx.db.patch(chapter._id, { status: "ready", progress: "Ready", chapterSegmentId: ids.chapter });
    await ctx.db.patch(jobId, { status: "done", progress: "Done", resultSegmentId: ids.chapter });
    await ensureChaptersQueued(ctx, job.sessionId);
  },
});

export const completeChapterFeedback = mutation({
  args: { secret: v.string(), jobId: v.id("jobs"), segments: v.array(segmentInput) },
  handler: async (ctx, { secret, jobId, segments }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job || job.kind !== "chapter_feedback") throw new Error("Not a chapter feedback job");
    const chapterId = job.payload.chapterId as Id<"chapters">;
    const patch: { correctSegmentId?: Id<"segments">; mistakeSegmentId?: Id<"segments"> } = {};
    for (const segment of segments) {
      const id = await ctx.db.insert("segments", { ...segment, sessionId: job.sessionId, chapterId, createdAt: Date.now() });
      if (segment.kind === "feedback_correct") patch.correctSegmentId = id;
      if (segment.kind === "feedback_mistake") patch.mistakeSegmentId = id;
    }
    await ctx.db.patch(chapterId, patch);
    await ctx.db.patch(jobId, { status: "done", progress: "Done" });
  },
});

export const completeSegment = mutation({
  args: { secret: v.string(), jobId: v.id("jobs"), segment: segmentInput },
  handler: async (ctx, { secret, jobId, segment }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("No such job");
    const segmentId = await ctx.db.insert("segments", {
      ...segment,
      sessionId: job.sessionId,
      chapterId: job.payload.chapterId as Id<"chapters"> | undefined,
      createdAt: Date.now(),
    });
    await ctx.db.patch(jobId, { status: "done", progress: "Done", resultSegmentId: segmentId });
    if (job.kind === "feedback" && job.payload.answerId) {
      await ctx.db.patch(job.payload.answerId as Id<"answers">, { feedbackSegmentId: segmentId });
    }
    return segmentId;
  },
});

export const completeExport = mutation({
  args: { secret: v.string(), jobId: v.id("jobs"), storageId: v.id("_storage") },
  handler: async (ctx, { secret, jobId, storageId }) => {
    assertWorker(secret);
    await ctx.db.patch(jobId, { status: "done", progress: "Done", resultStorageId: storageId });
  },
});

export const fail = mutation({
  args: { secret: v.string(), jobId: v.id("jobs"), error: v.string() },
  handler: async (ctx, { secret, jobId, error }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const retry = job.attempts < MAX_ATTEMPTS;
    await ctx.db.patch(jobId, {
      status: retry ? "queued" : "failed",
      error,
      progress: retry ? "Retrying after an error" : "Failed",
      log: [...job.log, `error: ${error}`].slice(-40),
    });
    const chapter = await chapterOf(ctx, job);
    if (chapter) {
      await ctx.db.patch(chapter._id, {
        status: retry ? "queued" : "failed",
        progress: retry ? "Hit a snag, rebuilding" : "Could not build this chapter",
      });
    }
  },
});
