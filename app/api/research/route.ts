/**
 * POST /api/research  { topic, days? }  →  ResearchRecord, at once (lib/research/CONTRACT.md).
 * Ready straight away from experiments/research-cache; otherwise "running", poll GET /api/research/<id>.
 * Development only: `fresh` skips the cache, `fixture` loads the hand-written set, `only` forces one path.
 */
import { startResearch } from "@/lib/research/papers";
import type { ResearchVia } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATHS: ResearchVia[] = ["apify-arxiv", "apify-rag", "arxiv-api"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { topic?: unknown; days?: unknown; fresh?: unknown; fixture?: unknown; only?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic || topic.length > 200) return Response.json({ error: "topic is required (max 200 chars)" }, { status: 400 });
  const days = typeof body.days === "number" && body.days >= 1 && body.days <= 90 ? body.days : 14;
  const dev = process.env.NODE_ENV !== "production";
  const only = dev && PATHS.includes(body.only as ResearchVia) ? (body.only as ResearchVia) : undefined;
  try {
    const rec = await startResearch(topic, days, { fresh: dev && (body.fresh === true || !!only), fixture: dev && body.fixture === true, only });
    return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
