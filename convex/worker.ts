// Read-only views the builder worker needs to do a job. Every call carries the worker secret.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { assertWorker } from "./lib/worker";

/** Source text sent to the animation builder is capped so briefs stay focused. */
const SOURCE_CHARS = 12_000;

export const chapterContext = query({
  args: { secret: v.string(), chapterId: v.id("chapters") },
  handler: async (ctx, { secret, chapterId }) => {
    assertWorker(secret);
    const chapter = await ctx.db.get(chapterId);
    if (!chapter) throw new Error("No such chapter");
    const session = await ctx.db.get(chapter.sessionId);
    const chapters = await ctx.db
      .query("chapters")
      .withIndex("by_session", (q) => q.eq("sessionId", chapter.sessionId))
      .collect();
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_session", (q) => q.eq("sessionId", chapter.sessionId))
      .collect();
    return {
      chapter,
      session,
      outline: chapters.map((c) => ({ index: c.index, title: c.title, objective: c.objective })),
      sources: sources
        .filter((s) => s.status === "ready")
        .map((s) => ({ title: s.title, summary: s.summary ?? "", excerpt: (s.text ?? "").slice(0, SOURCE_CHARS) })),
    };
  },
});

export const segment = query({
  args: { secret: v.string(), segmentId: v.id("segments") },
  handler: async (ctx, { secret, segmentId }) => {
    assertWorker(secret);
    const segment = await ctx.db.get(segmentId);
    if (!segment) throw new Error("No such segment");
    return {
      ...segment,
      documentUrl: await ctx.storage.getUrl(segment.documentStorageId),
      assetUrls: await Promise.all(
        segment.assets.map(async (a) => ({ uri: a.uri, url: await ctx.storage.getUrl(a.storageId) })),
      ),
    };
  },
});

export const strokesForInk = query({
  args: { secret: v.string(), inkId: v.id("timeline") },
  handler: async (ctx, { secret, inkId }) => {
    assertWorker(secret);
    return await ctx.db
      .query("strokes")
      .withIndex("by_ink", (q) => q.eq("inkId", inkId))
      .collect();
  },
});

export const sessionRecording = query({
  args: { secret: v.string(), sessionId: v.id("sessions") },
  handler: async (ctx, { secret, sessionId }) => {
    assertWorker(secret);
    const timeline = await ctx.db
      .query("timeline")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const strokes = await ctx.db
      .query("strokes")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return { timeline, strokes };
  },
});
