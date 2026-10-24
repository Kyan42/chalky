import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { enqueueJob } from "./lib/pipeline";

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("answers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const record = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    chapterId: v.id("chapters"),
    transcript: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    verdict: v.union(v.literal("correct"), v.literal("partial"), v.literal("incorrect")),
    reasoning: v.string(),
    feedbackSegmentId: v.optional(v.id("segments")),
    /** When set, no pre-built feedback fits and a custom animation is queued with this brief. */
    customFeedback: v.optional(
      v.object({
        segmentId: v.id("segments"),
        tick: v.number(),
        inkId: v.id("timeline"),
        brief: v.string(),
        narration: v.array(v.object({ narration: v.string(), visual: v.string() })),
      }),
    ),
  },
  handler: async (ctx, { customFeedback, ...answer }) => {
    const answerId = await ctx.db.insert("answers", { ...answer, createdAt: Date.now() });
    let jobId = null;
    if (customFeedback) {
      jobId = await enqueueJob(ctx, answer.sessionId, "feedback", {
        answerId,
        chapterId: answer.chapterId,
        verdict: answer.verdict,
        ...customFeedback,
      });
    }
    return { answerId, jobId };
  },
});

export const enqueueDetour = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    segmentId: v.id("segments"),
    tick: v.number(),
    inkId: v.optional(v.id("timeline")),
    /** Short name for the lesson list, e.g. "Why leaves are green". */
    title: v.string(),
    question: v.string(),
    brief: v.string(),
    narration: v.array(v.object({ narration: v.string(), visual: v.string() })),
  },
  handler: async (ctx, { sessionId, ...payload }) => {
    const segment = await ctx.db.get(payload.segmentId);
    return await enqueueJob(ctx, sessionId, "detour", { ...payload, chapterId: segment?.chapterId });
  },
});
