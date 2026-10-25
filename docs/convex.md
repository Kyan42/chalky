# Lessons and learners in Convex

Every lesson transcript the page posts to `/api/live-log` (every ~2 s and on Stop)
is mirrored into Convex when a deployment is configured, next to the file in
`experiments/live-runs/`. `/log` shows them live.

- `convex/schema.ts`: `lessons` (one per transcript id), `lessonEvents` (one row
  per event, by lesson and seq / t), `beats` (one per played beat), `learners`
  (one per learner id, merged across lessons). Event and beat payloads are JSON text.
- `convex/lessons.ts`: `upsertLesson({ transcript, learnerId?, build? })` takes the
  transcript JSON as posted and appends only new rows (idempotent);
  `lessonLive({ lessonId })`, `recentLessons({ limit? })`.
- `convex/learners.ts`: `learnerMemory({ learnerId, before? })` returns a few lines
  for a prompt ("" when nothing is known); `get({ learnerId })`.
- `lib/convexMirror.ts`: the route's mirror (a no-op, logged once, without
  `NEXT_PUBLIC_CONVEX_URL`).
- `app/log/`: the live page. Without Convex it polls the saved files instead.

## One-time setup (cloud deployment, never a local one)

1. `npx convex login` (opens the browser; sign in to the team's Convex account).
2. In the checkout that has `convex/`:
   `npx convex dev --once --configure new --project chalky --dev-deployment cloud`
   This creates the project and a cloud dev deployment, pushes the schema and
   functions, regenerates `convex/_generated/`, and writes `CONVEX_DEPLOYMENT` and
   `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Check both lines are there; if only
   `CONVEX_URL` was written, add `NEXT_PUBLIC_CONVEX_URL=<same url>`.
3. Copy those two lines into every checkout's `.env.local` that runs the app, and
   restart `next dev` (`NEXT_PUBLIC_*` is read at build time).
4. After changing anything in `convex/`, push again: `npx convex dev --once`
   (or `npx convex dev` to watch). A production deployment for the demo:
   `npx convex deploy`, then use its URL.

## Checking it without a lesson

    npx tsx scripts/replay-live-run.ts <saved transcript.json> --id 20261025180000-replay-test --every 1500 --learner l-demo-learner1

then open `/log`: the lesson appears and grows with each post. The header says
"Convex · live subscription" when it reads from Convex.

## Learner id

The route reads the learner id from the post's optional `learnerId` field, else
from the `chalky_learner` cookie, and sets that cookie (one year) when neither is
there, so one browser is one learner with no page change. If the lesson page
should own the id instead, the one-line change in `components/Lesson.tsx`, in
the `transcript` object:

    learnerId: localStorage.getItem("chalky_learner") ?? (localStorage.setItem("chalky_learner", `l-${crypto.randomUUID().slice(0, 13)}`), localStorage.getItem("chalky_learner")),

A later lesson can read what this learner got stuck on before with
`learnerMemory`, e.g. from a route:
`new ConvexHttpClient(url).query(api.learners.learnerMemory, { learnerId, before: lessonId })`.

`upsertLesson` is a public mutation: anyone with the deployment URL can write.
Fine for the hackathon; make it internal behind an HTTP action with a secret
before anything real.
