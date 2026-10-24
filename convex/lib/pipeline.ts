import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { JobKind } from "../../lib/types";

/** How many chapters past the current one are built in the background. */
const BUILD_AHEAD = 2;

export async function enqueueJob(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  kind: JobKind,
  payload: Record<string, unknown>,
) {
  return await ctx.db.insert("jobs", {
    sessionId,
    kind,
    payload,
    status: "queued",
    attempts: 0,
    log: [],
    createdAt: Date.now(),
  });
}

/** Queues chapter builds so the student never waits between chapters. */
export async function ensureChaptersQueued(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.status !== "learning") return;
  const chapters = await ctx.db
    .query("chapters")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const chapter of chapters) {
    if (chapter.status !== "planned") continue;
    if (chapter.index > session.currentChapter + BUILD_AHEAD) continue;
    await enqueueJob(ctx, sessionId, "chapter", { chapterId: chapter._id });
    await ctx.db.patch(chapter._id, { status: "queued", progress: "Waiting for the animation builder" });
  }
}
