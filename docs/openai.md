# Running Chalky on OpenAI models

Chalky's lesson calls all go through one adapter, `lib/lesson/provider.ts`. Nothing else in the app knows
which provider answers.

## Switching

```
MODEL_PROVIDER=openai        # or anthropic (the default)
OPENAI_API_KEY=sk-...        # read from .env.local first, like ANTHROPIC_API_KEY
```

`MODEL_PROVIDER` picks each role's default model, read once at startup. The per-role env names still override
it, for either provider, and a model id routes itself: `gpt-…`, `o…` or `chatgpt-…` go to OpenAI, `claude-…`
to Anthropic. So a mixed setup works, e.g. `MODEL_PROVIDER=openai PLANNER_MODEL=claude-opus-5-5`.

## Models per role

| role | env override | Anthropic default | OpenAI default |
|---|---|---|---|
| converse (the voice), intake, text grading (label, predict, Socratic) | `CONVERSE_MODEL` | claude-haiku-5-5 | gpt-6-luna |
| converse fallback (first model failed before a sentence) | `CONVERSE_FALLBACK_MODEL` | claude-sonnet-5-5 | gpt-6.1-terra |
| planner (the lesson) | `PLANNER_MODEL` (+ `PLANNER_EFFORT`, default low) | claude-opus-5-5 | gpt-6.1-sol |
| amend (detours, rewrites) | `AMEND_MODEL` | claude-sonnet-5-5 | gpt-6.1-terra |
| draw, beat 1 and fallback | `DRAW_FAST_MODEL` | claude-haiku-5-5 | gpt-6-luna |
| draw, later beats | `DRAW_MODEL` | claude-sonnet-5-5 | gpt-6.1-terra |
| draw, slow mode | `DRAW_SLOW_MODEL` | claude-opus-5-5 | gpt-6.1-sol |
| layout | `LAYOUT_MODEL` | claude-sonnet-5-5 | gpt-6.1-terra |
| delegate, sketch grading (vision) | `DELEGATE_MODEL` | claude-sonnet-5-5 | gpt-6.1-terra |
| opener | `OPENER_MODEL` | claude-haiku-5-5 | gpt-6-luna |
| reply (older check-in path) | `REPLY_MODEL` (new) | claude-opus-5-5 | gpt-6.1-terra |
| visual (older one-beat path) | `VISUAL_MODEL` (new) | claude-haiku-5-5 | gpt-6-luna |

Slow-mode draw, reply and visual weren't in the brief; they follow the same tiers.

## How each parameter maps

| our request | Anthropic (Messages API) | OpenAI (Responses API, `openai` SDK) |
|---|---|---|
| `system` | `system` (cached with `cache_control` when `cacheSystem`) | `instructions` (prompt caching is automatic) |
| `messages` (text, image parts, assistant turns) | `messages`, `image` blocks (base64 jpeg) | `input`, `input_text` / `input_image` (data URL), assistant messages as text |
| `effort: "off"` | thinking `disabled` (Sonnet 5.5: `between_tools`) | `reasoning.effort: "none"` |
| `effort: low / medium / high` | thinking `adaptive`, `output_config.effort` | `reasoning.effort` low / medium / high |
| `schema` | `output_config.format` json_schema | `text.format` json_schema, `strict: true` when the schema allows it (all properties required, no extras) |
| `maxTokens` | `max_tokens` | `max_output_tokens` |
| streaming | `content_block_delta` text deltas | `response.output_text.delta` |
| stop reason | `end_turn` / `max_tokens` / `refusal` | `completed` / incomplete `max_output_tokens` / refusal delta |
| request id, rate limits (call log) | `request-id`, `anthropic-ratelimit-*` | `x-request-id`, `x-ratelimit-*` |

Both SDKs retry 408/409/429/5xx with backoff (`MAX_RETRIES` = 2), and every attempt is on the call log.

## Rate limits

A new OpenAI account is low-tier. Parallel draw calls are capped per provider: `OPENAI_DRAW_CONCURRENCY`
(default 4) and `ANTHROPIC_DRAW_CONCURRENCY` (default 0, no cap). A held call waits for a slot. Its deadline
starts once it has one, and it is logged (`[draw] b5: openai cap of 4 parallel draws reached…`), with
`queuedMs` on its call log.

## Prompt tuning for OpenAI

Provider-specific prompt lines live in one place, `lib/lesson/provider-prompts.ts`. They are appended to a
call's system prompt by its name. Every line, and why it is there:

| call | line | why (what the OpenAI runs showed) |
|---|---|---|
| converse | the output format restated strictly, and "stop writing right after the JSON object: no tool calls, no further text" | gpt-6-luna wrote a correct trailer, then sometimes ran on with junk, invented "assistant to=research" tool calls and a made-up search result |
| converse | every sentence after the actions line is spoken aloud to the learner; never notes or reasoning to yourself | once it skipped the actions line and spoke its own plan ("This is time-sensitive, so start a lesson…") |
| converse | before a lesson, a "why" or "how" question about a topic starts a lesson even when it could be answered in a sentence; a quick question is a single fact | it answered "Why is the sky blue?" in two sentences and offered more (0/6 lessons started), where Claude starts the lesson. Now 6/6; "What's the capital of Peru?" is still a quick answer |
| plan | JSON lines only, no fences or commentary | the planner's output is parsed line by line (no failures seen; kept as a guard) |
| plan | the first beat line after the title always has a `section` field | gpt-6.1-sol left the title off the first beat |
| plan | first person isn't narrating actions ("I draw…", "I point to…", "I call this…") | gpt-6.1-sol read the voice rule that way and opened most beats with it |

Two fixes were made in the code for both providers, not as prompt lines:

- The conversation trailer is the first complete JSON object after the sentinel, and the stream stops as
  soon as it is whole (`firstJsonObject` in `lib/lesson/converse.ts`). Before, everything up to the last `}`
  was parsed, so text after the trailer broke it and the fallback dropped start_lesson and research.
  On CRISPR's first turn: 3/6 lessons started with a lookup before, 10/10 after.
- A caller that stops reading a stream early (as the trailer now does) is a cancel, not a failure. An
  aborted Anthropic stream used to throw, which would have sent the reply to the fallback model.

`CONVERSE_LOG_RAW=1` logs each reply as the model wrote it, and `experiments/converse-first-turn.mjs` checks a
first turn's format N times. Both were used for this tuning.

## Timings

`node scripts/call-timings.mjs <transcripts…>` prints, per role, each provider's median time to first token
and total time from the transcripts' call logs.

Median per role, from the lessons below (Anthropic: this morning's runs on the same fixtures and questions;
OpenAI: the runs after tuning):

From 14 transcript(s).

| role | Anthropic model | first token (ms) | total (ms) | n | OpenAI model | first token (ms) | total (ms) | n |
|---|---|---|---|---|---|---|---|---|
| amend | claude-sonnet-5-5 | 2622 | 16509 | 1 | gpt-6.1-terra | 4589 | 18270 | 1 |
| converse | claude-haiku-5-5 | 905 | 1597 | 6 | gpt-6-luna | 1038 | 1600 | 4 |
| draw | claude-haiku-5-5, claude-sonnet-5-5 | 1603 | 2592 | 18 | gpt-6-luna, gpt-6.1-terra | 2454 | 5861 | 19 |
| intake-ask | claude-haiku-5-5 | – | 1758 | 1 | – | – | – | 0 |
| intake-decide | claude-haiku-5-5 | 887 | 1887 | 1 | gpt-6-luna | 1183 | 1921 | 1 |
| layout | claude-sonnet-5-5 | 1953 | 6213 | 1 | gpt-6.1-terra | 3159 | 10693 | 2 |
| plan | claude-opus-5-5 | 1104 | 24252 | 2 | gpt-6.1-sol | 10248 | 43116 | 3 |
| quiz-label | claude-haiku-5-5 | 1848 | 2330 | 1 | gpt-6-luna | 1509 | 2225 | 1 |
| quiz-predict | claude-haiku-5-5 | 1212 | 1761 | 1 | gpt-6-luna | 944 | 1809 | 1 |
| quiz-sketch | claude-sonnet-5-5 | 3277 | 5300 | 1 | gpt-6.1-terra | 1392 | 2601 | 1 |
| quiz-socratic | claude-haiku-5-5 | – | 3356 | 1 | gpt-6-luna | 951 | 1760 | 2 |

- intake-ask (anthropic): 1 error(s), 0 retries
- draw (openai): 0 error(s), 0 retries, 3 held by the draw cap (median 3282 ms)

Per lesson (first reply's first sound, after the question; beat 1, after the intake answer; the plan):

| lesson | provider | first reply sound | beat 1 starts | plan total (first token) |
|---|---|---|---|---|
| photosynthesis | Anthropic | 1.5 s | 20.1 s | 21.4 s (0.5 s) |
| photosynthesis | OpenAI | 1.7 s | 16.5 s | 43.1 s (8.6 s) |
| why is the sky blue | OpenAI | 4.7 s | 20.4 s | 41.4 s (10.2 s) |
| what's new in CRISPR this month | Anthropic | 4.2 s | 28.1 s | 27.1 s (1.7 s) |
| what's new in CRISPR this month | OpenAI | 5.1 s | 33.9 s | 44.1 s (13.8 s) |

On OpenAI the plan is much slower: gpt-6.1-sol at low effort takes 8–14 s to its first token, against Opus at
0.5–1.7 s. The intake hides most of that. Beat 1 starts about as soon, because the plan runs while the learner
answers. Draws and layout are about twice as slow on terra; the voice (luna) is close to Haiku. Three draws
waited for the 4-call cap, median 3.3 s.

## Status

- The adapter, all eleven callers, the draw cap and the call log work for both providers.
- Anthropic path (no regression): the quiz fixture by voice 6/6; "I'm done", recap, History and Continue 5/5;
  slow mode reaching /api/draw; the cached CRISPR research lesson 6/7 (the one miss is the script, which can't
  get past a check-in since the Continue button went).
- OpenAI path, after tuning, by voice on the dev server:
  - photosynthesis 9/9 (one Socratic question at b4, five specific check-ins, 15 beats played, 6 drawn, 349 s);
  - why is the sky blue 9/9 (question at b3, 13 beats, 5 drawn). That run took 636 s because one beat sat
    352 s with nothing logged and no speech stall. That looks like the test browser's audio, not the provider;
    without it, about 280 s;
  - what's new in CRISPR this month 6/7 (cached lookup ready, the intake asked meanwhile, 10 cited beats, no
    tag spoken, the open card highlights the matching sentence; the miss is the same script limit);
  - the quiz fixture 6/6 (label 100%, predict graded right in one line, sketch graded from the board picture);
  - "I'm done" 5/5.
- Trailer parse rate on first turns after tuning: 26/26 parsed, with the intended actions.
