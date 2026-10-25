/**
 * POST /api/converse  { utterance, question, beats, beatIndex, wordIndex, board, history, escalation }
 *   →  NDJSON stream of ConverseEvent: start, sentence…, trailer, done.
 *
 * The fast reply to whatever the learner says mid-lesson. When the browser
 * aborts (the learner spoke again), the model request is aborted too.
 */
import { converse, type ConverseEvent, type ConverseInput } from "@/lib/lesson/converse";
import { decideIntake, intakeQuestion } from "@/lib/lesson/intake";
import { cleanLearner, type BeatMode } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);

function parse(body: Record<string, unknown>): ConverseInput | string {
  const utterance = str(body.utterance, 1000).trim();
  if (!utterance) return "utterance is required";
  const beats = Array.isArray(body.beats)
    ? body.beats.slice(0, 30).map((b, i) => {
        const o = (b ?? {}) as Record<string, unknown>;
        const mode: BeatMode = o.mode === "point" || o.mode === "talk" ? o.mode : "draw";
        const section = str(o.section, 160).trim();
        return { id: str(o.id, 60) || `b${i + 1}`, say: str(o.say, 600), mode, ...(section ? { section } : {}), ...(o.check === true ? { check: true } : {}) };
      })
    : [];
  const board = Array.isArray(body.board)
    ? body.board.slice(0, 80).flatMap((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const id = str(o.id, 60).trim();
        return id ? [{ id, kind: str(o.kind, 30) || "element", label: str(o.label, 120) }] : [];
      })
    : [];
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).flatMap((h) => {
        const o = (h ?? {}) as Record<string, unknown>;
        const text = str(o.text, 600).trim();
        return text ? [{ who: o.who === "chalky" ? ("chalky" as const) : ("learner" as const), text }] : [];
      })
    : [];
  const esc = int(body.escalation, 0);
  return {
    utterance,
    question: str(body.question, 500),
    beats,
    beatIndex: Math.min(beats.length - 1, int(body.beatIndex, -1)),
    wordIndex: int(body.wordIndex, -1),
    board,
    history,
    escalation: esc >= 2 ? 2 : esc === 1 ? 1 : 0,
    learner: cleanLearner(body.learner),
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // The intake, before the lesson: ask one question, then decide from the answer. Plain JSON, not streamed.
  if (body.intent === "intake_ask" || body.intent === "intake_answer") {
    const question = str(body.question, 500).trim();
    if (!question) return Response.json({ error: "question is required" }, { status: 400 });
    try {
      if (body.intent === "intake_ask") return Response.json(await intakeQuestion(question, request.signal));
      const answer = str(body.answer, 600).trim();
      if (!answer) return Response.json({ error: "answer is required" }, { status: 400 });
      const beats = Array.isArray(body.beats) ? body.beats.filter((b): b is string => typeof b === "string").slice(0, 4) : [];
      return Response.json(await decideIntake({ question, asked: str(body.asked, 300), answer, beats }, request.signal));
    } catch (error) {
      return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
    }
  }
  const input = parse(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  const upstream = new AbortController();
  const t0 = performance.now();
  request.signal.addEventListener(
    "abort",
    () => {
      upstream.abort();
      console.info(`[converse] browser disconnected after ${Math.round(performance.now() - t0)} ms; model request aborted`);
    },
    { once: true },
  );
  const events = converse(input, upstream.signal);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (error) {
        if (upstream.signal.aborted) return controller.close();
        const event: ConverseEvent = { type: "error", message: String((error as Error)?.message ?? error), tMs: Math.round(performance.now() - t0) };
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
