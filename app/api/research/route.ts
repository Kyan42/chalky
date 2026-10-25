/**
 * POST /api/research  { question, wait? }  →  ResearchRecord (lib/research/CONTRACT.md).
 * Ready at once from experiments/research-cache; otherwise "running", settling as "ready" or
 * "none" within 8 s. `wait: true` holds the response until it settles; without it, poll
 * GET /api/research/<id>. Development only: `fresh` skips the cache, `budgetMs` lengthens the wait (pre-warming).
 */
import { settled, startResearch } from "@/lib/research/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; topic?: unknown; wait?: unknown; fresh?: unknown; budgetMs?: unknown };
  const raw = typeof body.question === "string" ? body.question : typeof body.topic === "string" ? body.topic : "";
  const question = raw.trim();
  if (!question || question.length > 300) return Response.json({ error: "question is required (max 300 chars)" }, { status: 400 });
  const dev = process.env.NODE_ENV !== "production";
  const budgetMs = dev && typeof body.budgetMs === "number" && body.budgetMs > 0 && body.budgetMs <= 60_000 ? body.budgetMs : undefined;
  let rec = await startResearch(question, { fresh: dev && body.fresh === true, budgetMs });
  if (body.wait === true && rec.status === "running") rec = (await settled(rec.id)) ?? rec;
  return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
}
