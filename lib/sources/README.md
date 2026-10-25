# Live sources (Apify)

Two or three real web pages per lesson, fetched in the background and shown as cards beside the
board, each with the passage that goes with the beat being taught. Never on the lesson's critical
path: the fetch starts after the plan's title arrives, the route returns at once, and the page polls.

| file | what |
|---|---|
| `lib/sources/apify.ts` | the actor call (Standby first, a normal run if that fails), markdown → paragraphs, the per-question disk cache, runs in flight |
| `lib/sources/match.ts` | which passage goes with a beat (word overlap; runs in the browser) |
| `lib/sources/types.ts` | `SourceCard`, `SourcesRecord`, `SourcesEvent` |
| `app/api/sources/route.ts` | `POST {question, title?, beats?}` → record at once (ready from cache, running, or no-token) |
| `app/api/sources/[id]/route.ts` | `GET` → status and cards |
| `components/SourceCards.tsx` | the card stack; mounting it: `lib/sources/MOUNT.md` |
| `app/experiments/sources/page.tsx` | dev page; `?fixture=1` loads the hand-written test set |
| `scripts/prewarm-sources.mjs` | fills the cache for the five demo questions through the dev server |
| `experiments/sources-cache/<question>.json` | one file per question (`what-is-photosynthesis.json`); `_fixture.json` is the hand-written test set, never served for a real question |

## Status (2026-10-24)

Live since 2026-10-24: the five demo questions are fetched and cached (3 real pages each), and
the dev page shows real cards with passages following the beat. Re-fetch with
`node scripts/prewarm-sources.mjs 3011 --fresh`.

| question | fetch | via | sites |
|---|---|---|---|
| what is photosynthesis | 8.6 s | Standby | bbc.co.uk, en.wikipedia.org, life.illinois.edu |
| why is the sky blue | 6.4 s | Standby | spaceplace.nasa.gov, math.ucr.edu, nesdis.noaa.gov |
| how do plants breathe | 4.3 s | Standby | rhs.org.uk, jic.ac.uk, bbcearth.com |
| what is an oxygen molecule | 8.8 s | Standby | en.wikipedia.org, sciencedirect.com, bbc.co.uk |
| how do vaccines work | 3.4 s | Standby | who.int, cdc.gov, mayoclinic.org |

Not every first try worked. With `-site:youtube.com -site:tiktok.com` in the query, Standby timed
out (40 s) on 2 of 5 and the fallback run took 54 to 62 s. Without those operators it answers in
3 to 9 s, so they are gone (video sites are dropped from the results instead). Standby still
timed out once on "what is photosynthesis" without them, and a run can come back with pages that
have no usable text (error pages, cookie walls), so the actor now fetches 5 pages and keeps the
best 3. Reliability is fine for background work and the cache covers the demo, but expect a
timeout now and then on a fresh question.

## The actor: `apify/rag-web-browser`

One actor does both halves: a Google search and each top result's text as markdown, so there is
no second "page content" actor to chain. Chosen without a token to measure the alternatives; the
choice is one constant (`ACTOR`) plus `viaStandby`/`viaRun` in `apify.ts`, so a swap after
measuring is small.

- **Standby mode** (`https://rag-web-browser.apify.actor/search`, token in the `Authorization:
  Bearer` header so it never lands in a log): a warm web server, no actor start, the actor's
  README's recommended low-latency path. If it fails (non-200, timeout), the same input goes to a
  normal run via `apify-client` `.call()` at 4 GB with a 120 s run timeout.
- Input: `maxResults: 5` (3 kept), `scrapingTool: "raw-http"` (up to 2x faster than the browser per the
  README; the pages we want are static), `outputFormats: ["markdown"]`, `requestTimeoutSecs: 45`,
  `removeCookieWarnings: false` (slightly faster). Query: the learner's question as asked.
- **Latency, measured:** 3.4 to 8.8 s through Standby (table above); the normal-run fallback took
  54 to 62 s. The actor's README benchmarks a normal run at 17 to 31 s.
- **Cost per lesson** (store page, pay per event, FREE tier prices; cheaper on paid tiers): one
  search $0.00348 + five page fetches 5 × $0.00228 = **about $0.015 per question** through Standby.
  A normal run also pays the platform's actor-start charge per GB of memory. A cached question
  costs nothing.

Alternatives not measured: a Wikipedia scraper actor (cleaner text, one site only), Google
Search Results Scraper plus a page-content actor (two runs chained, slower), a scholarly search
actor (abstracts only, often paywalled). For papers see `lib/research/README.md`.

## Passage matching: word overlap, no model call

`bestPassage(card, beatLine, topic)` splits each paragraph into sentences and scores each by the
distinct content words it shares with the beat's line (stop words dropped, crude stemming), with
the question and title counting a quarter as tie-breakers. The card shows the best sentence
highlighted with one sentence either side; with no shared words it shows the page's excerpt.
Free and instant, and it runs in the browser, so the cache holds pages, not per-beat answers: a
re-planned lesson (new beat ids, new lines) matches against the same cached pages. The card that
matches the current beat best opens by itself. Good enough for "show the passage", not for quiz
grading; a Haiku pass that maps passages to beat ids can replace it later behind the same function.

## Source events

`SourceCards` calls `onEvent` with `{kind: "sources-started" | "sources-cached" | "sources-ready" |
"sources-failed" | "sources-no-token", id, ms, cards, mode, ...}`, the shape the lesson transcript
stores (`logEv({kind, ...})` → `transcript.events`, saved by `/api/live-log`). The server also logs
each as a `[sources] {...}` line.

## Rules this keeps

- No sources, no cost: the component fetches nothing until there is a question and a title, and
  renders nothing on no-token, failure or zero cards. A quiet "finding sources…" only while a fetch
  is out.
- The token is read on the server only and sent in a header.
- The cache is keyed by the normalised question (`cacheKey` in `apify.ts`); a fixture never shares a key with a real question.
- Dev only: `fresh` (skip the cache) and `fixture` are ignored in production.
