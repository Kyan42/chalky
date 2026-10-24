import { mutation } from "./_generated/server";

/** Upload URL for snapshots of the stage with the student's ink on it. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});
