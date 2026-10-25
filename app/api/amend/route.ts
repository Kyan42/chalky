/**
 * POST /api/amend  { question, beats, op: "insert_after" | "replace_from", index, note, heard?, prefix }
 *   →  NDJSON stream of PlanEvent (beat…, done | error).
 * Changes a lesson while it is taught: a detour after a beat, or a new ending.
 * The browser's abort (the learner moved on) aborts the planner too.
 */
import { amendLesson, type AmendOp } from "@/lib/lesson/planner";
import { cleanLearner, type PlanEvent, type PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const op = body.op === "insert_after" || body.op === "replace_from" ? (body.op as AmendOp) : null;
  const beats = Array.isArray(body.beats) ? (body.beats as PlannedBeat[]).filter((b) => b && typeof b.say === "string").slice(0, 40) : [];
  const index = typeof body.index === "number" && Number.isFinite(body.index) ? Math.round(body.index) : NaN;
  const prefix = typeof body.prefix === "string" && /^[a-z][a-z0-9]{0,8}$/.test(body.prefix) ? body.prefix : "x";
  if (!op || !beats.length || Number.isNaN(index)) return Response.json({ error: "op, beats and index are required" }, { status: 400 });

  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort(), { once: true });
  const events = amendLesson(
    {
      question: typeof body.question === "string" ? body.question.slice(0, 500) : "",
      beats: beats.map((b) => ({ ...b, adds: b.adds ?? [], points: b.points ?? [], scene: b.scene ?? 1, mode: b.mode ?? "talk" })),
      op,
      index,
      note: typeof body.note === "string" ? body.note.slice(0, 600) : "",
      heard: typeof body.heard === "string" ? body.heard.slice(0, 600) : undefined,
      said: typeof body.said === "string" ? body.said.slice(0, 600) : undefined,
      prefix,
      intake: body.intake === true,
      learner: cleanLearner(body.learner),
    },
    upstream.signal,
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (error) {
        if (upstream.signal.aborted) return controller.close();
        const event: PlanEvent = { type: "error", message: String((error as Error)?.message ?? error), tMs: 0 };
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        controller.close();
      }
    },
    cancel() {
      upstream.abort();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
