# What's new, from the web

Time-sensitive questions ("what's new in CRISPR this month", "who won the 2026 Nobel in physics")
answered from the open web: one Apify `rag-web-browser` call (Google search plus page extraction)
through its Standby server, up to 3 pages, each with 2 or 3 verbatim key sentences, and a
plain-text `material` block under 500 words for the planner. Contract: `CONTRACT.md`. Code:
`web.ts`. Cards: `components/ResearchCards.tsx`. Dev page: `/experiments/research`. Cache:
`experiments/research-cache/<normalised question>.json`. (v1 used arXiv; removed 2026-10-25.)

## Latency (measured 2026-10-25, cache off)

Four passes over the six demo questions, one question at a time, each fetch run to completion
(40 s budget) so no two overlapped: 24 fetches.

| | |
|---|---|
| median | **6.8 s** |
| under the 8 s budget | 14 of 24 (58%) |
| 8 to 35 s | 6 of 24 (9.6, 9.8, 18.7, 19.3, 22.7, 34.8 s) |
| timed out at 35 s (actor 500 "Timed out.") | 4 of 24 (17%) |
| fastest / worst | 2.5 s / timeout |

| question | pass 1 | pass 2 | pass 3 | pass 4 |
|---|---|---|---|---|
| what's new in CRISPR this month | 5.9 | 4.0 | 7.3 | 5.3 |
| what changed in Python 3.14 | timeout | 6.7 | 5.7 | 22.7 |
| who won the 2026 Nobel in physics and for what | 19.3 | timeout | 18.7 | timeout |
| what's the latest on the James Webb telescope | 7.8 | timeout | 4.2 | 9.6 |
| what's new in battery technology | 6.3 | 6.8 | 5.9 | 9.8 |
| what's the latest with quantum computers | 34.8 | 6.6 | 6.2 | 2.5 |

So with the 8 s budget, **roughly 4 in 10 fresh questions settle as "none"**, and the lesson says it
found nothing recent. The slow part is the Google search inside the actor, not the pages: with
`debugMode` on, the search step took 3.5 to 4.5 s on a good run and 23 to 36 s on a slow one, while
fetching the three pages took about 2 s. Page retries off (`maxRequestRetries: 0`) and a short
`requestTimeoutSecs` don't help: the actor returns all pages or none, never a partial answer.
What does help: **an over-budget fetch keeps going in the background and caches its answer**, so
the same question asked again (or pre-warmed) is instant.

Overlap matters. In a run with the real 8 s budget back to back, only 1 of 6 made it, because
each late fetch was still running on the same Standby instance when the next question started.
Two research questions within ~30 s of each other will slow each other down.

## Cached for the demo

| question | pages (site, date) | on topic? |
|---|---|---|
| what's new in CRISPR this month | crisprmedicinenews.com 2026-10-23 (weekly roundup: PPL-001, FXN excision), nature.com 2026-10-22 (first in-body prime editing), cen.acs.org 2026-10-22 (Cas12a2 shreds DNA) | **yes**, all from this week |
| what changed in Python 3.14 | docs.python.org 2025-10-07 (What's New), realpython.com 2026-07-03, blog.miguelgrinberg.com (speed tests) | **yes**; dates are the release (Oct 2025), as expected |
| who won the 2026 Nobel in physics and for what | en.wikipedia.org (prize overview, updated 2026-10-14), nobelprize.org press release 2026-10-06: "awarded to Francis Halzen for decisive contributions to the IceCube Neutrino Observatory…" | **yes** for [2]; [1] is background |
| what's the latest on the James Webb telescope | livescience.com 2026-10-20, science.nasa.gov 2026-10-08, esawebb.org 2026-10-08 (most distant FRB host galaxy) | **yes**, all October |
| what's new in battery technology | energy.gov 2026-08-11 (next-gen batteries explainer), eleport.com 2026-06-03 (EV batteries 2026), e360.yale.edu (sodium vs lithium) | **mostly**: explainers and overviews more than news |
| what's the latest with quantum computers | sciencedaily.com 2026-10-24 (news hub), quantumcomputingreport.com 2026-10-24, thequantuminsider.com 2026-08-13 | **partly**: news-hub pages, so the key sentences are headlines and teasers |

Google's results vary a lot between identical searches (the same Nobel query returned CNN, then
nobelprize.org, then generic "Physics" pages). The cache keeps the best answer seen: a fresh fetch
replaces it only with at least as many on-topic pages dated in the last 90 days. The Nobel and
CRISPR files took several fetches to get a good one. The Nobel file was also cleaned once by hand,
with the same banner filter the code now applies (a press-contact sentence came out).

## Recency hint: what was tried

Four recent questions, each searched plainly and with the hint appended:

| question | plain | with the hint |
|---|---|---|
| CRISPR this month | 1 usable page (C&EN, Oct 22) | **+ "October 2026": 3 pages, two from October** |
| latest on James Webb | ESA/Webb Oct 8 + NASA pages | + "October 2026": **worse**, 2022 articles |
| new in battery tech | explainers, one from June 2026 | + "October 2026": 2026 EV-battery articles, 2 pages |
| latest with quantum computers | news hubs dated Oct 24 | + "2026": "where we stand in 2026" overviews |

Kept: a hint only for an explicit window. "this week/month" adds "October 2026", "this year" adds
"2026", and a question that names a year goes as asked. "New" and "latest" go as asked, because
Google already favours fresh pages for those and an appended month pulled in older ones. Every
recent question (new, latest, this…, a year, a version number) ranks pages dated in the last 90
days first, then the rest in Google's order.

## Pages, dates and sentences

- 4 pages fetched (`raw-http`, no retries), the best 3 kept. Dropped: video and social sites,
  pages with fewer than 2 usable sentences, and off-topic pages (the title and key sentences must
  carry every content word of the question when it has two or fewer, else two thirds of them;
  "new", "latest", months and years don't count).
- Date: JSON-LD `datePublished`, then Open Graph `article:published_time`, then the modified
  dates, then a date written near the top of the page. A page published over a year ago but
  modified since (Wikipedia) shows the modified date. Null when the page gives none.
- Key sentences: the page's own description plus its paragraphs; the two sentences sharing the
  most words with the question, plus one with a number, in page order. Banner, contact and
  duplicate sentences are skipped. No model call.
- Cost: one search ($0.00348) plus four pages (4 × $0.00228) is about **$0.013 a question**
  (FREE tier, Standby).

## Commands

```bash
node scripts/prewarm-research.mjs 3011 --measure
```

Cache off, real 8 s budget. Note the overlap effect above.

```bash
node scripts/prewarm-research.mjs 3011
```

Cache off, 40 s budget: fills the cache for the six questions (keeps a better cached answer).
