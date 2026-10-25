/**
 * POST /api/board-index  { lesson, docs: [{ id, label, scene, said }] }  →  { added, ms, status }
 * Keeps the lesson's board index current: one document per element on the board (any scene), sent by
 * the page as beats and sketches land. /api/converse searches it with each utterance (lib/moss/session.ts).
 */
import { upsertDocs } from "@/lib/moss/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const lesson = typeof body.lesson === "string" && /^[a-z0-9-]{8,100}$/.test(body.lesson) ? body.lesson : null;
  if (!lesson) return Response.json({ error: "lesson is required" }, { status: 400 });
  const docs = (Array.isArray(body.docs) ? body.docs : []).slice(0, 200).flatMap((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.slice(0, 60) : "";
    const label = typeof o.label === "string" ? o.label.slice(0, 120) : "";
    const said = typeof o.said === "string" ? o.said.slice(0, 300) : "";
    const scene = typeof o.scene === "number" ? String(Math.round(o.scene)) : "1";
    return id ? [{ id, text: `${label} (${id.replace(/[-_.]/g, " ")}). Scene ${scene}. ${said}`, meta: { label, scene, said } }] : [];
  });
  const r = await upsertDocs(`board-${lesson}`, docs);
  return Response.json(r);
}
