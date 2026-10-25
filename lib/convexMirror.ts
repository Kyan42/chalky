/**
 * Mirrors a lesson transcript into Convex (convex/lessons.ts upsertLesson) from
 * the /api/live-log route, after the file write. A no-op, logged once, when no
 * Convex deployment is configured (NEXT_PUBLIC_CONVEX_URL); a Convex failure is
 * logged and never changes the route's answer.
 */
import "server-only";
import { execSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** Cookie holding the browser's learner id; set by /api/live-log when missing. */
export const LEARNER_COOKIE = "chalky_learner";

let client: ConvexHttpClient | null = null;
let warned = false;
let build: string | null | undefined;

function buildId(): string | null {
  if (build !== undefined) return build;
  build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null;
  if (!build) {
    try {
      build = execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).toString().trim() || null;
    } catch {
      build = null;
    }
  }
  return build;
}

export function convexConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_CONVEX_URL;
}

export async function mirrorLesson(transcript: string, learnerId: string | null): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    if (!warned) console.log("[live-log] Convex mirror off: NEXT_PUBLIC_CONVEX_URL is not set (transcripts go to files only)");
    warned = true;
    return;
  }
  client ??= new ConvexHttpClient(url);
  const t0 = Date.now();
  try {
    await client.mutation(api.lessons.upsertLesson, { transcript, ...(learnerId ? { learnerId } : {}), ...(buildId() ? { build: buildId()! } : {}) });
  } catch (e) {
    console.error(`[live-log] Convex mirror failed after ${Date.now() - t0} ms:`, (e as Error).message ?? e);
  }
}

/** The learner id from the post (an optional `learnerId` field), else the cookie; null if neither is a plausible id. */
export function learnerIdFrom(request: Request, body: { learnerId?: unknown }): string | null {
  const ok = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(s);
  if (ok(body.learnerId)) return body.learnerId;
  const m = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${LEARNER_COOKIE}=([^;]+)`));
  return m && ok(m[1]) ? m[1] : null;
}
