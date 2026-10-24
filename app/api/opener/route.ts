/**
 * POST /api/opener  { question }  →  { say, ms, fallback }
 * Chalky's first spoken line, ready in a second or two while the planner thinks.
 */
import { opener } from "@/lib/lesson/opener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  return Response.json(await opener(question));
}
