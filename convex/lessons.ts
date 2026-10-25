import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";

const MAX_CONFUSIONS = 12;

type Row = Record<string, unknown>;
const str = (x: unknown) => (typeof x === "string" ? x : "");
const strOrNull = (x: unknown) => (typeof x === "string" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const rows = (x: unknown): Row[] => (Array.isArray(x) ? x.filter((r): r is Row => !!r && typeof r === "object") : []);

function cleanLearner(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Row;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return { level: str(o.level) || "unknown", prior: str(o.prior), focus: str(o.focus), confusions: list(o.confusions), replies: list(o.replies) };
}

/**
 * Writes one lesson's transcript, exactly as the page posts it to /api/live-log
 * (the whole thing, every ~2 s and at the end), as JSON text. Idempotent: the
 * page only ever appends events and beats, so only the rows past what is stored
 * are inserted; if the stored tail no longer matches, the lesson's rows are
 * rewritten. With a learner id, the lesson's learner record is merged into it.
 */
export const upsertLesson = mutation({
  args: { transcript: v.string(), learnerId: v.optional(v.string()), build: v.optional(v.string()) },
  handler: async (ctx, { transcript, learnerId, build }) => {
    const t = JSON.parse(transcript) as Row;
    const lessonId = str(t.id);
    if (!/^[a-z0-9-]{8,100}$/.test(lessonId)) throw new Error("bad lesson id");
    const events = rows(t.events);
    const beats = rows(t.beats);
    const learner = cleanLearner(t.learner);

    const existing = await ctx.db
      .query("lessons")
      .withIndex("by_lessonId", (q) => q.eq("lessonId", lessonId))
      .unique();
    const fields = {
      lessonId,
      question: str(t.question),
      askedVia: str(t.askedVia),
      title: str(t.title),
      startedAt: str(t.startedAt),
      endedAt: strOrNull(t.endedAt),
      end: strOrNull(t.end),
      learner,
      prefetch: t.prefetch ? JSON.stringify(t.prefetch) : null,
      fixture: t.fixture == null ? null : typeof t.fixture === "string" ? t.fixture : JSON.stringify(t.fixture),
      learnerId: learnerId ?? existing?.learnerId ?? null,
      build: build ?? existing?.build ?? null,
      eventCount: events.length,
      beatCount: beats.length,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("lessons", fields);

    await syncEvents(ctx, lessonId, events);
    await syncBeats(ctx, lessonId, beats);
    if (fields.learnerId && learner) await mergeLearner(ctx, fields.learnerId, lessonId, learner);
    return { lessonId, events: events.length, beats: beats.length };
  },
});

async function syncEvents(ctx: MutationCtx, lessonId: string, events: Row[]) {
  const last = await ctx.db
    .query("lessonEvents")
    .withIndex("by_lesson", (q) => q.eq("lessonId", lessonId))
    .order("desc")
    .first();
  let from = last ? last.seq + 1 : 0;
  if (last && (last.seq >= events.length || last.json !== JSON.stringify(events[last.seq]))) {
    const old = await ctx.db.query("lessonEvents").withIndex("by_lesson", (q) => q.eq("lessonId", lessonId)).collect();
    for (const r of old) await ctx.db.delete(r._id);
    from = 0;
  }
  for (let seq = from; seq < events.length; seq++) {
    const e = events[seq];
    await ctx.db.insert("lessonEvents", { lessonId, seq, t: num(e.t) ?? 0, kind: str(e.kind) || "?", json: JSON.stringify(e) });
  }
}

async function syncBeats(ctx: MutationCtx, lessonId: string, beats: Row[]) {
  const last = await ctx.db
    .query("beats")
    .withIndex("by_lesson", (q) => q.eq("lessonId", lessonId))
    .order("desc")
    .first();
  let from = last ? last.seq + 1 : 0;
  if (last && (last.seq >= beats.length || last.json !== JSON.stringify(beats[last.seq]))) {
    const old = await ctx.db.query("beats").withIndex("by_lesson", (q) => q.eq("lessonId", lessonId)).collect();
    for (const r of old) await ctx.db.delete(r._id);
    from = 0;
  }
  for (let seq = from; seq < beats.length; seq++) {
    const b = beats[seq];
    await ctx.db.insert("beats", {
      lessonId,
      seq,
      beatId: str(b.beatId),
      startMs: num(b.startMs),
      endMs: num(b.endMs),
      firstSoundMs: num(b.firstSoundMs),
      interrupted: b.interrupted === true,
      json: JSON.stringify(b),
    });
  }
}

/** Latest known level, prior and focus win; confusions and lesson ids accumulate (deduplicated, so a repeated post changes nothing). */
async function mergeLearner(ctx: MutationCtx, learnerId: string, lessonId: string, l: NonNullable<ReturnType<typeof cleanLearner>>) {
  const row = await ctx.db
    .query("learners")
    .withIndex("by_learnerId", (q) => q.eq("learnerId", learnerId))
    .unique();
  const confusions = [...(row?.confusions ?? [])];
  for (const c of l.confusions) if (!confusions.includes(c)) confusions.push(c);
  const lessonIds = row?.lessonIds.includes(lessonId) ? row.lessonIds : [...(row?.lessonIds ?? []), lessonId];
  const merged = {
    learnerId,
    level: l.level !== "unknown" ? l.level : row?.level ?? "unknown",
    prior: l.prior || row?.prior || "",
    focus: l.focus || row?.focus || "",
    confusions: confusions.slice(-MAX_CONFUSIONS),
    lessonIds,
    updatedAt: Date.now(),
  };
  if (row) await ctx.db.patch(row._id, merged);
  else await ctx.db.insert("learners", merged);
}

/** The most recently updated lessons, newest first, without their events. */
export const recentLessons = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    await ctx.db
      .query("lessons")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(Math.min(limit ?? 25, 100)),
});

/** One lesson with its events and beats in order (payloads as JSON text); null if unknown. Subscribed to by /log while it runs. */
export const lessonLive = query({
  args: { lessonId: v.string() },
  handler: async (ctx, { lessonId }) => {
    const lesson = await ctx.db
      .query("lessons")
      .withIndex("by_lessonId", (q) => q.eq("lessonId", lessonId))
      .unique();
    if (!lesson) return null;
    const events = await ctx.db.query("lessonEvents").withIndex("by_lesson", (q) => q.eq("lessonId", lessonId)).collect();
    const beats = await ctx.db.query("beats").withIndex("by_lesson", (q) => q.eq("lessonId", lessonId)).collect();
    const learner = lesson.learnerId
      ? await ctx.db
          .query("learners")
          .withIndex("by_learnerId", (q) => q.eq("learnerId", lesson.learnerId!))
          .unique()
      : null;
    return { lesson, events, beats, learner };
  },
});
