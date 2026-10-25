/**
 * Replays a saved lesson transcript through POST /api/live-log the way the page
 * sends it: the whole transcript so far, growing, every `--every` ms, then the
 * final one. For checking the Convex mirror and the /log page without running
 * a lesson (no model or voice calls).
 *
 *   npx tsx scripts/replay-live-run.ts <transcript.json> [--base http://localhost:3010] [--every 500] [--id <new-id>] [--learner <id>]
 *
 * --id posts it under a new lesson id (so a replay shows as a new, live lesson);
 * --learner sends a learner id cookie, as the browser would.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file) throw new Error("usage: replay-live-run.ts <transcript.json> [--base url] [--every ms] [--id id] [--learner id]");
const base = flag("base") ?? "http://localhost:3010";
const every = Number(flag("every") ?? 500);
const learner = flag("learner");

const full = JSON.parse(readFileSync(file, "utf8"));
if (flag("id")) full.id = flag("id");
const events: Record<string, unknown>[] = full.events ?? [];
const beatOf = (e: Record<string, unknown>) => (full.beats ?? []).findIndex((b: Record<string, unknown>) => b.beatId === e.beatId && b.endMs === e.endMs);

async function post(body: unknown) {
  const r = await fetch(`${base}/api/live-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(learner ? { Cookie: `chalky_learner=${learner}` } : {}) },
    body: JSON.stringify(body),
  });
  return `${r.status} ${await r.text()}`;
}

async function main() {
  const step = Math.max(1, Math.ceil(events.length / 20));
  for (let n = step; n < events.length; n += step) {
    const seen = events.slice(0, n);
    const beats = seen.filter((e) => e.kind === "beat").map(beatOf).filter((i) => i >= 0).map((i) => full.beats[i]);
    const title = seen.some((e) => e.kind === "plan-title") ? full.title : "";
    const res = await post({ ...full, title, events: seen, beats, learner: null, prefetch: null, endedAt: null, end: null });
    console.log(`${n}/${events.length} events, ${beats.length} beats → ${res}`);
    await new Promise((r) => setTimeout(r, every));
  }
  console.log(`final → ${await post(full)}`);
}

void main();
