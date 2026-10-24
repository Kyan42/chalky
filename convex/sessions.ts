import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ensureChaptersQueued } from "./lib/pipeline";

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("sessions", {
      status: "onboarding",
      currentChapter: 0,
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => await ctx.db.get(sessionId),
});

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("sessions").order("desc").take(20),
});

/** Called by the app when the student moves on to the next chapter. */
export const advance = mutation({
  args: { sessionId: v.id("sessions"), toChapter: v.number() },
  handler: async (ctx, { sessionId, toChapter }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("No such session");
    const chapters = await ctx.db
      .query("chapters")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    if (toChapter >= chapters.length) {
      await ctx.db.patch(sessionId, { status: "done", currentChapter: chapters.length });
      return;
    }
    await ctx.db.patch(sessionId, { currentChapter: toChapter });
    await ensureChaptersQueued(ctx, sessionId);
  },
});

export const update = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    topic: v.optional(v.string()),
    level: v.optional(v.string()),
    goal: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("onboarding"), v.literal("planning"), v.literal("learning"), v.literal("done")),
    ),
  },
  handler: async (ctx, { sessionId, ...fields }) => {
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    await ctx.db.patch(sessionId, patch);
    if (fields.status === "learning") await ensureChaptersQueued(ctx, sessionId);
  },
});
