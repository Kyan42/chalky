# chalky

Learn anything through animation. You talk to Chalky about what you want to learn (optionally
handing it PDFs or links). It plans a lesson, builds a narrated Clayzo animation **one chapter at
a time**, and talks you through it. At the end of each chapter it asks you a question that you
answer by **drawing on the frame and talking**. It grades you with an animation. Pause any time,
circle something, say "explain this", and it takes an animated detour from that exact frame, then
comes back on track. Afterwards you can replay the whole lesson, including your drawings, or
export it as an MP4.

The design is in [docs/PLAN.md](docs/PLAN.md).

## How it fits together

```
Browser (Next.js)                 Convex                         Your laptop
 mic → Cartesia Ink 2  ──────▶  tutor actions (Claude API)       npm run worker
 Sonic voice ◀── messages       sessions · chapters · jobs   ◀──  claims jobs, then:
 Clayzo player + ink layer ◀──  segments · strokes · timeline      Sonic narration (word timestamps)
                                                                   Claude Code + the Chalky kit → Clayzo docs
                                                                   uploads documents + audio
```

| Piece | Where |
| - | - |
| Voice loop (mic → Ink 2, Sonic playback) | `lib/voice/` |
| Session controller: talk, play, pause/ask, answer/grade, detours | `components/session/SessionView.tsx` |
| Clayzo stage (seamless clip swaps) and ink layer | `components/Stage.tsx`, `components/InkLayer.tsx` |
| Tutor brain: conversation, syllabus, grading, interjections | `convex/tutor.ts` |
| PDF and link reading | `convex/ingest.ts` |
| Job queue and pipelining (2 chapters ahead) | `convex/jobs.ts`, `convex/lib/pipeline.ts` |
| Builder worker (Claude Code via the Agent SDK) | `worker/` |
| The animation kit Claude Code authors with | `worker/kit/kit.ts`, `worker/kit/KIT.md` |
| Freeze-frame (start a detour on the paused frame) | `lib/clayzo/freeze.ts` |
| Student ink → Clayzo paths (export) | `lib/clayzo/ink.ts` |
| Replay and MP4 export | `app/s/[sessionId]/replay/page.tsx`, `worker/handlers.ts` |

## Setup (the morning checklist)

You need Node 22, Chrome, `ffmpeg` (for MP4 export), and the `claude` CLI signed in. The worker
runs Claude Code with your login.

1. **Install:** `npm install`
2. **Convex:** `npm run convex` and leave it running. It currently uses a local anonymous
   deployment (no account needed, everything stays on this laptop). To use a cloud deployment
   instead, run `npx convex login` and then `npx convex dev --configure`.
3. **Keys:** both files already exist with placeholders.
   - `.env.convex`: `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `WORKER_SECRET` (any long random string). Then run `npm run keys` to push them to Convex.
   - `.env.worker`: the same `WORKER_SECRET`, plus `CARTESIA_API_KEY`.
4. **Clayzo:** run `npx clayzo login` once. Claude Code uses `render-frame` to check its own
   frames, and the MP4 export uses `clayzo export`.
5. **Run:** `npm run dev` (web, http://localhost:3000) and `npm run worker` (builder), next to `npm run convex`.

Use Chrome with headphones for the first try; see the echo note below.

## Trying it without keys

- `npm run sample` builds a sample chapter with the kit. http://localhost:3000/dev plays it on
  the real stage with the ink layer.
- `npm run seed:sample` completes the next queued chapter job with that sample (it needs
  `WORKER_SECRET` set), so you can click through a lesson without Cartesia or Claude Code. If voice
  can't start, the session falls back to captions.
- `npm test` checks freeze-frame, ink-to-path and WAV against the sample.

## What's verified and what isn't

Verified tonight, without API keys:
- Typecheck, lint and production build pass.
- Convex functions deploy. Chapter jobs queue and pipeline. The worker claims, fails and retries
  with clear errors.
- The kit produces valid Clayzo documents. Freeze-frame matches the source frame exactly (tested
  with `valueAt`).
- The stage plays, drawing works, and the snapshot of player plus ink is readable.
- The replay page plays clips and redraws ink at the drawing pace.

Not yet run, because they need the keys:
- Claude tutor calls.
- Cartesia STT and TTS (wire formats follow docs.cartesia.ai, API version `2026-08-14`).
- Claude Code authoring a real chapter (time this first: it decides how long chapters should be).
- `clayzo export` for MP4.

## Things to know

- **Echo:** while the tutor is talking, the mic isn't sent, so it can't hear itself. While an
  animation plays the mic stays live so you can interrupt, and transcripts that match the
  narration are ignored. Headphones still make it most reliable.
- **Space** pauses and resumes. Tap the orb to cut the tutor off.
- **Chapter build time:** Claude Code takes minutes per chapter. The tutor keeps you talking while
  chapter 1 builds, and later chapters build two ahead. For a demo, run the whole lesson once
  beforehand so the chapters are cached.
- **Failed chapters** show "Try again" in the syllabus. That's useful after fixing a key.
