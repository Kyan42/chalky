import { existsSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..");

for (const file of [".env.local", ".env.worker"]) {
  const full = path.join(ROOT, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

function required(name: string) {
  const value = process.env[name];
  if (!value || value.startsWith("YOUR_")) {
    throw new Error(`${name} is not set. Add it to .env.worker (see .env.worker.example).`);
  }
  return value;
}

export const env = {
  convexUrl: () => process.env.CONVEX_URL ?? required("NEXT_PUBLIC_CONVEX_URL"),
  workerSecret: () => required("WORKER_SECRET"),
  cartesiaKey: () => required("CARTESIA_API_KEY"),
  voiceId: () => process.env.CARTESIA_VOICE_ID ?? "694f9389-aac1-45b6-b726-9d9369183238",
  builderModel: () => process.env.BUILDER_MODEL ?? "claude-opus-5-5",
  concurrency: () => Number(process.env.WORKER_CONCURRENCY ?? 2),
};
