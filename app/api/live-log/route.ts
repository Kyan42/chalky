/**
 * POST /api/live-log  { id, ...transcript }  →  { ok, path }
 * Writes one lesson's transcript to experiments/live-runs/<id>.json, replacing
 * the previous write of the same lesson (the page sends the whole transcript
 * every few seconds and at the end). For reviewing live runs afterwards; not
 * available in production.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000_000;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let body: { id?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "not JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[a-z0-9-]{8,100}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const dir = join(process.cwd(), "experiments/live-runs");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  await writeFile(path, JSON.stringify(body, null, 2));
  return Response.json({ ok: true, path: `experiments/live-runs/${id}.json` });
}
