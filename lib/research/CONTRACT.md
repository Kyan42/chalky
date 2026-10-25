# Research route contract (v2, 2026-10-25: open web, replaces the arXiv papers version)

Time-sensitive questions ("what's new in CRISPR this month", "what changed in Python 3.14", "who
won the 2026 Nobel in physics and for what"): the lesson asks the route, the route runs one Apify
rag-web-browser call (Google search plus page extraction), and the planner teaches from up to 3
pages and cites them. Types: `lib/research/types.ts` (`ResearchRecord`, `ResearchItem`,
`ResearchEvent`). Owner: the apify-sources session.

## What changed from v1 (papers)

| v1 | v2 |
|---|---|
| request `{ topic, days }` | request `{ question, wait? }` (`topic` still accepted as an alias; `days` ignored) |
| `papers: Paper[]` | `items: ResearchItem[]` (0 to 3) |
| `Paper.arxivId, authors, authorCount, pdfUrl, category, abstract` | gone |
| `Paper.published` (always set) | `ResearchItem.published`: `"YYYY-MM-DD"` or `null` |
| — | `ResearchItem.site` (e.g. `"nobelprize.org"`) |
| `topic, days, searchedDays, from, to, via` | `question, query, recent` |
| status `"failed"` | status `"none"` (also: over budget, nothing usable) |
| events `research-failed` | `research-none` |
| `components/PaperCards.tsx` | `components/ResearchCards.tsx` (same props, minus `topic`/`days`, plus `question`) |

Unchanged: `id`, `status: "running" | "ready"`, `material`, `cached`, `startedAt`, `fetchedAt`,
`ms`, `error`, `n` and `key` on each item, `cite: n` on beats, the GET poll.

## Request

```
POST /api/research
{ "question": "what's new in CRISPR this month", "wait": true }
```

- `question`: the learner's question as asked, 1 to 300 chars. No rewriting needed: the route
  adds the recency hint itself.
- `wait` (optional): `true` holds the response until the record settles, **8 s at most**, so one
  request is enough. Without it, the record comes back at once and you poll
  `GET /api/research/<id>` every ~1 s until `status` is not `"running"`.
- A cached question (same normalised question) comes back `"ready"` with `cached: true` in a few ms.

## The 8 s budget

- If the pages are not in hand 8 s after the request, the record settles as `status: "none"`,
  `items: []`, `error: "over the 8 s budget"`. Actor errors and "no usable pages" are `"none"` too.
  The route never throws for any of these; the lesson says it couldn't find anything recent.
- The fetch itself keeps going in the background (up to ~40 s) and, if it succeeds, writes the
  cache, so asking the same question again a little later is instant. That late result never
  changes a record that already settled as `"none"`.
- 400 only for a bad request; 404 from GET for an unknown id (server restarted).

## Response (`ResearchRecord`)

```jsonc
{
  "id": "what-s-new-in-crispr-this-month-cache",
  "question": "what's new in CRISPR this month",
  "query": "what's new in CRISPR this month October 2026",
  "recent": true,
  "status": "ready",            // "running" | "ready" | "none"
  "items": [
    {
      "n": 1,
      "title": "CRISPR Medicine News",
      "url": "https://crisprmedicinenews.com/",
      "site": "crisprmedicinenews.com",
      "published": "2026-10-21",  // or null when the page gives no date
      "key": ["…", "…", "…"]      // 2 or 3 sentences from the page, verbatim
    }
  ],
  "material": "…",               // "" unless ready
  "cached": true,
  "startedAt": "…", "fetchedAt": "…", "ms": 5700,
  "error": "…"                   // only when status is "none"
}
```

## Material (for the planner prompt)

Plain text, **under ~500 words**, built from the pages' own sentences (no model rewrite):

```
Recent web pages for "what's new in CRISPR this month" (searched 2026-10-25). Cite them as [1] to [3].

[1] Page title (crisprmedicinenews.com, 2026-10-21)
Key sentence. Key sentence. Key sentence.

[2] Page title (innovativegenomics.org, undated)
…
```

- One header line, a blank line, then one block per page: `[n] Title (site, date or "undated")`
  and its key sentences on one line.
- Over 500 words, the third sentence of each page goes first, then the last page.
- Teach "as of" the dates shown; an undated page may be older than it looks.

## Citation tags on beats (unchanged)

- Beats that teach from a page carry `cite: n` (the item's `n`); never put `[n]` in `say`.
- `components/ResearchCards.tsx` takes `record` (or `question` to fetch itself), `currentCite`
  and `currentLine`: the cited page's card opens (site, date, title, link) with the key sentence
  that best matches the line highlighted.

## Events (for the transcript)

`research-started | research-cached | research-ready | research-none` (shapes in `types.ts`).
The server also logs one `[research] {...}` line per call with status and latency.
