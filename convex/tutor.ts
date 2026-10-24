"use node";

// The live tutor: everything the student says goes through one of these actions.
// Replies are written to `messages` with `speak: true`; the browser says them out loud.
import { v } from "convex/values";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { askJson, beatSchema, blobToBase64, imageBlock, s } from "./lib/claude";
import type { Beat, ChapterPlan, Manifest } from "../lib/types";

const VOICE_RULES = `You are Chalky, a warm, sharp tutor who teaches through animated videos. Everything you write is spoken aloud by a text-to-speech voice, so:
- Write plain spoken sentences. No markdown, bullet points, emoji, URLs or symbols that cannot be read aloud.
- Be brief: usually one to three sentences. Never lecture in a reply; the animations do the teaching.
- Sound like a person: contractions, plain words, enthusiasm without hype.`;

type Context = {
  session: Doc<"sessions">;
  messages: Doc<"messages">[];
  chapters: Doc<"chapters">[];
  sources: Doc<"sources">[];
};

async function loadContext(ctx: ActionCtx, sessionId: Id<"sessions">): Promise<Context> {
  const [session, messages, chapters, sources]: [Doc<"sessions"> | null, Doc<"messages">[], Doc<"chapters">[], Doc<"sources">[]] = await Promise.all([
    ctx.runQuery(api.sessions.get, { sessionId }),
    ctx.runQuery(api.messages.list, { sessionId }),
    ctx.runQuery(api.chapters.list, { sessionId }),
    ctx.runQuery(api.sources.list, { sessionId }),
  ]);
  if (!session) throw new Error("No such session");
  return { session, messages, chapters, sources };
}

function describeSources(sources: Doc<"sources">[]) {
  if (sources.length === 0) return "The student has not shared any reference material.";
  return sources
    .map((source) =>
      source.status === "ready"
        ? `- "${source.title}" (${source.kind}): ${source.summary}`
        : `- "${source.title}" (${source.kind}): ${source.status === "pending" ? "still being read" : "could not be read"}`,
    )
    .join("\n");
}

function describeChapters(chapters: Doc<"chapters">[], current: number) {
  if (chapters.length === 0) return "No syllabus yet.";
  return chapters
    .map((c) => `${c.index + 1}. ${c.title} [${c.status}${c.index === current ? ", current" : ""}]: ${c.objective}`)
    .join("\n");
}

function transcript(messages: Doc<"messages">[], limit = 30) {
  return messages
    .slice(-limit)
    .map((m) => `${m.role === "user" ? "Student" : "Chalky"}: ${m.text}`)
    .join("\n");
}

async function say(ctx: ActionCtx, sessionId: Id<"sessions">, text: string, context?: "chat" | "answer" | "interject") {
  await ctx.runMutation(internal.messages.add, { sessionId, role: "agent", text, speak: true, context });
}

async function heard(ctx: ActionCtx, sessionId: Id<"sessions">, text: string, context: "chat" | "answer" | "interject") {
  if (text.trim()) await ctx.runMutation(internal.messages.add, { sessionId, role: "user", text, context });
}

async function snapshot(ctx: ActionCtx, imageStorageId?: Id<"_storage">): Promise<BetaContentBlockParam[]> {
  if (!imageStorageId) return [];
  const blob = await ctx.storage.get(imageStorageId);
  return blob ? [imageBlock(await blobToBase64(blob))] : [];
}

// ---- Conversation --------------------------------------------------------------------------------

type Turn = {
  reply: string;
  action: "none" | "plan_syllabus" | "revise_syllabus" | "end_session";
  topic: string;
  level: string;
  goal: string;
  revision: string;
};

export const respond = action({
  args: { sessionId: v.id("sessions"), text: v.string() },
  handler: async (ctx, { sessionId, text }): Promise<{ action: Turn["action"] }> => {
    await heard(ctx, sessionId, text, "chat");
    const { session, messages, chapters, sources } = await loadContext(ctx, sessionId);

    const turn = await askJson<Turn>({
      system: `${VOICE_RULES}

How a session goes:
1. Onboarding. Find out what the student wants to learn, what they already know, and why. Ask at most one question per reply, and no more than three questions in total. If they shared reference material, the lesson should follow it.
2. As soon as you know the topic and roughly their level (or they say "just start"), set action to plan_syllabus. In that same reply, tell them you're putting together a plan.
3. While the lesson runs, they may talk to you between chapters. Answer briefly. If they want the plan changed ("skip the history", "go deeper on X"), set action to revise_syllabus and describe the change in "revision".
4. If they say they're done for today, set action to end_session.

Fill topic, level and goal with what you know so far ("" when unknown). Leave revision "" unless revising.`,
      messages: [
        {
          role: "user",
          content: `Session status: ${session.status}
Topic so far: ${session.topic ?? "unknown"} | Level: ${session.level ?? "unknown"} | Goal: ${session.goal ?? "unknown"}

Reference material:
${describeSources(sources)}

Syllabus:
${describeChapters(chapters, session.currentChapter)}

Conversation so far (the last line is what the student just said):
${transcript(messages)}`,
        },
      ],
      schema: s.object({
        reply: s.string("What you say next, out loud."),
        action: s.enum(["none", "plan_syllabus", "revise_syllabus", "end_session"]),
        topic: s.string(),
        level: s.string(),
        goal: s.string(),
        revision: s.string(),
      }),
      effort: "low",
      maxTokens: 4000,
    });

    await ctx.runMutation(internal.sessions.update, {
      sessionId,
      topic: turn.topic || undefined,
      level: turn.level || undefined,
      goal: turn.goal || undefined,
    });
    await say(ctx, sessionId, turn.reply, "chat");

    if (turn.action === "plan_syllabus" && chapters.length === 0 && session.status === "onboarding") {
      await ctx.runMutation(internal.sessions.update, { sessionId, status: "planning" });
      await ctx.scheduler.runAfter(0, internal.tutor.planSyllabus, { sessionId });
    } else if (turn.action === "revise_syllabus" && turn.revision) {
      await ctx.scheduler.runAfter(0, internal.tutor.planSyllabus, { sessionId, revision: turn.revision });
    } else if (turn.action === "end_session") {
      await ctx.runMutation(internal.sessions.update, { sessionId, status: "done" });
    }
    return { action: turn.action };
  },
});

// ---- Syllabus ------------------------------------------------------------------------------------

export const planSyllabus = internalAction({
  args: { sessionId: v.id("sessions"), revision: v.optional(v.string()) },
  handler: async (ctx, { sessionId, revision }): Promise<void> => {
    const { session, messages, chapters, sources } = await loadContext(ctx, sessionId);
    const material = sources
      .filter((source) => source.status === "ready")
      .map((source) => `### ${source.title}\n${(source.text ?? "").slice(0, 40_000)}`)
      .join("\n\n");

    const plan = await askJson<{ chapters: ChapterPlan[]; announcement: string }>({
      system: `You design short animated video lessons. Each chapter becomes one narrated animation of about 60 to 120 seconds, built by a motion designer from your beats.

Rules for a great plan:
- 3 to 5 chapters that build on each other. Start from what the student already knows.
- Each chapter has 4 to 7 beats. A beat is 1 to 3 spoken sentences plus a concrete visual: what appears, where, how it moves, what gets highlighted. Prefer diagrams, motion and transformation over text on screen.
- Narration is spoken: conversational, vivid, no lists or markdown, no "in this chapter we will".
- End every chapter with one question the student answers by drawing on the screen and talking (for example "draw the path the current takes", "circle the part that stores energy and tell me why"). The last beat leads into the question; the question card itself is added automatically, so don't narrate the question in the beats.
- rubric: what a correct answer must contain. correctAnswer: the ideal answer in one or two sentences. commonMistake: the single most likely misconception.
- If reference material is provided, follow its content, terms and order.
announcement: what you say aloud to introduce the plan in two or three sentences, naming the chapters briefly, then say you're animating the first one now.`,
      messages: [
        {
          role: "user",
          content: `Topic: ${session.topic ?? "see conversation"}
Level: ${session.level ?? "unknown"}
Goal: ${session.goal ?? "unknown"}
${revision ? `\nThe student asked to change the plan: ${revision}\nCurrent plan:\n${describeChapters(chapters, session.currentChapter)}\nKeep chapters that are already built or being built (anything not "planned") exactly as they are at the start of the list.` : ""}

Conversation:
${transcript(messages, 40)}

${material ? `Reference material:\n${material}` : "No reference material."}`,
        },
      ],
      schema: s.object({
        chapters: s.array(
          s.object({
            title: s.string(),
            objective: s.string("One sentence: what the student can do after this chapter."),
            beats: s.array(beatSchema),
            question: s.object({
              prompt: s.string("The question, as it should appear on screen and be read aloud."),
              kind: s.enum(["draw", "explain", "draw+explain"]),
              rubric: s.string(),
              correctAnswer: s.string(),
              commonMistake: s.string(),
            }),
          }),
        ),
        announcement: s.string(),
      }),
      effort: "high",
      maxTokens: 32000,
    });

    await ctx.runMutation(internal.chapters.replacePlan, { sessionId, chapters: plan.chapters });
    await ctx.runMutation(internal.sessions.update, { sessionId, status: "learning" });
    await say(ctx, sessionId, plan.announcement, "chat");
  },
});

// ---- End-of-chapter answers ------------------------------------------------------------------------

type Grade = {
  verdict: "correct" | "partial" | "incorrect";
  reasoning: string;
  spoken: string;
};

export const grade = action({
  args: {
    sessionId: v.id("sessions"),
    chapterId: v.id("chapters"),
    segmentId: v.id("segments"),
    tick: v.number(),
    inkId: v.id("timeline"),
    transcript: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ verdict: Grade["verdict"] }> => {
    await heard(ctx, args.sessionId, args.transcript, "answer");
    const chapter: Doc<"chapters"> | null = await ctx.runQuery(internal.chapters.getInternal, { chapterId: args.chapterId });
    if (!chapter) throw new Error("No such chapter");

    const result = await askJson<Grade>({
      system: `${VOICE_RULES}

You are grading a student's answer to the question at the end of an animated chapter. The image is the paused animation with the student's drawing on top (their ink is the bright freehand strokes). Their spoken answer is transcribed below. Judge the drawing and the words together and be generous about messy drawing and speech-to-text errors; judge the idea.

- verdict: correct, partial or incorrect.
- reasoning: one or two sentences for the record.
- spoken: what you say right away, out loud. Start by naming what they got right, then explain the key correction if any, pointing at what's on screen. Two to three sentences. There is no feedback animation: your words are the feedback, and afterwards the student can ask a question about it.`,
      messages: [
        {
          role: "user",
          content: [
            ...(await snapshot(ctx, args.imageStorageId)),
            {
              type: "text",
              text: `Chapter: ${chapter.title}
Question: ${chapter.question.prompt}
Rubric: ${chapter.question.rubric}
Correct answer: ${chapter.question.correctAnswer}
Common mistake: ${chapter.question.commonMistake}

Student said: "${args.transcript || "(nothing, they only drew)"}"`,
            },
          ],
        },
      ],
      schema: s.object({
        verdict: s.enum(["correct", "partial", "incorrect"]),
        reasoning: s.string(),
        spoken: s.string(),
      }),
      effort: "medium",
      maxTokens: 8000,
    });

    await ctx.runMutation(internal.answers.record, {
      sessionId: args.sessionId,
      chapterId: args.chapterId,
      transcript: args.transcript,
      imageStorageId: args.imageStorageId,
      verdict: result.verdict,
      reasoning: result.reasoning,
    });
    await say(ctx, args.sessionId, result.spoken, "answer");
    return { verdict: result.verdict };
  },
});

// ---- Pausing to ask about something on screen ----------------------------------------------------------

type Interjection = {
  intent: "question" | "resume" | "stop" | "chat";
  reply: string;
  title: string;
  wants_animation: boolean;
  brief: string;
  beats: Beat[];
};

export const interject = action({
  args: {
    sessionId: v.id("sessions"),
    segmentId: v.id("segments"),
    tick: v.number(),
    transcript: v.string(),
    inkId: v.optional(v.id("timeline")),
    imageStorageId: v.optional(v.id("_storage")),
    /** Manifest elements the student's ink overlaps, most overlapped first. */
    circled: v.array(v.object({ label: v.string(), concept: v.string() })),
  },
  handler: async (ctx, args): Promise<{ intent: Interjection["intent"]; jobId: Id<"jobs"> | null }> => {
    await heard(ctx, args.sessionId, args.transcript, "interject");
    const segment: Doc<"segments"> | null = await ctx.runQuery(internal.segments.getInternal, { segmentId: args.segmentId });
    if (!segment) throw new Error("No such segment");
    const chapter: Doc<"chapters"> | null = segment.chapterId
      ? await ctx.runQuery(internal.chapters.getInternal, { chapterId: segment.chapterId })
      : null;
    const manifest = segment.manifest as Manifest;
    const saidSoFar = manifest.beats
      .filter((b) => b.startTick <= args.tick)
      .map((b) => b.narration)
      .join(" ");
    const { messages } = await loadContext(ctx, args.sessionId);

    const result = await askJson<Interjection>({
      system: `${VOICE_RULES}

The student paused the animation and said something, maybe after circling or drawing on the frame (their ink is the bright freehand strokes in the image). Work out what they mean, especially "this" or "that", from the circled elements and the image.

- intent: "question" if they want something explained; "resume" if they want to keep going ("ok", "carry on", "never mind"); "stop" if they just want it held; "chat" otherwise.
- reply: what you say right away, out loud. For a question, answer it directly in two or three sentences, pointing at what's on screen ("that capacitor you circled..."). For resume, a short "Okay, back to it."
- wants_animation: true when the question deserves a visual detour (a mechanism, a process, a "show me", "explain in more detail"). False for quick factual answers or when intent is not "question".
- title: a 2 to 6 word name for what they asked about, shown in their lesson outline ("Why leaves are green"). "" when wants_animation is false.
- brief and beats: when wants_animation is true, a 30 to 75 second detour animation (3 to 5 beats) that starts from this exact frame, zooms into what they asked about, explains it, and ends by returning to the frame so the chapter can continue. Its first beat should not repeat your reply word for word. Otherwise brief "" and beats [].`,
      messages: [
        {
          role: "user",
          content: [
            ...(await snapshot(ctx, args.imageStorageId)),
            {
              type: "text",
              text: `Chapter: ${chapter?.title ?? "detour"} (${chapter?.objective ?? ""})
Narration up to the pause: "${saidSoFar}"
Elements they circled: ${args.circled.length ? args.circled.map((c) => `${c.label} (${c.concept})`).join("; ") : "none"}

Recent conversation:
${transcript(messages, 10)}

Student said: "${args.transcript || "(nothing, they only drew)"}"`,
            },
          ],
        },
      ],
      schema: s.object({
        intent: s.enum(["question", "resume", "stop", "chat"]),
        reply: s.string(),
        title: s.string(),
        wants_animation: s.boolean(),
        brief: s.string(),
        beats: s.array(beatSchema),
      }),
      effort: "low",
      maxTokens: 6000,
    });

    await say(ctx, args.sessionId, result.reply, "interject");
    let jobId: Id<"jobs"> | null = null;
    if (result.intent === "question" && result.wants_animation && result.beats.length > 0) {
      jobId = await ctx.runMutation(internal.answers.enqueueDetour, {
        sessionId: args.sessionId,
        segmentId: args.segmentId,
        tick: args.tick,
        inkId: args.inkId,
        title: result.title || args.transcript.slice(0, 40) || "Your question",
        question: args.transcript,
        brief: result.brief,
        narration: result.beats,
      });
    }
    return { intent: result.intent, jobId };
  },
});
