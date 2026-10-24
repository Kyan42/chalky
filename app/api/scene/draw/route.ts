/**
 * POST /api/scene/draw  { question, beat, plan, earlier, model? }  →  { elements, ms }
 * Draws one beat inside its region from the layout plan. The browser compiles the board.
 */
import { drawBeat, type LayoutBeat } from "@/lib/lesson/scenes";
import type { PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string; beat?: PlannedBeat; plan?: LayoutBeat; earlier?: LayoutBeat[]; model?: string };
  if (!body.beat || !body.plan) return Response.json({ error: "beat and plan are required" }, { status: 400 });
  const model = body.model && MODELS.has(body.model) ? body.model : "claude-sonnet-5-5";
  try {
    return Response.json(await drawBeat(body.question ?? "", body.beat, body.plan, body.earlier ?? [], model, request.signal));
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
