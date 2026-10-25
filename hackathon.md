# Hackathon log

- **Project:** Chalky
- **Event:** Cal Hacks 13.0
- **What it does:** Chalky replaces the chat box for understanding things: ask out loud, and it explains on a whiteboard in a voice you can interrupt mid-word, and remembers what you got stuck on.
- **Live app:** not deployed (runs locally, see README)
- **Repo:** https://github.com/Kyan42/chalky
- **Frontend:** not deployed (run locally)
- **Convex deployment:** https://wooden-clam-492.convex.cloud
- **Components:** none
- **Convex features:** schema (4 tables), indexes (7), queries (4), mutations (1), realtime useQuery
- **Auth:** none (anonymous learner cookie)
- **AI models:** claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5; Cartesia sonic-3, ink-2
- **Started:** 2026-10-24T05:17:27Z
- **Last updated:** 2026-10-25T08:16:29Z

## How we use Convex

- **Live lesson log at `/log`.** While a lesson plays, its beats with timings, every decision event and the learner record appear as they happen. Three `useQuery` hooks (`recentLessons`, `lessonLive`, `learnerMemory`) in `app/log/LiveLog.tsx`; the lesson list, the open lesson and the memory panel all update live, no refresh.
- **Lesson records.** The lesson page posts its transcript every ~2 s; the server mirrors it with the `upsertLesson` mutation in `convex/lessons.ts` (through `lib/convexMirror.ts`). Events and beats live in their own tables keyed by `seq`, so a save inserts only the new rows and rewrites only if the stored tail no longer matches. Tables and indexes: `convex/schema.ts`.
- **It remembers you.** Each save merges the lesson's learner record (level, prior knowledge, focus, confusions, capped at 12) into `learners`. The next lesson's planner and fast voice read `learnerMemory` (`convex/learners.ts`, `lib/moss/memory.ts`) before Chalky's first word, so "you got stuck on ATP last time" is real.
- **Memory inside every reply.** The learner's Convex memory is indexed with the board in a Moss session and searched before each answer to an interruption (`lib/moss/memory.ts`, `lib/lesson/converse.ts`).
- **Quiz results.** Label and sketch quiz scores land on the learner record and flow into the same memory (`components/Lesson.tsx`, `convex/lessons.ts`).

## Log

- 2026-10-24 07:11Z `e4267ad` Spike: one beat end to end, Sonic + Clayzo. `SPIKE_NOTES.md`
- 2026-10-24 23:40Z `04f8190` Per-lesson transcript for reviewing live runs. `app/api/live-log/route.ts`
- 2026-10-25 00:42Z `6b033a6` Convex records: lessons, events, beats, learners merged across lessons. `convex/schema.ts`, `convex/lessons.ts`, `convex/learners.ts`
- 2026-10-25 00:45Z `c1c3f9c` Moss index, one document per catalog block. `lib/moss/blocks.ts`
- 2026-10-25 00:48Z `bdfc857` live-log mirrors each transcript into Convex. `lib/convexMirror.ts`
- 2026-10-25 00:48Z `65f6df2` `/log`: lessons, beats with timings, learner record, event stream, live. `app/log/LiveLog.tsx`
- 2026-10-25 02:40Z `e2a51c7` Conversation actions: the reply's trailer is an action list. `lib/lesson/converse.ts`
- 2026-10-25 02:49Z `0899b2d` Convex records merged into the main line. `app/log/`, `app/api/live-log/route.ts`
- 2026-10-25 03:00Z `ff7aecb` One board: scenes side by side, the camera glides. `components/Lesson.tsx`
- 2026-10-25 03:14Z `cb8db49` Retrieval before each reply: board + learner's Convex memory in Moss. `lib/moss/memory.ts`, `app/api/converse/route.ts`
- 2026-10-25 03:46Z `46d55b3` Learner memory fetched afresh per lesson; the record rides on every save. `lib/moss/memory.ts`, `components/Lesson.tsx`
- 2026-10-25 04:23Z `37d3643` 300 hand-built blocks: biology, computing, chemistry. `presets/`
- 2026-10-25 05:53Z `760164b` Quizzes: label and sketch, results on the learner record. `app/api/quiz/route.ts`, `lib/lesson/planner.ts`
- 2026-10-25 07:01Z `4cb7307` New start screen and captions. `components/Lesson.tsx`, `app/globals.css`
- 2026-10-25 08:09Z `3239522` End a lesson by voice; a clean board between lessons. `lib/lesson/converse.ts`, `components/Lesson.tsx`
