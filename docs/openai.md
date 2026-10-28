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

| call | line | why |
|---|---|---|
| converse | the output format restated strictly (actions line first, sentences, `<<<trailer>>>`, one JSON line) | the reply is parsed as it streams; anything before the actions line or after the JSON breaks the parse |
| plan | JSON lines only, no fences or commentary | the planner's output is parsed line by line |

These two are starting points, written before any OpenAI run. The tuning from real calls is still to do;
see the status below.

## Timings

`node scripts/call-timings.mjs <transcripts…>` prints, per role, each provider's median time to first token
and total time from the transcripts' call logs.

(pending: the OpenAI runs)

## Status

- The adapter, all eleven callers, the draw cap and the call log work for both providers. `tsc` passes.
- Anthropic path: regression checks pending.
- OpenAI path: not run yet. `OPENAI_API_KEY` is not in `.env.local`.
