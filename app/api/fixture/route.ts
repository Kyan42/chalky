/**
 * GET /api/fixture?name=<slug>&beats=<n>  →  NDJSON PlanEvents from a saved plan
 * (experiments/converse/fixtures/<slug>.json), development only. Lets the
 * lesson be tested without spending a planner call: /lesson?fixture=<slug>&beats=3.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlanEvent, PlannedBeat } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!/^[a-z0-9-]{1,60}$/.test(name)) return Response.json({ error: "bad name" }, { status: 400 });
  const max = Math.max(1, Math.min(40, Number(url.searchParams.get("beats")) || 40));
  let fixture: { title: string; beats: PlannedBeat[] };
  try {
    fixture = JSON.parse(await readFile(join(process.cwd(), "experiments/converse/fixtures", `${name}.json`), "utf8"));
  } catch {
    return Response.json({ error: "no such fixture" }, { status: 404 });
  }
  const events: PlanEvent[] = [
    { type: "title", title: fixture.title, tMs: 0 },
    ...fixture.beats.slice(0, max).map((beat, i) => ({ type: "beat" as const, beat, tMs: 50 * (i + 1) })),
    { type: "done", tMs: 50 * (max + 1), inputTokens: 0, outputTokens: 0 },
  ];
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
