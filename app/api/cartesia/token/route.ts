/**
 * POST /api/cartesia/token  →  { token, version, expiresAt }
 * A short-lived Cartesia access token so the browser can stream the mic to
 * Ink-2 without seeing the API key. Ported from Janani's Convex action (PR #2).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARTESIA_VERSION = "2026-08-14";
const LIFETIME_S = 3600;

export async function POST() {
  const apiKey = process.env.CARTESIA_API_KEY;
  // Without a key here, an egress proxy may add one (see lib/sonic.ts).
  const response = await fetch("https://api.cartesia.ai/access-token", {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grants: { stt: true, tts: true }, expires_in: LIFETIME_S }),
  });
  if (!response.ok) return Response.json({ error: `Cartesia token request failed (${response.status})` }, { status: 502 });
  const { token } = (await response.json()) as { token: string };
  return Response.json({ token, version: CARTESIA_VERSION, expiresAt: Date.now() + LIFETIME_S * 1000 }, { headers: { "Cache-Control": "no-store" } });
}
