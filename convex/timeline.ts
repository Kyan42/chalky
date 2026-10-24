import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const start = mutation({
  args: {
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("play"), v.literal("ink")),
    segmentId: v.id("segments"),
    fromTick: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("timeline", { ...args, startedAt: Date.now() }),
});

export const end = mutation({
  args: { entryId: v.id("timeline"), toTick: v.number() },
  handler: async (ctx, { entryId, toTick }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.endedAt !== undefined) return;
    if (entry.kind === "play" && toTick <= entry.fromTick) {
      // Nothing was actually watched; keep the replay free of empty clips.
      await ctx.db.delete(entryId);
      return;
    }
    await ctx.db.patch(entryId, { toTick, endedAt: Date.now() });
  },
});

export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("timeline")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});
