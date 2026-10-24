import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const beat = v.object({ narration: v.string(), visual: v.string() });

export const question = v.object({
  prompt: v.string(),
  kind: v.union(v.literal("draw"), v.literal("explain"), v.literal("draw+explain")),
  rubric: v.string(),
  correctAnswer: v.string(),
  commonMistake: v.string(),
});

export const chapterStatus = v.union(
  v.literal("planned"),
  v.literal("queued"),
  v.literal("voicing"),
  v.literal("animating"),
  v.literal("ready"),
  v.literal("failed"),
);

export const segmentKind = v.union(
  v.literal("chapter"),
  v.literal("feedback_correct"),
  v.literal("feedback_mistake"),
  v.literal("feedback_custom"),
  v.literal("detour"),
);

export const jobKind = v.union(
  v.literal("chapter"),
  /** The pre-built "correct" and "common mistake" feedback for a chapter, built after the chapter itself. */
  v.literal("chapter_feedback"),
  v.literal("feedback"),
  v.literal("detour"),
  v.literal("export"),
);

export const strokePoints = v.array(v.array(v.number()));

export default defineSchema({
  sessions: defineTable({
    topic: v.optional(v.string()),
    level: v.optional(v.string()),
    goal: v.optional(v.string()),
    status: v.union(
      v.literal("onboarding"),
      v.literal("planning"),
      v.literal("learning"),
      v.literal("done"),
    ),
    currentChapter: v.number(),
    createdAt: v.number(),
  }),

  sources: defineTable({
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("pdf"), v.literal("url")),
    title: v.string(),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    summary: v.optional(v.string()),
    /** Readable text, trimmed to a size that fits comfortably in a prompt. */
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_session", ["sessionId"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("agent")),
    text: v.string(),
    /** Agent messages the browser should say out loud, once. */
    speak: v.optional(v.boolean()),
    spoken: v.optional(v.boolean()),
    context: v.optional(v.union(v.literal("chat"), v.literal("answer"), v.literal("interject"))),
    createdAt: v.number(),
  }).index("by_session", ["sessionId", "createdAt"]),

  chapters: defineTable({
    sessionId: v.id("sessions"),
    index: v.number(),
    title: v.string(),
    objective: v.string(),
    beats: v.array(beat),
    question,
    status: chapterStatus,
    progress: v.optional(v.string()),
    chapterSegmentId: v.optional(v.id("segments")),
    correctSegmentId: v.optional(v.id("segments")),
    mistakeSegmentId: v.optional(v.id("segments")),
  }).index("by_session", ["sessionId", "index"]),

  segments: defineTable({
    sessionId: v.id("sessions"),
    chapterId: v.optional(v.id("chapters")),
    kind: segmentKind,
    documentStorageId: v.id("_storage"),
    /** Audio and image files the document references by `uri`. */
    assets: v.array(v.object({ uri: v.string(), storageId: v.id("_storage") })),
    manifest: v.any(),
    durationTicks: v.number(),
    ticksPerSecond: v.number(),
    /** For detours and custom feedback: the frame the animation starts from. */
    from: v.optional(v.object({ segmentId: v.id("segments"), tick: v.number() })),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),

  jobs: defineTable({
    sessionId: v.id("sessions"),
    kind: jobKind,
    payload: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    workerId: v.optional(v.string()),
    heartbeatAt: v.optional(v.number()),
    progress: v.optional(v.string()),
    log: v.array(v.string()),
    error: v.optional(v.string()),
    resultSegmentId: v.optional(v.id("segments")),
    resultStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_session", ["sessionId", "createdAt"]),

  strokes: defineTable({
    sessionId: v.id("sessions"),
    segmentId: v.id("segments"),
    /** The ink period this stroke belongs to (a question answer or an interjection). */
    inkId: v.id("timeline"),
    tick: v.number(),
    offsetMs: v.number(),
    points: strokePoints,
    color: v.string(),
    size: v.number(),
    purpose: v.union(v.literal("answer"), v.literal("interject")),
  })
    .index("by_session", ["sessionId"])
    .index("by_ink", ["inkId"]),

  answers: defineTable({
    sessionId: v.id("sessions"),
    chapterId: v.id("chapters"),
    transcript: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    verdict: v.optional(v.union(v.literal("correct"), v.literal("partial"), v.literal("incorrect"))),
    reasoning: v.optional(v.string()),
    feedbackSegmentId: v.optional(v.id("segments")),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),

  /** What the student actually saw, in order. Drives the replay and the MP4 export. */
  timeline: defineTable({
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("play"), v.literal("ink")),
    segmentId: v.id("segments"),
    fromTick: v.number(),
    toTick: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId", "startedAt"]),
});
