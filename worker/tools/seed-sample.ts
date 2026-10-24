// Dev helper: completes the next queued chapter job with the kit's sample animation, so the app
// can be tried end to end without Cartesia or Claude Code.
//   npx tsx worker/kit/sample.ts && npx tsx worker/tools/seed-sample.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { api } from "../../convex/_generated/api";
import { upload, workerMutation } from "../convex";
import { ROOT } from "../env";

async function main() {
  const job = await workerMutation(api.jobs.claim, { workerId: "seed-sample" });
  if (!job) return console.log("No queued jobs.");
  if (job.kind !== "chapter") {
    await workerMutation(api.jobs.fail, { jobId: job._id, error: "seed-sample only fills chapter jobs" });
    return console.log(`Skipped a ${job.kind} job.`);
  }
  const document = readFileSync(path.join(ROOT, "public/dev/sample.json"), "utf8");
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/dev/sample.manifest.json"), "utf8"));
  const parsed = JSON.parse(document);
  const segment = {
    documentStorageId: await upload(document, "application/json"),
    assets: [],
    manifest,
    durationTicks: parsed.timing.durationTicks,
    ticksPerSecond: parsed.timing.ticksPerSecond,
  };
  await workerMutation(api.jobs.completeChapter, {
    jobId: job._id,
    segments: [
      { kind: "chapter", ...segment },
      { kind: "feedback_correct", ...segment },
      { kind: "feedback_mistake", ...segment },
    ],
  });
  console.log(`Filled chapter job ${job._id} for session ${job.sessionId} with the sample animation.`);
}

void main();
