# Chalky

Ask an LLM to explain something and you get a wall of text. Chalky replaces the chat box for
understanding things: you ask out loud, and it explains on a whiteboard, in a voice you can interrupt
mid-word. It draws while it talks, points at what it means, asks what you already know, quizzes you,
and remembers what you got stuck on.

Built at Cal Hacks 13 by Keyon, Janani and Leo.

## How we use Convex

Convex is Chalky's memory. Every lesson's transcript is mirrored into Convex as it plays (lessons, events, beats),
and a learner record is merged across lessons, so the next lesson starts from what you got stuck on last time.
`/log` shows lessons live through `useQuery`, no refresh. Evidence, files and a dated commit log: [hackathon.md](hackathon.md).

## A lesson in one minute

Open `/lesson`, press **Start talking** and ask, for example, "how does photosynthesis work?".

1. Chalky answers within a second or two and asks one short intake question ("what do you already
   know about it?"). Meanwhile the planner is already writing the lesson, shaped by your answer.
2. The lesson plays as 12 to 18 short beats in sections, with check-ins. Each beat is spoken by
   Cartesia Sonic, and its drawing appears on the board on the word it belongs to, built from a
   catalogue of 300 line-art blocks (a leaf, a chloroplast, a water molecule) where one fits.
3. Cut in whenever you like: just start talking, or hold **Space**. Chalky freezes on the exact word,
   listens, and answers on the board: it points with its chalk hand, circles, sketches one missing
   thing, or inserts a short detour of new beats. Then it goes on from the word it stopped on.
4. Pick up the pen and circle something: "what is this?" Chalky reads what the circle goes round.
5. The board is one long world. New scenes open beside the old ones and the camera glides between
   them. "Show me where the leaf diagram was" glides back.
6. A quiz asks you to label the numbered parts of a diagram, or to sketch it. Chalky grades it and
   says what was right and what was missing.
7. Ask something time-sensitive ("what's new in CRISPR this month") and Chalky looks it up on the
   web while it asks the intake question, then teaches from what it found, with the sources on screen.
8. Say "I'm done" to end. Your next lesson starts from what you got stuck on last time.

Pause, Stop and a Space tap freeze on the word and resume from it. Captions show every word as it is
spoken, and your own words as you say them.

## Sponsors, and what each one does here

**Cartesia** is the voice. Sonic (`sonic-3.6`) speaks every line as 16-bit PCM at 24 kHz with a
timestamp for every word, and those timestamps are the clock: each drawing, pointer and caption word
is scheduled against them, and an interruption resumes on the exact word. Measured over the last
live runs, Sonic's first audio arrives 85 to 400 ms after a sentence is sent. Ink-2 listens over a
WebSocket from the browser; it gets up to 100 key terms per lesson (Chalky's name plus the lesson's
own vocabulary), and its turn detection decides when you've finished asking.

**Anthropic** models do the thinking, each matched to its latency budget. Claude Haiku 5.5 is the
voice: every reply, the intake, the decision of what happens next. Claude Opus 5.5 writes the lesson
plan, streamed beat by beat, at low effort. Claude Sonnet 5.5 writes detours and rewrites, draws the
later beats, grades sketches from a picture of the board, and handles the rare request the fast model
hands over with the whole board in view. Claude never writes animation: it names blocks, positions
and words, and our compiler owns the geometry and timing.

**Clayzo** renders the board. Every drawing is a Clayzo document played in WebGL and seeked to the
speech clock each frame, which is what makes a line appear on its word. The 300 blocks (100 each in
biology, chemistry and computing) are hand-built vector scenes; every part of every block has a
name, so a lesson can point at a cell's nucleus or one node of a neural network.

**Moss** picks the blocks and finds things on the board. Listing 300 blocks in every prompt was too
much, so each beat's description is searched against a Moss index of the catalogue and the drawer
gets the four best matches (about a millisecond inside Moss, around 20 ms round trip). Before every
reply to an interruption, a Moss session over the board's elements and the learner's memory ranks
what "that arrow" most likely means.

**Convex** stores everything: lessons, their events and beats, and a learner record merged across
lessons. The `/log` page follows a lesson live. Details in [hackathon.md](hackathon.md).

**Apify** answers the questions a model can't: anything time-sensitive. A question that asks for
what's new, latest, a version or a date triggers one call to Apify's browser actor, which searches
the web and extracts the top three pages. It runs while Chalky asks the intake question, so it costs
no time you can feel; the planner then teaches from verbatim sentences of those pages, each beat
citing the page it came from, and the source card shows on screen. Mid-lesson, a question past the
model's knowledge becomes a quick lookup and a short detour. If nothing recent turns up within the
eight-second budget, Chalky says so and teaches from what it knows; a late result arrives as a detour
when it lands.

## Architecture

The audio is the clock. Each frame the board's Clayzo player is seeked to the speech time, so a
drawing starts on its anchor word. Speech never waits for a drawing: a drawing that is late starts
when it arrives.

| Part | Model or service | Where |
|---|---|---|
| Speech in: streaming recognition with turn detection, per-lesson key terms | Cartesia Ink-2 (WebSocket from the browser, short-lived token) | `lib/voice/stt.ts`, `lib/voice/useHybridMic.ts`, `lib/voice/keyterms.ts`, `app/api/cartesia/token/route.ts` |
| Speech out: audio plus word timestamps | Cartesia Sonic (`sonic-3.6`), SSE, 16-bit PCM at 24 kHz | `lib/sonic.ts`, `app/api/tts/route.ts`, `lib/audio/stream-player.ts` |
| The voice: answers every utterance, decides what happens next (answer, point, sketch, detour, replan, go to, quiz, research, end) | Claude Haiku 5.5, thinking off; Sonnet 5.5 if Haiku fails before its first sentence | `lib/lesson/converse.ts`, `app/api/converse/route.ts` |
| Intake question and the decision to rewrite the plan | Claude Haiku 5.5 | `lib/lesson/intake.ts` |
| Lesson planner: 12 to 18 beats, sections, check-ins, quizzes, scenes, regions, element ids | Claude Opus 5.5, streaming JSON lines, low effort | `lib/lesson/planner.ts`, `app/api/plan/route.ts` |
| Detours and new endings while teaching | Claude Sonnet 5.5 | `lib/lesson/planner.ts` (amend), `lib/lesson/scenes.ts`, `app/api/amend/route.ts` |
| Drawing one beat in the scene language | Claude Haiku 5.5 for beat 1, Sonnet 5.5 after (deadline, Haiku fallback) | `lib/lesson/draw.ts`, `lib/lesson/language.ts`, `app/api/draw/route.ts` |
| Layout pass once the whole plan is in | Claude Sonnet 5.5 | `lib/lesson/layout.ts`, `app/api/layout/route.ts` |
| Requests the voice can't settle from its small context | Claude Sonnet 5.5, whole board in view | `lib/lesson/delegate.ts`, `app/api/delegate/route.ts` |
| Quiz grading | Haiku 5.5 (label, text), Sonnet 5.5 (sketch, from the board picture) | `lib/lesson/quiz.ts`, `app/api/quiz/route.ts` |
| Time-sensitive questions: web search and page extraction | Apify `apify/rag-web-browser` | `lib/research/`, `app/api/research/`, `components/ResearchCards.tsx` |
| Layout compiler: places labels, arrows, flows; owns geometry | our code | `lib/lesson/presets.ts`, `lib/lesson/board.ts` |
| 300 line-art blocks (biology, chemistry, computing) | hand-built | `presets/`, `lib/blocks/` |
| Block retrieval per beat | Moss index, keyword fallback | `lib/moss/blocks.ts`, `lib/blocks/catalog.ts` |
| Board and learner memory search on every reply | Moss sessions in the server process | `lib/moss/session.ts`, `lib/moss/memory.ts`, `app/api/board-index/route.ts` |
| Animation | Clayzo WebGL player | `@clayzo/webgl-player`, `components/Lesson.tsx` |
| Lessons, events, beats, learners; live log | Convex | `convex/`, `lib/convexMirror.ts`, `app/api/live-log/route.ts`, `app/log/` |
| Learner's pen, Chalky's cursor | perfect-freehand, SVG overlay | `components/InkLayer.tsx`, `lib/lesson/ink.ts`, `components/ChalkyCursor.tsx` |

The lesson loop itself, with all its states, is `components/Lesson.tsx`.

## Setup

Requires Node 22.13 or later.

```bash
npm install
```

Create `.env.local` in the repo root. Keys are read only on the server, except the `NEXT_PUBLIC_*`
values, which are not secrets.

| Variable | Needed | Where it comes from |
|---|---|---|
| `CARTESIA_API_KEY` | yes | Cartesia dashboard, API keys |
| `ANTHROPIC_API_KEY` | yes | console.anthropic.com, API keys |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | for Moss retrieval (without them, keyword match and word overlap) | portal.usemoss.dev |
| `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` | for Convex records and the live `/log` | written by `npx convex dev --once --configure new --project chalky --dev-deployment cloud` (see `docs/convex.md`) |
| `APIFY_TOKEN` | for time-sensitive questions (without it, Chalky teaches from what it knows) | console.apify.com, Settings, API & Integrations |
| `CHALKY_LIVE_LOG` | `1` to write transcripts to `experiments/live-runs/` | none |
| `NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN` | `1` to have voice interrupt on by default (the header switch overrides it per browser) | none |
| `NEXT_PUBLIC_CHALKY_THEME` | `chalk` (default), `chalkboard` or `whiteboard` | none |
| `SONIC_SPEED` | optional, 0.6 to 1.5, default 0.92; `1` turns it off | none |
| `CARTESIA_VOICE_ID`, `CARTESIA_MODEL_ID` | optional voice and model overrides | Cartesia voice library |
| `CHALKY_BLOCK_RETRIEVAL` | optional, `moss` or `all` | none |

Build the Moss block index once (and after changing blocks):

```bash
npx tsx --env-file=.env.local scripts/moss-build-blocks.ts
```

Run it:

```bash
npm run dev
```

Open http://localhost:3000/lesson. (`/` is an early one-beat demo page; the app is `/lesson`.)

For a demo, use a production build. The dev server compiles each route on its first request, which
makes a cold first sound several seconds slower.

```bash
npm run build
npm run start
```

At start the server loads the Moss block index and makes spare Moss sessions ahead of time
(`instrumentation.ts`), so the first lesson after a boot can still be a few seconds slower. Run one
throwaway lesson first. On the dev server, `scripts/warm.sh` compiles every route the lesson uses
(it reads `BASE_URL`).

## Checks

No server, no keys:

```bash
npm run typecheck
npx tsx scripts/test-turn-merger.ts      # Ink turns merged into one utterance
npx tsx scripts/test-layout.ts           # labels and blocks move off each other; circle-to-block swap
npx tsx scripts/test-amend-scenes.ts     # scene rules on a plan change
npx tsx scripts/test-first-person.ts     # Chalky speaks as "I"
```

With Moss keys:

```bash
npx tsx --env-file=.env.local scripts/test-moss-blocks.ts   # 26 briefs; expected block in Moss's top 3; exits 2 without keys
```

Against a running server (Playwright; `npx playwright install chromium` once). Each script states its
options at the top. Set `BASE_URL` to your server.

| Script | What it drives |
|---|---|
| `scripts/e2e-lesson.mjs "Why is the sky blue?"` | a whole lesson, typed or by fake mic, screenshot per beat |
| `scripts/e2e-voice-ask.mjs`, `e2e-intake.mjs`, `e2e-intake-rewrite.mjs` | asking by voice; the intake and a plan rewrite |
| `scripts/e2e-cut-resume.mjs`, `e2e-cut-detour.mjs`, `e2e-toggle.mjs`, `e2e-stop-mic.mjs` | cut-ins, detours, Pause and Stop resuming on the word |
| `scripts/e2e-voice-barge.mjs` | voice barge-in |
| `scripts/e2e-ink-sketch-zoom.mjs`, `e2e-one-board.mjs` | pen, sketch answers, camera on the one board |
| `scripts/e2e-quiz.mjs` | label and sketch quizzes, scores on the learner record |
| `scripts/e2e-end-lesson.mjs` | "I'm done" ends the lesson and returns to the start screen |
| `scripts/grounding-check.mjs`, `keyterm-check.mjs`, `pacing-check.mjs` | reply grounding, key terms, pacing |

Saved plans in `experiments/converse/fixtures/` let the lesson run without a planner call in
development: `/lesson?fixture=why-is-the-sky-blue&beats=3`.

## Repo map

| Path | What it is |
|---|---|
| `app/lesson/`, `components/Lesson.tsx` | the lesson page and loop |
| `app/api/` | server routes (each file's header says what it takes and returns) |
| `app/log/` | live log of lessons (Convex subscription, or the saved files without Convex) |
| `app/experiments/` | dev pages: blocks gallery, chalk theme, cursor, mic, Moss, board view |
| `lib/lesson/` | planner, conversation layer, intake, drawing, scene language, compiler, quiz, ink |
| `lib/voice/`, `lib/sonic.ts`, `lib/audio/` | Ink-2, Sonic, audio playback and the clock |
| `lib/moss/` | block retrieval, board and learner memory sessions |
| `lib/research/` | time-sensitive questions: Apify fetch, cache, the contract the lesson reads |
| `lib/blocks/`, `presets/` | the 300 blocks and how the compiler draws them |
| `lib/board/` | themes and the chalk look |
| `convex/` | schema and functions; `docs/convex.md` |
| `scripts/` | checks, benchmarks, warm-up |
| `experiments/` | measured experiments; `visual-flex/RESULTS.md` is why the drawing model writes a scene language |
| `public/` | fonts, mascot, icon style packs |

## Team and credits

- **Keyon**: lesson loop, planner, conversation layer, voice pipeline, Moss, Convex, Apify.
- **Janani**: the 300 blocks, the original voice loop (Ink-2 and orb), ink, pause, sketches, zoom,
  the cursor character, ending a lesson by voice.
- **Leo**: the interface: start screen, mascot, conversation dock, captions, fonts, icon style packs.

Built on [Clayzo](https://clayzo.com) for animation, [Cartesia](https://cartesia.ai) Ink-2 and
Sonic for voice, [Anthropic](https://anthropic.com) Claude for the models, [Moss](https://usemoss.dev)
for retrieval, [Convex](https://convex.dev) for records, and [Apify](https://apify.com) for the web.
Fonts are under the OFL (`public/fonts/OFL.txt`).

## Known limitations

- **Voice interrupt wants headphones.** Talking over Chalky works, but through speakers the mic can
  hear Chalky and cut it off. The header switch turns it off per browser; holding Space always works.
- **Sonic on weak wifi.** We moved from float32 at 44.1 kHz to 16-bit at 24 kHz because the heavier
  stream stuttered on the venue network. On a very weak connection the player still inserts silence
  when audio arrives late.
- **First sound under API load.** Measured in live runs, Chalky's first sound comes 1.1 to 2.6 s after
  you stop talking, once 4.6 s on a cold start. Each model call's timing and retries are logged in
  the transcript (`lib/lesson/calllog.ts`).
- **Grading a drawing can be unfair.** A sketch quiz is graded by Sonnet from a picture of the board
  against the lesson's own sentences. A rough but correct sketch can score low. Quizzes are skippable.
- **Blocks cover three subjects.** 300 blocks: 100 each in biology, chemistry and computing. Outside them
  the drawer uses plain shapes, labels and arrows.
- **Research is a gamble on fresh questions.** A fresh web fetch takes a median of about 7 s, and about
  four in ten miss the 8 s budget when the search step inside the actor stalls; those arrive later as a
  detour, or not at all. Repeated questions are cached and instant. Only three pages are read.
- **Misheard first turn.** Ink-2 can end a turn after "Hey Chalky" or mishear a topic word. A bare
  greeting no longer starts a lesson, and key terms help, but a misheard question can start the wrong
  lesson.
- **Convex writes are public.** `upsertLesson` is a public mutation: anyone with the deployment URL can
  write. Fine for a hackathon, not for real learners.
- **One browser is one learner.** The learner id is a cookie. No accounts.
- **Laptop only.** Transcripts are files in the working directory; Moss sessions live in the server
  process. A serverless host would lose both (Convex still keeps the records).
- **Clayzo can't edit a running document**, so the board document is rebuilt per beat.
