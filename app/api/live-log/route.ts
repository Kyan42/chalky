/**
 * POST /api/live-log  { id, ...transcript }  →  { ok, path }
 * Writes one lesson's transcript to experiments/live-runs/<id>.json, replacing
 * the previous write of the same lesson (the page sends the whole transcript
 * every few seconds, at the end, and when the tab closes). For reviewing live
 * runs afterwards. Writes only when CHALKY_LIVE_LOG=1 (in any NODE_ENV, so a
 * frozen production build can record too); refuses otherwise.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000_000;

export async function POST(request: Request) {
  if (process.env.CHALKY_LIVE_LOG !== "1") return Response.json({ error: "transcripts are off (set CHALKY_LIVE_LOG=1)" }, { status: 403 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let body: { id?: unknown; endMarker?: unknown; end?: unknown; endedAt?: unknown; fromEvent?: unknown; events?: unknown };
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
  if (body.endMarker === true) {
    // The tab closed on a transcript too big for one beacon: mark the saved file ended, with the events since.
    const saved = await readFile(path, "utf8").then((t) => JSON.parse(t) as { events?: unknown[] } & Record<string, unknown>).catch(() => null);
    const tail = Array.isArray(body.events) ? body.events : [];
    const from = typeof body.fromEvent === "number" ? body.fromEvent : Infinity;
    const merged = saved ?? { id, events: [] };
    merged.events = [...(merged.events ?? []).slice(0, from), ...tail];
    merged.end = typeof body.end === "string" ? body.end : "closed";
    merged.endedAt = typeof body.endedAt === "string" ? body.endedAt : new Date().toISOString();
    await writeFile(path, JSON.stringify(merged, null, 2));
    return Response.json({ ok: true, path: `experiments/live-runs/${id}.json`, endMarker: true });
  }
  await writeFile(path, JSON.stringify(body, null, 2));
  return Response.json({ ok: true, path: `experiments/live-runs/${id}.json` });
}
