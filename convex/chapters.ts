import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ensureChaptersQueued } from "./lib/pipeline";
import { beat, question } from "./schema";

export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("chapters")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

/** Rebuilds a chapter that failed (for example before the API keys were set). */
export const retry = mutation({
  args: { chapterId: v.id("chapters") },
  handler: async (ctx, { chapterId }) => {
    const chapter = await ctx.db.get(chapterId);
    if (!chapter || chapter.status !== "failed") return;
    await ctx.db.patch(chapterId, { status: "planned", progress: undefined });
    await ensureChaptersQueued(ctx, chapter.sessionId);
  },
});

export const getInternal = internalQuery({
  args: { chapterId: v.id("chapters") },
  handler: async (ctx, { chapterId }) => await ctx.db.get(chapterId),
});

/** Replaces the syllabus. Only chapters nobody has started building are replaced. */
export const replacePlan = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    chapters: v.array(v.object({ title: v.string(), objective: v.string(), beats: v.array(beat), question })),
  },
  handler: async (ctx, { sessionId, chapters }) => {
    const existing = await ctx.db
      .query("chapters")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const chapter of existing) {
      if (chapter.status === "planned") await ctx.db.delete(chapter._id);
    }
    const kept = existing.filter((chapter) => chapter.status !== "planned").length;
    for (const [offset, chapter] of chapters.slice(kept).entries()) {
      await ctx.db.insert("chapters", { sessionId, index: kept + offset, status: "planned", ...chapter });
    }
  },
});
