/**
 * POST /api/plan  { question }  →  NDJSON stream of PlanEvent.
 * ANTHROPIC_API_KEY is read here on the server only.
 */
import { planLesson } from "@/lib/lesson/planner";
import type { PlanEvent } from "@/lib/lesson/types";
import { prefetchBlocks } from "@/lib/retrieval/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; effort?: unknown; material?: unknown };
  // Research material to teach from (recent papers with citation tags), from /api/research.
  const material = typeof body.material === "string" && body.material.trim() ? body.material.slice(0, 40_000) : undefined;
  // Development only: compare planner effort levels without restarting the server.
  const effort = process.env.NODE_ENV !== "production" && (body.effort === "low" || body.effort === "medium" || body.effort === "high") ? body.effort : undefined;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) return Response.json({ error: "question is required (max 500 chars)" }, { status: 400 });

  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort(), { once: true });
  const events = planLesson(question, upstream.signal, effort, material);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        // Start the beat's block pick now, seconds before it is drawn (lib/retrieval/blocks.ts).
        if (value?.type === "beat") prefetchBlocks(value.beat);
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
