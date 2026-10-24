import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const addPdf = mutation({
  args: { sessionId: v.id("sessions"), storageId: v.id("_storage"), title: v.string() },
  handler: async (ctx, { sessionId, storageId, title }) => {
    const sourceId = await ctx.db.insert("sources", { sessionId, kind: "pdf", storageId, title, status: "pending" });
    await ctx.scheduler.runAfter(0, internal.ingest.extract, { sourceId });
    return sourceId;
  },
});

export const addUrl = mutation({
  args: { sessionId: v.id("sessions"), url: v.string() },
  handler: async (ctx, { sessionId, url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only web links are supported");
    const sourceId = await ctx.db.insert("sources", {
      sessionId,
      kind: "url",
      url: parsed.toString(),
      title: parsed.hostname,
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.ingest.extract, { sourceId });
    return sourceId;
  },
});

export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    await ctx.db
      .query("sources")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const getInternal = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => await ctx.db.get(sourceId),
});

export const finish = internalMutation({
  args: {
    sourceId: v.id("sources"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { sourceId, ...fields }) => {
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    await ctx.db.patch(sourceId, patch);
  },
});
