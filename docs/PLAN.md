# Chalky: learn anything through animation

A voice-first tutor. You talk to it about what you want to learn, optionally hand
it reference material, and it builds an animated, narrated lesson **chapter by
chapter**. At the end of each chapter it asks you a question, and you answer by
**drawing on the screen and talking**. It grades you with an animation. You can
pause any time, circle something, and say "explain this". It takes an animated
detour, then comes back on track. At the end you get the whole lesson saved as a
video, **including everything you drew**.

**Stack:** Cartesia (STT + TTS) · Claude API (the live tutor brain) · Claude Code
running locally (writes the Clayzo animations) · Clayzo (animation + playback +
export) · Convex (database, files, realtime) · Next.js (UI).

---

## 1. The experience

```
 ┌───────────── Onboarding ─────────────┐
 │ ● orb   "What do you want to learn?" │   ← ChatGPT-voice style: full-screen orb,
 │  [+ add PDF / link]  (optional)      │     no chat log, just voice + live caption
 └──────────────────────────────────────┘
                 │  agent asks 1–3 questions (level, goal, time)
                 ▼
     Syllabus appears live: Ch1 ▸ Ch2 ▸ Ch3 ▸ Ch4      ← building status per chapter
                 │
                 ▼
 ┌──────────── Chapter N plays ────────────┐
 │  animation + narration in sync          │  ⏸ pause → draw/circle + talk → DETOUR
 │  ...                                    │           (animated explanation, then resume)
 │  question card at the end ──────────────┼─▶ draw + talk answer → GRADE animation
 └─────────────────────────────────────────┘
                 │
                 ▼  next chapter (already built in the background)
           ...  → Lesson complete → saved replay / MP4 with your drawings
```

**UI states** (one screen, the stage changes):
| State | Stage shows | Voice |
| - | - | - |
| `talking` | Pulsing orb (driven by audio level), live caption | Open mic, agent replies with Sonic |
| `building` | Orb + syllabus with per-chapter progress ("Animating chapter 1… 60%") | Agent keeps chatting: warm-up questions, prior-knowledge check |
| `playing` | Clayzo player full width, small orb in the corner, captions | Narration is inside the animation; mic listens for interrupts |
| `paused` / `drawing` | Frozen frame + ink layer + toolbar (pen, highlighter, undo, done) | Mic open: "explain this", or an answer |
| `grading` / `detour` | The new animation plays | Narration in the animation |

---

## 2. Architecture

```
 Browser (Next.js)                         Convex (cloud)                    Your laptop
 ─────────────────                         ──────────────                    ───────────
 Mic ─▶ Cartesia Ink 2 (STT, WebSocket)    sessions, sources, chapters,      Builder worker (Node)
 Orb UI / captions                         segments, strokes, transcript,     │ subscribes to `jobs`
 Clayzo player + ink canvas    ◀─realtime─  jobs, files (WAV, JSON, PNG)  ◀──┤ runs Claude Code
 Cartesia Sonic playback (agent replies)                                     │ (Agent SDK) with the
        │                                   Actions:                         │ clayzo-authoring skill
        └─ user turn ─▶ tutorBrain (Claude API, fast, tool calls)            │ → validate, render-frame
                         ├ plan_syllabus   ├ grade_answer                    │ → upload document
                         ├ build_chapter   ├ start_detour                    └ clayzo export (replay)
                         ├ resume          └ say(text) → Sonic
```

### Two different Claudes

| | **Tutor brain** | **Animation builder** |
| - | - | - |
| What | Claude API (`claude-sonnet-5-5`), called from a Convex action | Claude Code via the Agent SDK (`@anthropic-ai/claude-agent-sdk`), running on your laptop |
| Job | Conversation, syllabus, narration scripts, grading (vision), detour decisions | Writing Clayzo authoring scripts, running them, checking frame sheets, fixing |
| Latency | ~1–3 s per turn (it's voice, it must be quick) | Minutes per chapter (quality over speed) |
| Talks to | User (via Sonic), Convex | Only Convex (pulls jobs, uploads results) |

**Why a local worker:** Claude Code needs a real filesystem, Node, `npx tsx` and the
`clayzo` CLI (signed in) to author and self-check animations. Convex is the bridge:
the worker subscribes to a `jobs` table, claims a job, builds, and writes results back.
The browser sees progress instantly through Convex's reactive queries.

### Convex schema (sketch)

```ts
sessions:   { userId?, topic, status: "onboarding"|"building"|"learning"|"done", level, goal, currentChapter, createdAt }
sources:    { sessionId, kind: "pdf"|"url"|"text", fileId?, url?, title, extractedText, summary }
messages:   { sessionId, role: "user"|"agent", text, at, segmentId? }          // the voice transcript
chapters:   { sessionId, index, title, objective, outline, question: QuestionSpec, status: "planned"|"scripting"|"voicing"|"animating"|"ready"|"failed", progress }
segments:   { sessionId, chapterId?, kind: "chapter"|"question"|"answer"|"feedback"|"detour",
              order, parentSegmentId?, startFromTick?, documentFileId, audioFileIds[], manifest, durationTicks, status }
jobs:       { kind: "chapter"|"feedback"|"detour"|"export", sessionId, payload, status: "queued"|"claimed"|"running"|"done"|"failed",
              workerId?, log[], progress, resultSegmentId?, createdAt }
strokes:    { sessionId, segmentId, tick, sessionTimeMs, points: [x,y,pressure,t][], tool, color, purpose: "answer"|"interject" }
answers:    { sessionId, chapterId, transcript, inkImageFileId, verdict: "correct"|"partial"|"incorrect", reasoning, feedbackSegmentId }
playback:   { sessionId, events: [{ at, type: "segment_start"|"pause"|"resume"|..., segmentId, tick }] }  // for the replay
```

The **segment** is the core unit: one Clayzo document with its narration audio
baked in. A lesson is an ordered list of segments: chapters, question cards,
answers, feedback and detours.

---

## 3. The pieces in detail

### 3.1 Voice (Cartesia)

- **STT:** Ink 2 over `/stt/turns/websocket`, straight from the browser, using a
  short-lived access token minted in a Convex action (`grants: { stt: true }`).
  It detects turns itself, so there's no VAD to build.
  - `turn.start` → while `playing`, **pause the animation** (interrupt).
  - `turn.update` → live caption (cumulative, never revised).
  - `turn.end` → send the transcript to `tutorBrain`.
  - Keyterms: pass the topic's vocabulary (from the syllabus) for better accuracy.
  - ⚠ Check on day one that the access token works on the turns endpoint. If not,
    proxy through a small WebSocket relay.
- **TTS, conversational replies:** Sonic (`sonic-3.6`) over the TTS WebSocket
  from the browser (token with `tts: true`), with raw PCM played through Web Audio.
  The orb's pulse follows the output level.
- **TTS, narration inside animations:** generated **before** the animation is
  built, on the worker, with `add_timestamps: true`. Raw PCM gets a 44-byte header to
  become a WAV, then goes into the Clayzo document as an `audio` asset + node.
  **Voice and visuals share the player's clock**, so pausing pauses both, and the
  builder times visuals to the word timestamps.
- Use one consistent Sonic voice for the tutor everywhere.

### 3.2 Reference content (path 1)

- Upload a PDF to Convex file storage, or paste a URL.
- A Convex action extracts the content: send the PDF straight to Claude as a document
  block, or fetch the URL and pull its readable text. Store `extractedText` + a summary.
- The syllabus planner and every narration script get the relevant source excerpts,
  so the lesson follows *their* material (and can cite page numbers in captions).
- Path 2 (nothing): the planner works from the conversation alone.

### 3.3 Syllabus and chapters

`tutorBrain` tool `plan_syllabus` → 3–6 chapters, each:
```ts
{ title, objective, outline: string[],         // what the chapter covers
  narration: Beat[],                           // the full script, written up front
  question: { prompt, kind: "draw"|"explain"|"draw+explain", rubric, correctAnswer, commonMistakes[] } }
```
- Writing all narration **before** animating means the voice and the visuals are
  designed together.
- **Pipeline:** queue chapter 1 right away. When it's ready, queue chapter 2, and so
  on, staying ~1–2 chapters ahead. Run 2 workers in parallel if your laptop can handle it.
- The syllabus shows up live in the UI as chapter statuses change.

### 3.4 Chapter build job (the local worker)

For each chapter:
1. **Voice it:** narration beats → Sonic → WAVs + word timestamps (each beat
   ≈ 1–3 sentences).
2. **Brief Claude Code** (Agent SDK `query()` with `cwd` = a fresh job folder,
   tools: Read/Write/Edit/Bash, the Clayzo skills installed). The brief includes:
   - canvas 1920×1080, 30 fps, the house style (palette, fonts in `fonts/`, motion rules),
   - the beats, **with word-level timestamps** ("at 3.42 s, 'resistor' → the resistor appears"),
   - the audio files to embed as `audio` nodes,
   - the **question card** to end on (its prompt shown on screen, plus a clear area
     left empty for drawing),
   - required outputs: `chapter.json` (validated + stamped) **and `manifest.json`**
     (below), plus a `render-frame` sheet it must look at before finishing.
3. **Check it:** the worker re-runs `assertValidAnimationDocument`, renders a sheet, and
   uploads the document, WAVs, manifest and sheet to Convex. The chapter becomes `ready`.
4. Stream progress: the worker writes Agent SDK messages to `jobs.log`/`progress` → "Animating chapter 2… drawing the circuit".

**Manifest** (lets the tutor understand what's on screen, needed for "explain *this*"):
```ts
{ beats: [{ startTick, endTick, narration, words: [{ w, tick }] }],
  elements: [{ nodeId, label: "resistor R1", concept: "resistance", firstTick, lastTick }],
  questionTick }        // where the question card starts; the player auto-pauses here
```
The bounding box of any element at any tick can be computed from the document
itself with Clayzo's `valueAt(property, tick)` (position/scale/size) plus the
manifest labels.

**Template library (do this early, it pays off 3×):** have Claude Code build a small
reusable kit once (`kit/`: title card, labeled-diagram helpers, arrow draw-on,
highlight ring, equation reveal, question card, "correct/incorrect" stamps, a
transition) in the house style. Every chapter brief says "use `kit/`". The results
are faster, more consistent and less broken.

### 3.5 End-of-chapter question → draw + talk → grade

1. The player reaches `questionTick` and pauses. Onboard the question card: the agent
   reads the prompt aloud (it's already in the narration).
2. The UI switches to `drawing`: an ink layer over the frozen frame (use
   `perfect-freehand` on a `<canvas>`; store strokes as points with timestamps).
3. The student draws and talks. Strokes stream to Convex (`strokes`), and the transcript to `messages`.
4. Done: either they say "done / that's my answer" (`turn.end` + intent) or tap ✓.
5. **Grade** (`tutorBrain` → `grade_answer`): composite the frozen frame plus ink into a
   PNG (draw the player canvas + ink canvas onto one canvas) and send it to Claude
   vision with the transcript, rubric, correct answer and common mistakes →
   `{ verdict, reasoning, whatTheyGotRight, misconception? }`.
6. **Feedback animation:**
   - **Instant path:** the agent says the verdict right away by voice ("Close! You got
     the current direction right, but…") while the feedback animation builds.
   - **Pre-built path (recommended):** while building the chapter, also build
     *feedback-correct* and *feedback-common-mistake* segments. Most answers match one
     of these, so feedback plays immediately with a short spoken personalized intro.
   - **Custom path:** if the answer doesn't fit either, queue a `feedback` job (a short
     ~20–40 s animation that starts from the frozen frame and **includes the student's
     strokes as path nodes**, then corrects them).
7. Then move on to the next chapter, which is already built.

### 3.6 Pause → circle → "explain this" → detour → back on track

1. Pausing (button, or `turn.start` from Ink 2) freezes the player at tick `t`.
2. The student circles something and talks: "explain this in more detail".
3. **Resolve "this":** take the bounding box of the stroke, find manifest elements whose
   boxes (computed via `valueAt` at `t`) overlap it, and send Claude the frame+ink
   PNG plus those element labels plus the narration so far. It returns what they mean
   and a detour plan.
4. **Respond now, animate soon:**
   - Right away, the agent answers by voice, and the UI pulses a highlight ring around
     the circled area, so there's never dead air.
   - In parallel, queue a `detour` job: a short animation (30–90 s) that **starts from
     the frozen frame** and dives in. Build it with the kit and a tight brief, so it
     takes 1–3 minutes.
   - When it's ready: "Want me to show you visually?" (or play it automatically if they
     asked for more detail).
5. **Seamless start:** `freezeFrame(document, t)` turns every visible node's
   animated properties into constants with `valueAt(prop, t)`. That snapshot is
   given to the builder as the opening state, so the detour's frame 0 is exactly the
   paused frame plus the student's ink as path nodes.
6. **Back on track:** the detour ends with a transition back to the frozen frame
   ("Okay — back to where we were"), then the original chapter resumes from `t`.
   The segment order records chapter (0→t), detour, chapter (t→end).

### 3.7 Saved lesson / replay with your drawings

- **In-app replay (always works):** a `LessonPlayer` that plays segments in order
  and **redraws strokes in real time** from `strokes` (by `segmentId` + `tick`).
  The student's voice answers can be replayed too, if you record mic audio to Convex.
- **MP4 export (stretch, impressive):** an `export` job on the worker. For each
  segment, inject the student's strokes into the Clayzo document as `path` nodes with
  a `trim` draw-on keyed to their recorded ticks, then `clayzo export --format mp4`,
  then concatenate with ffmpeg. Answer segments (frozen frame + drawing + their voice)
  become short clips. Upload to Convex, and the user gets a download link.

---

## 4. Latency budget (the main risk)

| Moment | Target | How |
| - | - | - |
| Agent replies in conversation | < 1.5 s | Sonnet, short replies, streaming Sonic, Ink 2 `eager_end` to start early |
| First chapter ready | 2–5 min | Fill the wait with a real conversation: level check, a fun hook, preview the syllabus aloud. Show live build progress. |
| Next chapters | 0 s wait | Pipeline 1–2 chapters ahead |
| Feedback after an answer | < 3 s | Pre-built correct/mistake segments + spoken intro |
| Detour | voice < 2 s, animation 1–3 min | Answer by voice + highlight first, then the animation |

**Measure Claude Code's real build time per chapter on day one.** It decides how
long the chapters should be (target 60–120 s of video each) and how many workers you need.

---

## 5. Repo layout

```
app/                       Next.js UI
  page.tsx                 landing: orb + "what do you want to learn?" + add source
  s/[sessionId]/page.tsx   the session: stage, orb, captions, syllabus rail
  s/[sessionId]/replay/page.tsx
components/
  Orb.tsx  Captions.tsx  SyllabusRail.tsx  Stage.tsx  InkLayer.tsx  Toolbar.tsx  LessonPlayer.tsx
lib/
  voice/stt.ts             mic → AudioWorklet PCM → Ink 2 turns socket
  voice/tts.ts             Sonic WebSocket → Web Audio playback + level meter
  clayzo/freeze.ts         freezeFrame(document, tick) via valueAt
  clayzo/hitTest.ts        stroke bbox → manifest elements at tick
  ink/composite.ts         frame + ink → PNG
convex/
  schema.ts  sessions.ts  sources.ts  chapters.ts  segments.ts  jobs.ts  strokes.ts
  tutor.ts                 tutorBrain action (Claude tool use)
  cartesia.ts              access-token action
worker/                    runs on your laptop: `npm run worker`
  index.ts                 ConvexClient subscribe → claim job → dispatch
  chapter.ts  detour.ts  feedback.ts  export.ts
  sonic.ts  wav.ts
  brief/                   prompt templates: style guide, chapter brief, detour brief
  kit/                     reusable Clayzo authoring helpers (built once, phase 3)
  jobs/<jobId>/            scratch folders for Claude Code
```

Env: `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL`.
The worker also needs `npx clayzo login` done once.

---

## 6. Build phases

Each phase ends with something demoable. Hours assume one person; **A/B** marks
a natural split for two people (A = frontend/voice, B = worker/animation).

### Phase 0: Setup and risk spikes (~2 h)
- [ ] Next.js + Convex (`npm create convex@latest`), `npx clayzo@latest init`, keys in env.
- [ ] **Spike 1 (B):** Agent SDK script → Claude Code builds a 30 s Clayzo animation
      from a one-paragraph brief in a scratch folder. **Time it.**
- [ ] **Spike 2 (B):** Sonic with timestamps → WAV → plays inside a Clayzo document.
- [ ] **Spike 3 (A):** browser → Ink 2 turns socket with an access token. Log events.

### Phase 1: Voice shell (~3 h, A)
- [ ] Orb UI (canvas/CSS, scaled by mic/output level), live captions, mic toggle.
- [ ] `tutorBrain` Convex action: user turn → Claude → reply text → Sonic playback.
- [ ] Transcript saved to `messages`, and the session row created.
- ✅ A natural back-and-forth voice conversation about what you want to learn.

### Phase 2: Sources + syllabus (~2.5 h, A+B)
- [ ] Add PDF/URL → Convex storage → extract + summarize action.
- [ ] `plan_syllabus` tool → `chapters` rows. `SyllabusRail` updates live.
- [ ] The agent reads the plan aloud and asks "sound good?" Edits by voice ("skip the history part").
- ✅ Say "teach me how transistors work" (+ a PDF) → a sensible chapter plan appears live.

### Phase 3: The chapter builder (~5 h, B) ⭐
- [ ] Worker: subscribe to `jobs`, claim atomically (a mutation), heartbeats, retry once on failure.
- [ ] Build the `kit/` and the house style guide with Claude Code (once).
- [ ] `chapter.ts`: voice → brief → Claude Code → validate → sheet → upload document/WAVs/manifest.
- [ ] Progress messages into `jobs.progress` → UI shows "Animating chapter 1…".
- [ ] Pipelining: stay up to 2 chapters ahead.
- ✅ Chapter 1 plays in the app with narration in sync, and chapter 2 is ready when it ends.

### Phase 4: Questions, drawing, grading (~4 h, A+B)
- [ ] Auto-pause at `questionTick`, `InkLayer` + toolbar, strokes into Convex.
- [ ] "Done" by voice or button → composite PNG → `grade_answer` (vision).
- [ ] Pre-built feedback segments per chapter + a spoken personalized intro. Custom feedback job as a fallback.
- ✅ Draw an answer on a circuit question, say "I think current flows this way", and get graded with an animation.

### Phase 5: Pause, circle, detour (~4 h, A+B)
- [ ] Pause on button or voice. Circle → `hitTest` → resolve "this".
- [ ] Instant spoken answer + highlight ring.
- [ ] `freezeFrame` + detour job → plays → returns → resume at `t`.
- ✅ Circle the capacitor mid-chapter, say "explain this", get a voice answer now and an animated detour shortly, then it resumes.

### Phase 6: Saved lesson (~3 h)
- [ ] `LessonPlayer` replay with ink redrawn in time (A).
- [ ] MP4 export job with strokes injected as trim-animated paths + ffmpeg concat (B, stretch).
- ✅ The finished lesson replays end to end with your drawings.

### Phase 7: Polish (~3 h)
- [ ] Building-wait experience (warm-up questions, progress), error recovery ("that chapter failed, rebuilding"),
      landing page, keyboard shortcuts (Space = pause, D = draw), demo rehearsal + backup recording.

**Total ≈ 26 h solo, ≈ 15 h with two people.**

---

## 7. Cut lines

| Behind at… | Cut | Still demo |
| - | - | - |
| Phase 3 | Pipelining, run 1 worker | Chapters (with a wait between them) |
| Phase 4 | Custom feedback jobs; use pre-built only | Draw + talk + graded feedback |
| Phase 5 | Animated detours; voice answer + highlight only | Interrupt + explain |
| Phase 6 | MP4 export; in-app replay only | Saved lesson with drawings |

**Pre-build the demo topic.** Run the full pipeline for the demo topic before
presenting, so chapters are cached. Live-build only one detour on stage.

## 8. Demo (3 min)

1. "I want to understand how a transistor works", plus drop in a datasheet PDF. The
   agent asks your level, and the syllabus appears live.
2. Chapter 1 plays: animated circuit, narrated by Cartesia.
3. Pause, circle the base terminal: "wait, explain this part". You get an instant
   voice answer, then an animated detour from that exact frame, and it's back on track.
4. Question card: "draw where the current flows". Draw arrows and talk, and get a
   "partially right" verdict with an animation correcting your arrow.
5. Finish → replay the full lesson with your drawings in it → download the MP4.

## 9. Open questions to settle early

- **Chapter length vs. build time:** decide after spike 1.
- **Laptop as the build server:** fine for a hackathon, and the worker can move to a
  cloud VM later (it only needs Node, Claude Code and `CLAYZO_TOKEN`).
- **Auth:** skip it (one anonymous session per browser) unless the judging needs it.
