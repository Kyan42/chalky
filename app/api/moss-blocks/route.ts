/**
 * POST /api/moss-blocks  { brief, k? }  →  the blocks the retrieval engine (local or Moss,
 * lib/retrieval/blocks.ts) ranks for a beat brief, the query's latency, the keyword fallback's pick
 * for the same brief, and the drawer prompt's block section for the engine's pick.
 * For the dev page /experiments/moss. Waits for the engine to load, unlike a live beat.
 */
import { blockById } from "@/lib/blocks";
import { blockLanguageFor, keywordBlocks } from "@/lib/blocks/catalog";
import { BLOCK_INDEX, mossState } from "@/lib/moss/blocks";
import { hasMossKeys, relevantBlocks, retrievalEngine, retrievalMode } from "@/lib/retrieval/blocks";
import { EMBED_STAMP, modelLoadMs } from "@/lib/retrieval/embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { brief?: unknown; k?: unknown };
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return Response.json({ error: "brief is required" }, { status: 400 });
  const k = Math.max(1, Math.min(15, Number(body.k) || 4));
  const retrieval = await relevantBlocks(brief, k, { waitForLoad: true, force: true });
  const hits = (retrieval.hits ?? []).map((h) => ({ ...h, title: blockById(h.id)?.title ?? h.id }));
  const after = retrieval.hits ? blockLanguageFor(retrieval.hits.map((h) => blockById(h.id)!)) : null;
  const moss = retrievalEngine() === "moss";
  return Response.json({
    index: moss ? BLOCK_INDEX : `local ${EMBED_STAMP} + BM25, lib/blocks/vectors.json`,
    keys: hasMossKeys(),
    mode: retrievalMode(),
    loadMs: moss ? (mossState()?.loadMs ?? null) : modelLoadMs(),
    ...retrieval,
    hits,
    keywords: keywordBlocks(brief, k).map((b) => b.id),
    after,
  });
}
