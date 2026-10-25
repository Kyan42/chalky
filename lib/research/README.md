# Recent papers ("teach me what's new")

The learner asks for the latest on a topic; `/api/research` returns 3 to 5 recent arXiv papers,
newest first, with key sentences and a plain-text `material` block the planner teaches from and
cites. Contract for the lesson side: `CONTRACT.md`. Cards: `components/PaperCards.tsx`. Dev page:
`/experiments/research`. Cache: `experiments/research-cache/<topic>-<days>d.json`.

## Choice: the Apify arXiv actor, arXiv's API as the fallback

| path (`via`) | how | measured 2026-10-24 (14-day window, 5 topics, one run each) |
|---|---|---|
| **`apify-arxiv`** (default) | Apify actor `dami_studio/arxiv-scraper`: arXiv's own query syntax (exact `submittedDate` window, title/abstract terms), `sortBy: submittedDate`, 25 items, 256 MB | **2.2 to 3.5 s**, 5/5 topics answered; 6.4 to 6.9 s when the window widens to 90 days (3 runs) |
| `apify-rag` | `apify/rag-web-browser` Standby, `site:arxiv.org/abs <topic> after:<from>`, 6 abs pages parsed | 4.5 to 9.1 s when it answers; **timed out (40 to 47 s) on 3 of 8 tries** ("voice AI" twice, "photosynthesis" twice) |
| `arxiv-api` | arXiv's free export API, same query as the actor; used when there is no token or the Apify path fails | 0.1 to 1.4 s |

`APIFY_PATH = "apify-arxiv"` in `papers.ts`. It is the fastest Apify path and the only one that
answered every topic. One run is about 1 s of actor time; the rest is the platform's start and
the dataset read. Cost: $0.002 a paper on the FREE tier, 25 papers a run, so **~$0.05 a topic**
(three runs, ~$0.15, when the window widens to 90 days). `apify-rag` would be ~$0.017 a topic, but
Google's `after:` filter is loose and Standby timed out too often.

arXiv's own API is faster still. It stays as the fallback, so the lesson gets papers even when
Apify is down; every record says which path served it (`via`).

Re-measure: `node scripts/prewarm-research.mjs 3011 --measure` (no cache writes).
Re-cache: `node scripts/prewarm-research.mjs 3011`.

## Cached for the demo (via apify-arxiv)

| topic | fetch | papers | window | how good |
|---|---|---|---|---|
| vision-language-action models | 3.2 s | 5 | 14 d | all on-topic (VLA monitoring, view routing, driving VLAs, 3D memory) |
| LLM agents | 3.3 s | 5 | 14 d | on-topic (agent safety benchmarks, KV caching for agents, RL for agents) |
| retrieval-augmented generation | 3.3 s | 5 | 14 d | on-topic |
| voice AI | 2.5 s | 5 | 14 d | **weak**: research says "speech" or "spoken dialogue", so "voice" + "AI" catches HCI and "employee voice" papers |
| speech language models | 4.0 s | 5 | 14 d | better for the voice demo: 4 of 5 are speech papers (ASR, speech separation, speech front-end) |
| photosynthesis | 6.9 s | 5 | widened to 90 d | **weak**: arXiv carries little biology; the papers mention photosynthesis (CO2 records, greenhouse control, lettuce growth) rather than study it |

## Ranking and key sentences

- The query asks for every topic word in the title or abstract inside the window (actor: 25
  newest; arXiv API: 100 newest). Ranking: the topic as a phrase in the title (+4) or abstract (+2),
  then each topic word in the title (2) or abstract (1); short acronyms ("AI", "RL") match
  case-sensitively. The best 5 are kept, sorted newest first and numbered [1] to [5].
- Fewer than 3 papers → widen to 30, then 90 days (the header line of `material` says so).
- Key sentences, verbatim from the abstract, in order: the claim ("we propose / introduce / this
  paper"), a method sentence ("by / using / framework"), and a number or "outperforms" sentence.
  No model call. LaTeX flattened (`$\sim$40\%` → `~40%`; a paper's own macros dropped).
- Only answers with at least one paper are cached; a forced path (`only`) never reads or writes the cache.
