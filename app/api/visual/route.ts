/**
 * POST /api/visual  { question, beat, board }  →  { doc, board, cleared, ms, attempts }
 * Draws one beat onto the growing board and compiles the whole board to Clayzo.
 * The client keeps `board` and sends it back with the next beat.
 */
import type { BoardElement } from "@/lib/lesson/board";
import type { PlannedBeat } from "@/lib/lesson/types";
import { generateVisual } from "@/lib/lesson/visual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; beat?: Partial<PlannedBeat>; board?: unknown };
  const question = typeof body.question === "string" ? body.question : "";
  const beat = body.beat;
  if (!beat || typeof beat.say !== "string" || typeof beat.at !== "string" || typeof beat.visual !== "string" || typeof beat.id !== "string") {
    return Response.json({ error: "beat {id, say, at, visual} is required" }, { status: 400 });
  }
  const board = Array.isArray(body.board) ? (body.board as BoardElement[]) : [];
  try {
    const result = await generateVisual(question, beat as PlannedBeat, board, request.signal);
    return Response.json(result, { status: result.doc ? 200 : 502 });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
