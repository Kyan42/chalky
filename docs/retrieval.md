# Retrieval: local engine (default) and Moss

Chalky searches three things: the **block catalogue** (which ready-made drawings a beat's drawer prompt
lists), the **board** of the current lesson (which drawn element an interruption is about), and the
**learner's memory** (what they said in earlier lessons). Since `keyon/local-retrieval` all three run
in the Node server process with no vendor and no key. Moss is still there behind a switch for
comparison.

## How it works

| Piece | File | What it does |
|---|---|---|
| Model | `lib/retrieval/embed.ts` | `Xenova/all-MiniLM-L6-v2`, 384 dims, 8-bit ONNX, CPU, through transformers.js (`@huggingface/transformers` 4.3). One per process, on `globalThis`. |
| Hybrid search | `lib/retrieval/hybrid.ts` | Cosine (clipped to 0..1) blended 0.5 / 0.5 with MiniSearch BM25 (divided by the query's best BM25). English stop words, plurals folded, prefix match on words over 5 letters, block title boosted x3 and tags x2. |
| Blocks | `lib/retrieval/blocks.ts`, `local-blocks.ts`, `lib/blocks/vectors.json` | Block vectors are computed ahead by `scripts/build-block-vectors.ts` (base64 Float32 plus a hash of each block's text and the model), so a server only embeds the query. Learned blocks (slow mode) are embedded when they are registered, which Moss never did. |
| Board and memory | `lib/retrieval/session.ts`, `memory.ts` | One index per lesson board and per learner; each doc is embedded as it arrives (a few ms). A hit needs a blended score over 0.2. |
| Fallbacks | same files | Before the model has loaded: blocks use `keywordBlocks()`; board and memory use word overlap (status `words`). |

The exported functions and shapes are as before (`relevantBlocks` → `{status, hits, ms}`,
`warmBlockIndex`, `prefetchBlocks`, `blocksForBeat`, `upsertDocs`/`searchDocs`/`warmSession`,
`learnerMemory` → lines). Callers changed only their imports, from `lib/moss/*` to `lib/retrieval/*`.
Session statuses gained `local`.

**Switch.** `RETRIEVAL_ENGINE=moss` with both `MOSS_PROJECT_ID` and `MOSS_PROJECT_KEY` set uses Moss
(`lib/moss/blocks.ts`, `lib/moss/session.ts`). Anything else is local, including no Moss keys at all.
`CHALKY_BLOCK_RETRIEVAL=all` still turns block retrieval off. Other knobs: `RETRIEVAL_MODEL`,
`RETRIEVAL_CACHE_DIR`, `RETRIEVAL_MIN_SCORE` (0.2), `MOSS_BLOCK_ALPHA` (blend, 0.5), `CHALKY_BLOCK_K` (5).

**Model files.** These are downloaded from the Hugging Face hub on first use into
`.cache/transformers/` under the project root (about 23 MB, gitignored), and read from there afterwards.
`RETRIEVAL_CACHE_DIR` moves them. `instrumentation.ts` loads the model at server start and runs one
throwaway sentence, because the first call is the slow one.

**When blocks change**, run `npx tsx scripts/build-block-vectors.ts`; only changed blocks are
embedded. `npm run build` runs `--check` first and stops with `BLOCK VECTORS OUT OF DATE` if any
catalogue block's vector is missing or was made from different text or another model. In dev, a
stale block is embedded at startup with a warning instead.

`next.config.ts` keeps `@huggingface/transformers`, `onnxruntime-node` and `sharp` out of the bundle
(native addons), as it does Moss's core.

## Fixture: 26 beat briefs, expected block in the top 3

`npx tsx --env-file=.env.local scripts/test-retrieval.ts [--engine=local|moss]` (was `test-moss-blocks.ts`).
Both engines were run on the same block text; the Moss index was rebuilt from it.

| Engine | In top 3 | Miss | Query median | Max |
|---|---|---|---|---|
| local | **25 / 26** | `h2o` (4th: plant, roots, seedling) | 7.3 ms | 26 ms |
| Moss | 25 / 26 | `h2o` (plant, roots, seedling) | 6.8 ms | 13.5 ms |
| keyword fallback (top 5) | 25 / 26 (24 before the attention tags) | glucose | <1 ms | |

The local median includes embedding the query; Moss's query also embeds in process.

**How it got to 25.** The first local run scored 24/26 (`h2o` 9th, `attention` 13th). Three general changes:

- stop words and plural folding in BM25, plus no fuzzy matching, which had matched "matters" to chemistry blocks;
- title and tags as boosted BM25 fields;
- these lifted `h2o` to 4th.

One catalogue change: `attention`'s tags gain "words" and "context", because a brief for learners
says "each word looks back at the other words" and the block only said "tokens". That last change was
made on the fixture itself. Six held-out briefs (cloud, energy, pine-tree, drop, bar-chart, burette)
were 6/6 before and after. Things tried and dropped:

- **bge-small-en-v1.5:** also 24, and 3.5x slower to embed.
- **Embedding only the title, description and tags:** no change.

Every blend from 0.3 to 0.7 scores 25; 0.8 still scores 25 but ranks `h2o` lower, and pure semantic (1.0) scores 24. 0.5 is kept.

## Timings

The two sets below were taken under different conditions, and only the first is a fair absolute number.
The laptop was on battery (25% then 18%, discharging) for the second half of the work, and Windows throttled
it: both engines got 10-20x slower, and their order swapped between runs.
**Redo this table on AC power with `npx tsx --env-file=.env.local scripts/bench-retrieval.ts`**
(for a cold load add `RETRIEVAL_CACHE_DIR=<empty folder>`).

**Light load** (first hours of the session, from the prototype and the fixture runs):

| Measure | Local | Moss |
|---|---|---|
| Model load, cold (download 23 MB + load) | 2.1 s | n/a (cloud index load 1.8-2.1 s) |
| Model load, warm (from `.cache`) | 0.66-1.3 s in a script, 2.9 s in `next dev` | |
| First sentence after load | 67-69 ms (now part of the warm-up) | |
| Embed one short line | 4.0 ms median | |
| Embed block docs (batches of 32) | 30 ms a block (300 blocks in 9 s, once, offline) | |
| Block query (fixture, 26 briefs) | median 7.3 ms | median 6.8 ms |
| Memory (process RSS) | +75 MB for the model in the prototype | |

**Throttled, on battery** (`bench-retrieval.ts`, engines interleaved; two runs):

| Measure | Local, run 1 / run 2 | Moss, run 1 / run 2 |
|---|---|---|
| Model load + first sentence | 13.3 s warm / 16.8 s cold | index load 5.8 s / 8.3 s |
| Embed one board/memory line | 170 / 264 ms median | |
| Block query, 5 hits | 159 / 321 ms median | 172 / 262 ms median |
| Board, 8 docs: index / query | 496 ms, 29 ms / 1.3 s, 124 ms | 3.8 s, 58 ms / 11 s, 25 ms |
| Memory, 6 lines: index / query | 284 ms, 40 ms / 1.1 s, 124 ms | 1.1 s, 44 ms / 0.9 s, 44 ms |
| RSS after loading the local model | 89 → 304-312 MB (transformers.js, onnxruntime and the model) | |

What holds regardless of throttling:

- The local engine has no cloud round trip. It needs no index build on Moss, and a board needs no session creation (Moss's took 0.9-11 s here, 1-7 s live).
- The process gains roughly 215 MB for the local engine.
- The model takes seconds to load at server start; `instrumentation.ts` hides that, as it hid Moss's index load.
- In the production server (`next start`, keys blanked, battery), steady block queries ran 27-62 ms, and the first board upsert took 4.3 s while startup work was still running. Until the model is ready, the fallbacks answer.

## A real lesson (`scripts/e2e-retrieval.mjs`)

Two lessons for one learner (one browser, so one learner cookie), on the fixture plan
`why-is-the-sky-blue-paced`, a dev server with the MOSS keys blanked and `MODEL_PROVIDER=openai`.
Each lesson's question is asked by voice; lesson 1 cuts in mid-beat about the board, lesson 2 (after
lesson 1 was saved to Convex) asks what it got stuck on before. From the transcripts' `retrieval`
events (2026-10-28):

- **Lesson 1** (`20261028203530`), cut in at b3: "Wait, is the red one the longer wave?"
  - `board-index`: 9 elements added, 592 ms, status `local`.
  - `retrieval.board`: `local`, 101 ms, hits `red-wave 0.785`, `waves 0.603`, `sun 0.504`.
  - Reply: "Yes, the red wave is longer, and the blue wave is shorter…"
  - A second run (`20261028204108`): `waves 0.725`, `sun 0.624`, `blue-wave 0.371`, 61 ms.
- **Lesson 2** (`20261028204243`):
  - `retrieval.memory`: `local`, 245 ms, 1 doc, line `earlier lesson "Why the Sky Is Blue" (2026-10-28)`.
  - It appeared on both replies. The board search on the same turns: `sun 0.732`, then `light-path 0.651`, `blue-wave 0.307`.

The first run's lesson 2 had memory `empty`. That lesson's first reply was the one that started the
Convex fetch, and `learnerMemory` waits only 600 ms on a reply's path, so the cold fetch missed that
turn, as designed. In a normal lesson, the intake's reply starts the fetch earlier. The e2e now cuts
in once early (b1) to play that part.

These runs wrote four test lessons to the Convex deployment in `.env.local`.

## Known limits

- **Paraphrases with no shared word** lean on the 384-dim model. On a three-element board, "why does the plant need the yellow thing in the sky" found `glucose` (it shares "plant"), not `sun`. Unrelated utterances ("how do I bake bread", "can you say that again", "wait what") correctly return nothing.
- **The `h2o` brief** ("water molecules travel up" a plant) ranks the plant first on both engines. The beat still gets `h2o`, because the keyword match's top 3 join every pick.
- **`lib/blocks/vectors.json`** is 630 KB, one line per block, so a changed block is a one-line diff.
- **Moss stays installed** (`@moss-js/moss`, `lib/moss/`, `scripts/moss-build-blocks.ts`, the `--engine=moss` test) until Keyon removes it. Removing it means deleting `lib/moss/`, the moss branches in `lib/retrieval/blocks.ts` and `session.ts`, the dev route's Moss fields and the package.
