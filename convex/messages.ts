import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const context = v.optional(v.union(v.literal("chat"), v.literal("answer"), v.literal("interject")));

export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

/** The tutor's opening line, said once when a session starts. */
export const greet = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (existing) return;
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const text = sources.length
      ? "Hey, I'm Chalky! I'm reading through what you gave me now. What would you like to get out of it?"
      : "Hey, I'm Chalky! What do you want to learn today?";
    await ctx.db.insert("messages", { sessionId, role: "agent", text, speak: true, spoken: false, context: "chat", createdAt: Date.now() });
  },
});

export const markSpoken = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    await ctx.db.patch(messageId, { spoken: true });
  },
});

export const add = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("agent")),
    text: v.string(),
    speak: v.optional(v.boolean()),
    context,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", { ...args, spoken: args.speak ? false : undefined, createdAt: Date.now() });
  },
});
