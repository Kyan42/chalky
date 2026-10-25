import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** What a lesson learned about its learner (lib/lesson/types.ts LearnerRecord). */
export const learnerRecord = v.object({
  level: v.string(),
  prior: v.string(),
  focus: v.string(),
  confusions: v.array(v.string()),
  replies: v.array(v.string()),
});

/**
 * One lesson per transcript the page posts to /api/live-log (keyed by the
 * transcript's own id), with its events and played beats in their own tables,
 * and one learner record merged across that learner's lessons.
 * Event and beat payloads are kept as JSON text: they are free-form records
 * whose keys (header names, `_`-prefixed fields) Convex objects may not allow.
 */
export default defineSchema({
  lessons: defineTable({
    lessonId: v.string(),
    question: v.string(),
    askedVia: v.string(),
    title: v.string(),
    startedAt: v.string(),
    endedAt: v.union(v.string(), v.null()),
    /** "done", "stopped", "error: ..." or null while the lesson runs. */
    end: v.union(v.string(), v.null()),
    learner: v.union(learnerRecord, v.null()),
    /** Prefetch stats as JSON text. */
    prefetch: v.union(v.string(), v.null()),
    fixture: v.union(v.string(), v.null()),
    learnerId: v.union(v.string(), v.null()),
    /** The commit the server was built from, when known. */
    build: v.union(v.string(), v.null()),
    eventCount: v.number(),
    beatCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lessonId", ["lessonId"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_learner", ["learnerId", "updatedAt"]),

  lessonEvents: defineTable({
    lessonId: v.string(),
    /** Position in the transcript's events array. */
    seq: v.number(),
    /** Ms since the question. */
    t: v.number(),
    kind: v.string(),
    json: v.string(),
  })
    .index("by_lesson", ["lessonId", "seq"])
    .index("by_lesson_t", ["lessonId", "t"]),

  beats: defineTable({
    lessonId: v.string(),
    seq: v.number(),
    beatId: v.string(),
    startMs: v.union(v.number(), v.null()),
    endMs: v.union(v.number(), v.null()),
    firstSoundMs: v.union(v.number(), v.null()),
    interrupted: v.boolean(),
    json: v.string(),
  }).index("by_lesson", ["lessonId", "seq"]),

  learners: defineTable({
    learnerId: v.string(),
    level: v.string(),
    prior: v.string(),
    focus: v.string(),
    /** What didn't land, across lessons, newest last (capped). */
    confusions: v.array(v.string()),
    lessonIds: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_learnerId", ["learnerId"]),
});
