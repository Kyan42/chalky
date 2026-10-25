import { v } from "convex/values";
import { query } from "./_generated/server";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What this learner's earlier lessons left behind, as a few short lines for a
 * prompt ("" when nothing is known): their level and focus, and what they got
 * stuck on in their last few lessons. `before` leaves out the lesson asking.
 */
export const learnerMemory = query({
  args: { learnerId: v.string(), before: v.optional(v.string()) },
  handler: async (ctx, { learnerId, before }) => {
    const row = await ctx.db
      .query("learners")
      .withIndex("by_learnerId", (q) => q.eq("learnerId", learnerId))
      .unique();
    if (!row) return "";
    const lessons = (
      await ctx.db
        .query("lessons")
        .withIndex("by_learner", (q) => q.eq("learnerId", learnerId))
        .order("desc")
        .take(4)
    )
      .filter((l) => l.lessonId !== before)
      .slice(0, 3);
    const lines = [
      row.level !== "unknown" ? `level last time: ${row.level}` : "",
      row.prior ? `already knew: ${clip(row.prior, 120)}` : "",
      row.focus ? `last focus: ${clip(row.focus, 120)}` : "",
      ...lessons.map((l) => {
        const stuck = l.learner?.confusions.slice(-2).map((c) => clip(c, 140)) ?? [];
        return `earlier lesson "${clip(l.title || l.question, 80)}"${stuck.length ? `, got stuck on: ${stuck.join(" | ")}` : ""}`;
      }),
    ].filter(Boolean);
    return lines.length ? `What this learner's earlier lessons showed:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
  },
});

export const get = query({
  args: { learnerId: v.string() },
  handler: async (ctx, { learnerId }) =>
    await ctx.db
      .query("learners")
      .withIndex("by_learnerId", (q) => q.eq("learnerId", learnerId))
      .unique(),
});
