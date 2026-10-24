// The animation builder. Runs on your laptop next to Claude Code:  npm run worker
// It claims jobs from Convex, builds them, and writes the results back.
import { hostname } from "node:os";
import { api } from "../convex/_generated/api";
import { workerMutation } from "./convex";
import { env } from "./env";
import { buildChapter, buildChapterFeedback, buildDetour, buildFeedback, exportLesson, type Job } from "./handlers";

const workerId = `${hostname()}-${process.pid}`;
const POLL_MS = 2500;
const HEARTBEAT_MS = 30_000;

const handlers: Record<Job["kind"], (job: Job, progress: (message: string) => Promise<void>) => Promise<void>> = {
  chapter: buildChapter,
  chapter_feedback: buildChapterFeedback,
  detour: buildDetour,
  feedback: buildFeedback,
  export: exportLesson,
};

async function work(job: Job) {
  const label = `${job.kind} ${job._id}`;
  console.log(`→ ${label} (attempt ${job.attempts})`);
  let last = "";
  const progress = async (message: string) => {
    if (message === last) return;
    last = message;
    console.log(`  ${label}: ${message}`);
    await workerMutation(api.jobs.progress, { jobId: job._id, progress: message }).catch(() => {});
  };
  // Keep the claim alive during long silent stretches (Claude Code thinking, exports).
  const heartbeat = setInterval(() => void workerMutation(api.jobs.progress, { jobId: job._id, progress: last || "Working" }).catch(() => {}), HEARTBEAT_MS);
  const started = Date.now();
  try {
    await handlers[job.kind](job, progress);
    console.log(`✓ ${label} in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${label}: ${message}`);
    await workerMutation(api.jobs.fail, { jobId: job._id, error: message.slice(0, 2000) }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  const slots = env.concurrency();
  let running = 0;
  console.log(`Chalky builder ${workerId}: ${slots} slot(s), Convex ${env.convexUrl()}`);
  for (;;) {
    while (running < slots) {
      const job = (await workerMutation(api.jobs.claim, { workerId }).catch((error) => {
        console.error(`claim failed: ${error instanceof Error ? error.message : error}`);
        return null;
      })) as Job | null;
      if (!job) break;
      running++;
      void work(job).finally(() => running--);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void main();
