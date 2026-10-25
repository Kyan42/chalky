/**
 * GET /api/research/<id>  →  ResearchRecord (running | ready | failed). 404 for an unknown id.
 */
import { getResearch } from "@/lib/research/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getResearch(id);
  if (!rec) return Response.json({ error: "unknown research id" }, { status: 404 });
  return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
}
