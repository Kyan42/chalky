/**
 * GET /api/sources/<id>  →  SourcesRecord (status running | ready | failed, and the cards so far).
 * 404 for an id this server does not know (it restarted, or the id is made up).
 */
import { getRun } from "@/lib/sources/apify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getRun(id);
  if (!rec) return Response.json({ error: "unknown sources id" }, { status: 404 });
  return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
}
