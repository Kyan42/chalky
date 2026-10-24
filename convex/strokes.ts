import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { strokePoints } from "./schema";

export const add = mutation({
  args: {
    sessionId: v.id("sessions"),
    segmentId: v.id("segments"),
    inkId: v.id("timeline"),
    tick: v.number(),
    offsetMs: v.number(),
    points: strokePoints,
    color: v.string(),
    size: v.number(),
    purpose: v.union(v.literal("answer"), v.literal("interject")),
  },
  handler: async (ctx, args) => await ctx.db.insert("strokes", args),
});

export const remove = mutation({
  args: { strokeId: v.id("strokes") },
  handler: async (ctx, { strokeId }) => {
    await ctx.db.delete(strokeId);
  },
});

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("strokes")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const listByInk = internalQuery({
  args: { inkId: v.id("timeline") },
  handler: async (ctx, { inkId }) =>
    await ctx.db
      .query("strokes")
      .withIndex("by_ink", (q) => q.eq("inkId", inkId))
      .collect(),
});
