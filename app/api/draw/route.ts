/**
 * POST /api/draw  { question, beat, earlier, mode }  →  { elements, ms, model, outputTokens, error, free, learned, blocks }
 * Draws one beat from the planner's layout. `earlier` are the draw beats
 * before it in the same scene. Never fails the lesson: on any problem it
 * answers 200 with no elements and the reason.
 */
import { drawBeat } from "@/lib/lesson/draw";
import type { DrawMode } from "@/lib/lesson/language";
import type { PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; beat?: Partial<PlannedBeat>; earlier?: unknown; model?: unknown; mode?: unknown; free?: unknown };
  const question = typeof body.question === "string" ? body.question : "";
  const beat = body.beat;
  if (!beat || typeof beat.say !== "string" || typeof beat.at !== "string" || typeof beat.id !== "string" || !beat.region) {
    return Response.json({ error: "beat {id, say, at, region, ...} is required" }, { status: 400 });
  }
  const earlier = Array.isArray(body.earlier) ? (body.earlier as PlannedBeat[]) : [];
  // Development only: compare drawing models without restarting the server.
  const model = process.env.NODE_ENV !== "production" && typeof body.model === "string" ? body.model : undefined;
  // Fast (presets only) unless the learner switched Slow mode on.
  const mode: DrawMode = body.mode === "slow" ? "slow" : "fast";
  // Development only: force a free beat (scripts, testing a new block) instead of slow mode's one in five.
  const free = process.env.NODE_ENV !== "production" && body.free === true;
  const result = await drawBeat(question, { adds: [], points: [], ...beat } as PlannedBeat, earlier, request.signal, model, mode, free);
  if (result.error) console.warn(`[draw] ${beat.id}: ${result.error} (${result.ms} ms)`);
  return Response.json(result);
}
