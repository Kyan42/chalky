# Spike notes: one beat, end to end

Measured on 2026-10-24 in a cloud container: headless Chromium 1.63 (Playwright), WebGL2 on
**SwiftShader** (software GPU), Next.js dev server, real Cartesia Sonic (`sonic-3`, voice
`e07c00bc-…`, raw `pcm_f32le` at 44.1 kHz) reached through an egress proxy. Each number is from
`scripts/e2e.mjs` (4 full runs, 8 played beats) or `scripts/spike-clayzo.mjs`, unless marked
otherwise. Raw output: `docs/e2e-results.json`, `docs/clayzo-spike-results.json`.

**Unconfirmed** means not observed live here; the reason is given each time.

## Summary

| Question | Answer |
|---|---|
| Does Sonic SSE return word timestamps? | **Yes.** `add_timestamps: true` gives `type: "timestamps"` events, usually one word per event. |
| Does the Sonic WebSocket return word timestamps? | **Yes per the official SDK types; unconfirmed live** (the proxy breaks WebSocket upgrades here). |
| Time to first audio | Warm: **248–383 ms** at the server, **259–396 ms** in the browser. Cold first request: **742–958 ms** at the server. |
| Do timestamps arrive before the word is played? | **Yes, in every run**, with **108–403 ms** to spare on the closest word. Each word's timestamp arrives *after* the audio chunk that contains it. |
| Text normalization | Numbers, money, times, dates and abbreviations are spoken in full. Timestamps keep the **written** form unless you set `use_normalized_timestamps: true`. |
| `checkCoverage()` | **Passes**: `{ supported: true, reasons: [] }`. |
| `seek(tick)` precision | The player reports the exact tick asked for, but **draws on the frame grid** (4 ticks at 60 fps). 240 ticks/s confirmed. |
| 5+ players on one page | **6 players, all drawing ~47 fps** at once on the software GPU, with no errors. |
| Change a running player's document | **No API for it.** `dispose()` then `createPlayer()` on the same canvas takes **93–108 ms**. |
| Sync drift (wave vs. audio) | The wave starts **4–71 ms** after the word "wave" begins. While drawing, median **−10 to −12 ms** (wave slightly behind), worst **−42 ms**. |

## Sonic

### API used (docs.cartesia.ai was unreachable from the container)

The docs host was blocked by the network policy during the spike, so the request shape comes from
Cartesia's official SDK `@cartesia/cartesia-js@4.2.0` (`tts.generateSSE`, its types and its
WebSocket client). It was then confirmed live against the API:

```
POST https://api.cartesia.ai/tts/sse
Authorization: Bearer <key>          (added by the proxy here; sent from .env.local when running locally)
Cartesia-Version: 2026-08-14
{ model_id: "sonic-3", transcript, voice: { id }, language: "en",
  output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: 44100 },
  add_timestamps: true }
```

The response is SSE. Its events are `chunk` (base64 audio, about 0.2 s each), `timestamps`
(`word_timestamps: { words, start, end }` in seconds), `done` and `error`.

### WebSocket vs SSE timestamps

- **SSE:** confirmed live. Timestamps arrive interleaved with the audio chunks.
- **WebSocket (`wss://api.cartesia.ai/tts/websocket`):** the SDK's request type
  (`GenerationRequest`) has `add_timestamps`, and its response union includes a `timestamps`
  message with `word_timestamps`, keyed by `context_id`. So the WebSocket should return the same
  data, per context. **Unconfirmed live:** the upgrade got back `426 Upgrade Required`, which
  suggests the proxy strips the upgrade headers. Run `node` with the SDK's `tts.websocket()` on a
  laptop to confirm. The WebSocket is the likely choice for the real planner (one connection, one
  context per beat, `continue: true` to stream text in).

### Time to first audio

| | server: request → first chunk | browser: click → first chunk |
|---|---|---|
| Cold (first request after the server starts) | 742, 958 ms | 761, 1161 ms |
| Warm | 248, 271, 272, 277, 280, 289, 360, 383 ms | 259, 284, 286, 288, 300, 303, 377, 396 ms |

A bare `curl` to the API took 977 ms to first byte (cold, through the proxy). The browser plays
the first chunk 100 ms after it arrives, a deliberate cushion in `lib/audio/stream-player.ts`.
There were 0 s of underruns in every run: Sonic streams faster than real time (a 3.7–4.0 s
sentence fully arrives about 1.6 s after the request).

### Do timestamps arrive before the words are spoken?

They arrive **after the audio they describe** but **before it plays**. In the raw stream, the
timestamp for "wave" (starts at 0.80 s) comes after about 1.16 s of audio has already been sent.
Because audio arrives faster than real time, the browser still had it in time:

- the "wave" timestamp arrived **673–1156 ms** before "wave" was audible;
- the closest any word came was **108–403 ms** of lead (usually the first word, "Noise").

So anchoring a visual to a word works for words after the first second. For the **first word of a
beat**, the lead is only about 100–400 ms. That is still enough here, but not guaranteed. Keep the
100 ms playback cushion; the 200 ms first-chunk latency is the larger risk.

**Sonic is not deterministic.** The start of "wave" varied from **0.71 s to 1.28 s** across
generations of the same sentence. Never pre-compute timings; always resolve `at` against this
generation's timestamps.

### Text normalization

Transcript: `I have 3 cats and $5.50 at 10:30am on 2026-10-24, Dr. Smith said 1,000 dB is loud.`

| Written | Default timestamps (`use_normalized_timestamps` unset) | `use_normalized_timestamps: true` |
|---|---|---|
| `3` | `3` | `three` |
| `$5.50` | `$5.50` (one "word", 1.35 s long) | `five` `dollars` `fifty` `cents` |
| `10:30am` | `10:30am` | `ten` `thirty` `AM` |
| `2026-10-24,` | `2026-10-24,` | `october` `twenty` `fourth` `twenty` `twenty` `six,` |
| `Dr.` | `Dr.` | `doctor` |
| `1,000` | `1,000` | `one` `thousand` |
| `dB` | `dB` | `dB` (not expanded; you probably want it spoken as "decibels") |

Punctuation stays attached to words (`pressure,`, `falling.`) in both modes. Implications:

- Captions should use the default (written) timestamps; they read better.
- Anchor matching should normalize case and punctuation (done in `lib/beat.ts`). The planner
  should anchor on plain words, not on numbers. An anchor like `"5.50"` would only match the
  written form.
- Units like `dB` should be written out by the planner (`decibels`), or handled with a
  pronunciation dictionary (`pronunciation_dict_id`).

## Clayzo

Skills installed with `npx skills add clayzo/agent-skills`, giving `clayzo-animation-authoring`
and `clayzo-animation-shipping`. They aren't committed (no license file); `skills-lock.json` pins
them. The document is authored in TypeScript in `lib/visuals/wave.ts` with
`@clayzo/animation/authoring` 0.3.18 (`base`, `keyed`, `trim`, `stroke`, `withComputedRevision`,
`assertValidAnimationDocument`). The CLI and login were not used.

The wave is a static dashed baseline plus a 193-vertex polyline sine. Its `trim.end` runs 0 → 1
over 384 ticks (1.6 s, ease in-out); the document is 480 ticks long at 60 fps.

### `checkCoverage()`

`{ supported: true, reasons: [] }` for the wave document in `@clayzo/webgl-player` 0.3.18.

### `seek(tick)` precision

- **240 ticks per second is confirmed:** `play()` advanced 240 ticks in 1.0 s of wall time, and
  6 players advanced 356–360 ticks in 1.5 s.
- **Reported tick is exact:** after `await seek(n)`, `player.tick === n` for every value tried
  (0–8, 48, 96–101, 192, 288, 383, 384, 479).
- **Drawn frame is quantized to the document's frame rate.** Measured by reading back the canvas
  and finding the rightmost wave pixel: ticks 96 and 97 draw the same image, and 98–101 draw the
  next one. So rendering rounds to the nearest frame (4 ticks = 16.7 ms at 60 fps). A seek that
  lands on the already-drawn frame costs about 0.1 ms. Author at 60 fps for smooth following.
- **Seek cost when it redraws** (SwiftShader software GPU): median **19.8 ms**, p95 **27.7 ms**,
  max **44 ms**, called once per animation frame. A real GPU should be much faster;
  **unconfirmed** on hardware.
- **`seek()` beyond the duration is not clamped** (`seek(600)` on a 480-tick document reports
  600). `secondsToTick()` clamps for us.
- The drawn extent tracks the trim curve: tick 192 (`trim.end` 0.5) drew to 50.6% of the width,
  which is what the geometry predicts.

### Many players

6 players on one page, each with its own document, all `play()`ing: each drew **70–72 frames
in 1.5 s (about 47 fps)** on SwiftShader, with no `onError` calls. `createPlayer` took about
450 ms for the first player (engine start-up). The player has built-in off-screen pause/release
(`pauseWhenOffscreen`, `releaseWhenOffscreen`). This app turns them off for the stage player so
seeks always draw.

### Updating a running player's document

`PlayerHandle` has no `setDocument`/`load`. The working route is `player.dispose()`, then
`createPlayer({ canvas, document: newDoc })` on the **same canvas**: **93–108 ms**, with no
errors, and the new player seeks normally. The React `ClayzoPlayer` does the same thing
internally: per the shipping skill, it rebuilds from the start when the document's content
changes (not tested here). Implication for Chalky: treat each visual as an immutable document,
author variants up front, and swap on beat boundaries. Never mutate mid-draw.

## Sync: audio as the master clock

`lib/audio/stream-player.ts` schedules each PCM chunk back to back on one `AudioContext` and
remembers, per chunk, both its AudioContext start time and its position in the speech. So
`position()` (the speech time audible now) stays exact even if a gap is ever inserted. Every
`requestAnimationFrame`, the loop in `components/Whiteboard.tsx`:

1. reads `position()`;
2. highlights the caption word whose `start <= position`;
3. for `wave.draw`, computes `tick = round((position − start("wave")) × 240)` and calls
   `seek(tick)`, skipping the call if a seek is still drawing (seeks are never queued).

Measured over 8 played beats:

- **Wave cue latency** (audio clock when the first seek past tick 0 finished, minus the word's
  start): 71, 30, 5, 5, 29, 27, 5, 30, 25, 4 ms (includes interrupted runs).
- **Drift while drawing** (tick shown ÷ 240, minus audio time since "wave"; negative means the
  wave is behind), about 140–180 samples per run: median −10.0 / −10.5 / −10.7 / −11.0 /
  −11.4 / −11.9 ms, p95 +0.9 to +1.5 ms, worst −30 to −42 ms. The steady −10 ms is about the
  rAF-to-seek-to-draw latency plus half a frame of rounding. The worst cases are slow SwiftShader
  redraws. Both are well under what anyone perceives as out of sync (about 45 ms of audio lead).
- **Audio evidence (headless; nothing can be heard):** the AudioContext was `running` at 44.1 kHz
  with `currentTime` advancing; 639–713 KB of PCM arrived per full beat (= 3.6–4.0 s of audio);
  an `AnalyserNode` on the output measured RMS **0.048–0.089** while speaking and **0** within
  60 ms of Space.

## Interrupt and resume

Measured from `scripts/e2e.mjs`:

- **Space mid-sentence** (at "air" or "pressure," in each run): the output level went to 0 within
  60 ms; the wave tick stayed frozen (e.g. 302 → 302 after 800 ms, `playing: false`); the stage
  had `data-dimmed="true"`; the resume point was recorded as e.g.
  `{ beatId: "b1", wordIndex: 6, word: "pressure,", speechSeconds: 2.178 }`.
- **Discarding audio still arriving** (Space 50 ms into playback, while Sonic was still
  streaming): bytes stayed at 98,304 (of about 655 KB for the full beat) for the next 2.5 s; no
  `done` event was processed; the server logged
  `[tts] browser disconnected after 414 ms; Sonic request aborted`.
- **Space again:** the wave rewinds to tick 0, a new Sonic request replays the sentence from the
  start (warm first audio 259–377 ms), and the wave re-cues on the new generation's "wave"
  timestamp, which differs from the first generation's.

The resume replays the sentence with a fresh request. It costs one TTS round trip (about 300 ms)
and is always correct. Caching the received audio would make resume instant but needs care when
the stream was cut short; that's a later choice.

## Verified vs. not verified

- **Verified in a real browser:** layout; Play; Sonic audio received and scheduled (bytes,
  context clock, output RMS); word-anchored cue; per-frame seeking; captions; Space interrupt;
  discarding late audio; resume; 6 players; document swap. See `docs/screenshots/`.
- **Not verifiable here:** *hearing* the audio (headless; proven via RMS instead), WebGL on a
  hardware GPU (SwiftShader only, so seek costs are pessimistic), and the Sonic WebSocket (see
  above). Headed Chromium wasn't needed because headless already had WebGL2 and a running
  AudioContext.
