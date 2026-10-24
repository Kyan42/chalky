/**
 * POST /api/visual  { question, beat }  →  { doc, ms, attempts }
 * Generates one beat's scene-language visual and compiles it to Clayzo.
 */
import { generateVisual } from "@/lib/lesson/visual";
import type { PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; beat?: Partial<PlannedBeat> };
  const question = typeof body.question === "string" ? body.question : "";
  const beat = body.beat;
  if (!beat || typeof beat.say !== "string" || typeof beat.at !== "string" || typeof beat.visual !== "string" || typeof beat.id !== "string") {
    return Response.json({ error: "beat {id, say, at, visual} is required" }, { status: 400 });
  }
  try {
    const result = await generateVisual(question, beat as PlannedBeat, request.signal);
    return Response.json(result, { status: result.doc ? 200 : 502 });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
