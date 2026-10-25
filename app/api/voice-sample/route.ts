/**
 * POST /api/voice-sample { voice, speed }  →  audio/wav: the greeting in that voice at that speed, for the
 * Preferences dialog. Cartesia's /tts/bytes (wav, 16-bit PCM, 24 kHz, the lesson's model), cached in memory
 * per voice and speed so a repeat pick is instant. Only the curated voices and speeds (lib/voices.ts).
 */
import { CARTESIA_VERSION, sonicModel, SONIC_ENCODING, SONIC_SAMPLE_RATE } from "@/lib/sonic";
import { DEFAULT_VOICE_ID, SAMPLE_LINE, SPEEDS, VOICES } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, ArrayBuffer>();

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { voice?: unknown; speed?: unknown };
  const voice = VOICES.find((v) => v.id === b.voice)?.id ?? DEFAULT_VOICE_ID;
  const speed: number = SPEEDS.find((s) => s.value === String(b.speed ?? "default"))?.speed ?? 0.92;
  const key = `${voice}@${speed}`;
  let audio = cache.get(key);
  if (!audio) {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      signal: request.signal,
      headers: {
        ...(process.env.CARTESIA_API_KEY ? { Authorization: `Bearer ${process.env.CARTESIA_API_KEY}` } : {}),
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: sonicModel(),
        transcript: SAMPLE_LINE,
        voice: { id: voice },
        output_format: { container: "wav", encoding: SONIC_ENCODING, sample_rate: SONIC_SAMPLE_RATE },
        language: "en",
        ...(speed !== 1 ? { generation_config: { speed } } : {}),
      }),
    }).catch((e) => new Response(String(e), { status: 502 }));
    if (!response.ok) return Response.json({ error: `Cartesia responded ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}` }, { status: 502 });
    audio = await response.arrayBuffer();
    cache.set(key, audio);
  }
  return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" } });
}
