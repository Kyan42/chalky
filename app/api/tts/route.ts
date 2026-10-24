/**
 * POST /api/tts  { text }  →  NDJSON stream of BeatAudioEvent.
 *
 * The Cartesia key, when set (CARTESIA_API_KEY, local runs), is read here on
 * the server and never leaves it. Without it the request goes out with no
 * Authorization header, for environments whose egress proxy injects it. When the
 * browser aborts (interrupt), the upstream Sonic request is aborted too.
 */
import { sonicStream, type BeatAudioEvent } from "@/lib/sonic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 1000) return Response.json({ error: "text is required (max 1000 chars)" }, { status: 400 });

  const upstream = new AbortController();
  const t0 = performance.now();
  request.signal.addEventListener(
    "abort",
    () => {
      upstream.abort();
      console.info(`[tts] browser disconnected after ${Math.round(performance.now() - t0)} ms; Sonic request aborted`);
    },
    { once: true },
  );
  const events = sonicStream(text, upstream.signal);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (error) {
        if (upstream.signal.aborted) return controller.close();
        const message = String((error as Error)?.message ?? error);
        const event: BeatAudioEvent = { type: "error", message, tMs: 0 };
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        controller.close();
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
