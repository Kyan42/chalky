export const runtime = "nodejs";
export async function GET() {
  try {
    const response = await fetch("https://api.cartesia.ai/voices?limit=100", {
      headers: { "Cartesia-Version": "2026-08-14", ...(process.env.CARTESIA_API_KEY ? { Authorization: `Bearer ${process.env.CARTESIA_API_KEY}` } : {}) },
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: "Couldn't load voices. Try again." }, { status: 502 });
    const data = await response.json();
    const voices = (Array.isArray(data) ? data : data.data || []).filter((v: {id?: string; name?: string}) => v.id && v.name).map((v: {id: string; name: string; language?: string}) => ({ id: v.id, name: v.name, language: v.language || "en" }));
    return Response.json({ voices });
  } catch { return Response.json({ error: "Couldn't load voices. Try again." }, { status: 502 }); }
}
