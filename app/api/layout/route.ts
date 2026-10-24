/**
 * POST /api/layout  { question, beats, fixed }  →  { beats, ms, model }
 * Re-lays out the lesson's visual beats once the whole plan is known: scenes,
 * regions, the ids each beat adds and the ones point beats highlight. `fixed`
 * beats were drawn already and keep their region and ids.
 */
import { layoutLesson, type FixedBeat } from "@/lib/lesson/layout";
import type { PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; beats?: unknown; fixed?: unknown };
  const question = typeof body.question === "string" ? body.question : "";
  if (!Array.isArray(body.beats) || !body.beats.length) return Response.json({ error: "beats are required" }, { status: 400 });
  const fixed = Array.isArray(body.fixed) ? (body.fixed as FixedBeat[]) : [];
  try {
    return Response.json(await layoutLesson(question, body.beats as PlannedBeat[], fixed, request.signal));
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    console.warn(`[layout] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
