/**
 * POST /api/sources  { question, title?, beats?, fresh?, fixture? }  →  SourcesRecord, at once.
 * Ready straight away when experiments/sources-cache holds the question; otherwise status
 * "running" with an id to poll at GET /api/sources/<id>; "no-token" without APIFY_TOKEN.
 * `beats` is accepted for the page's convenience but not needed: passages are matched to beats in
 * the browser (lib/sources/match.ts), so a re-planned lesson reuses the same pages.
 * `fresh` (skip the cache) and `fixture` (the hand-written test set) are for development only.
 */
import { startSources } from "@/lib/sources/apify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; title?: unknown; fresh?: unknown; fixture?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) return Response.json({ error: "question is required (max 500 chars)" }, { status: 400 });
  const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
  const dev = process.env.NODE_ENV !== "production";
  try {
    const rec = await startSources(question, title, { fresh: dev && body.fresh === true, fixture: dev && body.fixture === true });
    return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
