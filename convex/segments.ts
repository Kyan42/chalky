import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

async function withUrls(ctx: QueryCtx, segment: Doc<"segments">) {
  const documentUrl = await ctx.storage.getUrl(segment.documentStorageId);
  const assets = await Promise.all(
    segment.assets.map(async (asset) => ({ uri: asset.uri, url: await ctx.storage.getUrl(asset.storageId) })),
  );
  return { ...segment, documentUrl, assets };
}

export const get = query({
  args: { segmentId: v.id("segments") },
  handler: async (ctx, { segmentId }) => {
    const segment = await ctx.db.get(segmentId);
    return segment ? await withUrls(ctx, segment) : null;
  },
});

export const getMany = query({
  args: { segmentIds: v.array(v.id("segments")) },
  handler: async (ctx, { segmentIds }) => {
    const unique = [...new Set(segmentIds)] as Id<"segments">[];
    const segments = await Promise.all(unique.map((id) => ctx.db.get(id)));
    return await Promise.all(segments.filter((s): s is Doc<"segments"> => s !== null).map((s) => withUrls(ctx, s)));
  },
});

export const getInternal = internalQuery({
  args: { segmentId: v.id("segments") },
  handler: async (ctx, { segmentId }) => await ctx.db.get(segmentId),
});
