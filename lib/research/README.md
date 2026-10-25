# Recent papers ("teach me what's new")

The learner asks for the latest on a topic; `/api/research` returns 3 to 5 recent arXiv papers,
newest first, with key sentences and a plain-text `material` block the planner teaches from and
cites. Contract for the lesson side: `CONTRACT.md`. Cards: `components/PaperCards.tsx`. Dev page:
`/experiments/research`. Cache: `experiments/research-cache/<topic>-<days>d.json`.

## Paths

| path (`via`) | how | status |
|---|---|---|
| `apify-arxiv` | Apify actor `dami_studio/arxiv-scraper`: takes arXiv's own query syntax (so the same `submittedDate` window and title/abstract terms as the fallback), `sortBy: submittedDate`, 25 items, 256 MB | **unmeasured, no token** |
| `apify-rag` | `apify/rag-web-browser` Standby, query `site:arxiv.org/abs <topic> after:<from>`, 6 results; each abs page parsed for title, authors, "Submitted on", "Abstract:" | **unmeasured, no token** |
| `arxiv-api` | arXiv's free export API, same query; the fallback when there is no token or the Apify path fails | **measured: 0.3 to 1.4 s** |

Order: `APIFY_PATH` (now `apify-arxiv`) when `APIFY_TOKEN` is set, then `arxiv-api`. Every record
says which path served it. `apify-arxiv` was picked over the other arXiv actors in the store
because it takes arXiv query syntax (the date window is exact rather than filtered afterwards), runs
at 256 MB (cheap, quick start), and charges per paper: $0.002 FREE tier, so ~$0.05 for 25 papers.
`apify-rag` costs ~$0.017 (one search + six pages) but Google's `after:` filter is loose and abs
pages need parsing. Pick the faster of the two after measuring:

```bash
node scripts/prewarm-research.mjs 3011 --measure
```

then set `APIFY_PATH` in `papers.ts` and record the table here.

## Measured without a token (2026-10-24, arxiv-api, 14-day window)

| topic | fetch | papers | window | notes |
|---|---|---|---|---|
| vision-language-action models | 0.6 s | 5 | 14 d | all on-topic (VLA monitoring, view routing, driving VLAs, plan latents) |
| LLM agents | 0.5 to 1.4 s | 5 | 14 d | on-topic (agent safety benchmarks, KV caching for agents, RL for agents) |
| voice AI | 0.4 s | 5 | 14 d | **weak**: research says "speech" / "spoken dialogue", so "voice" + "AI" catches HCI and "employee voice" papers |
| retrieval-augmented generation | 0.4 s | 5 | 14 d | on-topic |
| photosynthesis | 0.3 s | 5 | widened to 90 d | **weak**: arXiv carries little biology; papers mention photosynthesis (CO2 records, greenhouse control, lettuce growth) rather than study it |

These five are cached now from `arxiv-api` so the demo has papers whatever the network; the
pre-warm run with the token (`node scripts/prewarm-research.mjs 3011`, no `--measure`) replaces
them with Apify-fetched ones.

## Ranking and key sentences

- The query asks for every topic word in the title or abstract inside the window (100 newest).
  Ranking: the topic as a phrase in the title (+4) or abstract (+2), then each topic word in the
  title (2) or abstract (1); short acronyms ("AI", "RL") match case-sensitively. Best 5 kept, then
  sorted newest first and numbered [1]..[5].
- Fewer than 3 papers → widen to 30, then 90 days (the header line of `material` says so).
- Key sentences, verbatim from the abstract, in order: the claim ("we propose / introduce / this
  paper"), a method sentence ("by / using / framework"), and a number or "outperforms" sentence.
  No model call. LaTeX flattened (`$\sim$40\%` → `~40%`; a paper's own macros dropped).
- Only complete answers (at least one paper) are cached; a forced path (`only`) never writes the cache.
