/**
 * POST /api/live-log  { id, ...transcript }  →  { ok, path }
 * Writes one lesson's transcript to experiments/live-runs/<id>.json, replacing
 * the previous write of the same lesson (the page sends the whole transcript
 * every few seconds, at the end, and when the tab closes). For reviewing live
 * runs afterwards. Writes only when CHALKY_LIVE_LOG=1 (in any NODE_ENV, so a
 * frozen production build can record too).
 * With a Convex deployment (NEXT_PUBLIC_CONVEX_URL) the transcript is also
 * mirrored into Convex (lib/convexMirror.ts), with the browser's learner id
 * from a cookie this route sets; refuses when neither is on.
 *
 * GET /api/live-log → recent transcripts' summaries; ?id=<id> → one transcript.
 * Reads the files back for /log when there is no Convex deployment.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { convexConfigured, LEARNER_COOKIE, learnerIdFrom, mirrorLesson } from "@/lib/convexMirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000_000;
const DIR = () => join(process.cwd(), "experiments/live-runs");

export async function POST(request: Request) {
  const toFile = process.env.CHALKY_LIVE_LOG === "1";
  if (!toFile && !convexConfigured()) return Response.json({ error: "transcripts are off (set CHALKY_LIVE_LOG=1)" }, { status: 403 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let body: { id?: unknown; learnerId?: unknown; endMarker?: unknown; end?: unknown; endedAt?: unknown; fromEvent?: unknown; events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "not JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[a-z0-9-]{8,100}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  let learnerId = learnerIdFrom(request, body);
  const newLearner = !learnerId;
  learnerId ??= `l-${crypto.randomUUID().slice(0, 13)}`;
  let saved = text;
  let endMarker = false;
  if (body.endMarker === true) {
    // The tab closed on a transcript too big for one beacon: mark the saved file ended, with the events since.
    // Without a file to merge into there is nothing whole to mirror, so Convex keeps its last full copy.
    if (!toFile) return Response.json({ ok: true, path: null, learnerId, endMarker: true });
    const path = join(DIR(), `${id}.json`);
    const before = await readFile(path, "utf8").then((t) => JSON.parse(t) as { events?: unknown[] } & Record<string, unknown>).catch(() => null);
    const tail = Array.isArray(body.events) ? body.events : [];
    const from = typeof body.fromEvent === "number" ? body.fromEvent : Infinity;
    const merged = before ?? { id, events: [] };
    merged.events = [...(merged.events ?? []).slice(0, from), ...tail];
    merged.end = typeof body.end === "string" ? body.end : "closed";
    merged.endedAt = typeof body.endedAt === "string" ? body.endedAt : new Date().toISOString();
    saved = JSON.stringify(merged);
    endMarker = true;
  }
  if (toFile) {
    await mkdir(DIR(), { recursive: true });
    await writeFile(join(DIR(), `${id}.json`), JSON.stringify(JSON.parse(saved), null, 2));
  }
  await mirrorLesson(saved, learnerId);
  const res = Response.json({ ok: true, path: toFile ? `experiments/live-runs/${id}.json` : null, learnerId, ...(endMarker ? { endMarker } : {}) });
  if (newLearner) res.headers.append("Set-Cookie", `${LEARNER_COOKIE}=${learnerId}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return res;
}

export async function GET(request: Request) {
  if (process.env.CHALKY_LIVE_LOG !== "1") return Response.json({ error: "transcripts are off (set CHALKY_LIVE_LOG=1)" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (!/^[a-z0-9-]{8,100}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    try {
      return new Response(await readFile(join(DIR(), `${id}.json`), "utf8"), { headers: { "Content-Type": "application/json" } });
    } catch {
      return Response.json(null, { status: 404 });
    }
  }
  const names = (await readdir(DIR()).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
  const recent = (await Promise.all(names.map(async (n) => ({ n, m: (await stat(join(DIR(), n))).mtimeMs }))))
    .sort((a, b) => b.m - a.m)
    .slice(0, 25);
  const lessons = await Promise.all(
    recent.map(async ({ n, m }) => {
      const t = JSON.parse(await readFile(join(DIR(), n), "utf8"));
      return { lessonId: t.id, question: t.question ?? "", title: t.title ?? "", startedAt: t.startedAt ?? "", end: t.end ?? null, eventCount: t.events?.length ?? 0, beatCount: t.beats?.length ?? 0, updatedAt: m };
    }),
  );
  return Response.json(lessons);
}
