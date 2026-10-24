# Visual flexibility experiment: latency vs. freedom

**Question:** does limiting the planner to fixed animation primitives cost too much expressiveness, and how much latency does more freedom cost?

**Answer:** fixed primitives (L1) are fast but often wrong for the topic. A small scene language (L3) on Claude Haiku 5.5 expresses almost everything raw Clayzo code (L4) does, at about a fifth of the latency: median 2.9 s, p95 4.0 s, valid on the first try 8/8. That fits inside one beat of speech. Raw Clayzo is 15–60 s, too slow to generate live.

Run on 2026-10-24 from a laptop (Windows, local network), 64 generations in 2.5 minutes. Video: `experiments/visual-flex/out/visual-flex.mp4` (not committed; rebuild with the steps at the end).

## Method

- **Beats:** 8 one-sentence lesson beats from different subjects (`beats.ts`), each with an anchor word the visual starts on. The model sees the question, the sentence, the anchor, and "finish building within about N seconds, then hold" (`estimateVisualSeconds`).
- **Levels** (`prompts.ts`):
  1. **Fixed primitive:** pick one of 10 primitives by name; it plays with defaults and no labels.
  2. **Parameterized primitives:** up to 3 primitives with parameters, labels, start times, a layout and a caption.
  3. **Scene language:** up to 30 elements (line, plot, circle, rect, arrow, bar, move, text) on a 100x100 grid with timing; `scene.ts` compiles them to Clayzo.
  4. **Raw Clayzo:** a TypeScript module against `@clayzo/animation/authoring`, given a condensed API reference written for this experiment. It runs in a child process (10 s timeout, network globals removed, imports other than the authoring package rejected) and is then validated.
- **Models:** `claude-opus-5-5` and `claude-haiku-5-5`, `effort: "low"`, adaptive thinking (it can't be turned off on either), streamed, through the official `@anthropic-ai/sdk`. Levels 1–3 use structured outputs (a JSON schema); level 4 returns one code block.
- **Validity:** compile, then `assertValidAnimationDocument`. On failure, one repair turn with the error. "Time to valid doc" runs from the first request to a validated document, including the repair.
- **Rendering check:** `checkCoverage` in `@clayzo/webgl-player` with the Inter font loader, on all 64 documents.
- **Run conditions:** 4 requests in flight at once. Each JSON schema was warmed up once per model before timing, because a new schema has a one-time compile cost (cached 24 h). The warm-up calls took 1.9–4.7 s.

## Results

| Level | Model | Median s to valid doc | p95 s | Median s to first token | Valid first try | Valid after repair | Median output tokens | Coverage OK |
|---|---|---|---|---|---|---|---|---|
| L1 | Opus 5.5 | 1.9 | 3.4 | 1.8 | 8/8 | 8/8 | 13 | 8/8 |
| L1 | Haiku 5.5 | 1.2 | 1.5 | 1.1 | 8/8 | 8/8 | 13 | 8/8 |
| L2 | Opus 5.5 | 2.7 | 6.1 | 1.3 | 8/8 | 8/8 | 164 | 8/8 |
| L2 | Haiku 5.5 | 1.6 | 1.9 | 1.0 | 8/8 | 8/8 | 176 | 8/8 |
| L3 | Opus 5.5 | 7.2 | 46.7 | 1.7 | 7/8 | 8/8 | 746 | 8/8 |
| L3 | Haiku 5.5 | 2.9 | 4.0 | 1.2 | 8/8 | 8/8 | 480 | 8/8 |
| L4 | Opus 5.5 | 29.5 | 61.6 | 1.2 | 4/8 | 8/8 | 3881 | 8/8 |
| L4 | Haiku 5.5 | 15.4 | 22.1 | 7.9 | 8/8 | 8/8 | 3844 | 8/8 |

With 8 samples per cell, p95 is the slowest of the 8. Treat it as "worst seen", not a stable percentile.

Per generation (seconds to valid doc; `*` = needed the repair turn):

| Beat | L1 Opus | L1 Haiku | L2 Opus | L2 Haiku | L3 Opus | L3 Haiku | L4 Opus | L4 Haiku |
|---|---|---|---|---|---|---|---|---|
| headphones | 2.5 | 1.2 | 1.7 | 1.3 | 4.1 | 1.9 | 34.1* | 7.4 |
| photosynthesis | 3.2 | 1.4 | 2.6 | 1.7 | 7.0 | 4.0 | 19.4 | 20.1 |
| compound-interest | 1.4 | 0.9 | 2.3 | 1.2 | 10.6 | 3.4 | 39.7* | 14.5 |
| binary-search | 1.3 | 1.0 | 6.1 | 1.9 | 7.5 | 3.0 | 61.6* | 13.2 |
| heart | 1.9 | 1.2 | 3.8 | 1.7 | 6.6 | 2.9 | 19.4 | 16.3 |
| demand | 3.4 | 1.2 | 2.4 | 1.8 | 46.7* | 2.5 | 47.9* | 13.5 |
| seasons | 1.5 | 1.4 | 3.5 | 1.6 | 5.9 | 2.9 | 24.8 | 22.1 |
| neural-network | 1.9 | 1.5 | 2.7 | 1.4 | 12.7 | 2.9 | 17.7 | 19.5 |

First-try failures (all fixed by the one repair turn):

- **L3 Opus, demand:** the output ran to the 6,000-token cap (stop reason `max_tokens`), probably a degenerate repetition inside the JSON. The retry took 534 tokens. This single case is the 46.7 s p95.
- **L4 Opus, 4 of 8:**
  - a keyframe track with two keys on the same tick;
  - two documents that failed schema validation (30 and 5 errors);
  - one TypeScript syntax error.

  Haiku's L4 code was valid on the first try in all 8.

**Observations on timing**
- Even L1, with 13 output tokens, takes about 1–2 s. That's the floor here: request overhead plus thinking, which can't be turned off.
- Haiku's L4 time to first token (median 7.9 s) is mostly thinking before it writes code.

## Latency budget

From this run's Sonic audio (`public/experiments/visual-flex/audio/*.json`):

- **First beat:** the visual has to exist by time to first audio (126–258 ms here) plus the anchor word's start (0.60–2.77 s). That's roughly **0.7–3.0 s** after the beat's text is ready. L1 and L2 on Haiku (median 1.2 / 1.6 s, worst 1.5 / 1.9 s) fit only when the anchor comes late in the sentence (2.1 s and 2.8 s here, for neural-network and compound-interest). With an early anchor (about 0.6 s, so a budget of about 0.75 s), no level fits. The first beat needs a pre-built visual, which matches the canned-opener plan, or an anchor placed later in the sentence.
- **Later beats:** if a beat's visual is generated while the previous beat plays, the budget is a whole beat: these sentences ran **4.3–6.4 s**. Even the worst L3 Haiku result (4.0 s) fits. L2 Opus and L3 Opus fit at the median but not their worst cases (6.1 s and 46.7 s). L4 doesn't fit on either model.

## What each level could express

These notes come from the Opus 5.5 outputs in the video. Haiku's documents were validated and coverage-checked but not reviewed visually.

- **L1, fixed primitive:** fast, and right only when a primitive matches the topic closely, as `waves_cancel` does for headphones and `network` for neural networks. Elsewhere it's misleading or generic:
  - **demand:** an *exponential* curve for a curve that slopes down;
  - **heart and seasons:** a cycle labeled "One / Two / Three";
  - **photosynthesis:** a flow labeled "Input / Process / Output";
  - **binary search:** a tree with children "A / B".

  Defaults can't carry the content.
- **L2, parameterized primitives:** fixes most of L1's problems with labels and parameters:
  - "Heart / Arteries / Body / Veins" around a loop;
  - a downward demand line with axis labels;
  - "Sunlight + Water + CO2 → Leaf → Sugar + Oxygen".

  It can't draw anything the library lacks: seasons became a cycle and a "23.5 tilt" label instead of a tilted Earth. A stray dots primitive in the photosynthesis scene drew a small blob.
- **L3, scene language:** draws the actual idea:
  - a tilted Earth facing a sun;
  - the list halving 1,000,000 → 500,000 → 250,000;
  - a demand curve with two price points and arrows;
  - a heart → body → veins loop;
  - stacked bars showing interest on interest.

  Layout is sometimes rough: small labels, uneven spacing, and the grid's 3:2 aspect makes circles look stretched in places.
- **L4, raw Clayzo:** similar range to L3, a little more polish (a leaf shape, a two-colored Earth, a highlighted cell in a 1M-item row), and the most freedom over easing and timing. It costs 4–8x the output tokens and 15–60 s.

## Recommendation

Use **L3 (scene language) on Claude Haiku 5.5**, generated one beat ahead, as the default visual path. For the first beat, where the budget is 0.7–3 s, use a pre-built visual with the canned opener, or L2 primitives when the anchor word is late. Keep L2 as the fallback when an L3 document fails validation. Use **L4 offline**, with Claude Code, to author new primitives and scene-language elements, not at runtime.

## Not verified or caveats

- 8 samples per cell, one run, one network. Latencies will move with load; rerun before relying on exact numbers.
- Generations ran 4 at a time, which may have added some queueing compared with one request at a time.
- Haiku's visuals were not reviewed visually. The video shows Opus 5.5 outputs.
- Quality notes are one reviewer's reading of the frames, not a scored evaluation.
- The level 4 sandbox (child process, timeout, import allowlist, network globals removed) is enough for this experiment. It is not a security boundary for untrusted code in production.
- Refusal handling is in the code, but no request was refused, so that path never ran.

## Reproduce

```bash
npx tsx experiments/visual-flex/smoke.ts              # builders produce valid documents
npx tsx experiments/visual-flex/generate.ts           # needs ANTHROPIC_API_KEY in .env.local
npx tsx experiments/visual-flex/analyze.ts            # the tables above
npm run dev                                           # needs CARTESIA_API_KEY in .env.local
node scripts/render-flex-video.mjs                    # → experiments/visual-flex/out/visual-flex.mp4 (needs ffmpeg on PATH)
```

The render page is at `/experiments/visual-flex`. Add `?play` to step through it live, without sound.
