/**
 * POST /api/moss-blocks  { brief, k? }  →  the blocks Moss ranks for a beat brief, the query's
 * latency, and the drawer prompt's block section before (whole catalog) and after (just those).
 * For the dev page /experiments/moss. Waits for the index to load, unlike a live beat.
 */
import { blockById } from "@/lib/blocks";
import { blockLanguageFor, BLOCK_LANGUAGE } from "@/lib/blocks/catalog";
import { BLOCK_INDEX, hasMossKeys, mossState, relevantBlocks, retrievalMode } from "@/lib/moss/blocks";

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
  return Response.json({
    index: BLOCK_INDEX,
    keys: hasMossKeys(),
    mode: retrievalMode(),
    loadMs: mossState()?.loadMs ?? null,
    ...retrieval,
    hits,
    before: BLOCK_LANGUAGE,
    after,
  });
}
