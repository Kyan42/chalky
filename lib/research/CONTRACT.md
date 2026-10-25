# Research route contract (frozen 2026-10-24)

"Teach me what's new": the learner asks for the latest on a topic; the lesson fetches recent
papers, the planner teaches from them and cites them, and the cards show the paper being taught.
Types: `lib/research/types.ts` (`ResearchRecord`, `Paper`, `ResearchEvent`). Owner of this route:
the apify-sources session. Changes to this file are additive only (new optional fields).

## Request

```
POST /api/research
{ "topic": "vision-language-action models", "days": 14 }
```

- `topic`: string, 1 to 200 chars. Pass the subject, not the whole utterance ("LLM agents", not
  "teach me the latest on LLM agents this week"); the route also strips filler like "the latest
  on", "newest papers on", "this week" if it is left in.
  Matching is by keywords against arXiv titles and abstracts, so research wording finds better
  papers: "voice AI" catches HCI papers that mention "voice", while "spoken dialogue models" or
  "speech language models" finds the speech papers. If the converse model rewrites the topic, it
  should use the words a paper title would use.
- `days`: optional window, 1 to 90, default 14. "this week" → 7, "this month" → 30.
- The record comes back **at once**. Cached topics (same normalised topic and `days`) come back
  with `status: "ready"` and `cached: true` in a few ms. Otherwise `status: "running"`: poll

```
GET /api/research/<id>      every ~1.5 s, until status is "ready" or "failed"
```

- Budget: a fresh fetch is expected to take 5 to 30 s (measured numbers in `lib/research/README.md`
  once the token is in). Suggested: give up after 45 s and teach from memory, saying so.
- 400 for a bad request; 404 from GET for an unknown id (server restarted). Network trouble is
  never an HTTP error: it is a record with `status: "failed"` and `error`.

## Response (`ResearchRecord`)

```jsonc
{
  "id": "vision-language-action-models-14d-cache",
  "topic": "vision-language-action models",
  "days": 14,
  "searchedDays": 14,          // widened to 30, then 90, when fewer than 3 papers came back
  "from": "2026-10-10", "to": "2026-10-24",
  "status": "ready",           // "running" | "ready" | "failed"
  "papers": [ /* Paper, 0 to 5, newest first */ ],
  "material": "…",             // see below; "" while running, on failure, and when papers is empty
  "via": "apify-arxiv",        // "apify-arxiv" | "apify-rag" | "arxiv-api" (free fallback) | "fixture"
  "cached": true,
  "startedAt": "…", "fetchedAt": "…", "ms": 8400,
  "error": "…"                 // only on failure
}
```

`Paper`:

```jsonc
{
  "n": 1,                                   // citation number: [1] in material, cite: 1 on a beat
  "arxivId": "2610.12345",
  "title": "…",
  "authors": ["A. Author", "B. Author"],    // at most 8
  "authorCount": 14,
  "published": "2026-10-22",
  "url": "https://arxiv.org/abs/2610.12345",
  "pdfUrl": "https://arxiv.org/pdf/2610.12345",
  "category": "cs.RO",
  "abstract": "…",
  "key": ["…", "…", "…"]                    // 2 or 3 sentences from the abstract, verbatim
}
```

`status: "ready"` with `papers: []` means nothing recent was found even at 90 days (e.g. a topic
with no arXiv presence). The planner should then teach from memory and say it found no recent
papers.

## Material (for the planner prompt)

Plain text, under ~1,500 words (5 papers at most, each paragraph built from the paper's own
abstract sentences: what it claims, how, one number when the abstract has one). Exact shape:

```
Recent papers on "vision-language-action models", submitted 2026-10-10 to 2026-10-24 (arXiv). Cite them as [1] to [4].

[1] Title of the newest paper (Firstauthor et al., 2026-10-22, arXiv:2610.12345)
Claim sentence from the abstract. Method sentence. Sentence with the number.

[2] …
```

- One header line, a blank line, then one block per paper: a tag line `[n] Title (Author et al.,
  date, arXiv:id)` (`Author and Other` for two authors, `Author` for one) and one paragraph.
- Text is verbatim from the abstract (no model rewrite), so anything the planner says can be traced
  to the paper. LaTeX is flattened to plain text (`$\sim$40\%` → `~40%`).
- If `searchedDays` > `days`, the header says the window was widened: `… submitted 2026-07-26 to
  2026-10-24 (arXiv; nothing in the last 14 days, so the last 90).`

## Citation tags on beats

- The planner marks each beat that teaches from a paper with **`cite: n`** (one number, the
  paper's `n`; a new optional `PlannedBeat` field the conversation session adds). Beats not taken
  from a paper leave it out.
- Tags never appear in `say` (Sonic would read them aloud). Speech may name the paper naturally
  ("a paper from last week out of Stanford…").
- The cards (`components/PaperCards.tsx`) take `currentCite` (that beat's `cite`) and
  `currentLine` (that beat's `say`): the cited paper's card opens, and the key sentence that best
  matches the line is highlighted (word overlap, `lib/sources/match.ts`). A beat with no `cite`
  leaves the last opened card as it was.

## Events (for the transcript)

`PaperCards` calls `onEvent` with `research-started | research-cached | research-ready |
research-failed` (shapes in `types.ts`); pass `logRef.current`. If the conversation session does
the POST itself (to hand `material` to the planner), pass the same record to `PaperCards` through
its `record` prop and it will not fetch again.
