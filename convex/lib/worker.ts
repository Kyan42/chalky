/** The builder worker on the laptop authenticates every call with a shared secret. */
export function assertWorker(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected) throw new Error("WORKER_SECRET is not set on the Convex deployment (npx convex env set WORKER_SECRET ...)");
  if (secret !== expected) throw new Error("Bad worker secret");
}
