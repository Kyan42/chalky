/**
 * POST /api/reply  { question, said, now?, heard, kind }  →  { say, intent, ms }
 * Chalky's spoken answer when the learner talks back mid-lesson.
 */
import { reply } from "@/lib/lesson/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question : "";
  const heard = typeof body.heard === "string" ? body.heard.trim() : "";
  const said = Array.isArray(body.said) ? body.said.filter((s): s is string => typeof s === "string").slice(-20) : [];
  const kind = body.kind === "interrupt" ? "interrupt" : "check-in";
  if (!heard) return Response.json({ error: "heard is required" }, { status: 400 });
  try {
    return Response.json(await reply({ question, said, now: typeof body.now === "string" ? body.now : undefined, heard, kind }));
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
