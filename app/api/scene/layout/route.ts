/**
 * POST /api/scene/layout  { question, beats, fixed }  →  { plan, ms }
 * Splits the lesson into scenes and gives every visual beat a region and element ids.
 */
import { layoutLesson, type FixedBeat } from "@/lib/lesson/scenes";
import type { PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string; beats?: PlannedBeat[]; fixed?: FixedBeat[] };
  if (!Array.isArray(body.beats) || !body.beats.length) return Response.json({ error: "beats are required" }, { status: 400 });
  try {
    return Response.json(await layoutLesson(body.question ?? "", body.beats, body.fixed ?? [], request.signal));
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
